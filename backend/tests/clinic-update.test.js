const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { CONSENT_VERSION, assertConsentAccess } = require('../tools/medicalConsent');

// Exercise actual route handlers and authentication without touching a live DB.
const calls = [];
let accepted = false;
let sessionVersion = 1;
let existingPatient = false;
let duplicateQueue = false;
const client = {
  release() {},
  async query(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('SELECT user_id, role::text')) return { rowCount: 1, rows: [{
      user_id: 7, role: 'user', account_status: 'active', session_version: sessionVersion,
      medical_consent_at: accepted ? new Date() : null, medical_consent_version: accepted ? CONSENT_VERSION : null,
    }] };
    if (sql.includes('SET medical_consent_at = CASE')) accepted = true;
    if (sql.includes('session_version = session_version + 1')) { accepted = false; sessionVersion++; }
    if (sql.includes('SELECT 1 FROM clinic.queue_tickets')) return { rowCount: duplicateQueue ? 1 : 0, rows: [] };
    if (sql.includes('SELECT u.user_id')) return { rowCount: existingPatient ? 1 : 0, rows: existingPatient ? [{ user_id: 7 }] : [] };
    if (sql.includes('INSERT INTO clinic.users')) return { rows: [{ user_id: 7 }] };
    if (sql.includes('INSERT INTO clinic.queue_tickets')) return { rows: [{ queue_id: 9, queue_number: values[0] }] };
    return { rowCount: 1, rows: [] };
  },
};
require.cache[require.resolve('../tools/db')] = { exports: { connect: async () => client } };
const { JWT_SECRET } = require('../tools/config');
const { authRequired } = require('../tools/_utils');
const consentRouter = require('../routes/medicalConsent');
const queueRouter = require('../routes/queue');
function handler(router, path, method) {
  return router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]).route.stack.at(-1).handle;
}
function response() {
  return { statusCode: 200, cookies: [], status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, clearCookie(name) { this.cookies.push(name); },
    sendStatus(code) { this.statusCode = code; }, setHeader() {} };
}

test('unconsented accounts can only read session/consent and submit consent or logout', () => {
  for (const role of ['user', 'users']) {
    for (const path of ['/api/me/profile', '/api/appointments', '/api/users/medical-consent/extra']) {
      assert.throws(() => assertConsentAccess({ role, medical_consent: false }, { method: 'GET', originalUrl: path }), { code: 'MEDICAL_CONSENT_REQUIRED' });
    }
    assert.doesNotThrow(() => assertConsentAccess({ role }, { method: 'GET', originalUrl: '/api/users/me?check=1' }));
    assert.doesNotThrow(() => assertConsentAccess({ role }, { method: 'POST', originalUrl: '/api/users/medical-consent' }));
  }
  assert.doesNotThrow(() => assertConsentAccess({ role: 'admin' }, { method: 'GET', originalUrl: '/api/patients' }));
  assert.doesNotThrow(() => assertConsentAccess({ role: 'user', medical_consent: true }, { method: 'GET', originalUrl: '/api/me/profile' }));
});

test('accept persists consent, decline revokes existing tokens, stale versions are rejected', async () => {
  const post = handler(consentRouter, '/medical-consent', 'post');
  const token = jwt.sign({ sub: 7, sv: 1 }, JWT_SECRET);
  const request = () => ({ method: 'GET', originalUrl: '/api/me/profile', headers: { authorization: `Bearer ${token}` } });
  const blocked = response();
  await authRequired(request(), blocked, () => assert.fail('must not allow access before consent'));
  assert.equal(blocked.statusCode, 403);
  const invalid = response();
  await post({ user: { user_id: 7, role: 'user' }, body: { accepted: true, version: 'old' } }, invalid, assert.fail);
  assert.equal(invalid.statusCode, 400);
  const saved = response();
  await post({ user: { user_id: 7, role: 'user' }, body: { accepted: true, version: CONSENT_VERSION } }, saved, assert.fail);
  assert.deepEqual(saved.body, { accepted: true });
  let permitted = false;
  await authRequired(request(), response(), () => { permitted = true; });
  assert.equal(permitted, true);
  const declined = response();
  await post({ user: { user_id: 7, role: 'user' }, body: { accepted: false, version: CONSENT_VERSION } }, declined, assert.fail);
  assert.deepEqual(declined.cookies, ['authToken', 'userToken']);
  const revoked = response();
  await authRequired(request(), revoked, () => assert.fail('old token must be revoked'));
  assert.equal(revoked.statusCode, 401);
});

test('walk-in rejects missing/invalid receipt numbers before writing and rejects duplicates', async () => {
  const post = handler(queueRouter, '/issue-walkin', 'post');
  for (const receipt_queue of [undefined, '', 'B', 'B000', 'A001', 'B01', 'B1000']) {
    calls.length = 0;
    const res = response();
    await post({ body: { receipt_queue } }, res, assert.fail);
    assert.equal(res.statusCode, 400);
    assert.equal(calls.length, 0);
  }
  duplicateQueue = true;
  const res = response();
  await post({ body: { receipt_queue: 'B001', service_date: '2026-09-18' } }, res, assert.fail);
  assert.equal(res.statusCode, 409);
  duplicateQueue = false;
});

test('walk-in stores underlying disease for new and existing patients with exact receipt number', async () => {
  const post = handler(queueRouter, '/issue-walkin', 'post');
  for (const existing of [false, true]) {
    existingPatient = existing;
    calls.length = 0;
    const res = response();
    await post({ body: {
      receipt_queue: 'B042', service_date: '2026-09-18', user_id: existing ? 7 : null,
      patient: { first_name: 'Test', last_name: 'Patient', congenital_disease: 'โรคประจำตัวทดสอบ' },
    } }, res, assert.fail);
    assert.equal(res.statusCode, 200);
    const write = calls.find(({ sql }) => sql.includes(`${existing ? 'UPDATE' : 'INSERT INTO'} clinic.user_details`));
    assert.ok(write.sql.includes('congenital_disease'));
    assert.equal(write.values[11], 'โรคประจำตัวทดสอบ');
    assert.equal(res.body.ticket.queue_number, 'B042');
    assert.equal(calls.some(({ sql }) => sql.includes('MAX(numeric_no)')), false);
  }
});
