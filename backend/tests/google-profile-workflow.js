const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../tools/db");
const { JWT_SECRET, PORT } = require("../tools/config");

async function request(route, token, options = {}) {
  const response = await fetch(`http://127.0.0.1:${PORT}/api${route}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function main() {
  const suffix = `${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const email = `google_profile_${suffix}@example.test`;
  const nationalId = `8${String(Date.now()).slice(-12)}`;
  let userId = null;

  try {
    const user = await pool.query(
      `INSERT INTO clinic.users
       (google_id,email,role,account_status,email_verified_at,registration_source)
       VALUES($1,$2,'user','active',now(),'google')
       RETURNING user_id,session_version`,
      [`google-test-${suffix}`, email],
    );
    userId = user.rows[0].user_id;
    await pool.query(
      `INSERT INTO clinic.user_details(user_id,first_name,email)
       VALUES($1,'Google',$2)`,
      [userId, email],
    );

    const token = jwt.sign(
      { sub: userId, role: "user", sv: Number(user.rows[0].session_version || 1) },
      JWT_SECRET,
      { expiresIn: "5m" },
    );

    const before = await request("/users/me", token);
    if (before.status !== 200 || before.body?.registration_source !== "google" || before.body?.profile_completed) {
      throw new Error(`Unexpected Google session before completion: ${JSON.stringify(before)}`);
    }

    const invalid = await request("/me/google-profile", token, {
      method: "PATCH",
      body: JSON.stringify({ national_id: "1" }),
    });
    if (invalid.status !== 400) throw new Error(`Invalid profile expected 400, got ${invalid.status}`);

    const completed = await request("/me/google-profile", token, {
      method: "PATCH",
      body: JSON.stringify({
        national_id: nationalId,
        first_name: "Google",
        last_name: "Patient",
        birth_date: "1990-01-01",
        phone: "0812345678",
      }),
    });
    if (completed.status !== 200 || !completed.body?.profile_completed || completed.body?.email !== email) {
      throw new Error(`Google profile completion failed: ${JSON.stringify(completed)}`);
    }

    const notification = await pool.query(
      `SELECT notification_id, email_required
       FROM clinic.user_notifications
       WHERE user_id = $1
         AND source_type = 'security'
         AND event_key = 'google_email_access'`,
      [userId],
    );
    if (notification.rowCount !== 1 || !notification.rows[0].email_required) {
      throw new Error("Google email access notification was not queued exactly once");
    }

    const completedAgain = await request("/me/google-profile", token, {
      method: "PATCH",
      body: JSON.stringify({
        national_id: nationalId,
        first_name: "Google",
        last_name: "Patient",
        birth_date: "1990-01-01",
        phone: "0812345678",
      }),
    });
    const notificationCount = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM clinic.user_notifications
       WHERE user_id = $1
         AND source_type = 'security'
         AND event_key = 'google_email_access'`,
      [userId],
    );
    if (completedAgain.status !== 200 || notificationCount.rows[0].count !== 1) {
      throw new Error("Google email access notification was duplicated");
    }

    const after = await request("/users/me", token);
    if (after.status !== 200 || !after.body?.profile_completed) {
      throw new Error(`Google session was not completed: ${JSON.stringify(after)}`);
    }

    console.log(JSON.stringify({
      ok: true,
      google_email_verified_without_otp: true,
      minimal_profile_validation: invalid.status,
      profile_completed: after.body.profile_completed,
      google_access_email_notification_queued_once: true,
    }, null, 2));
  } finally {
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
