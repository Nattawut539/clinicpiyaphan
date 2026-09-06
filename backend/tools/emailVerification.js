const crypto = require("crypto");
const pool = require("./db");
const { FRONTEND_URL, JWT_SECRET } = require("./config");
const { escapeHtml, sendClinicMail } = require("./mailer");

const OTP_TTL_MINUTES = 15;

function hashOtp(userId, otp) {
  return crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${userId}:${otp}`)
    .digest("hex");
}

function buildEmailVerificationUrl(email) {
  const verificationUrl = new URL("/verify-email", FRONTEND_URL);
  verificationUrl.searchParams.set(
    "email",
    String(email || "")
      .trim()
      .toLowerCase(),
  );
  return verificationUrl.toString();
}

async function issueEmailVerification(userId, email) {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  const otp = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const tokenHash = hashOtp(userId, otp);
  const verificationUrl = buildEmailVerificationUrl(normalizedEmail);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const recent = await client.query(
      `SELECT last_sent_at FROM clinic.email_verification_otps
       WHERE user_id = $1 ORDER BY last_sent_at DESC LIMIT 1`,
      [userId],
    );
    if (
      recent.rowCount &&
      Date.now() - new Date(recent.rows[0].last_sent_at).getTime() < 60_000
    ) {
      const error = new Error("กรุณารอ 60 วินาทีก่อนส่งรหัสใหม่");
      error.status = 429;
      throw error;
    }
    await client.query(
      `UPDATE clinic.email_verification_otps SET used_at = now()
       WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    );
    await client.query(
      `INSERT INTO clinic.email_verification_otps
       (user_id, token_hash, expires_at, last_sent_at)
       VALUES ($1,$2,now() + interval '15 minutes',now())`,
      [userId, tokenHash],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await sendClinicMail({
    to: normalizedEmail,
    subject: "ยืนยันอีเมลสำหรับบัญชีผู้ป่วย",
    html: `<p>บัญชีผู้ป่วยของคุณพร้อมสำหรับการยืนยันอีเมลแล้ว</p>
      <p>รหัสยืนยันอีเมลของคุณคือ</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px">${escapeHtml(otp)}</p>
      <p>รหัสนี้มีอายุ ${OTP_TTL_MINUTES} นาที และใช้ได้เพียงครั้งเดียว</p>
      <p style="margin:24px 0">
        <a href="${escapeHtml(verificationUrl)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:700">
          ไปหน้ากรอกรหัส OTP
        </a>
      </p>
      <p>เมื่อยืนยันสำเร็จ ระบบจะพาคุณไปหน้าเข้าสู่ระบบ เพื่อกรอกอีเมลและรหัสผ่าน</p>
      <p style="color:#64748b">หากปุ่มไม่ทำงาน ให้คัดลอกลิงก์ต่อไปนี้ไปเปิดในเบราว์เซอร์</p>
      <p style="word-break:break-all"><a href="${escapeHtml(verificationUrl)}">${escapeHtml(verificationUrl)}</a></p>`,
  });
}

module.exports = {
  buildEmailVerificationUrl,
  hashOtp,
  issueEmailVerification,
  OTP_TTL_MINUTES,
};
