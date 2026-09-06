// backend/routes/medical.js
const express = require("express");
const router = express.Router();

const { authRequired, requireRole, withContext } = require("../tools/_utils");

const requireMedicalRole = requireRole("doctor", "super_admin", "superadmin");

async function requireTodayVisit(client, { queueId, userId, visitDate }) {
  const todayResult = await client.query(
    `SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date::text AS today`,
  );
  const today = todayResult.rows[0].today;
  const requestedDate = visitDate ? String(visitDate).slice(0, 10) : today;
  if (requestedDate !== today) {
    const error = new Error("บันทึกเวชระเบียนได้เฉพาะวันเข้าตรวจเท่านั้น ไม่สามารถบันทึกย้อนหลังหรือก่อนวันนัดได้");
    error.status = 409;
    throw error;
  }

  if (queueId) {
    const queue = await client.query(
      `SELECT queue_id
       FROM clinic.queue_tickets
       WHERE queue_id = $1 AND user_id = $2
         AND service_date = (now() AT TIME ZONE 'Asia/Bangkok')::date
         AND status <> 'cancelled'
       LIMIT 1`,
      [queueId, userId],
    );
    if (!queue.rowCount) {
      const error = new Error("คิวนี้ไม่ใช่คิวสำหรับวันปัจจุบัน จึงไม่สามารถบันทึกเวชระเบียนได้");
      error.status = 409;
      throw error;
    }
  }

  return today;
}

// ผู้ใช้ดูเวชระเบียนของตัวเอง
router.get("/medical/my", authRequired, async (req, res, next) => {
  try {
    await withContext(req, async (client) => {
      const userId = req.user && req.user.user_id;
      const { rows } = await client.query(
        `
        SELECT record_id, user_id, visit_date, symptoms, diagnosis, treatment,
               medications, notes, doctor_id, follow_up_date, visibility,
               body_drawing_data, created_at, updated_at
        FROM clinic.medical_records
        WHERE user_id = $1
        ORDER BY visit_date DESC
      `,
        [userId]
      );
      res.json(rows);
    });
  } catch (e) {
    next(e);
  }
});

// เฉพาะแพทย์และผู้ดูแลระบบสูงสุดเท่านั้นที่ดูเวชระเบียนผู้ป่วยได้
router.get(
  "/medical/by-user/:user_id",
  requireMedicalRole,
  async (req, res, next) => {
    try {
      await withContext(req, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM clinic.medical_records
         WHERE user_id = $1
         ORDER BY visit_date DESC`,
          [req.params.user_id]
        );
        res.json(rows);
      });
    } catch (e) {
      next(e);
    }
  }
);

// รายการเวชระเบียนสำหรับแพทย์และผู้ดูแลระบบสูงสุด
router.get("/medical-records", requireMedicalRole, async (req, res, next) => {
  const { appointment_id, start_date, end_date, recorded_only } = req.query;

  try {
    await withContext(req, async (client) => {
      const params = [];
      let appointmentFilter = "";

      if (appointment_id) {
        params.push(Number(appointment_id));
        appointmentFilter = Number(appointment_id) < 0
          ? `AND q.queue_id = ABS($${params.length})`
          : `AND a.appointment_id = $${params.length}`;
      }

      if (start_date) {
        params.push(start_date);
        appointmentFilter += ` AND q.service_date::date >= $${params.length}::date`;
      }

      if (end_date) {
        params.push(end_date);
        appointmentFilter += ` AND q.service_date::date <= $${params.length}::date`;
      }

      if (recorded_only === "true") {
        appointmentFilter += " AND mr.record_id IS NOT NULL";
      }

      const { rows } = await client.query(
        `
        SELECT
          COALESCE(a.appointment_id, -q.queue_id) AS appointment_id,
          q.user_id,
          LPAD(q.user_id::text, 3, '0') AS patient_code,
          d.national_id,
          TRIM(CONCAT(COALESCE(d.first_name, ''), ' ', COALESCE(d.last_name, ''))) AS full_name,
          d.birth_date,
          d.phone,
          d.emergency_phone,
          d.gender,
          d.blood_type,
          d.profile_image,
          d.congenital_disease,
          d.drug_allergy,
          d.food_allergy,
          q.service_date::date AS visit_date,
          q.avaliable_date,
          COALESCE(s.hour_of_day, EXTRACT(HOUR FROM q.created_at)::int) AS hour_of_day,
          COALESCE(CONCAT(LPAD(s.hour_of_day::text, 2, '0'), ':00'), TO_CHAR(q.created_at, 'HH24:MI')) AS time_label,
          q.queue_number AS queue_no,
          q.queue_id,
          q.numeric_no,
          q.status AS queue_status,
          q.prefix,
          q.source,
          m.weight,
          m.height,
          m.bmi,
          m.chief_complaint,
          m.temperature,
          m.heart_rate,
          m.respiratory_rate,
          m.systolic_bp,
          m.diastolic_bp,
          mr.record_id AS medical_record_id,
          mr.record_id,
          mr.symptoms,
          mr.diagnosis,
          mr.treatment,
          mr.medications,
          mr.notes,
          mr.follow_up_date,
          mr.body_drawing_data,
          (mr.record_id IS NOT NULL) AS has_medical_record
        FROM clinic.queue_tickets q
        LEFT JOIN clinic.appointments a ON a.appointment_id = q.appointment_id
        LEFT JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
        JOIN clinic.users u ON u.user_id = q.user_id
        LEFT JOIN LATERAL (
          SELECT *
          FROM clinic.user_details
          WHERE user_id = q.user_id
          ORDER BY detail_id DESC
          LIMIT 1
        ) d ON true
        LEFT JOIN LATERAL (
          SELECT
            weight,
            height,
            bmi,
            chief_complaint,
            temperature,
            heart_rate,
            respiratory_rate,
            systolic_bp,
            diastolic_bp
          FROM clinic.measurements
          WHERE queue_id = q.queue_id
          ORDER BY created_at DESC
          LIMIT 1
        ) m ON true
        LEFT JOIN LATERAL (
          SELECT *
          FROM clinic.medical_records
          WHERE user_id = q.user_id
            AND visit_date::date = q.service_date::date
          ORDER BY created_at DESC
          LIMIT 1
        ) mr ON true
        WHERE q.queue_number IS NOT NULL
          AND q.user_id IS NOT NULL
          AND (a.appointment_id IS NULL OR a.status = 'approved')
          ${appointmentFilter}
        ORDER BY
          q.service_date,
          CASE
            WHEN q.avaliable_date = 'morning' THEN 1
            WHEN q.avaliable_date = 'afternoon' THEN 2
            ELSE 3
          END,
          CASE WHEN q.prefix = 'A' THEN 1 ELSE 2 END,
          q.numeric_no
        `,
        params
      );

      res.json(appointment_id ? rows[0] || null : rows);
    });
  } catch (e) {
    next(e);
  }
});

router.post("/medical-records", requireMedicalRole, async (req, res, next) => {
  const {
    user_id,
    queue_id = null,
    visit_date = null,
    symptoms = null,
    diagnosis = null,
    treatment = null,
    medications = [],
    notes = null,
    doctor_id = null,
    follow_up_date = null,
    visibility = "private",
    body_drawing_data = null,
  } = req.body || {};

  if (!user_id) {
    return res.status(400).json({ message: "ต้องมี user_id" });
  }

  try {
    await withContext(req, async (client) => {
      const validVisitDate = await requireTodayVisit(client, {
        queueId: queue_id,
        userId: user_id,
        visitDate: visit_date,
      });
      const meds = Array.isArray(medications)
        ? medications
        : [medications].filter(Boolean);

      const ins = await client.query(
        `INSERT INTO clinic.medical_records
         (user_id, visit_date, symptoms, diagnosis, treatment, medications,
          notes, doctor_id, follow_up_date, visibility, body_drawing_data)
         VALUES ($1, COALESCE($2, NOW()), $3, $4, $5, $6::jsonb, $7, $8, $9, $10::public.record_visibility, $11)
         RETURNING *`,
        [
          user_id,
          validVisitDate,
          symptoms,
          diagnosis,
          treatment,
          JSON.stringify(meds),
          notes,
          doctor_id,
          follow_up_date,
          visibility,
          body_drawing_data,
        ]
      );

      if (queue_id) {
        await client.query(
          `UPDATE clinic.queue_tickets
           SET status = 'served',
               served_at = COALESCE(served_at, NOW())
           WHERE queue_id = $1`,
          [queue_id]
        );
      }

      res.json(ins.rows[0]);
    });
  } catch (e) {
    next(e);
  }
});

router.post("/medical", requireMedicalRole, async (req, res, next) => {
  const {
    user_id,
    queue_id = null,
    visit_date = null,
    symptoms = null,
    diagnosis = null,
    treatment = null,
    medications = [],
    notes = null,
    doctor_id = null,
    follow_up_date = null,
    visibility = "private",
    body_drawing_data = null,
  } = req.body || {};

  if (!user_id)
    return res.status(400).json({ message: "จำเป็นต้องมี user_id" });

  try {
    await withContext(req, async (client) => {
      const validVisitDate = await requireTodayVisit(client, {
        queueId: queue_id,
        userId: user_id,
        visitDate: visit_date,
      });
      const ins = await client.query(
        `INSERT INTO clinic.medical_records
         (user_id, visit_date, symptoms, diagnosis, treatment, medications,
          notes, doctor_id, follow_up_date, visibility, body_drawing_data)
         VALUES ($1, COALESCE($2, NOW()), $3, $4, $5, $6::jsonb, $7, $8, $9, $10::public.record_visibility, $11)
         RETURNING *`,
        [
          user_id,
          validVisitDate,
          symptoms,
          diagnosis,
          treatment,
          JSON.stringify(medications),
          notes,
          doctor_id,
          follow_up_date,
          visibility,
          body_drawing_data,
        ]
      );
      if (queue_id) {
        await client.query(
          `UPDATE clinic.queue_tickets
           SET status = 'served',
               served_at = COALESCE(served_at, NOW())
           WHERE queue_id = $1`,
          [queue_id]
        );
      }
      res.json(ins.rows[0]);
    });
  } catch (e) {
    next(e);
  }
});

// แก้ไขเวชระเบียนบางส่วน (เฉพาะแพทย์และผู้ดูแลระบบสูงสุด)
router.patch("/medical/:record_id", requireMedicalRole, async (req, res, next) => {
  const fields = [
    "symptoms",
    "diagnosis",
    "treatment",
    "medications",
    "notes",
    "follow_up_date",
    "visibility",
    "body_drawing_data",
  ];

  const sets = [];
  const params = [];
  let i = 1;

  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) {
      if (f === "medications") {
        sets.push(`${f} = $${i}::jsonb`);
        params.push(JSON.stringify(req.body[f]));
      } else if (f === "visibility") {
        sets.push(`${f} = $${i}::public.record_visibility`);
        params.push(req.body[f]);
      } else {
        sets.push(`${f} = $${i}`);
        params.push(req.body[f]);
      }
      i++;
    }
  }

  if (!sets.length)
    return res.status(400).json({ message: "ไม่มีฟิลด์ที่จะอัปเดต" });

  params.push(req.params.record_id);

  try {
    await withContext(req, async (client) => {
      const up = await client.query(
        `UPDATE clinic.medical_records
         SET ${sets.join(", ")}
         WHERE record_id = $${params.length}
           AND visit_date::date = (now() AT TIME ZONE 'Asia/Bangkok')::date
         RETURNING *`,
        params
      );
      if (!up.rowCount) return res.status(409).json({ message: "แก้ไขเวชระเบียนได้เฉพาะวันเข้าตรวจเท่านั้น" });
      res.json(up.rows[0]);
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
