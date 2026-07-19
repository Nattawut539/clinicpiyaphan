const express = require("express");
const router = express.Router();
const pool = require("../tools/db");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const { authRequired, requireRole, requireStaff, withContext, pgErrorToHttp } = require("../tools/_utils");


// multer (ลบตัวซ้ำ)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
});

// รายการผู้ป่วยทั้งหมด — ดึงจาก user_details เป็นหลัก + ส่ง patient_code 3 หลัก
// router.get("/patients", authRequired, requireStaff, async (req, res) => {
//   console.log("HIT /patients", req.user);
//   try {
//     const rows = await withContext(req, async (client) => {
//       const ctx = await client.query(`
//         SELECT
//           current_setting('app.user_id', true) AS uid,
//           current_setting('app.role', true) AS role,
//           clinic.is_staff() AS is_staff
//       `);
//       console.log("PG CONTEXT =", ctx.rows[0]);

//       const result = await client.query(`
//         SELECT
//           u.user_id,
//           LPAD(u.user_id::text, 3, '0') AS patient_code,
//           d.national_id,
//           d.first_name,
//           d.last_name,
//           d.phone,
//           d.address,
//           d.birth_date AS dob,
//           d.profile_image,
//           u.created_at
//         FROM clinic.users u
//         LEFT JOIN clinic.user_details d
//           ON d.user_id = u.user_id
//         ORDER BY u.user_id ASC
//     `);

//       return result.rows;
//     });

//     res.json(rows);
//   } catch (e) {
//     console.error("GET /patients error:", e);
//     res.status(500).json({ message: "Server error" });
//   }
// });

// ✅ รายชื่อผู้ป่วยทั้งหมด
router.get("/patients", authRequired, requireStaff, async (req, res) => {
  try {
    await withContext(req, async (client) => {
      const { rows } = await client.query(`
        SELECT
          u.user_id,
          LPAD(u.user_id::text, 3, '0') AS patient_code,
          d.national_id,
          d.first_name,
          d.last_name,
          d.phone,
          d.address,
          d.birth_date AS dob,
          d.profile_image,
          u.created_at
        FROM clinic.users u
        LEFT JOIN clinic.user_details d ON d.user_id = u.user_id
        WHERE u.role = 'user'
        ORDER BY u.user_id ASC
      `);

      return res.json(rows);
    });
  } catch (e) {
    console.error("GET /patients error:", e);
    res.status(500).json({ message: "Server error", detail: String(e?.message || e) });
  }
});
router.get("/patients-debug", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT COUNT(*) AS total_users
      FROM clinic.users
      WHERE role = 'user'
    `);
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ message: String(e?.message || e) });
  }
});

router.get("/patients/lookup", requireStaff, async (req, res) => {
  const nationalId = String(req.query.national_id || "").trim();
  const firstName = String(req.query.first_name || "").trim();
  const lastName = String(req.query.last_name || "").trim();

  if (!nationalId && (!firstName || !lastName)) {
    return res.status(400).json({ message: "ระบุเลขบัตรประชาชน หรือชื่อและนามสกุล" });
  }

  try {
    await withContext(req, async (client) => {
      const { rows } = await client.query(
        `
        SELECT
          u.user_id,
          LPAD(u.user_id::text, 3, '0') AS patient_code,
          d.national_id,
          COALESCE(d.title, '') AS title,
          d.first_name,
          d.last_name,
          d.phone,
          d.emergency_phone,
          d.birth_date AS dob,
          d.gender,
          d.blood_type,
          d.drug_allergy,
          d.food_allergy,
          m.weight,
          m.height,
          m.bmi
        FROM clinic.users u
        JOIN clinic.user_details d ON d.user_id = u.user_id
        LEFT JOIN LATERAL (
          SELECT m.weight, m.height, m.bmi
          FROM clinic.measurements m
          JOIN clinic.queue_tickets q ON q.queue_id = m.queue_id
          WHERE q.user_id = u.user_id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) m ON true
        WHERE u.role = 'user'
          AND (
            (NULLIF($1, '') IS NOT NULL AND d.national_id = $1)
            OR (
              LOWER(BTRIM(d.first_name)) = LOWER($2)
              AND LOWER(BTRIM(d.last_name)) = LOWER($3)
            )
          )
        ORDER BY
          CASE WHEN NULLIF($1, '') IS NOT NULL AND d.national_id = $1 THEN 0 ELSE 1 END,
          u.user_id
        LIMIT 1
        `,
        [nationalId, firstName, lastName]
      );

      if (!rows.length) return res.status(404).json({ message: "ไม่พบผู้ป่วยเดิม" });
      res.json(rows[0]);
    });
  } catch (e) {
    console.error("GET /patients/lookup error:", e);
    res.status(500).json({ message: "ค้นหาผู้ป่วยไม่สำเร็จ", detail: String(e?.message || e) });
  }
});

// รายละเอียดรายคน — ส่ง patient_code ด้วย และกรองเฉพาะ user
router.get("/patients/:user_id", requireStaff, async (req, res) => {
  const id = parseInt(req.params.user_id, 10);

  try {
    await withContext(req, async (client) => {
      const { rows } = await client.query(
        `
        SELECT
          u.user_id,
          LPAD(u.user_id::text, 3, '0') AS patient_code,

          d.national_id,
          COALESCE(d.title, '') AS title,
          d.first_name,
          d.last_name,
          d.phone,
          d.address,
          d.birth_date AS dob,
          d.profile_image,

          COALESCE(d.nationality, '') AS nationality,
          COALESCE(d.ethnicity, '') AS ethnicity,

          COALESCE(d.position, '') AS position,    -- อาชีพ (ใช้ position)
          d.gender,
          COALESCE(d.blood_type, '') AS blood_type,
          COALESCE(d.emergency_phone, '') AS emergency_phone,
          COALESCE(d.email, '') AS email,

          COALESCE(d.congenital_disease, '') AS congenital_disease,
          COALESCE(d.drug_allergy, '') AS drug_allergy,
          COALESCE(d.food_allergy, '') AS food_allergy,

          u.created_at
        FROM users u
        JOIN user_details d ON d.user_id = u.user_id
        WHERE u.user_id = $1
          AND u.role = 'user'
        `,
        [id]
      );

      if (!rows.length)
        return res.status(404).json({ message: "ไม่พบข้อมูลผู้ป่วย" });

      res.status(200).json(rows[0]);
    });
  } catch (e) {
    console.error("GET /patients/:id error:", e);
    res.status(500).json({
      message: "Server error",
      detail: String(e?.message || e),
    });
  }
});

// ค้นหาด้วยเลขบัตรประชาชน
router.get("/patients/national/:nid", requireStaff, async (req, res) => {
  const nid = String(req.params.nid || "").trim();
  if (!nid) return res.status(400).json({ message: "invalid national_id" });

  try {
    await withContext(req, async (client) => {
      const { rows } = await client.query(
        `
        SELECT
          u.user_id,
          LPAD(u.user_id::text, 3, '0') AS patient_code  -- ✅ เผื่อใช้บนหน้า
        FROM users u
        JOIN user_details d ON d.user_id = u.user_id
        WHERE d.national_id = $1
          AND u.role = 'user'
        `,
        [nid]
      );
      if (!rows.length)
        return res.status(404).json({ message: "ไม่พบผู้ป่วย" });
      res.status(200).json(rows[0]); // { user_id, patient_code }
    });
  } catch (e) {
    console.error("GET /patients/national/:nid error:", e);
    res
      .status(500)
      .json({ message: "Server error", detail: String(e?.message || e) });
  }
});

// ✅ ค้นหาด้วย patient_code (เช่น 001) → ส่ง user_id กลับเพื่อนำไป /information
router.get("/patients/code/:code", requireStaff, async (req, res) => {
  // รับทั้ง 1, 01, 001 → จะแปลงเป็น 3 หลักให้ก่อนค้นหา
  const raw = String(req.params.code || "").trim();
  if (!raw) return res.status(400).json({ message: "invalid patient_code" });

  // ทำให้เป็น 3 หลักเสมอ (001, 023, 120 ...)
  const code = raw.padStart(3, "0");

  try {
    await withContext(req, async (client) => {
      const { rows } = await client.query(
        `
        SELECT
          u.user_id,
          LPAD(u.user_id::text, 3, '0') AS patient_code
        FROM users u
        WHERE u.role = 'user'
          AND LPAD(u.user_id::text, 3, '0') = $1
        `,
        [code]
      );
      if (!rows.length)
        return res.status(404).json({ message: "ไม่พบผู้ป่วย" });
      res.status(200).json(rows[0]); // { user_id, patient_code }
    });
  } catch (e) {
    console.error("GET /patients/code/:code error:", e);
    res
      .status(500)
      .json({ message: "Server error", detail: String(e?.message || e) });
  }
});

// อัปเดตข้อมูลผู้ป่วย (user_details)
router.put("/patients/:user_id", requireStaff, async (req, res) => {
  const id = parseInt(req.params.user_id, 10);
  const allow = [
    "national_id",
    "first_name",
    "last_name",
    "phone",
    "address",
    "birth_date",
    "gender",
    "blood_type",
    "ethnicity",
    "nationality",
    "emergency_phone",
    "email",
    "congenital_disease",
    "drug_allergy",
    "food_allergy",
    "position",
    "license_no",
  ];

  const payload = {};
  for (const k of allow)
    if (req.body[k] !== undefined) payload[k] = req.body[k];
  if (!Object.keys(payload).length)
    return res.status(400).json({ message: "no update fields" });

  try {
    await withContext(req, async (client) => {
      const sets = [];
      const vals = [];
      let i = 1;

      for (const [k, v] of Object.entries(payload)) {
        sets.push(`${k} = $${i++}`);
        vals.push(v);
      }
      vals.push(id);

      const sql = `
        UPDATE user_details
           SET ${sets.join(", ")},
               updated_at = NOW()
         WHERE user_id = $${i}
         RETURNING *`;
      const { rows } = await client.query(sql, vals);
      if (!rows.length) return res.status(404).json({ message: "not found" });
      res.json({ message: "updated", detail: rows[0] });
    });
  } catch (e) {
    console.error("PUT /patients/:id error:", e);
    res
      .status(500)
      .json({ message: "Server error", detail: String(e?.message || e) });
  }
});

router.put(
  "/patients/:user_id/profile",
  requireStaff,
  upload.single("file"), // ชื่อ field ต้องเป็น "file"
  async (req, res) => {
    const id = Number(req.params.user_id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "invalid user_id" });
    }

    const imageUrl = (req.body?.imageUrl || "").trim();

    if (!req.file && !imageUrl) {
      return res.status(400).json({ message: "no file" });
    }

    // ถ้ามีไฟล์ แปลงเป็น base64 data URL; ถ้ามี imageUrl ให้ใช้ URL แทน
    const finalImage = req.file
      ? `data:${
          req.file.mimetype || "image/jpeg"
        };base64,${req.file.buffer.toString("base64")}`
      : imageUrl;

    try {
      await withContext(req, async (client) => {
        const { rows } = await client.query(
          `UPDATE user_details
             SET profile_image = $1, updated_at = NOW()
           WHERE user_id = $2
           RETURNING profile_image`,
          [finalImage, id]
        );
        if (!rows.length) return res.status(404).json({ message: "not found" });
        res.json({ message: "updated", profile_image: rows[0].profile_image });
      });
    } catch (e) {
      console.error("PUT /patients/:id/profile error:", e);
      res
        .status(500)
        .json({ message: "Server error", detail: String(e?.message || e) });
    }
  }
);

/**
 * ลบผู้ป่วย (ลบ users → user_details cascade)
 */
router.delete("/patients/:user_id", requireStaff, async (req, res) => {
  const id = parseInt(req.params.user_id, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ message: "รหัสผู้ป่วยไม่ถูกต้อง" });
  }

  try {
    await withContext(req, async (client) => {
      const patient = await client.query(
        `SELECT user_id FROM clinic.users WHERE user_id = $1 AND role = 'user'`,
        [id]
      );
      if (!patient.rowCount) {
        return res.status(404).json({ message: "ไม่พบบัญชีผู้ป่วย" });
      }

      // Delete queue rows explicitly before the user. Letting the user FK set
      // queue_tickets.user_id to NULL fires the queue/appointment validation
      // trigger and can fail for legacy appointments that have no slot_id.
      await client.query(
        `DELETE FROM clinic.queue_tickets
         WHERE user_id = $1
            OR appointment_id IN (
              SELECT appointment_id
              FROM clinic.appointments
              WHERE user_id = $1
            )`,
        [id]
      );

      const { rowCount } = await client.query(
        `DELETE FROM clinic.users WHERE user_id = $1 AND role = 'user'`,
        [id]
      );
      if (!rowCount) return res.status(404).json({ message: "ไม่พบบัญชีผู้ป่วย" });
      res.json({ message: "ลบบัญชีผู้ป่วยเรียบร้อยแล้ว" });
    });
  } catch (e) {
    console.error("DELETE /patients/:id error:", e);
    res
      .status(500)
      .json({ message: "ลบบัญชีผู้ป่วยไม่สำเร็จ", detail: String(e?.message || e) });
  }
});


router.get("/me/profile", authRequired, async (req, res) => {
  try {
    const userId = req.user?.user_id;
    if (!userId)
      return res.status(401).json({ message: "Unauthorized: no user_id" });

    const profile = await pool.query(
      `
      SELECT
        u.user_id,
        LPAD(u.user_id::text, 3, '0') AS patient_code,
        u.role,
        u.email AS user_email,
        NULLIF(BTRIM(u.username), '') AS username,
        u.created_at,
        to_jsonb(ud) AS detail
      FROM clinic.users u
      LEFT JOIN LATERAL (
        SELECT d.*
        FROM clinic.user_details d
        WHERE d.user_id = u.user_id
        ORDER BY d.detail_id DESC
        LIMIT 1
      ) ud ON true
      WHERE u.user_id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (!profile.rows.length)
      return res.status(404).json({ message: "ไม่พบโปรไฟล์" });

    const row = profile.rows[0];
    const detail = row.detail || {};
    const firstName =
      String(detail.first_name || "").trim() ||
      row.username ||
      String(row.user_email || "").split("@")[0] ||
      "";

    res.json({
      ...detail,
      user_id: row.user_id,
      patient_code: row.patient_code,
      role: row.role,
      created_at: row.created_at,
      email: String(detail.email || row.user_email || ""),
      first_name: firstName,
      last_name: detail.last_name || "",
    });
  } catch (err) {
    console.error("GET /users/me/profile error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Only a super admin can create privileged staff accounts. The role is
// deliberately restricted to admin/doctor and cannot be supplied elsewhere.
router.post(
  "/staff/accounts",
  requireRole("super_admin", "superadmin"),
  async (req, res) => {
    const {
      username,
      email,
      password,
      first_name,
      last_name,
      role,
      super_admin_password,
    } = req.body || {};
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedUsername = String(username || "").trim();
    const normalizedRole = String(role || "").trim().toLowerCase();

    if (!normalizedUsername || !normalizedEmail || !password || !first_name || !last_name || !super_admin_password) {
      return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ message: "รูปแบบอีเมลไม่ถูกต้อง" });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ message: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" });
    }
    if (!["admin", "doctor"].includes(normalizedRole)) {
      return res.status(400).json({ message: "Role ต้องเป็น admin หรือ doctor เท่านั้น" });
    }

    try {
      await withContext(req, async (client) => {
        const actorResult = await client.query(
          `SELECT password_hash FROM clinic.users WHERE user_id = $1 LIMIT 1`,
          [req.user.user_id]
        );
        const actorPasswordHash = actorResult.rows[0]?.password_hash;
        if (!actorPasswordHash) {
          return res.status(400).json({
            message: "บัญชี Super Admin นี้ไม่ได้ตั้งรหัสผ่าน จึงไม่สามารถยืนยันตัวตนได้",
          });
        }

        const passwordVerified = await bcrypt.compare(
          String(super_admin_password),
          actorPasswordHash
        );
        if (!passwordVerified) {
          return res.status(401).json({ message: "รหัสผ่าน Super Admin ไม่ถูกต้อง" });
        }

        const duplicate = await client.query(
          `SELECT 1 FROM clinic.users
           WHERE LOWER(email) = $1 OR LOWER(username) = LOWER($2)
           LIMIT 1`,
          [normalizedEmail, normalizedUsername]
        );
        if (duplicate.rowCount) {
          return res.status(409).json({ message: "Username หรืออีเมลนี้ถูกใช้งานแล้ว" });
        }

        const passwordHash = await bcrypt.hash(String(password), 10);
        const userResult = await client.query(
          `INSERT INTO clinic.users (username, email, password_hash, role)
           VALUES ($1, $2, $3, $4)
           RETURNING user_id, username, email, role`,
          [normalizedUsername, normalizedEmail, passwordHash, normalizedRole]
        );
        const created = userResult.rows[0];

        await client.query(
          `INSERT INTO clinic.user_details (user_id, first_name, last_name, email)
           VALUES ($1, $2, $3, $4)`,
          [created.user_id, String(first_name).trim(), String(last_name).trim(), normalizedEmail]
        );

        return res.status(201).json({
          message: "สร้างบัญชีสำเร็จ",
          user: created,
        });
      });
    } catch (error) {
      console.error("POST /staff/accounts error:", error);
      return res.status(500).json({ message: "สร้างบัญชีไม่สำเร็จ" });
    }
  }
);

// Self-service profile update. Role is never accepted or updated here.
router.patch(
  "/me/profile",
  authRequired,
  upload.single("file"),
  async (req, res) => {
    const userId = req.user?.user_id;
    const normalizeText = (value) => {
      const text = String(value ?? "").trim();
      return text === "" ? null : text;
    };
    const normalizeDigits = (value) => {
      const text = normalizeText(value);
      return text ? text.replace(/\D/g, "") || null : null;
    };
    const normalizeDate = (value) => {
      const text = normalizeText(value);
      if (!text) return null;
      const dateText = text.slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? dateText : "__INVALID_DATE__";
    };
    const fieldLimits = {
      title: 20,
      national_id: 20,
      first_name: 100,
      last_name: 100,
      gender: 20,
      blood_type: 2,
      province_code: 10,
      ethnicity: 10,
      nationality: 10,
      phone: 10,
      emergency_phone: 10,
      email: 50,
    };
    const fieldLabels = {
      title: "คำนำหน้า",
      national_id: "เลขบัตรประชาชน",
      first_name: "ชื่อ",
      last_name: "นามสกุล",
      birth_date: "วันเกิด",
      gender: "เพศ",
      blood_type: "กรุ๊ปเลือด",
      province_code: "รหัสจังหวัด",
      ethnicity: "เชื้อชาติ",
      nationality: "สัญชาติ",
      phone: "เบอร์โทรศัพท์",
      emergency_phone: "เบอร์ฉุกเฉิน",
      email: "อีเมล",
    };
    const normalizeDetailValue = (field, value) => {
      if (field === "phone" || field === "emergency_phone" || field === "national_id") {
        return normalizeDigits(value);
      }
      if (field === "birth_date") return normalizeDate(value);
      if (field === "email") return normalizeText(value)?.toLowerCase() || null;
      if (field === "blood_type") return normalizeText(value)?.toUpperCase() || null;
      return normalizeText(value);
    };
    const firstName = normalizeText(req.body?.first_name);
    const lastName = normalizeText(req.body?.last_name);
    const email = normalizeText(req.body?.email)?.toLowerCase() || null;

    if (!firstName || !lastName || !email) {
      return res.status(400).json({ message: "กรุณากรอกชื่อ นามสกุล และอีเมล" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "รูปแบบอีเมลไม่ถูกต้อง" });
    }
    if (req.file && !String(req.file.mimetype || "").startsWith("image/")) {
      return res.status(400).json({ message: "รองรับเฉพาะไฟล์รูปภาพ" });
    }

    const profileImage = req.file
      ? `data:${req.file.mimetype || "image/jpeg"};base64,${req.file.buffer.toString("base64")}`
      : null;

    try {
      await withContext(req, async (client) => {
        const duplicate = await client.query(
          `SELECT 1 FROM clinic.users WHERE LOWER(email) = $1 AND user_id <> $2 LIMIT 1`,
          [email, userId]
        );
        if (duplicate.rowCount) {
          return res.status(409).json({ message: "อีเมลนี้ถูกใช้งานแล้ว" });
        }

        await client.query(
          `UPDATE clinic.users SET email = $1 WHERE user_id = $2`,
          [email, userId]
        );

        const detailColumns = await client.query(
          `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = 'clinic' AND table_name = 'user_details'`
        );
        const existingFields = new Set(detailColumns.rows.map((row) => row.column_name));

        const allowedFields = [
          "title",
          "national_id",
          "first_name",
          "last_name",
          "phone",
          "address",
          "province_code",
          "birth_date",
          "gender",
          "blood_type",
          "ethnicity",
          "nationality",
          "emergency_phone",
          "email",
          "congenital_disease",
          "drug_allergy",
          "food_allergy",
          "position",
        ].filter((field) => existingFields.has(field));

        const payload = {};
        for (const field of allowedFields) {
          if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
            payload[field] = normalizeDetailValue(field, req.body[field]);
          }
        }
        payload.first_name = firstName;
        payload.last_name = lastName;
        payload.email = email;
        if (profileImage && existingFields.has("profile_image")) payload.profile_image = profileImage;

        for (const [field, value] of Object.entries(payload)) {
          if (value === "__INVALID_DATE__") {
            return res.status(400).json({ message: `${fieldLabels[field] || field} ต้องอยู่ในรูปแบบ YYYY-MM-DD` });
          }
          const limit = fieldLimits[field];
          if (limit && value && String(value).length > limit) {
            return res.status(400).json({ message: `${fieldLabels[field] || field} ต้องไม่เกิน ${limit} ตัวอักษร` });
          }
        }

        if (payload.province_code) {
          const province = await client.query(
            `SELECT 1 FROM clinic.provinces WHERE province_code = $1 LIMIT 1`,
            [payload.province_code]
          );
          if (!province.rowCount) {
            return res.status(400).json({ message: "รหัสจังหวัดไม่ถูกต้อง" });
          }
        }

        const sets = [];
        const values = [];
        let index = 1;
        for (const [field, value] of Object.entries(payload)) {
          sets.push(`${field} = $${index++}`);
          values.push(value);
        }
        values.push(userId);

        const detail = await client.query(
          `UPDATE clinic.user_details
           SET ${sets.join(", ")},
               updated_at = NOW()
           WHERE detail_id = (
             SELECT detail_id FROM clinic.user_details
             WHERE user_id = $${index} ORDER BY detail_id DESC LIMIT 1
           )
           RETURNING *`,
          values
        );

        let savedDetail = detail.rows[0];
        if (!savedDetail) {
          const insertFields = ["user_id", ...Object.keys(payload)];
          const insertValues = [userId, ...Object.values(payload)];
          const placeholders = insertValues.map((_, i) => `$${i + 1}`);
          const inserted = await client.query(
            `INSERT INTO clinic.user_details (${insertFields.join(", ")})
             VALUES (${placeholders.join(", ")})
             RETURNING *`,
            insertValues
          );
          savedDetail = inserted.rows[0];
        }

        return res.json({
          user_id: userId,
          patient_code: String(userId).padStart(3, "0"),
          role: req.user.role,
          ...savedDetail,
        });
      });
    } catch (error) {
      console.error("PATCH /me/profile error:", error);
      const mapped = pgErrorToHttp(error);
      if (mapped.status !== 500) {
        return res.status(mapped.status).json({ message: mapped.message });
      }
      return res.status(500).json({ message: "บันทึกโปรไฟล์ไม่สำเร็จ" });
    }
  }
);


module.exports = router;
