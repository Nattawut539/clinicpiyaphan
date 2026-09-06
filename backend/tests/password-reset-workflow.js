const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const pool = require("../tools/db");
const { JWT_SECRET, PORT } = require("../tools/config");

async function post(route, body) {
  const response = await fetch(`http://127.0.0.1:${PORT}/api/users${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function main() {
  const suffix = `${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const email = `password_reset_${suffix}@test.local`;
  const otp = "246810";
  let userId;
  try {
    const inserted = await pool.query(
      `INSERT INTO clinic.users
         (username,email,password_hash,role,account_status,email_verified_at,
          profile_completed_at,registration_source,session_version)
       VALUES($1,$2,$3,'user','active',now(),now(),'test',1)
       RETURNING user_id`,
      [`pwd_${suffix}`, email, await bcrypt.hash("Before-123", 4)],
    );
    userId = inserted.rows[0].user_id;

    const token = jwt.sign({ uid: userId, email, action: "pwd_reset" }, JWT_SECRET, { expiresIn: "10m" });
    const otpHash = crypto.createHmac("sha256", JWT_SECRET).update(`${email}:${otp}`).digest("hex");
    await pool.query(
      `INSERT INTO clinic.password_reset_otps(email,otp_hash,token,expires_at)
       VALUES($1,$2,$3,now()+interval '10 minutes')`,
      [email, otpHash, token],
    );

    const wrong = await post("/forgot-password/verify", { email, otp: "000000" });
    const verified = await post("/forgot-password/verify", { email, otp });
    const reset = await post("/forgot-password/reset", { token, new_password: "After-456" });
    const reused = await post("/forgot-password/reset", { token, new_password: "Again-789" });
    const stored = await pool.query(
      "SELECT password_hash,session_version FROM clinic.users WHERE user_id=$1",
      [userId],
    );

    const passwordChanged = await bcrypt.compare("After-456", stored.rows[0].password_hash);
    const ok = wrong.status === 400
      && verified.status === 200
      && reset.status === 200
      && reused.status === 400
      && passwordChanged
      && Number(stored.rows[0].session_version) === 2;
    if (!ok) {
      throw new Error(JSON.stringify({ wrong, verified, reset, reused, passwordChanged, sessionVersion: stored.rows[0].session_version }));
    }

    console.log(JSON.stringify({
      ok: true,
      wrong_otp_rejected: true,
      reset_succeeded: true,
      token_reuse_rejected: true,
      sessions_revoked: true,
    }, null, 2));
  } finally {
    await pool.query("DELETE FROM clinic.password_reset_otps WHERE lower(email)=lower($1)", [email]);
    if (userId) await pool.query("DELETE FROM clinic.users WHERE user_id=$1", [userId]);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
