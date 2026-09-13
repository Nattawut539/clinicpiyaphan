const express = require("express");
const pool = require("../../tools/db");
const { hashOtp, issueEmailVerification } = require("../../tools/emailVerification");

const router = express.Router();

router.post("/email-verification/resend", async (req, res, next) => {
  if (process.env.DISABLE_EMAIL === "true") {
    return res.status(503).json({ message: "ระบบส่งอีเมลยังไม่เปิดใช้งาน", code: "EMAIL_DISABLED" });
  }
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ message: "กรุณาระบุอีเมล" });
  try {
    const result = await pool.query(
      `SELECT user_id, email, account_status FROM clinic.users WHERE lower(email) = $1 LIMIT 1`,
      [email],
    );
    if (result.rowCount && result.rows[0].account_status === "pending_verification") {
      await issueEmailVerification(result.rows[0].user_id, result.rows[0].email);
    }
    return res.json({ message: "หากบัญชีรอยืนยัน ระบบได้ส่งรหัสใหม่แล้ว" });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  }
});

router.post("/email-verification/verify", async (req, res, next) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const otp = String(req.body?.otp || "").trim();
  if (!email || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ message: "กรุณากรอกอีเมลและ OTP 6 หลัก" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userResult = await client.query(
      `SELECT user_id, account_status FROM clinic.users WHERE lower(email) = $1 LIMIT 1 FOR UPDATE`,
      [email],
    );
    if (!userResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "OTP ไม่ถูกต้องหรือหมดอายุ" });
    }
    const user = userResult.rows[0];
    if (user.account_status === "active") {
      await client.query("COMMIT");
      return res.json({ message: "อีเมลนี้ได้รับการยืนยันแล้ว" });
    }
    if (user.account_status !== "pending_verification") {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "บัญชีนี้ไม่สามารถยืนยันอีเมลผ่านขั้นตอนนี้ได้" });
    }
    const verification = await client.query(
      `SELECT verification_id, token_hash, attempt_count
       FROM clinic.email_verification_otps
       WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [user.user_id],
    );
    if (!verification.rowCount || verification.rows[0].attempt_count >= 5) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "OTP ไม่ถูกต้องหรือหมดอายุ" });
    }
    const row = verification.rows[0];
    if (row.token_hash !== hashOtp(user.user_id, otp)) {
      await client.query(
        `UPDATE clinic.email_verification_otps SET attempt_count = attempt_count + 1 WHERE verification_id = $1`,
        [row.verification_id],
      );
      await client.query("COMMIT");
      return res.status(400).json({ message: "OTP ไม่ถูกต้องหรือหมดอายุ" });
    }
    await client.query(
      `UPDATE clinic.email_verification_otps SET used_at = now() WHERE verification_id = $1`,
      [row.verification_id],
    );
    await client.query(
      `UPDATE clinic.users
       SET email_verified_at = now(), account_status = 'active', status_changed_at = now()
       WHERE user_id = $1`,
      [user.user_id],
    );
    await client.query("COMMIT");
    return res.json({ message: "ยืนยันอีเมลสำเร็จ" });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    return next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
