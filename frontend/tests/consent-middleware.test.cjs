/* eslint-disable @typescript-eslint/no-require-imports -- Node's CommonJS test runner loads the TypeScript middleware in a VM. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { NextRequest } = require('next/server');
const source = fs.readFileSync(path.join(__dirname, '../src/middleware.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

async function run(url, session) {
  const exports = {};
  vm.runInNewContext(code, { exports, require, process, URL, AbortSignal,
    fetch: async () => ({ ok: Boolean(session), json: async () => session }),
  });
  return exports.middleware(new NextRequest(`https://clinic.test${url}`, {
    headers: { cookie: 'userToken=test; adminToken=staff' },
  }));
}

test('Google, LINE and local users must consent before home or profile completion', async () => {
  for (const registration_source of ['google', 'line', 'local']) {
    for (const page of ['/users/userHome', '/users/userprofile', '/google/complete-profile', '/line/complete-profile']) {
      const res = await run(page, { role: 'user', registration_source, profile_completed: false, medical_consent: false });
      assert.equal(res.headers.get('location'), 'https://clinic.test/medical-consent');
    }
  }
});

test('consent page stays accessible before profile completion and is never cached', async () => {
  const res = await run('/medical-consent', { role: 'user', registration_source: 'google', medical_consent: false });
  assert.equal(res.headers.get('location'), null);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
});

test('accepted users resume profile flow or home and staff bypass patient consent', async () => {
  const profile = await run('/users/userHome', { role: 'user', registration_source: 'google', medical_consent: true, profile_completed: false });
  assert.equal(profile.headers.get('location'), 'https://clinic.test/google/complete-profile');
  const home = await run('/users/userHome', { role: 'user', medical_consent: true, profile_completed: true });
  assert.equal(home.headers.get('location'), null);
  const staff = await run('/admin/dashboard', { role: 'admin', medical_consent: false });
  assert.equal(staff.headers.get('location'), null);
});

test('missing or revoked session returns to login', async () => {
  for (const page of ['/medical-consent', '/users/userHome']) {
    const res = await run(page, null);
    assert.equal(res.headers.get('location'), 'https://clinic.test/userlogin');
  }
});
