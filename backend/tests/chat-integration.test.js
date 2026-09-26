const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

test('chat API with real PostgreSQL, roles, history and retry handling', { skip: !process.env.CHAT_TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.CHAT_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/clinic_chat_test', 'Use only an isolated local clinic_chat_test database');
  const owner = new Pool({ connectionString: url.toString() });
  await owner.query('DROP SCHEMA IF EXISTS clinic CASCADE; CREATE SCHEMA clinic');
  await owner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='cliniccare_runtime') THEN CREATE ROLE cliniccare_runtime LOGIN; END IF; END $$;
    CREATE TABLE clinic.users(user_id integer PRIMARY KEY, role text, email text, account_status text DEFAULT 'active', session_version integer DEFAULT 1, profile_completed_at timestamptz DEFAULT now(), registration_source text DEFAULT 'local', medical_consent_at timestamptz DEFAULT now(), medical_consent_version text DEFAULT '2026-09-18');
    CREATE TABLE clinic.user_details(detail_id serial PRIMARY KEY,user_id integer,first_name text,last_name text,profile_image text);
    INSERT INTO clinic.users(user_id,role) VALUES (1,'user'),(2,'user'),(3,'admin'),(4,'doctor'),(5,'super_admin'),(6,'assistant'),(7,'user'),(8,'user');
    UPDATE clinic.users SET medical_consent_at=NULL WHERE user_id=7;
    UPDATE clinic.users SET session_version=2 WHERE user_id=8;
    INSERT INTO clinic.user_details(user_id,first_name,last_name,profile_image) VALUES (1,'สมชาย','ทดสอบ','/api/profile-images/1'),(2,'สมหญิง','ทดสอบ',NULL),(3,'แอดมิน','ทดสอบ',NULL),(4,'แพทย์','ทดสอบ',NULL);
    GRANT USAGE ON SCHEMA clinic TO cliniccare_runtime;
    GRANT SELECT ON clinic.users,clinic.user_details TO cliniccare_runtime;`);
  const { readSchemaSection } = require('../tools/schemaSections');
  await owner.query(readSchemaSection('chat'));
  await owner.query(readSchemaSection('chat')); // Repeatable migration.
  url.username = 'cliniccare_runtime'; url.password = '';
  process.env.DATABASE_URL = url.toString(); process.env.PGSSL = 'false';
  process.env.NODE_ENV = 'test'; process.env.STORAGE_PROVIDER = 'local';
  const pool = require('../tools/db');
  const { JWT_SECRET } = require('../tools/config');
  const jwt = require('jsonwebtoken');
  const express = require('express');
  const app = express(); app.use(express.json()); app.use('/api/chat', require('../routes/chat'));
  app.use((error, req, res, next) => { res.status(error.status || 500).json({ message: error.message }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await pool.end(); await owner.end(); });
  const base = `http://127.0.0.1:${server.address().port}/api/chat`;
  async function request(user, path, body) {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: {
      ...(user ? { Authorization: `Bearer ${jwt.sign({ sub: user, sv: 1 }, JWT_SECRET)}` } : {}), 'Content-Type': 'application/json',
    }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json().catch(() => null) };
  }
  const payload = (body = 'สวัสดีครับ') => ({ body, client_id: randomUUID() });
  let first;
  await t.test('requires login, valid session, consent and approved role', async () => {
    for (const [user, expected] of [[0,401],[6,403],[7,403],[8,401]]) assert.equal((await request(user,'/conversations')).status,expected);
    assert.equal((await request(1,'/2/messages')).status,403);
    assert.equal((await request(1,'/2/messages',payload())).status,403);
    assert.equal((await request(1,'/2/read',{message_id:1})).status,403);
    for (const user of [1,3,4,5]) assert.equal((await request(user,'/conversations')).status,200);
  });
  await t.test('saves names, Unicode, multiline text and treats HTML as text', async () => {
    first = await request(1,'/1/messages',payload('สวัสดี\n<script>alert(1)</script>'));
    assert.equal(first.status,201); assert.equal(first.data.sender_first_name,'สมชาย');
    assert.equal(first.data.sender_last_name,'ทดสอบ');
    assert.equal((await request(2,'/conversations')).data.conversations.length,0);
    const inbox = await request(3,'/conversations');
    assert.equal(inbox.data.conversations[0].first_name,'สมชาย'); assert.equal(inbox.data.conversations[0].profile_image,'/api/profile-images/1'); assert.equal(inbox.data.unread_total,1);
    assert.equal((await request(3,'/conversations?search=สมชาย')).data.conversations.length,1);
    assert.equal((await request(3,'/conversations?search=%25')).data.conversations.length,0);
  });
  await t.test('duplicate retries store only one message and reject changed content', async () => {
    const data = payload();
    const responses = await Promise.all([request(1,'/1/messages',data),request(1,'/1/messages',data)]);
    assert.deepEqual(responses.map((r)=>r.status).sort(),[200,201]);
    assert.equal(responses[0].data.message_id,responses[1].data.message_id);
    assert.equal((await request(1,'/1/messages',{...data,body:'changed'})).status,409);
  });
  await t.test('staff replies reach user, read receipts stay monotonic and hidden threads stay unread', async () => {
    const reply = await request(4,'/1/messages',payload('สวัสดีค่ะ'));
    assert.equal(reply.status,201); assert.equal(reply.data.sender_role,'doctor');
    assert.equal((await request(1,'/conversations')).data.unread_total,1);
    await request(1,'/1/read',{message_id:reply.data.message_id});
    await request(1,'/1/read',{message_id:first.data.message_id});
    assert.equal((await request(1,'/conversations')).data.unread_total,0);
    assert.equal((await request(3,'/1/messages')).data.read_through,reply.data.message_id);
    const last = (await request(3,'/1/messages')).data.messages.at(-1).message_id;
    await request(3,'/1/read',{message_id:last});
    assert.equal((await request(3,'/conversations')).data.unread_total,0);
    assert.ok((await request(5,'/conversations')).data.unread_total>0);
    assert.equal((await request(3,'/2/messages',payload())).status,404);
  });
  await t.test('invalid content and forged read cursors are rejected', async () => {
    for (const body of ['', ' ', 'x'.repeat(4001), 'bad\0text']) assert.equal((await request(1,'/1/messages',payload(body))).status,400);
    assert.equal((await request(1,'/1/messages',{body:'hi',client_id:'bad'})).status,400);
    assert.equal((await request(1,'/1/read',{message_id:200000})).status,400);
    assert.equal((await request(1,'/1/messages?before=1&after=2')).status,400);
  });
  await t.test('history and incremental pages do not omit or repeat messages', async () => {
    for (let index=0; index<57; index++) assert.equal((await request(1,'/1/messages',payload(`ข้อความ ${index}`))).status,201);
    const latest = (await request(1,'/1/messages')).data;
    assert.equal(latest.messages.length,50); assert.equal(latest.has_more,true);
    const previous = (await request(1,`/1/messages?before=${latest.messages[0].message_id}`)).data;
    const all = [...previous.messages,...latest.messages];
    assert.equal(new Set(all.map(m=>m.message_id)).size,60);
    const next = (await request(1,`/1/messages?after=${previous.messages.at(-1).message_id}`)).data;
    assert.deepEqual(next.messages.map(m=>m.message_id),latest.messages.map(m=>m.message_id));
  });
  await t.test('database RLS independently blocks another patient and assistant', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.role','user',true),set_config('app.user_id','2',true)");
      assert.equal((await client.query('SELECT * FROM clinic.chat_messages')).rowCount,0);
      await client.query("SELECT set_config('app.role','assistant',true)");
      assert.equal((await client.query('SELECT * FROM clinic.chat_messages')).rowCount,0);
      await client.query('ROLLBACK');
    } finally {client.release();}
  });
});
