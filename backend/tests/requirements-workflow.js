const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const pool = require("../tools/db");
const { JWT_SECRET, PORT } = require("../tools/config");
const { hashOtp } = require("../tools/emailVerification");

async function api(route, options = {}) {
  const response = await fetch(`http://127.0.0.1:${PORT}/api${route}`, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function main() {
  const suffix = `${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const email = `requirements_${suffix}@example.test`;
  const nationalId = `9${String(Date.now()).slice(-12)}`;
  const otp = "246810";
  let userId = null;
  let helpId = null;
  try {
    const user = await pool.query(
      `INSERT INTO clinic.users
       (username,email,password_hash,role,account_status,registration_source,profile_completed_at)
       VALUES ($1,$2,$3,'user','pending_verification','test',now())
       RETURNING user_id,session_version`,
      [`requirements_${suffix}`, email, await bcrypt.hash(`Test-${suffix}`, 4)],
    );
    userId = user.rows[0].user_id;
    await pool.query(
      `INSERT INTO clinic.user_details
       (user_id,national_id,first_name,last_name,birth_date,phone,email)
       VALUES ($1,$2,'ทดสอบ','ระบบ','1990-01-01','0800000000',$3)`,
      [userId, nationalId, email],
    );
    await pool.query(
      `INSERT INTO clinic.email_verification_otps (user_id,token_hash,expires_at)
       VALUES ($1,$2,now() + interval '15 minutes')`,
      [userId, hashOtp(userId, otp)],
    );

    const verified = await api("/users/email-verification/verify", {
      method: "POST",
      body: JSON.stringify({ email, otp }),
    });
    if (verified.status !== 200) throw new Error(`Email verification expected 200, got ${verified.status}`);

    const userToken = jwt.sign(
      { sub: userId, role: "user", sv: Number(user.rows[0].session_version || 1) },
      JWT_SECRET,
      { expiresIn: "5m" },
    );
    const request = await api("/help", {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({
        title: "ขอหยุดใช้งานบัญชี",
        description: "คำร้องสังเคราะห์สำหรับทดสอบระบบ",
        category: "account_deactivation",
        visibility: "private",
      }),
    });
    if (request.status !== 200) throw new Error(`Help request expected 200, got ${request.status}`);
    helpId = request.body.help_id;

    const staff = await pool.query(
      `SELECT user_id, role::text AS role, session_version FROM clinic.users
       WHERE lower(role::text) IN ('admin','super_admin','superadmin') AND account_status = 'active'
       ORDER BY user_id LIMIT 1`,
    );
    if (!staff.rowCount) throw new Error("No active admin available");
    const admin = staff.rows[0];
    const adminToken = jwt.sign(
      { sub: admin.user_id, role: String(admin.role).toLowerCase(), sv: Number(admin.session_version || 1) },
      JWT_SECRET,
      { expiresIn: "5m" },
    );
    const reviewed = await api(`/help/${helpId}/status`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        request_status: "approved",
        review_note: "ตรวจสอบคำร้องสังเคราะห์แล้ว",
        verification_method: "integration_test",
      }),
    });
    if (reviewed.status !== 200) throw new Error(`Help approval expected 200, got ${reviewed.status}`);

    const revoked = await api("/users/me", { headers: { Authorization: `Bearer ${userToken}` } });
    if (revoked.status !== 403 && revoked.status !== 401) {
      throw new Error(`Revoked session expected 401/403, got ${revoked.status}`);
    }
    const state = await pool.query(
      `SELECT account_status,session_version FROM clinic.users WHERE user_id = $1`,
      [userId],
    );
    if (state.rows[0]?.account_status !== "deactivated") throw new Error("Account was not deactivated");

    await pool.query(`DELETE FROM clinic.help_requests WHERE help_id = $1`, [helpId]);
    helpId = null;
    await pool.query(`DELETE FROM clinic.user_details WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM clinic.users WHERE user_id = $1`, [userId]);
    const remaining = await pool.query(
      `SELECT COUNT(*)::int AS count FROM clinic.users WHERE user_id = $1`,
      [userId],
    );
    userId = null;
    if (remaining.rows[0].count !== 0) throw new Error("Synthetic workflow data was not removed");

    console.log(JSON.stringify({
      ok: true,
      email_verification: verified.status,
      deactivation_request: request.status,
      admin_approval: reviewed.status,
      revoked_session: revoked.status,
      final_account_status: state.rows[0].account_status,
      synthetic_rows_removed: true,
    }, null, 2));
  } finally {
    if (helpId) await pool.query(`DELETE FROM clinic.help_requests WHERE help_id = $1`, [helpId]);
    if (userId) {
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
