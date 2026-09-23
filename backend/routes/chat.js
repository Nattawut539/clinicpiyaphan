const express = require('express');
const { authRequired, withContext } = require('../tools/_utils');
const router = express.Router();
const STAFF = new Set(['admin', 'doctor', 'super_admin', 'superadmin']);
const USERS = new Set(['user', 'users']);
const fail = (status, message) => Object.assign(new Error(message), { status });
const positiveId = (value) => {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 2147483647) throw fail(400, 'รหัสข้อความหรือบทสนทนาไม่ถูกต้อง');
  return Number(value);
};
router.use(authRequired, (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!STAFF.has(req.user.role) && !USERS.has(req.user.role)) return res.sendStatus(403);
  next();
});
const route = (handler) => async (req, res, next) => {
  try { await handler(req, res); } catch (error) { next(error); }
};
function threadId(req) {
  const id = positiveId(req.params.patientId);
  if (!STAFF.has(req.user.role) && id !== Number(req.user.user_id)) throw fail(403, 'ไม่มีสิทธิ์เข้าถึงบทสนทนานี้');
  return id;
}

router.get('/conversations', route(async (req, res) => {
  const staff = STAFF.has(req.user.role);
  const page = Math.max(0, Math.min(100000, Number.parseInt(req.query.page, 10) || 0));
  const search = String(req.query.search || '').trim().slice(0, 100);
  await withContext(req, async (db) => {
    const params = [req.user.user_id, staff, `%${search.replace(/[\\%_]/g, '\\$&')}%`, page * 30];
    const { rows } = await db.query(`SELECT c.patient_user_id, d.first_name, d.last_name,
      m.body AS last_message, m.created_at AS last_message_at, m.message_id AS last_message_id,
      (SELECT count(*)::int FROM clinic.chat_messages n WHERE n.patient_user_id=c.patient_user_id
        AND n.message_id > COALESCE(r.last_message_id, 0) AND n.sender_user_id <> $1
        AND (NOT $2 OR n.sender_role IN ('user','users'))) AS unread_count
      FROM clinic.chat_conversations c
      LEFT JOIN LATERAL (SELECT first_name,last_name FROM clinic.user_details WHERE user_id=c.patient_user_id ORDER BY detail_id DESC LIMIT 1) d ON true
      JOIN LATERAL (SELECT * FROM clinic.chat_messages WHERE patient_user_id=c.patient_user_id ORDER BY message_id DESC LIMIT 1) m ON true
      LEFT JOIN clinic.chat_reads r ON r.patient_user_id=c.patient_user_id AND r.reader_user_id=$1
      WHERE ($2 OR c.patient_user_id=$1) AND concat_ws(' ', d.first_name,d.last_name) ILIKE $3
      ORDER BY m.message_id DESC LIMIT 31 OFFSET $4`, params);
    const total = await db.query(`SELECT count(*)::int AS unread_total FROM clinic.chat_messages m
      LEFT JOIN clinic.chat_reads r ON r.patient_user_id=m.patient_user_id AND r.reader_user_id=$1
      WHERE ($2 OR m.patient_user_id=$1) AND m.sender_user_id <> $1
        AND (NOT $2 OR m.sender_role IN ('user','users')) AND m.message_id > COALESCE(r.last_message_id,0)`, params.slice(0, 2));
    res.json({ user_id: Number(req.user.user_id), staff, conversations: rows.slice(0, 30), has_more: rows.length > 30, unread_total: total.rows[0].unread_total });
  });
}));

router.get('/:patientId/messages', route(async (req, res) => {
  const id = threadId(req);
  const before = req.query.before ? positiveId(req.query.before) : null;
  const after = req.query.after ? positiveId(req.query.after) : null;
  if (before && after) throw fail(400, 'เลือกช่วงข้อความอย่างใดอย่างหนึ่ง');
  await withContext(req, async (db) => {
    const result = await db.query(`SELECT * FROM clinic.chat_messages
      WHERE patient_user_id=$1 AND ($2::int IS NULL OR message_id < $2) AND ($3::int IS NULL OR message_id > $3)
      ORDER BY message_id ${after ? 'ASC' : 'DESC'} LIMIT 51`, [id, before, after]);
    const messages = result.rows.slice(0, 50);
    if (!after) messages.reverse();
    const read = await db.query(`SELECT COALESCE(max(r.last_message_id),0)::int AS read_through
      FROM clinic.chat_reads r JOIN clinic.users u ON u.user_id=r.reader_user_id
      WHERE r.patient_user_id=$1 AND (($2 AND r.reader_user_id=$1) OR (NOT $2 AND u.role::text IN ('admin','doctor','super_admin','superadmin')))`, [id, STAFF.has(req.user.role)]);
    res.json({ messages, has_more: result.rows.length > 50, read_through: read.rows[0].read_through });
  });
}));

router.post('/:patientId/messages', route(async (req, res) => {
  const id = threadId(req);
  const { body, client_id: clientId } = req.body || {};
  if (typeof body !== 'string' || !body.trim() || body.length > 4000 || body.includes('\0')) throw fail(400, 'กรุณาพิมพ์ข้อความ 1–4,000 ตัวอักษร');
  if (typeof clientId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)) throw fail(400, 'รหัสการส่งข้อความไม่ถูกต้อง');
  const result = await withContext(req, async (db) => {
    if (!STAFF.has(req.user.role)) await db.query('INSERT INTO clinic.chat_conversations(patient_user_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
    // Lock before allocating message IDs: an incremental poll cannot miss a
    // lower ID that commits later than another send in the same conversation.
    const conversation = await db.query('SELECT patient_user_id FROM clinic.chat_conversations WHERE patient_user_id=$1 FOR UPDATE', [id]);
    if (!conversation.rowCount) throw fail(404, 'ไม่พบบทสนทนา');
    const prior = await db.query('SELECT * FROM clinic.chat_messages WHERE sender_user_id=$1 AND client_id=$2', [req.user.user_id, clientId]);
    if (prior.rowCount) {
      if (Number(prior.rows[0].patient_user_id) !== id || prior.rows[0].body !== body.trim()) throw fail(409, 'รหัสข้อความนี้ถูกใช้งานแล้ว');
      return { status: 200, message: prior.rows[0] };
    }
    const profile = await db.query('SELECT first_name,last_name FROM clinic.user_details WHERE user_id=$1 ORDER BY detail_id DESC LIMIT 1', [req.user.user_id]);
    const name = profile.rows[0] || {};
    const message = await db.query(`INSERT INTO clinic.chat_messages
      (patient_user_id,sender_user_id,sender_first_name,sender_last_name,sender_role,client_id,body)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [id, req.user.user_id, name.first_name || '', name.last_name || '', req.user.role, clientId, body.trim()]);
    await db.query('UPDATE clinic.chat_conversations SET updated_at=now() WHERE patient_user_id=$1', [id]);
    return { status: 201, message: message.rows[0] };
  });
  res.status(result.status).json(result.message);
}));

router.post('/:patientId/read', route(async (req, res) => {
  const id = threadId(req);
  const messageId = positiveId(req.body?.message_id);
  await withContext(req, async (db) => {
    const found = await db.query('SELECT 1 FROM clinic.chat_messages WHERE patient_user_id=$1 AND message_id=$2', [id, messageId]);
    if (!found.rowCount) throw fail(400, 'ไม่พบข้อความในบทสนทนานี้');
    await db.query(`INSERT INTO clinic.chat_reads(patient_user_id,reader_user_id,last_message_id) VALUES ($1,$2,$3)
      ON CONFLICT (patient_user_id,reader_user_id) DO UPDATE SET last_message_id=GREATEST(chat_reads.last_message_id,EXCLUDED.last_message_id)`, [id, req.user.user_id, messageId]);
  });
  res.json({ ok: true });
}));
module.exports = router;
