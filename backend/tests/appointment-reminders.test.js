const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { sendAppointmentReminders } = require('../services/appointmentReminderService');

test('booking, admin approval and next-day reminders with isolated PostgreSQL', {
  skip: process.env.REMINDER_TEST_LOCAL !== 'true',
}, async (t) => {
  const env = { ...require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env'))), ...process.env };
  const config = env.DATABASE_URL ? { connectionString: env.DATABASE_URL } : {
    host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 5432),
    user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
  };
  const host = config.connectionString ? new URL(config.connectionString).hostname : config.host;
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(host), 'Local PostgreSQL only');
  const owner = new Pool({ ...config, connectionTimeoutMillis: 5000 });
  const name = `clinic_reminder_test_${process.pid}_${Date.now()}`;
  await owner.query(`CREATE DATABASE ${name}`);
  let testConfig;
  if (config.connectionString) {
    const url = new URL(config.connectionString); url.pathname = `/${name}`;
    testConfig = { connectionString: url.toString() };
  } else { testConfig = { ...config, database: name }; }
  const pool = new Pool(testConfig);
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    // Only the uniquely named database created by this test is removed.
    assert.match(name, /^clinic_reminder_test_\d+_\d+$/);
    await owner.query(`DROP DATABASE ${name}`);
    await owner.end();
  });
  await pool.query(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8'));
  const mails = [];
  const nodemailer = require('nodemailer');
  const originalCreateTransport = nodemailer.createTransport;
  const transport = originalCreateTransport({ streamTransport: true, buffer: true });
  // Exercise the same sendClinicMail used by approval emails. Replace only
  // the external SMTP transport so this test cannot email real recipients.
  nodemailer.createTransport = () => transport;
  t.after(() => { nodemailer.createTransport = originalCreateTransport; });
  process.env.DISABLE_EMAIL = 'false';
  process.env.MAIL_FROM = 'clinic@example.test';
  const mailer = require('../tools/mailer');
  const sendMail = async (mail) => {
    const rendered = await mailer.sendClinicMail(mail);
    mails.push({ ...mail, mime: rendered.message.toString() });
    return rendered;
  };
  require.cache[require.resolve('../tools/db')] = { exports: pool };
  require.cache[require.resolve('../tools/mailer')].exports = { ...mailer, sendClinicMail: sendMail };
  process.env.STORAGE_PROVIDER = 'local';
  const { CONSENT_VERSION } = require('../tools/medicalConsent');
  await pool.query(`INSERT INTO clinic.users(user_id,username,email,password_hash,role,
    email_verified_at,profile_completed_at,medical_consent_at,medical_consent_version)
    VALUES (1,'reminder-test','patient@example.test','test-only','user',now(),now(),now(),$1),
           (2,'admin-test','admin@example.test','test-only','admin',now(),now(),now(),$1);
  `, [CONSENT_VERSION]);
  await pool.query(`INSERT INTO clinic.user_details(user_id,first_name,national_id)
    VALUES (1,'ทดสอบ <script>','TEST-ONLY');
    INSERT INTO clinic.advance_booking_weeks(week_start,week_end) VALUES ('2030-01-15','2030-01-15');
    INSERT INTO clinic.appointment_slots(slot_id,service_date,avaliable_date,hour_of_day)
    VALUES (1,'2030-01-15','morning',9);`);
  const express = require('express');
  const app = express(); app.use(express.json());
  app.use('/api/appointments', require('../routes/appointments'));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { signToken } = require('../tools/_utils');
  async function request(user, method, suffix, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/appointments${suffix}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken({ user_id: user, role: user === 1 ? 'user' : 'admin' })}` },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  const run = (options = {}) => sendAppointmentReminders({ pool, sendMail,
    now: new Date('2030-01-14T08:00:00+07:00'), logger: { error() {} }, ...options });
  let id;
  await t.test('user books: pending email, no reminder before admin approval', async () => {
    const response = await request(1, 'POST', '', { slot_id: 1, service_type: 'นัดทดสอบ' });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    id = (await pool.query('SELECT appointment_id FROM clinic.appointments')).rows[0].appointment_id;
    assert.match(mails[0].subject, /รอการอนุมัติ/);
    assert.equal((await run()).sent, 0);
  });
  await t.test('user cannot approve; admin approval creates queue and sends confirmation', async () => {
    assert.equal((await request(1, 'PUT', `/${id}`, { status: 'approved' })).status, 403);
    const response = await request(2, 'PUT', `/${id}`, { status: 'approved' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.queue.queue_number, 'A003');
    assert.match(mails.at(-1).subject, /อนุมัติการจองแล้ว/);
  });
  await t.test('not two days early; starts at Bangkok midnight despite UTC date', async () => {
    assert.equal((await run({ now: new Date('2030-01-13T16:59:59Z') })).sent, 0);
    assert.equal((await run({ now: new Date('2030-01-13T17:00:00Z') })).sent, 1);
    const mail = mails.at(-1);
    assert.equal(mail.to, 'patient@example.test');
    assert.match(mail.subject, /พรุ่งนี้/); assert.match(mail.html, /09:00/);
    assert.match(mail.html, /A003/); assert.match(mail.html, /15 มกราคม 2573/);
    assert.match(mail.html, /&lt;script&gt;/); assert.match(mail.mime, /MIME-Version/);
  });
  await t.test('repeated worker runs do not resend', async () => {
    assert.equal((await run()).sent, 0); assert.equal((await run()).sent, 0);
  });
  const reset = () => pool.query("DELETE FROM clinic.user_notifications WHERE event_key LIKE 'appointment_reminder:%'");
  await t.test('cancelled, rejected, completed, no-show and pending do not send', async () => {
    await reset();
    for (const status of ['cancelled','rejected','completed','no_show','pending']) {
      await pool.query('UPDATE clinic.appointments SET status=$1', [status]);
      assert.equal((await run()).sent, 0, status);
    }
    await pool.query("UPDATE clinic.appointments SET status='approved'");
    await pool.query("UPDATE clinic.queue_tickets SET status='cancelled'");
    assert.equal((await run()).sent, 0);
    await pool.query("UPDATE clinic.queue_tickets SET status='waiting'");
  });
  await t.test('no reminder on appointment day or after the appointment', async () => {
    for (const date of ['2030-01-15','2030-01-16']) {
      assert.equal((await run({ now: new Date(`${date}T08:00:00+07:00`) })).sent, 0);
    }
  });
  await t.test('SMTP failure can retry; rejected recipient is not marked sent', async () => {
    assert.equal((await run({ sendMail: async () => { throw new Error('SMTP unavailable'); } })).failed, 1);
    assert.equal((await run({ sendMail: async () => ({ accepted: [], rejected: ['patient@example.test'] }) })).failed, 1);
    assert.equal((await run()).sent, 1);
  });
  await t.test('simultaneous workers send once', async () => {
    await reset();
    const results = await Promise.all([run(), run(), run()]);
    assert.equal(results.reduce((sum, r) => sum + r.sent, 0), 1);
  });
  await t.test('missing email is skipped; profile email fallback works', async () => {
    await reset();
    await pool.query('UPDATE clinic.users SET email=NULL WHERE user_id=1');
    assert.equal((await run()).sent, 0);
    await pool.query("UPDATE clinic.user_details SET email='fallback@example.test' WHERE user_id=1");
    assert.equal((await run()).sent, 1);
    assert.equal(mails.at(-1).to, 'fallback@example.test');
  });
  await t.test('rescheduling uses new date and suppresses old-date reminder', async () => {
    await pool.query("UPDATE clinic.appointment_slots SET service_date='2030-01-16' WHERE slot_id=1");
    assert.equal((await run()).sent, 0);
    assert.equal((await run({ now: new Date('2030-01-15T12:00:00+07:00') })).sent, 1);
  });
});
