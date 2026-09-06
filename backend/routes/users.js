const express = require("express");
const router = express.Router();
const pool = require("../tools/db");
const bcrypt = require("bcryptjs");
const { authRequired, requireRole, requireStaff, withContext, pgErrorToHttp } = require("../tools/_utils");
const { issueEmailVerification } = require("../tools/emailVerification");
const { escapeHtml, sendClinicMail } = require("../tools/mailer");
const {
  uploadProfileImage,
  cleanupUncommittedUpload,
  validateProfileImageContent,
  getPublicProfileImagePath,
  commitProfileImage,
  acceptProfileImage,
  discardUploadedProfileImage,
} = require("../tools/profileImageUpload");

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
          u.account_status,
          u.status_reason,
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
router.get("/patients-debug", requireStaff, async (_req, res) => {
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

      // ไม่พบหมายถึงเป็นผู้ป่วย Walk-in ใหม่ ไม่ใช่ข้อผิดพลาดของระบบ
      if (!rows.length) return res.json(null);
      res.json(rows[0]);
    });
  } catch (e) {
    console.error("GET /patients/lookup error:", e);
    res.status(500).json({ message: "ค้นหาผู้ป่วยไม่สำเร็จ", detail: String(e?.message || e) });
  }
});

// Admin เปลี่ยนบัญชีผู้ป่วย Walk-in เดิมให้เป็นบัญชีออนไลน์ โดยคง user_id
// ประวัติคิว ผลตรวจ และเวชระเบียนทั้งหมดจึงยังเชื่อมกับผู้ป่วยคนเดิม
router.post(
  "/patients/:user_id/claim-account",
  requireRole("admin", "super_admin", "superadmin"),
  async (req, res, next) => {
    const userId = Number(req.params.user_id);
    const normalizedEmail = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ message: "รหัสผู้ป่วยไม่ถูกต้อง" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ message: "รูปแบบอีเมลไม่ถูกต้อง" });
    }
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password)) {
      return res.status(400).json({ message: "รหัสผ่านต้องมีอย่างน้อย 8 ตัว และมีตัวอักษรกับตัวเลข" });
    }

    try {
      const claimed = await withContext(req, async (client) => {
        const patientResult = await client.query(
          `SELECT u.user_id, u.account_status, u.registration_source,
                  d.first_name, d.last_name
           FROM clinic.users u
           LEFT JOIN clinic.user_details d ON d.user_id = u.user_id
           WHERE u.user_id = $1 AND u.role = 'user'
           FOR UPDATE OF u`,
          [userId],
        );
        if (!patientResult.rowCount) return { status: 404, message: "ไม่พบผู้ป่วย" };

        const patient = patientResult.rows[0];
        if (
          String(patient.account_status) !== "unclaimed" ||
          String(patient.registration_source) !== "walkin"
        ) {
          return { status: 409, message: "บัญชีผู้ป่วยนี้ถูกลงทะเบียนแล้ว" };
        }

        const duplicateEmail = await client.query(
          `SELECT 1 FROM clinic.users
           WHERE LOWER(email) = $1 AND user_id <> $2
           LIMIT 1`,
          [normalizedEmail, userId],
        );
        if (duplicateEmail.rowCount) {
          return { status: 409, message: "อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว" };
        }

        const usernameBase = normalizedEmail.split("@")[0].replace(/[^a-z0-9._-]/g, "") || `patient${userId}`;
        let username = usernameBase.slice(0, 42);
        let suffix = 1;
        while (true) {
          const duplicateUsername = await client.query(
            `SELECT 1 FROM clinic.users
             WHERE LOWER(username) = LOWER($1) AND user_id <> $2
             LIMIT 1`,
            [username, userId],
          );
          if (!duplicateUsername.rowCount) break;
          suffix += 1;
          username = `${usernameBase.slice(0, 38)}${suffix}`;
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const updated = await client.query(
          `UPDATE clinic.users
           SET username = $1,
               email = $2,
               password_hash = $3,
               account_status = 'pending_verification',
               registration_source = 'walkin_claim',
               email_verified_at = NULL,
               profile_completed_at = COALESCE(profile_completed_at, now()),
               status_reason = 'สร้างบัญชีออนไลน์โดยเจ้าหน้าที่',
               status_changed_at = now(),
               status_changed_by = $4,
               session_version = session_version + 1
           WHERE user_id = $5
           RETURNING user_id, username, email, account_status`,
          [username, normalizedEmail, passwordHash, req.user.user_id, userId],
        );

        await client.query(
          `UPDATE clinic.user_details
           SET email = $1, updated_at = now()
           WHERE user_id = $2`,
          [normalizedEmail, userId],
        );

        return {
          status: 200,
          patient: updated.rows[0],
          firstName: patient.first_name,
          lastName: patient.last_name,
        };
      });

      if (!claimed.patient) {
        return res.status(claimed.status).json({ message: claimed.message });
      }

      let emailSent = false;
      try {
        await issueEmailVerification(userId, normalizedEmail);
        emailSent = true;
      } catch (mailError) {
        console.error("ส่ง OTP สำหรับบัญชี Walk-in ไม่สำเร็จ:", mailError.message);
      }

      return res.json({
        message: emailSent
          ? "สร้างบัญชีออนไลน์และส่ง OTP ยืนยันอีเมลแล้ว"
          : "สร้างบัญชีออนไลน์แล้ว แต่ยังส่ง OTP ไม่สำเร็จ",
        ...claimed.patient,
        email_sent: emailSent,
      });
    } catch (error) {
      const mapped = pgErrorToHttp(error);
      return res.status(mapped.status).json({ message: mapped.message });
    }
  },
);

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
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "รหัสผู้ป่วยไม่ถูกต้อง" });
  }

  if (req.body.national_id !== undefined) {
    const nationalId = String(req.body.national_id || "").replace(/\D/g, "");
    if (nationalId && !/^\d{13}$/.test(nationalId)) {
      return res.status(400).json({ message: "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก" });
    }
    req.body.national_id = nationalId || null;
  }

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
      if (payload.national_id) {
        const duplicateNationalId = await client.query(
          `SELECT 1 FROM user_details WHERE national_id = $1 AND user_id <> $2 LIMIT 1`,
          [payload.national_id, id],
        );
        if (duplicateNationalId.rowCount) {
          return res.status(409).json({ message: "เลขบัตรประชาชนนี้มีอยู่ในระบบแล้ว" });
        }
      }

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
  uploadProfileImage.single("file"),
  cleanupUncommittedUpload,
  validateProfileImageContent,
  async (req, res) => {
    const id = Number(req.params.user_id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "invalid user_id" });
    }

    const imageUrl = (req.body?.imageUrl || "").trim();

    if (!req.file && !imageUrl) {
      return res.status(400).json({ message: "no file" });
    }

    const finalImage = getPublicProfileImagePath(req.file) || imageUrl;
    let previousImage = null;

    try {
      await withContext(req, async (client) => {
        const existing = await client.query(
          `SELECT profile_image FROM user_details WHERE user_id = $1 FOR UPDATE`,
          [id],
        );
        if (!existing.rows.length) {
          return res.status(404).json({ message: "not found" });
        }
        previousImage = existing.rows[0].profile_image;

        const { rows } = await client.query(
          `UPDATE user_details
             SET profile_image = $1, updated_at = NOW()
           WHERE user_id = $2
           RETURNING profile_image`,
          [finalImage, id]
        );
        if (!rows.length) return res.status(404).json({ message: "not found" });
        acceptProfileImage(req);
        res.json({ message: "updated", profile_image: rows[0].profile_image });
      });
      if (res.statusCode < 400) commitProfileImage(req, previousImage);
    } catch (e) {
      await discardUploadedProfileImage(req).catch(() => false);
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
        u.account_status,
        u.profile_completed_at,
        u.registration_source,
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
      account_status: row.account_status,
      profile_completed: Boolean(row.profile_completed_at),
      registration_source: row.registration_source,
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

router.put(
  "/users/:user_id/account-status",
  requireRole("super_admin", "superadmin"),
  async (req, res, next) => {
    const userId = Number(req.params.user_id);
    const requestedStatus = String(req.body?.account_status || "").trim().toLowerCase();
    const reason = String(req.body?.reason || "").trim();
    if (!userId || !["active", "suspended", "duplicate", "deactivated"].includes(requestedStatus) || !reason) {
      return res.status(400).json({ message: "กรุณาระบุสถานะและเหตุผล" });
    }
    try {
      const targetStatus = requestedStatus === "active" ? "pending_verification" : requestedStatus;
      const result = await pool.query(
        `UPDATE clinic.users
         SET account_status = $1, status_reason = $2, status_changed_at = now(),
             status_changed_by = $3, deactivated_at = CASE WHEN $1 = 'deactivated' THEN now() ELSE NULL END,
             email_verified_at = CASE WHEN $1 = 'pending_verification' THEN NULL ELSE email_verified_at END,
             session_version = session_version + 1
         WHERE user_id = $4
         RETURNING user_id, email, account_status`,
        [targetStatus, reason, req.user.user_id, userId],
      );
      if (!result.rowCount) return res.status(404).json({ message: "ไม่พบบัญชี" });
      let emailSent = false;
      if (requestedStatus === "active" && result.rows[0].email) {
        try {
          await issueEmailVerification(userId, result.rows[0].email);
          emailSent = true;
        } catch (mailError) {
          console.error("ส่ง OTP เปิดบัญชีอีกครั้งไม่สำเร็จ:", mailError.message);
        }
      }
      return res.json({ ...result.rows[0], email_sent: emailSent });
    } catch (error) {
      return next(error);
    }
  },
);

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
// Minimal patient profile required after a verified Google OAuth sign-in.
// Email is sourced from the verified Google account and cannot be changed here.
router.patch("/me/google-profile", authRequired, async (req, res) => {
  if (req.user.registration_source !== "google") {
    return res.status(403).json({ message: "หน้านี้ใช้สำหรับบัญชี Google เท่านั้น" });
  }

  const userId = req.user.user_id;
  const nationalId = String(req.body?.national_id || "").replace(/\D/g, "");
  const firstName = String(req.body?.first_name || "").trim();
  const lastName = String(req.body?.last_name || "").trim();
  const birthDate = String(req.body?.birth_date || "").slice(0, 10);
  const phone = String(req.body?.phone || "").replace(/\D/g, "");

  if (!/^\d{13}$/.test(nationalId)) {
    return res.status(400).json({ message: "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก" });
  }
  if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) {
    return res.status(400).json({ message: "กรุณากรอกชื่อและนามสกุลให้ถูกต้อง" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || Number.isNaN(Date.parse(`${birthDate}T00:00:00Z`))) {
    return res.status(400).json({ message: "กรุณากรอกวันเกิดให้ถูกต้อง" });
  }
  if (new Date(`${birthDate}T00:00:00Z`) > new Date()) {
    return res.status(400).json({ message: "วันเกิดต้องไม่เป็นวันในอนาคต" });
  }
  if (!/^\d{9,10}$/.test(phone)) {
    return res.status(400).json({ message: "เบอร์โทรศัพท์ต้องเป็นตัวเลข 9-10 หลัก" });
  }

  try {
    const completed = await withContext(req, async (client) => {
      const duplicateNationalId = await client.query(
        `SELECT 1 FROM clinic.user_details
         WHERE national_id = $1 AND user_id <> $2
         LIMIT 1`,
        [nationalId, userId],
      );
      if (duplicateNationalId.rowCount) {
        return { duplicateNationalId: true };
      }

      const profileState = await client.query(
        `SELECT profile_completed_at
         FROM clinic.users
         WHERE user_id = $1
         FOR UPDATE`,
        [userId],
      );
      const isFirstCompletion = !profileState.rows[0]?.profile_completed_at;

      const saved = await client.query(
        `UPDATE clinic.user_details
         SET national_id = $1, first_name = $2, last_name = $3,
             birth_date = $4, phone = $5, email = $6, updated_at = now()
         WHERE detail_id = (
           SELECT detail_id FROM clinic.user_details
           WHERE user_id = $7 ORDER BY detail_id DESC LIMIT 1
         )
         RETURNING *`,
        [nationalId, firstName, lastName, birthDate, phone, req.user.email, userId],
      );

      let detail = saved.rows[0];
      if (!detail) {
        const inserted = await client.query(
          `INSERT INTO clinic.user_details
           (user_id, national_id, first_name, last_name, birth_date, phone, email)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [userId, nationalId, firstName, lastName, birthDate, phone, req.user.email],
        );
        detail = inserted.rows[0];
      }

      await client.query(
        `UPDATE clinic.users
         SET profile_completed_at = COALESCE(profile_completed_at, now()),
             email_verified_at = COALESCE(email_verified_at, now())
         WHERE user_id = $1`,
        [userId],
      );

      let notificationId = null;
      if (isFirstCompletion) {
        const notification = await client.query(
          `INSERT INTO clinic.user_notifications
           (user_id, source_type, source_id, event_key, title, message, severity,
            target_url, event_at, email_required, expires_at)
           VALUES ($1,'security',$2,'google_email_access',
                   'แจ้งเตือนการใช้อีเมลเข้าสู่ระบบ',
                   'อีเมล Google ของคุณได้รับการยืนยันและถูกใช้เข้าสู่เว็บไซต์คลินิกเรียบร้อยแล้ว',
                   'info','/users/userHome',now(),true,now() + interval '1 month')
           ON CONFLICT (user_id, source_type, source_id, event_key) DO NOTHING
           RETURNING notification_id`,
          [userId, String(userId)],
        );
        notificationId = notification.rows[0]?.notification_id || null;
      }

      return { detail, notificationId };
    });

    if (completed.duplicateNationalId) {
      return res.status(409).json({
        message: "เลขบัตรประชาชนนี้มีอยู่ในระบบแล้ว กรุณาติดต่อเจ้าหน้าที่เพื่อเชื่อมบัญชี",
      });
    }

    let emailNotificationSent = false;
    if (completed.notificationId) {
      const claimed = await pool.query(
        `UPDATE clinic.user_notifications
         SET email_sent_at = now(), updated_at = now()
         WHERE notification_id = $1 AND email_sent_at IS NULL
         RETURNING notification_id`,
        [completed.notificationId],
      );

      if (claimed.rowCount) {
        try {
          const loginTime = new Date().toLocaleString("th-TH", {
            timeZone: "Asia/Bangkok",
            dateStyle: "long",
            timeStyle: "short",
          });
          await sendClinicMail({
            to: req.user.email,
            subject: "แจ้งเตือนการใช้อีเมล Google เข้าสู่เว็บไซต์คลินิก",
            html: `<p>สวัสดี ${escapeHtml(firstName)}</p>
              <p>อีเมล <b>${escapeHtml(req.user.email)}</b> ได้รับการยืนยันจาก Google และถูกใช้เข้าสู่เว็บไซต์คลินิกเรียบร้อยแล้ว</p>
              <p><b>วันที่และเวลา:</b> ${escapeHtml(loginTime)}</p>
              <p>หากเป็นการดำเนินการของคุณ ไม่จำเป็นต้องทำอะไรเพิ่มเติม</p>
              <p>หากคุณไม่ได้เป็นผู้ดำเนินการ กรุณาเปลี่ยนรหัสผ่านบัญชี Google และติดต่อเจ้าหน้าที่คลินิกทันที</p>`,
          });
          emailNotificationSent = true;
        } catch (mailError) {
          try {
            await pool.query(
              `UPDATE clinic.user_notifications
               SET email_sent_at = NULL, updated_at = now()
               WHERE notification_id = $1`,
              [completed.notificationId],
            );
          } catch (resetError) {
            console.error("Reset Google access email notification failed:", resetError.message);
          }
          console.error("Google profile access notification email failed:", mailError.message);
        }
      }
    }

    return res.json({
      ...completed.detail,
      user_id: userId,
      email: req.user.email,
      registration_source: "google",
      profile_completed: true,
      email_notification_sent: emailNotificationSent,
    });
  } catch (error) {
    console.error("PATCH /users/me/google-profile error:", error);
    const mapped = pgErrorToHttp(error);
    return res.status(mapped.status).json({ message: mapped.message });
  }
});

router.patch(
  "/me/profile",
  authRequired,
  uploadProfileImage.single("file"),
  cleanupUncommittedUpload,
  validateProfileImageContent,
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
    const nationalId = normalizeDigits(req.body?.national_id);

    if (!firstName || !lastName || !email) {
      return res.status(400).json({ message: "กรุณากรอกชื่อ นามสกุล และอีเมล" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "รูปแบบอีเมลไม่ถูกต้อง" });
    }
    if (nationalId && !/^\d{13}$/.test(nationalId)) {
      return res.status(400).json({ message: "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก" });
    }
    if (req.file && !String(req.file.mimetype || "").startsWith("image/")) {
      return res.status(400).json({ message: "รองรับเฉพาะไฟล์รูปภาพ" });
    }

    const profileImage = getPublicProfileImagePath(req.file);
    let previousImage = null;

    try {
      await withContext(req, async (client) => {
        const existingProfileImage = await client.query(
          `SELECT profile_image FROM clinic.user_details WHERE user_id = $1 FOR UPDATE`,
          [userId],
        );
        previousImage = existingProfileImage.rows[0]?.profile_image || null;

        const duplicate = await client.query(
          `SELECT 1 FROM clinic.users WHERE LOWER(email) = $1 AND user_id <> $2 LIMIT 1`,
          [email, userId]
        );
        if (duplicate.rowCount) {
          return res.status(409).json({ message: "อีเมลนี้ถูกใช้งานแล้ว" });
        }
        if (nationalId) {
          const duplicateNationalId = await client.query(
            `SELECT 1 FROM clinic.user_details WHERE national_id = $1 AND user_id <> $2 LIMIT 1`,
            [nationalId, userId],
          );
          if (duplicateNationalId.rowCount) {
            return res.status(409).json({ message: "เลขบัตรประชาชนนี้มีอยู่ในระบบแล้ว กรุณาติดต่อเจ้าหน้าที่เพื่อเชื่อมบัญชี" });
          }
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

        const profileCompleted = Boolean(
          savedDetail.national_id && savedDetail.first_name && savedDetail.last_name && savedDetail.birth_date && savedDetail.phone,
        );
        await client.query(
          `UPDATE clinic.users
           SET profile_completed_at = CASE WHEN $1 THEN COALESCE(profile_completed_at, now()) ELSE NULL END
           WHERE user_id = $2`,
          [profileCompleted, userId],
        );

        acceptProfileImage(req);
        return res.json({
          user_id: userId,
          patient_code: String(userId).padStart(3, "0"),
          role: req.user.role,
          profile_completed: profileCompleted,
          ...savedDetail,
        });
      });
      if (res.statusCode < 400) commitProfileImage(req, previousImage);
    } catch (error) {
      await discardUploadedProfileImage(req).catch(() => false);
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
