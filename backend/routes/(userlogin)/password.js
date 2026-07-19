// routes/(userlogin)/password.js
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../../tools/config");
const nodemailer = require("nodemailer");
const pool = require("../../tools/db");

const router = express.Router();

const EXPIRE_MIN = Number(process.env.RESET_TOKEN_EXPIRE_MIN || 10);

// อ่านค่าจาก .env (รองรับทั้ง SMTP_* และ MAIL_*)
const SMTP_HOST = process.env.SMTP_HOST || process.env.MAIL_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || process.env.MAIL_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || process.env.MAIL_USER;
const SMTP_PASS = process.env.SMTP_PASS || process.env.MAIL_PASS;
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;

function genOTP() {
  return ("" + Math.floor(100000 + Math.random() * 900000)).slice(-6);
}

function makeTransport() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}
/**
 * POST /api/users/forgot-password/request
 * body { email }
 * - ถ้าไม่พบอีเมล => 404
 * - ถ้าพบ => gen OTP + token, เก็บ DB, ส่งอีเมล แล้วตอบ 200
 */
router.post("/forgot-password/request", async (req, res) => {
  const raw = (req.body?.email || "").trim();
  const email = raw.toLowerCase();
  if (!email) return res.status(400).json({ message: "กรุณาระบุอีเมล" });

  const client = await pool.connect();
  try {
    // บัญชีทุกประเภทที่มีอีเมลสามารถยืนยัน OTP เพื่อตั้งรหัสผ่านได้
    // รวมถึงบัญชีที่สร้างผ่าน Google/LINE และยังไม่เคยมีรหัสผ่าน
    const { rows } = await client.query(
      `SELECT user_id, email
   FROM clinic.users
   WHERE lower(email) = $1
   LIMIT 1`,
      [email]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "ไม่พบบัญชีอีเมลนี้ในระบบ" });
    }

    const otp = genOTP();
    const token = jwt.sign(
      { uid: rows[0].user_id, email, action: "pwd_reset" },
      JWT_SECRET,
      {
        expiresIn: `${EXPIRE_MIN}m`,
      }
    );
    const expiresAt = new Date(Date.now() + EXPIRE_MIN * 60 * 1000);

    await client.query("BEGIN");
    await client.query(
      "DELETE FROM clinic.password_reset_otps WHERE lower(email) = $1",
      [email]
    );
    await client.query(
      `INSERT INTO clinic.password_reset_otps (email, otp, token, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [email, otp, token, expiresAt]
    );
    await client.query("COMMIT");

    const t = makeTransport();
    await t.sendMail({
      to: email,
      from: MAIL_FROM,
      subject: "รหัส OTP สำหรับรีเซ็ตรหัสผ่าน",
      html: `<p>รหัส OTP ของคุณคือ <b style="font-size:18px">${otp}</b></p>
             <p>รหัสมีอายุ ${EXPIRE_MIN} นาที</p>`,
    });

    res.json({ message: "ส่ง OTP แล้ว", email });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error(
      "forgot-password/request error:",
      e.code,
      e.detail || e.message
    );
    res
      .status(500)
      .json({ message: e.detail || e.message || "เกิดข้อผิดพลาด" });
  } finally {
    client.release();
  }
});

/**
 * POST /api/users/forgot-password/verify
 * body { email, otp }
 * - ถ้า otp ถูกต้อง (และยังไม่หมดอายุ) => ส่ง { token }
 */
router.post("/forgot-password/verify", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const otp = String(req.body?.otp || "").trim();
    if (!email || !otp)
      return res.status(400).json({ message: "ข้อมูลไม่ครบ" });

    const r = await pool.query(
      "SELECT token, expires_at FROM clinic.password_reset_otps WHERE lower(email)=$1 AND otp=$2 LIMIT 1",
      [email, otp]
    );
    if (!r.rowCount) return res.status(400).json({ message: "OTP ไม่ถูกต้อง" });

    const row = r.rows[0];
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ message: "OTP หมดอายุ" });
    }
    res.json({ token: row.token, email });
  } catch (e) {
    console.error("forgot-password/verify error:", e);
    res.status(500).json({ message: "เกิดข้อผิดพลาด" });
  }
});

/**
 * POST /api/users/forgot-password/reset
 * body { token, new_password }
 */
router.post("/forgot-password/reset", async (req, res) => {
  try {
    const { token, new_password } = req.body || {};
    if (!token || !new_password)
      return res.status(400).json({ message: "ข้อมูลไม่ครบ" });
    if (String(new_password).length < 8)
      return res.status(400).json({ message: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" });

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(400).json({ message: "โทเคนไม่ถูกต้องหรือหมดอายุ" });
    }
    if (payload.action !== "pwd_reset") {
      return res.status(400).json({ message: "โทเคนไม่ถูกต้อง" });
    }

    const email = String(payload.email || "").trim().toLowerCase();
    const userId = payload.uid;
    if (!email || !userId)
      return res.status(400).json({ message: "โทเคนไม่ถูกต้อง" });
    const check = await pool.query(
      "SELECT 1 FROM clinic.password_reset_otps WHERE lower(email)=$1 AND token=$2 AND expires_at > NOW() LIMIT 1",
      [email, token]
    );
    if (!check.rowCount)
      return res.status(400).json({ message: "ไม่พบสิทธิ์รีเซ็ต" });

    const hash = await bcrypt.hash(new_password, 10);
    await pool.query(
      "UPDATE clinic.users SET password_hash=$1 WHERE user_id=$2 AND lower(email)=$3",
      [hash, userId, email]
    );
    await pool.query("DELETE FROM clinic.password_reset_otps WHERE lower(email)=$1", [
      email,
    ]);

    res.json({ message: "รีเซ็ตรหัสผ่านสำเร็จ" });
  } catch (e) {
    console.error("forgot-password/reset error:", e);
    res.status(500).json({ message: "เกิดข้อผิดพลาด" });
  }
});

module.exports = router;
