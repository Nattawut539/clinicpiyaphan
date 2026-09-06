const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const jwt = require("jsonwebtoken");
const pool = require("../tools/db");
const { JWT_SECRET, PORT } = require("../tools/config");

async function main() {
  try {
    const staff = await pool.query(
      `SELECT user_id, role::text AS role, session_version FROM clinic.users
       WHERE lower(role::text) IN ('admin','super_admin','superadmin','doctor','assistant')
         AND account_status = 'active' ORDER BY user_id LIMIT 1`,
    );
    if (!staff.rowCount) throw new Error("No active staff account for test");
    const appointment = await pool.query(
      `SELECT a.appointment_id, d.national_id,
              REGEXP_REPLACE(COALESCE(d.phone, ''), '[^0-9]', '', 'g') AS phone
       FROM clinic.appointments a
       JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
       JOIN clinic.user_details d ON d.user_id = a.user_id
       WHERE s.service_date = (now() AT TIME ZONE 'Asia/Bangkok')::date
         AND d.national_id ~ '^\\d{13}$'
         AND REGEXP_REPLACE(COALESCE(d.phone, ''), '[^0-9]', '', 'g') ~ '^\\d{9,10}$'
       ORDER BY a.appointment_id LIMIT 1`,
    );
    if (!appointment.rowCount) {
      console.log(JSON.stringify({ ok: true, skipped: "no appointment with national ID and phone today" }, null, 2));
      return;
    }
    const actor = staff.rows[0];
    const token = jwt.sign(
      { sub: actor.user_id, role: String(actor.role).toLowerCase(), sv: Number(actor.session_version || 1) },
      JWT_SECRET,
      { expiresIn: "5m" },
    );
    const row = appointment.rows[0];
    const params = new URLSearchParams({ national_id: row.national_id, phone: row.phone });
    const response = await fetch(`http://127.0.0.1:${PORT}/api/appointments/check-in/search?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => null);
    if (response.status !== 200 || !Array.isArray(body) || !body.some((item) => item.appointment_id === row.appointment_id)) {
      throw new Error(`Phone check-in search failed: ${response.status} ${JSON.stringify(body)}`);
    }
    const queueResponse = await fetch(`http://127.0.0.1:${PORT}/api/today`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const queues = await queueResponse.json().catch(() => null);
    if (queueResponse.status !== 200 || !Array.isArray(queues) || queues.some((item) => "code_ciphertext" in item)) {
      throw new Error(`Today queue access-code response failed: ${queueResponse.status}`);
    }
    const appointmentsResponse = await fetch(`http://127.0.0.1:${PORT}/api/appointments`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const appointments = await appointmentsResponse.json().catch(() => null);
    const validCodeCount = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM clinic.appointments a
       JOIN clinic.appointment_access_codes ac ON ac.appointment_id = a.appointment_id
       WHERE ac.code_ciphertext IS NOT NULL
         AND ac.used_at IS NULL
         AND ac.expires_at > now()`,
    );
    const expectedVisibleCodes = validCodeCount.rows[0].count;
    const actualVisibleCodes = Array.isArray(appointments)
      ? appointments.filter((item) => /^\d{6}$/.test(item.access_code || "")).length
      : -1;
    if (
      appointmentsResponse.status !== 200 ||
      !Array.isArray(appointments) ||
      appointments.some((item) => "code_ciphertext" in item) ||
      appointments.some((item) => item.access_code && !/^\d{6}$/.test(item.access_code)) ||
      actualVisibleCodes !== expectedVisibleCodes
    ) {
      throw new Error(`Appointments access-code response failed: ${appointmentsResponse.status}`);
    }
    console.log(JSON.stringify({
      ok: true,
      status: response.status,
      matched_appointment: row.appointment_id,
      today_queue_status: queueResponse.status,
      appointments_status: appointmentsResponse.status,
      visible_access_codes: actualVisibleCodes,
      encrypted_code_not_exposed: true,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
