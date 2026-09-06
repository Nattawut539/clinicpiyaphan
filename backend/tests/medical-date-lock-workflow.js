const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../tools/db");
const { JWT_SECRET, PORT } = require("../tools/config");

const dateKey = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

async function request(route, token, body) {
  const response = await fetch(`http://127.0.0.1:${PORT}/api${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function main() {
  const suffix = `${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  let userId = null;
  const queueIds = [];
  try {
    const staff = await pool.query(
      `SELECT user_id, role::text AS role, session_version FROM clinic.users
       WHERE lower(role::text) IN ('super_admin','superadmin','doctor')
         AND account_status = 'active' ORDER BY user_id LIMIT 1`,
    );
    if (!staff.rowCount) throw new Error("No active staff account for test");
    const actor = staff.rows[0];
    const token = jwt.sign(
      { sub: actor.user_id, role: String(actor.role).toLowerCase(), sv: Number(actor.session_version || 1) },
      JWT_SECRET,
      { expiresIn: "5m" },
    );

    const user = await pool.query(
      `INSERT INTO clinic.users
       (google_id,email,role,account_status,email_verified_at,profile_completed_at,registration_source)
       VALUES($1,$2,'user','active',now(),now(),'google') RETURNING user_id`,
      [`date-lock-${suffix}`, `date_lock_${suffix}@example.test`],
    );
    userId = user.rows[0].user_id;
    await pool.query(
      `INSERT INTO clinic.user_details(user_id,national_id,first_name,last_name,birth_date,phone,email)
       VALUES($1,$2,'Date','Lock','1990-01-01','0812345678',$3)`,
      [userId, `7${String(Date.now()).slice(-12)}`, `date_lock_${suffix}@example.test`],
    ).catch(async () => {
      await pool.query(
        `INSERT INTO clinic.user_details(user_id,first_name,last_name,birth_date,phone,email)
         VALUES($1,'Date','Lock','1990-01-01','0812345678',$2)`,
        [userId, `date_lock_${suffix}@example.test`],
      );
    });

    const maxQueue = await pool.query(`SELECT COALESCE(MAX(numeric_no),0)::int + 100 AS value FROM clinic.queue_tickets`);
    const base = Number(maxQueue.rows[0].value);
    for (const [index, serviceDate] of [dateKey(-7), dateKey(0), dateKey(7)].entries()) {
      const numeric = base + index;
      const inserted = await pool.query(
        `INSERT INTO clinic.queue_tickets
         (queue_number,prefix,numeric_no,service_date,avaliable_date,source,user_id,service_type)
         VALUES($1,'B',$2,$3,'morning','staff',$4,'Date lock test') RETURNING queue_id`,
        [`B${String(numeric).padStart(3, "0")}`, numeric, serviceDate, userId],
      );
      queueIds.push(inserted.rows[0].queue_id);
    }

    const payload = (index, visitDate) => ({
      queue_id: queueIds[index], user_id: userId, visit_date: visitDate,
      symptoms: "test", diagnosis: "test", medications: [],
    });
    const past = await request("/medical-records", token, payload(0, dateKey(-7)));
    const today = await request("/medical-records", token, payload(1, dateKey(0)));
    const future = await request("/medical-records", token, payload(2, dateKey(7)));

    if (past.status !== 409 || today.status !== 200 || future.status !== 409) {
      throw new Error(`Unexpected date lock statuses: ${JSON.stringify({ past, today, future })}`);
    }
    console.log(JSON.stringify({ ok: true, past: past.status, today: today.status, future: future.status }, null, 2));
  } finally {
    if (userId) {
      await pool.query(`DELETE FROM clinic.medical_records WHERE user_id = $1`, [userId]);
      if (queueIds.length) await pool.query(`DELETE FROM clinic.measurements WHERE queue_id = ANY($1::int[])`, [queueIds]);
      if (queueIds.length) await pool.query(`DELETE FROM clinic.queue_tickets WHERE queue_id = ANY($1::int[])`, [queueIds]);
      await pool.query(`DELETE FROM clinic.user_details WHERE user_id = $1`, [userId]);
      await pool.query(`DELETE FROM clinic.users WHERE user_id = $1`, [userId]);
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
