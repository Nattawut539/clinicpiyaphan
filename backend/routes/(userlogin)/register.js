const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../../tools/db"); // << สำคัญ: ออกจาก (userlogin) สองชั้น
const router = express.Router();

// ไว้เช็คว่า route ถูก mount แล้ว
router.get("/register/health", (_req, res) => {
  res.json({ ok: true, path: "/api/users/register" });
});

/**
 * สมัครสมาชิก (role = user)
 * body {
 *   title, first_name, last_name, national_id, phone, address,
 *   province (ชื่อจังหวัดภาษาไทย), birth_date (YYYY-MM-DD),
 *   email, password, username (ส่งมาก็ได้ ไม่ส่งจะ gen ให้)
 * }
 */
router.post("/register", async (req, res) => {
  const client = await pool.connect();
  try {
    const {
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

    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedUsername = username ? String(username).trim() : "";

    if (!normalizedEmail || !password || !first_name || !last_name) {
      return res.status(400).json({ error: "ข้อมูลไม่ครบถ้วน" });
    }

    // ตรวจซ้ำ username / email
    if (normalizedUsername) {
      const q1 = await client.query(
        "SELECT 1 FROM clinic.users WHERE LOWER(username) = LOWER($1)",
        [normalizedUsername]
      );
      if (q1.rowCount)
        return res.status(409).json({ error: "Username นี้ถูกใช้แล้ว" });
    }
    const q2 = await client.query("SELECT 1 FROM clinic.users WHERE LOWER(email) = $1", [
      normalizedEmail,
    ]);
    if (q2.rowCount)
      return res.status(409).json({ error: "Email นี้ถูกใช้แล้ว" });

    await client.query("BEGIN");

    // หา province_code จากชื่อจังหวัด (ถ้าไม่มีให้เป็น null)
    let province_code = null;
    if (province) {
      const p = await client.query(
        "SELECT province_code FROM clinic.provinces WHERE name_th=$1 OR name_en=$1 LIMIT 1",
        [province]
      );
      if (p.rowCount) province_code = p.rows[0].province_code;
    }

    // gen username ถ้าไม่ส่งมา
    let finalUsername = normalizedUsername;
    if (!finalUsername) {
      finalUsername = normalizedEmail.split("@")[0].toLowerCase();
      // กันชนกับของเดิม
      let i = 1;
      while (true) {
        const chk = await client.query(
          "SELECT 1 FROM clinic.users WHERE LOWER(username)=LOWER($1)",
          [finalUsername]
        );
        if (!chk.rowCount) break;
        finalUsername = `${normalizedEmail.split("@")[0].toLowerCase()}${++i}`;
      }
    }

    const password_hash = await bcrypt.hash(password, 10);

    // users
    const u = await client.query(
      `INSERT INTO clinic.users (username, email, password_hash, role)
       VALUES ($1,$2,$3,'user') RETURNING user_id, username, email, role`,
      [finalUsername, normalizedEmail, password_hash]
    );
    const user_id = u.rows[0].user_id;

    // user_details
    await client.query(
      `INSERT INTO clinic.user_details
       (user_id, first_name, last_name, national_id, phone, address,
        province_code, birth_date, email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        user_id,
        first_name || null,
        last_name || null,
        national_id || null,
        phone || null,
        address || null,
        province_code,
        birth_date || null,
        normalizedEmail,
      ]
    );

    await client.query("COMMIT");
    return res
      .status(201)
      .json({ message: "สมัครสมาชิกสำเร็จ", user_id, username: finalUsername });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("REGISTER ERROR:", err);
    return res.status(500).json({ error: "สมัครสมาชิกไม่สำเร็จ" });
  } finally {
    client.release();
  }
});

module.exports = router;
