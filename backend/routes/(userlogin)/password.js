// routes/(userlogin)/password.js
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../../tools/config");
const { sendClinicMail } = require("../../tools/mailer");
const pool = require("../../tools/db");

const router = express.Router();

const EXPIRE_MIN = Number(process.env.RESET_TOKEN_EXPIRE_MIN || 10); // กำหนดเวลาหมดอายุของ OTP 10 นาที

// ฟังก์ชันสร้าง OTP ตัวเลข 6 หลักด้วยตัวสุ่มแบบเข้ารหัสของ Node.js
// crypto.randomInt สุ่มค่าตั้งแต่ 0 ถึง 999999 และ padStart เติมเลข 0 ด้านหน้าให้ครบ 6 หลัก
function genOTP() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function hashOTP(email, otp) {
  return crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${email}:${otp}`)
    .digest("hex");
}

//ขั้นตอน 1 การขอรหัส OTP
router.post("/forgot-password/request", async (req, res) => {
  if (process.env.DISABLE_EMAIL === "true") {
    return res.status(503).json({ message: "ระบบส่งอีเมลยังไม่เปิดใช้งาน", code: "EMAIL_DISABLED" });
  }
  const raw = (req.body?.email || "").trim(); //อ่านอีเมลจาก Request Body
  const email = raw.toLowerCase();
  if (!email) return res.status(400).json({ message: "ป้อนอีเมลของคุณ" }); //ตรวจสอบว่าผู้ใช้กรอกอีเมลหรือไม่

  const client = await pool.connect(); //ขอ Database Connection

  //เริ่มค้นหาบัญชีผู้ใช้จากอีเมล
  try {
    const { rows } = await client.query(
      //เลือก user_id,email จากตาราง clinic.users
      `SELECT user_id,email
      FROM clinic.users
      WHERE lower(email) = $1
      LIMIT 1`,
      [email],
    );

    //ตรวจสอบ
    // Return the same response for unknown addresses to prevent account enumeration.
    if (!rows.length) {
      return res.json({ message: "หากอีเมลนี้อยู่ในระบบ ระบบจะส่ง OTP ให้" , email });
    }

    const otp = genOTP();
    const token = jwt.sign(
      //สร้าง Reset Token
      { uid: rows[0].user_id, email, action: "pwd_reset" }, //เก็บข้อมูลใน token โดย uid คือรหัสผู้ใช้จากฐานข้อมูล ,email เก็บอีเมลของเจ้าของ ,action ระบุว่า token นี้ใช้สำหรับรีเซ็ตรหัสผ่าน
      JWT_SECRET,
      { expiresIn: `${EXPIRE_MIN}m` }, //การกำหนดอายุของ Token
    );

    //การคำนวณเวลาหมดอายุของ OTP
    const expiresAt = new Date(Date.now() + EXPIRE_MIN * 60 * 1000);

    //เริ่มทำการลบ OTP เก่า
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM clinic.password_reset_otps WHERE lower(email) = $1",
      [email],
    );

    //เพิ่ม OTP ใหม่และ Reset Token ใหม่ลงฐานข้อมูล
    await client.query(
      `INSERT INTO clinic.password_reset_otps(email,otp_hash,token,expires_at)
      VALUES($1,$2,$3,$4)`,
      [email, hashOTP(email, otp), token, expiresAt],
    );

    //การยืนยัน เมื่อสำเร็จจะบันทึกลงฐานข้อมูล
    await client.query("COMMIT");

    //สร้าง Nodemailer พร้อมส่ง OTP ให้ผู้ใช้
    await sendClinicMail({
      to: email,
      subject: "รหัส OTP สำหรับรีเซ็ตรหัสผ่านของคุณ",
      html: `<p>รหัส OTP ของคุณคือ <b style ="font-size:20px">${otp}</b></p>
        <p>รหัสมีอายุ ${EXPIRE_MIN} นาที</p>`,
    });

    //แจ้งผลเมื่อสำเร็จ
    res.json({ message: "ส่ง OTP แล้ว", email });
  } catch (e) {
    try {
      await client.query("ROLLBACK"); //ถ้าเกิดข้อผิดพลาด ROLLBACK ไม่สำเร็จ จะไม่ให้โปรแกรมหยุดทำงาน
    } catch {}
    console.error(
      "forgot-password/request error:",
      e.code,
      e.detail || e.message,
    );
    res.status(500).json({ message: "ไม่สามารถส่ง OTP ได้ กรุณาลองใหม่ภายหลัง" });
  } finally {
    client.release();
  }
});

//ขั้นตอนที่ 2 ตรวจสอบ OTP
router.post("/forgot-password/verify", async (req, res) => {
  const client = await pool.connect();
  try {
    const email = String(req.body?.email || "") //อ่าน email แปลงเป็น String
      .trim() //ตัดช่องว่าง
      .toLocaleLowerCase(); //แปลงเป็นตัวพิมพ์เล็ก

    const otp = String(req.body?.otp || "").trim(); //อ่าน OTP แปลงเป็น String
    if (!email || !otp)
      return res.status(400).json({ message: "ข้อมูลไม่ครบ" });

    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ message: "OTP ไม่ถูกต้อง" });
    }

    await client.query("BEGIN");
    const r = await client.query(
      `SELECT id,token,expires_at,otp_hash,attempt_count
       FROM clinic.password_reset_otps
       WHERE lower(email) = $1 AND used_at IS NULL
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [email],
    );
    if (!r.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "OTP ไม่ถูกต้องหรือหมดอายุ" });
    }

    //นำข้อมูลแถวแรกมาเก็บเป็นตัวแปร
    const row = r.rows[0];
    //ตรวจสอบการหมดอายุของ OTP
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await client.query("DELETE FROM clinic.password_reset_otps WHERE id=$1", [row.id]);
      await client.query("COMMIT");
      //new Date(row.expires_at).getTime() แปลงเวลาเป็นมิลลิวินาที, Date.now() คือเวลาปัจจุบัน
      return res.status(400).json({ message: "OTP หมดอายุ" }); //ถ้าเวลาที่แปลงน้อยกว่าเวลาปัจจุบัน ถือว่า OTP หมดอายุ
    }
    const suppliedHash = hashOTP(email, otp);
    const expected = String(row.otp_hash || "");
    const matches = expected.length === suppliedHash.length
      && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(suppliedHash));
    if (!matches) {
      const attempts = Number(row.attempt_count || 0) + 1;
      if (attempts >= 5) {
        await client.query("DELETE FROM clinic.password_reset_otps WHERE id=$1", [row.id]);
      } else {
        await client.query(
          "UPDATE clinic.password_reset_otps SET attempt_count=$1 WHERE id=$2",
          [attempts, row.id],
        );
      }
      await client.query("COMMIT");
      return res.status(400).json({ message: "OTP ไม่ถูกต้อง" });
    }
    await client.query(
      "UPDATE clinic.password_reset_otps SET verified_at=now() WHERE id=$1",
      [row.id],
    );
    await client.query("COMMIT");
    res.json({ token: row.token, email }); //ถ้า OTP ถูกต้องจะส่ง Reset token ไปยัง Frontend
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("forgot-password/verify error:", e);
    res.status(500).json({ message: "เกิดข้อผิดพลาด" });
  } finally {
    client.release();
  }
});

//ขั้นตอนที่ 3 ตั้งรหัสผ่านใหม่
router.post("/forgot-password/reset", async (req, res) => {
  const client = await pool.connect();
  try {
    const { token, new_password } = req.body || {};
    if (!token || !new_password) //ตรวจสอบข้อมูล
      return res.status(400).json({ message: "ข้อมูลไม่ครบ" });
    if (String(new_password).length < 8) //ตรวจสอบความยาวของรหัสผ่าน
      return res
        .status(400)
        .json({ message: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" });

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET); //ตรวจสอบ JWT token
    } catch {
      return res.status(400).json({ message: "Token ไม่ถูกต้องหรือหมดอายุ" });
    }
    if (payload.action !== "pwd_reset") { //ตรวจสอบประเภทของ token
      return res.status(400).json({ message: "Token ไม่ถูกต้อง" });
    }

    const email = String(payload.email || "") //อ่านข้อมูลจาก token
      .trim()
      .toLowerCase();
    const userId = payload.uid;
    if (!email || !userId)
      return res.status(400).json({ message: "Token ไม่ถูกต้อง" });
    await client.query("BEGIN");
    const check = await client.query( //ตรวจ token กับฐานข้อมูล
      `SELECT id FROM clinic.password_reset_otps
       WHERE lower(email)=$1 AND token=$2 AND expires_at > NOW()
         AND verified_at IS NOT NULL AND used_at IS NULL
       LIMIT 1 FOR UPDATE`,
      [email, token],
    );
    if (!check.rowCount) { //กรณีไม่มีสิทธิ์รีเซ็ต(อาจเกิดจาก ผู้ใช้ขอ OTP ใหม่ทำให้ token ถูกลบ , Token ถูกใช้ไปแล้ว , Token หมดอายุ , Token ไม่มีอยู่ในฐานข้อมูล)
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "ไม่พบสิทธิ์รีเซ็ต" });
    }

    const hash = await bcrypt.hash(new_password, 10); //Hash รหัสผ่าน (ใช้ bcrypt เข้ารหัสผ่านใหม่ก่อนบันทึกลงฐานข้อมูล)

    await client.query( //อัปเดตรหัสผ่านและยกเลิก session เก่า
      "UPDATE clinic.users SET password_hash=$1, session_version=session_version+1 WHERE user_id=$2 AND lower(email) =$3",
      [hash, userId, email],
    );
    await client.query(
      "UPDATE clinic.password_reset_otps SET used_at=now() WHERE id=$1",
      [check.rows[0].id],
    );
    await client.query("COMMIT");

    res.json({ message: "รีเซ็ตรหัสผ่านสำเร็จ" });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("forgot-password/reset error:", e);
    res.status(500).json({ message: "เกิดข้อผิดพลาด" });
  } finally {
    client.release();
  }
});

module.exports = router;
