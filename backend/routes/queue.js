const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const pool = require("../tools/db");
const { requireStaff, withContext } = require("../tools/_utils");
const { JWT_SECRET } = require("../tools/config");

const ACCESS_CODE_ENCRYPTION_KEY = crypto
  .createHash("sha256")
  .update(`clinic-appointment-access-code:${JWT_SECRET}`)
  .digest();

function decryptAccessCode(payload) {
  if (!payload) return null;
  try {
    const [version, iv, authTag, encrypted] = String(payload).split(":");
    if (version !== "v1" || !iv || !authTag || !encrypted) return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      ACCESS_CODE_ENCRYPTION_KEY,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(authTag, "base64url"));
    const code = Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return /^\d{6}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

// -----------------------------------------------------
// 📌 ฟังก์ชันหาลำดับคิวถัดไป (ต่อวัน, ช่วงเวลา, A/B prefix)
// -----------------------------------------------------
async function nextNo(client, serviceDate, _avail, prefix) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(numeric_no), 0) + 1 AS n
     FROM clinic.queue_tickets
     WHERE prefix = $1
       AND service_date = $2::date`,
    [prefix, serviceDate],
  );
  return rows[0].n;
}

// -----------------------------------------------------
// 📌 ฟอร์แมตรูปแบบคิว เช่น A001, B045
// -----------------------------------------------------
function formatQ(prefix, n) {
  return `${prefix}${String(n).padStart(3, "0")}`;
}

async function createWalkinPatientUser(client) {
  const random = crypto.randomBytes(5).toString("hex");
  const username = `walkin_${Date.now()}_${random}`;
  const insertedUser = await client.query(
    `INSERT INTO clinic.users (username, role, account_status, registration_source)
     VALUES ($1, 'user', 'unclaimed', 'walkin')
     RETURNING user_id`,
    [username],
  );

  return insertedUser.rows[0].user_id;
}

function cleanText(value) {
  return String(value || "").trim();
}

function parseOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitBp(value) {
  const text = cleanText(value);
  if (!text) return { systolic_bp: null, diastolic_bp: null };
  const match = text.match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
  if (!match) return null;
  return {
    systolic_bp: Number(match[1]),
    diastolic_bp: Number(match[2]),
  };
}

function appointmentQueueNo(hourOfDay) {
  const byHour = {
    7: 1,
    8: 2,
    9: 3,
    10: 4,
    16: 5,
    17: 6,
    18: 7,
    19: 8,
  };

  return byHour[Number(hourOfDay)] || null;
}

// -----------------------------------------------------
// 📌 ออกคิว Walk-in (prefix = 'B')
// -----------------------------------------------------
router.post("/issue-walkin", requireStaff, async (req, res, next) => {
  const {
    avaliable_date = "morning",
    service_date,
    visit_time = null,
    user_id = null,
    service_type = null,
    source = "staff",
    receipt_queue = null,
    patient = null,
    vitals = null,
  } = req.body || {};

  if (!["morning", "afternoon"].includes(avaliable_date)) {
    return res.status(400).json({ message: "avaliable_date ไม่ถูกต้อง" });
  }

  const firstName = cleanText(patient?.first_name);
  const lastName = cleanText(patient?.last_name);
  const nationalId = cleanText(patient?.national_id);
  const requestedQueueNumber = cleanText(receipt_queue).toUpperCase();
  const bp = splitBp(vitals?.bp);

  if ((patient || vitals) && (!firstName || !lastName)) {
    return res.status(400).json({ message: "กรุณากรอกชื่อและนามสกุลผู้ป่วย" });
  }
  if (nationalId && !/^\d{13}$/.test(nationalId)) {
    return res.status(400).json({ message: "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก" });
  }
  if (requestedQueueNumber && !/^B\d{3}$/.test(requestedQueueNumber)) {
    return res.status(400).json({ message: "หมายเลขคิว Walk-in ต้องเป็นรูปแบบ B001" });
  }

  if (vitals?.bp && !bp) {
    return res.status(400).json({ message: "กรุณากรอก BP เป็นรูปแบบ เช่น 120/80" });
  }

  try {
    await withContext(req, async (client) => {
      const d = service_date ? new Date(service_date) : new Date();
      const day = d.toISOString().slice(0, 10);
      const visitTimeText = /^\d{2}:\d{2}$/.test(cleanText(visit_time))
        ? cleanText(visit_time)
        : new Date().toLocaleTimeString("en-GB", {
            timeZone: "Asia/Bangkok",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
      const arrivedAt = `${day} ${visitTimeText}:00+07`;

      const prefix = "B";
      const n = requestedQueueNumber
        ? Number.parseInt(requestedQueueNumber.slice(1), 10)
        : await nextNo(client, day, avaliable_date, prefix);
      const qnum = requestedQueueNumber || formatQ(prefix, n);

      const duplicateQueue = await client.query(
        `SELECT 1 FROM clinic.queue_tickets
         WHERE service_date = $1::date
           AND queue_number = $2
           AND status <> 'cancelled'
         LIMIT 1`,
        [day, qnum],
      );
      if (duplicateQueue.rowCount) {
        return res.status(409).json({ message: `หมายเลขคิว ${qnum} ถูกใช้แล้วในวันนี้` });
      }

      let resolvedUserId = user_id;

      if (!resolvedUserId && patient) {
        const found = nationalId ? await client.query(
          `SELECT u.user_id
           FROM clinic.users u
           JOIN clinic.user_details d ON d.user_id = u.user_id
           WHERE u.role = 'user'
             AND d.national_id = $1
           ORDER BY u.user_id
           LIMIT 1`,
          [nationalId],
        ) : { rowCount: 0, rows: [] };

        if (found.rowCount) {
          resolvedUserId = found.rows[0].user_id;
          await client.query(
            `UPDATE clinic.user_details
             SET
               national_id = COALESCE(NULLIF($2, ''), national_id),
               first_name = COALESCE(NULLIF($3, ''), first_name),
               last_name = COALESCE(NULLIF($4, ''), last_name),
               phone = COALESCE(NULLIF($5, ''), phone),
               emergency_phone = COALESCE(NULLIF($6, ''), emergency_phone),
               birth_date = COALESCE(NULLIF($7, '')::date, birth_date),
               gender = COALESCE(NULLIF($8, ''), gender),
               blood_type = COALESCE(NULLIF($9, ''), blood_type),
               drug_allergy = COALESCE(NULLIF($10, ''), drug_allergy),
               food_allergy = COALESCE(NULLIF($11, ''), food_allergy)
             WHERE user_id = $1`,
            [
              resolvedUserId,
              nationalId,
              firstName,
              lastName,
              cleanText(patient?.phone),
              cleanText(patient?.emergency_phone),
              cleanText(patient?.birth_date),
              cleanText(patient?.gender),
              cleanText(patient?.blood_type),
              cleanText(patient?.drug_allergy),
              cleanText(patient?.food_allergy),
            ],
          );
        } else {
          resolvedUserId = await createWalkinPatientUser(client);

          await client.query(
            `INSERT INTO clinic.user_details
               (user_id, national_id, first_name, last_name, phone, emergency_phone,
                birth_date, gender, blood_type, drug_allergy, food_allergy)
             VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7, '')::date,$8,$9,$10,$11)`,
            [
              resolvedUserId,
              nationalId || null,
              firstName,
              lastName,
              cleanText(patient?.phone) || null,
              cleanText(patient?.emergency_phone) || null,
              cleanText(patient?.birth_date),
              cleanText(patient?.gender) || null,
              cleanText(patient?.blood_type) || null,
              cleanText(patient?.drug_allergy) || null,
              cleanText(patient?.food_allergy) || null,
            ],
          );
        }
      }

      const ins = await client.query(
        `INSERT INTO clinic.queue_tickets
          (queue_number, prefix, numeric_no, service_date, avaliable_date, source, user_id, service_type, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz)
         RETURNING *`,
        [
          qnum,
          prefix,
          n,
          day,
          avaliable_date,
          source,
          resolvedUserId,
          service_type || "Walk-in",
          arrivedAt,
        ],
      );

      let measurement = null;
      if (vitals) {
        const weight = parseOptionalNumber(vitals.weight);
        const height = parseOptionalNumber(vitals.height);
        const temperature = parseOptionalNumber(vitals.temperature);
        const heartRate = parseOptionalInteger(vitals.heart_rate);
        const respiratoryRate = parseOptionalInteger(vitals.respiratory_rate);
        const bmi = weight > 0 && height > 0
          ? +(weight / ((height / 100) * (height / 100))).toFixed(2)
          : null;

        const measurementResult = await client.query(
          `INSERT INTO clinic.measurements
             (queue_id, queue_number, weight, height, bmi, chief_complaint,
              temperature, heart_rate, respiratory_rate, systolic_bp, diastolic_bp)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING *`,
          [
            ins.rows[0].queue_id,
            ins.rows[0].queue_number,
            weight,
            height,
            bmi,
            cleanText(vitals.chief_complaint) || null,
            temperature,
            heartRate,
            respiratoryRate,
            bp?.systolic_bp ?? null,
            bp?.diastolic_bp ?? null,
          ],
        );
        measurement = measurementResult.rows[0];
      }

      res.json({ message: "issued", ticket: ins.rows[0], user_id: resolvedUserId, measurement });
    });
  } catch (e) {
    next(e);
  }
});

// -----------------------------------------------------
// 📌 ออกคิวจากการนัดหมาย (prefix = 'A')
// -----------------------------------------------------
router.post("/issue-from-appointment", requireStaff, async (req, res, next) => {
  const { appointment_id } = req.body || {};

  if (!appointment_id)
    return res.status(400).json({ message: "ต้องระบุ appointment_id" });

  try {
    await withContext(req, async (client) => {
      const ap = await client.query(
        `SELECT a.appointment_id, a.user_id, s.service_date::date AS service_date,
                s.avaliable_date, s.hour_of_day, a.service_type
         FROM clinic.appointments a
         JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
         WHERE a.appointment_id = $1`,
        [appointment_id],
      );

      if (!ap.rowCount)
        return res.status(404).json({ message: "ไม่พบการนัดหมาย" });

      const { service_date, avaliable_date, hour_of_day, user_id, service_type } =
        ap.rows[0];

      const prefix = "A";

      const existing = await client.query(
        `SELECT *
         FROM clinic.queue_tickets
         WHERE appointment_id = $1
         LIMIT 1`,
        [appointment_id],
      );

      if (existing.rowCount) {
        return res.json({ message: "already-issued", ticket: existing.rows[0] });
      }

      const n = appointmentQueueNo(hour_of_day);

      if (!n) {
        return res.status(400).json({ message: "ช่วงเวลานี้ไม่อยู่ในคิว A001-A008" });
      }

      const qnum = formatQ(prefix, n);

      const ins = await client.query(
        `INSERT INTO clinic.queue_tickets
          (queue_number, prefix, numeric_no, service_date, avaliable_date, source, appointment_id, user_id, service_type)
         VALUES ($1,$2,$3,$4,$5,'online',$6,$7,$8)
         RETURNING *`,
        [
          qnum,
          prefix,
          n,
          service_date,
          avaliable_date,
          appointment_id,
          user_id,
          service_type,
        ],
      );

      res.json({ message: "issued", ticket: ins.rows[0] });
    });
  } catch (e) {
    next(e);
  }
});

// -----------------------------------------------------
// 📌 ดูคิววันนี้ทั้งหมด (staff เท่านั้น)
// -----------------------------------------------------
router.get("/today", requireStaff, async (req, res, next) => {
  const { avaliable_date, status } = req.query;

  try {
    await withContext(req, async (client) => {
      const params = [];
      let sql = `SELECT
                   q.*,
                   s.hour_of_day,
                   ac.code_ciphertext,
                   ac.expires_at AS access_code_expires_at,
                   ac.used_at AS access_code_used_at,
                   EXISTS (
                     SELECT 1
                     FROM clinic.measurements m
                     WHERE m.queue_id = q.queue_id
                   ) AS has_measurement,
                   EXISTS (
                     SELECT 1
                     FROM clinic.medical_records mr
                     WHERE mr.user_id = q.user_id
                       AND mr.visit_date::date = q.service_date
                   ) AS has_medical_record
                 FROM clinic.queue_tickets q
                 LEFT JOIN clinic.appointments a ON a.appointment_id = q.appointment_id
                 LEFT JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
                 LEFT JOIN clinic.appointment_access_codes ac ON ac.queue_id = q.queue_id
                 WHERE q.service_date = (now() AT TIME ZONE 'Asia/Bangkok')::date`;

      if (avaliable_date) {
        params.push(avaliable_date);
        sql += ` AND q.avaliable_date = $${params.length}`;
      }

      if (status) {
        params.push(status);
        sql += ` AND q.status = $${params.length}`;
      }

      sql += ` ORDER BY q.avaliable_date, q.prefix, q.numeric_no`;

      const { rows } = await client.query(sql, params);
      for (const row of rows) {
        row.access_code =
          !row.access_code_used_at && row.access_code_expires_at && new Date(row.access_code_expires_at) > new Date()
            ? decryptAccessCode(row.code_ciphertext)
            : null;
        delete row.code_ciphertext;
      }
      res.json(rows);
    });
  } catch (e) {
    next(e);
  }
});

// GET /queue/week?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get("/week", requireStaff, async (req, res, next) => {
  const { start, end } = req.query;

  try {
    await withContext(req, async (client) => {
      const { rows } = await client.query(
        `SELECT *
         FROM clinic.queue_tickets
         WHERE service_date BETWEEN $1 AND $2
           AND prefix = 'A'
         ORDER BY service_date, avaliable_date, numeric_no`,
        [start, end],
      );
      res.json(rows);
    });
  } catch (e) {
    next(e);
  }
});

// -----------------------------------------------------
// 📌 ฟังก์ชัน setStatus: เปลี่ยนสถานะคิว
// -----------------------------------------------------
async function setStatus(req, res, next, newStatus, stampField) {
  try {
    await withContext(req, async (client) => {
      const { queue_id } = req.params;
      const { window_id = null } = req.body || {};

      const up = await client.query(
        `UPDATE clinic.queue_tickets
          SET status = $1,
              ${stampField} = NOW(),
              window_id = COALESCE($3, window_id)
         WHERE queue_id = $2
         RETURNING *`,
        [newStatus, queue_id, window_id],
      );

      if (!up.rowCount) return res.status(404).json({ message: "ไม่พบคิว" });
      res.json(up.rows[0]);
    });
  } catch (e) {
    next(e);
  }
}

// -----------------------------------------------------
// 📌 เปลี่ยนสถานะคิว — call / serve / skip / cancel
// -----------------------------------------------------
router.post("/:queue_id/call", requireStaff, (req, res, next) =>
  setStatus(req, res, next, "called", "called_at"),
);

router.post("/:queue_id/serve", requireStaff, (req, res, next) =>
  setStatus(req, res, next, "served", "served_at"),
);

router.post("/:queue_id/skip", requireStaff, (req, res, next) =>
  setStatus(req, res, next, "skipped", "skipped_at"),
);

router.post("/:queue_id/cancel", requireStaff, (req, res, next) =>
  setStatus(req, res, next, "cancelled", "cancelled_at"),
);

module.exports = router;
