const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../../tools/db");
const { issueEmailVerification } = require("../../tools/emailVerification");
const router = express.Router();

//ตรวจสอบการทำงานของไฟล์ว่าเชื่อมต่อกับ server.js หรือไม่
router.get("/register/health", (_req, res) => {
  res.json({ ok: true, path: "/api/users/register" });
});

//Router สมัครสมาชิก
router.post("/register", async (req, res) => {
  //สมัครสมาชิกจะเป็น role user เท่านั้น
  const client = await pool.connect(); //ขอเชื่อมต่อกับฐานข้อมูล
  try {
    const {
      //รับค่า
      title,
      first_name,
      last_name,
      national_id,
      phone,
      address,
      province,
      birth_date,
      email,
      password,
      username,
    } = req.body || {};

    const normalizedEmail = String(email || "") //normalizedEmail แปลงอีเมลเป็น String ตัดช่องว่างหน้าและหลัง และแปลงเป็นตัวพิมพ์เล็ก
      .trim()
      .toLowerCase();
    const normalizedUsername = username ? String(username).trim() : ""; //normalizedUsername แปลง username เป็น String และตัดช่องว่างหน้าและหลัง
    const normalizedNationalId = String(national_id || "").trim();

    if (!normalizedEmail || !password || !first_name || !last_name) {
      //ตรวจสอบข้อมูลที่จำเป็น
      return res.status(400).json({ error: "ข้อมูลไม่ครบถ้วน" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: "รูปแบบอีเมลไม่ถูกต้อง" });
    }
    if (!/^(?=.*[A-Za-z])(?=.*\d).{6,}$/.test(String(password))) {
      return res.status(400).json({ error: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวและมีตัวอักษรกับตัวเลข" });
    }
    if (normalizedNationalId && !/^\d{13}$/.test(normalizedNationalId)) {
      return res.status(400).json({ error: "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก" });
    }

    let claimUserId = null;
    if (normalizedNationalId) {
      const patient = await client.query(
        `SELECT u.user_id, u.account_status, d.first_name, d.last_name, d.birth_date::text, d.phone
         FROM clinic.users u
         JOIN clinic.user_details d ON d.user_id = u.user_id
         WHERE d.national_id = $1
         ORDER BY d.detail_id DESC LIMIT 1`,
        [normalizedNationalId],
      );
      if (patient.rowCount) {
        const row = patient.rows[0];
        const identityMatches =
          String(row.account_status) === "unclaimed" &&
          String(row.first_name || "").trim().toLowerCase() === String(first_name).trim().toLowerCase() &&
          String(row.last_name || "").trim().toLowerCase() === String(last_name).trim().toLowerCase() &&
          (!row.birth_date || !birth_date || String(row.birth_date).slice(0, 10) === String(birth_date).slice(0, 10)) &&
          (!row.phone || !phone || String(row.phone).replace(/\D/g, "") === String(phone).replace(/\D/g, ""));
        if (!identityMatches) {
          return res.status(409).json({ error: "เลขบัตรประชาชนนี้มีข้อมูลในระบบแล้ว กรุณาติดต่อเจ้าหน้าที่เพื่อยืนยันตัวตน" });
        }
        claimUserId = row.user_id;
      }
    }

    //ตรวจสอบ Username ซ้ำ (ตรวจสอบทั้งพิมพ์เล็กและใหญ่ หากซ้ำจะไม่สามารถสมัครได้)
    if (normalizedUsername) {
      const q1 = await client.query(
        "SELECT 1 FROM clinic.users WHERE LOWER(username) = LOWER($1)",
        [normalizedUsername],
      );
      if (q1.rowCount)
        return res.status(409).json({ error: "ชื่อนี้ถูกใช้แล้ว" });
    }
    //ตรวจสอบ Email ซ้ำ
    const q2 = await client.query(
      "SELECT 1 FROM clinic.users WHERE LOWER(email) =$1",
      [normalizedEmail],
    );
    if (q2.rowCount)
      return res.status(409).json({ error: "อีเมลนี้ถูกใช้ไปแล้ว" });

    //เริ่มการ Transaction
    await client.query("BEGIN");
    let province_code = null; //ค้นหา province_code (จังหวัด)
    if (province) {
      const p = await client.query(
        "SELECT province_code FROM clinic.provinces WHERE name_th=$1 OR name_en=$1 LIMIT 1",
        [province],
      );
      if (p.rowCount) province_code = p.rows[0].province_code;
    }

    //สร้าง Username อัตโนมัติ (ถ้าผู้ใช้ไม่ได้ส่ง Username มา ระบบจะใช้ข้อความก่อน @ เป็นของ Email )
    let finalUsername = normalizedUsername;
    if (!finalUsername) {
      finalUsername = normalizedEmail.split("@")[0].toLowerCase(); //ทำการแยกด้วย normalizedEmail.split("@")
      let i = 1; //ตรวจสอบ Username สร้างซ้ำหรือไม่
      while (true) {
        const chk = await client.query(
          "SELECT 1 FROM clinic.users WHERE LOWER(username) =LOWER($1)",
          [finalUsername],
        );
        if (!chk.rowCount) break;
        finalUsername = `${normalizedEmail.split("@")[0].toLowerCase()}${++i}`;
      }
    }

    const password_hash = await bcrypt.hash(password, 10); //การเข้ารหัสจริงไป Hash ด้วย bcrypt

    //บันทึกลง ตาราง user
    const u = claimUserId
      ? await client.query(
          `UPDATE clinic.users
           SET username = $1, email = $2, password_hash = $3,
               account_status = 'pending_verification', registration_source = 'walkin_claim',
               profile_completed_at = now(), status_changed_at = now(), session_version = session_version + 1
           WHERE user_id = $4
           RETURNING user_id,username,email,role`,
          [finalUsername, normalizedEmail, password_hash, claimUserId],
        )
      : await client.query(
          `INSERT INTO clinic.users
           (username,email,password_hash,role,account_status,registration_source,profile_completed_at)
           VALUES($1,$2,$3,'user','pending_verification','local',now())
           RETURNING user_id,username,email,role`,
          [finalUsername, normalizedEmail, password_hash],
        );
    const user_id = u.rows[0].user_id; //user_id จะใช้เชื่อมกับตาราง clinic.user_details

    //บันทึกลง ตาราง user_details
    if (claimUserId) {
      await client.query(
        `UPDATE clinic.user_details
         SET title = COALESCE(NULLIF($2, ''), title), first_name = $3, last_name = $4,
             phone = COALESCE(NULLIF($5, ''), phone), address = COALESCE(NULLIF($6, ''), address),
             province_code = COALESCE($7, province_code),
             birth_date = COALESCE(NULLIF($8, '')::date, birth_date), email = $9, updated_at = now()
         WHERE user_id = $1`,
        [user_id, title || "", first_name, last_name, phone || "", address || "", province_code, birth_date || "", normalizedEmail],
      );
    } else await client.query(
      `INSERT INTO clinic.user_details
      (user_id,title,first_name,last_name,national_id,phone,address,province_code,birth_date,email)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        user_id,
        title || null,
        first_name || null,
        last_name || null,
        normalizedNationalId || null,
        phone || null,
        address || null,
        province_code,
        birth_date || null,
        normalizedEmail,
      ],
    );

    await client.query("COMMIT"); //หากเพิ่มทั้ง 2 ตารางสำเร็จ ระบบจะยืนยัน Transaction
    let emailSent = false;
    try {
      await issueEmailVerification(user_id, normalizedEmail);
      emailSent = true;
    } catch (mailError) {
      console.error("ส่ง OTP ยืนยันอีเมลไม่สำเร็จ:", mailError.message);
    }
    return res.status(201).json({
      message: "สมัครสมาชิกสำเร็จ กรุณายืนยันอีเมล",
      user_id,
      username: finalUsername,
      email: normalizedEmail,
      verification_required: true,
      email_sent: emailSent,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(" ลงทะเบียนล้มเหลว", err);
    return res.status(500).json({ error: "สมัครสมาชิกไม่สำเร็จ" });
  } finally {
    client.release();
  }
});

module.exports = router;
