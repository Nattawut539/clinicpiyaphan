const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { requireStaff, withContext } = require("../tools/_utils");
const { JWT_SECRET } = require("../tools/config");

function hashAccessCode(code) {
  return crypto
    .createHmac("sha256", JWT_SECRET)
    .update(String(code))
    .digest("hex");
}

function parseMeasurement(weight, height) {
  const parsedWeight = Number.parseFloat(weight);
  const parsedHeight = Number.parseFloat(height);

  if (!(parsedWeight > 0) || !(parsedHeight > 0)) {
    return null;
  }

  return {
    weight: parsedWeight,
    height: parsedHeight,
    bmi: +(parsedWeight / ((parsedHeight / 100) * (parsedHeight / 100))).toFixed(2),
  };
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

router.post("/measurements/access-code", async (req, res, next) => {
  const code = String(req.body?.code || "").trim();
  const measurement = parseMeasurement(req.body?.weight, req.body?.height);

  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ message: "รหัสต้องเป็นตัวเลข 6 หลัก" });
  }

  if (!measurement) {
    return res.status(400).json({ message: "น้ำหนักหรือส่วนสูงไม่ถูกต้อง" });
  }

  try {
    await withContext(null, async (client) => {
      const accessCodeResult = await client.query(
        `SELECT ac.access_code_id, ac.queue_id, q.queue_number
         FROM clinic.appointment_access_codes ac
         JOIN clinic.queue_tickets q ON q.queue_id = ac.queue_id
         JOIN clinic.appointments a ON a.appointment_id = ac.appointment_id
         WHERE ac.code_hash = $1
           AND ac.used_at IS NULL
           AND ac.expires_at > now()
           AND a.status = 'approved'
           AND q.status <> 'cancelled'
         FOR UPDATE OF ac`,
        [hashAccessCode(code)]
      );

      if (!accessCodeResult.rowCount) {
        const error = new Error("รหัสไม่ถูกต้อง ถูกใช้งานแล้ว หรือหมดอายุแล้ว");
        error.status = 400;
        throw error;
      }

      const access = accessCodeResult.rows[0];
      const inserted = await client.query(
        `INSERT INTO clinic.measurements
           (queue_id, queue_number, weight, height, bmi)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING measurement_id, queue_id, queue_number, weight, height, bmi, created_at`,
        [access.queue_id, access.queue_number, measurement.weight, measurement.height, measurement.bmi]
      );

      await client.query(
        `UPDATE clinic.appointment_access_codes
         SET used_at = now()
         WHERE access_code_id = $1`,
        [access.access_code_id]
      );

      res.status(201).json({
        message: "ยืนยันคิวและบันทึกผลการชั่งเรียบร้อย",
        queue_number: access.queue_number,
        measurement: inserted.rows[0],
      });
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    next(error);
  }
});

async function saveManualMeasurement(req, res, next) {
  const {
    queue_id = null,
    queue_number = null,
    service_date = null,
    weight = null,
    height = null,
    chief_complaint = null,
    temperature = null,
    heart_rate = null,
    respiratory_rate = null,
    systolic_bp = null,
    diastolic_bp = null,
  } = req.body || {};

  if (!queue_id && !queue_number) {
    return res.status(400).json({ message: "ต้องมี queue_id หรือ queue_number" });
  }

  try {
    await withContext(req, async (client) => {
      const queueResult = await client.query(
        `SELECT queue_id, queue_number
         FROM clinic.queue_tickets
         WHERE ($1::int IS NOT NULL AND queue_id = $1)
            OR (
              $1::int IS NULL
              AND queue_number = $2
              AND ($3::date IS NULL OR service_date = $3::date)
            )
         ORDER BY service_date DESC
         LIMIT 1`,
        [queue_id, queue_number, service_date]
      );

      if (!queueResult.rowCount) {
        return res.status(400).json({ message: "ไม่พบคิว" });
      }

      const queue = queueResult.rows[0];
      const parsedWeight = Number.parseFloat(weight);
      const parsedHeight = Number.parseFloat(height);
      const parsedTemperature = parseOptionalNumber(temperature);
      const parsedHeartRate = parseOptionalInteger(heart_rate);
      const parsedRespiratoryRate = parseOptionalInteger(respiratory_rate);
      const parsedSystolicBp = parseOptionalInteger(systolic_bp);
      const parsedDiastolicBp = parseOptionalInteger(diastolic_bp);
      let bmi = null;

      if (parsedWeight > 0 && parsedHeight > 0) {
        bmi = +(parsedWeight / ((parsedHeight / 100) * (parsedHeight / 100))).toFixed(2);
      }

      const inserted = await client.query(
        `INSERT INTO clinic.measurements
           (
             queue_id,
             queue_number,
             weight,
             height,
             bmi,
             chief_complaint,
             temperature,
             heart_rate,
             respiratory_rate,
             systolic_bp,
             diastolic_bp
           )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          queue.queue_id,
          queue.queue_number,
          parsedWeight || null,
          parsedHeight || null,
          bmi,
          String(chief_complaint || "").trim() || null,
          parsedTemperature,
          parsedHeartRate,
          parsedRespiratoryRate,
          parsedSystolicBp,
          parsedDiastolicBp,
        ]
      );

      res.json(inserted.rows[0]);
    });
  } catch (error) {
    next(error);
  }
}

router.post("/", requireStaff, saveManualMeasurement);
router.post("/measurements", requireStaff, saveManualMeasurement);

router.get("/measurements/queue/:queue_id", requireStaff, async (req, res, next) => {
  try {
    await withContext(req, async (client) => {
      const { rows } = await client.query(
        `SELECT *
         FROM clinic.measurements
         WHERE queue_id = $1
         ORDER BY created_at DESC`,
        [req.params.queue_id]
      );

      res.json(rows);
    });
  } catch (error) {
    next(error);
  }
});

router.get("/measurements/user/:user_id/latest", requireStaff, async (req, res, next) => {
  try {
    await withContext(req, async (client) => {
      const { rows } = await client.query(
        `SELECT m.*
         FROM clinic.measurements m
         JOIN clinic.queue_tickets q ON q.queue_id = m.queue_id
         WHERE q.user_id = $1
         ORDER BY m.created_at DESC
         LIMIT 1`,
        [req.params.user_id]
      );

      res.json(rows[0] || null);
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:queue_number", requireStaff, async (req, res, next) => {
  const { service_date = null } = req.query;

  try {
    await withContext(req, async (client) => {
      const { rows } = await client.query(
        `SELECT m.*
         FROM clinic.measurements m
         LEFT JOIN clinic.queue_tickets q ON q.queue_id = m.queue_id
         WHERE m.queue_number = $1
           AND ($2::date IS NULL OR q.service_date = $2::date)
         ORDER BY m.created_at DESC`,
        [req.params.queue_number, service_date]
      );

      res.json(rows);
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
