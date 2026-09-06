const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const pool = require("../tools/db");
const { requireStaff } = require("../tools/_utils");
const { mqttStatus, publishJson, topic } = require("../tools/mqttBridge");

router.get("/hardware/mqtt-status", requireStaff, (_req, res) => {
  res.json(mqttStatus());
});

router.get("/hardware/pending-print", requireStaff, async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT e.message_id, e.device_id, e.mode, e.print_status,
              m.measurement_id, m.weight, m.height, m.measured_at,
              q.queue_number
       FROM clinic.hardware_measurement_events e
       JOIN clinic.measurements m ON m.measurement_id = e.measurement_id
       JOIN clinic.queue_tickets q ON q.queue_id = e.queue_id
       WHERE e.print_attempts < 3
         AND (
           e.print_status = 'pending'
           OR (e.print_status = 'failed' AND e.updated_at < now() - interval '30 seconds')
           OR (e.print_status = 'requested' AND e.print_requested_at < now() - interval '30 seconds')
         )
       ORDER BY e.created_at
       LIMIT 20`,
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post("/hardware/print", requireStaff, async (req, res, next) => {
  const messageId = String(req.body?.message_id || "").trim();
  const bmi = Number(req.body?.bmi);
  if (!messageId || messageId.length > 100 || !Number.isFinite(bmi) || bmi <= 0 || bmi > 100) {
    return res.status(400).json({ code: "INVALID_PRINT_DATA", message: "message_id or bmi is invalid" });
  }

  const printJobId = `PRINT-${crypto.createHash("sha256").update(messageId).digest("hex").slice(0, 24)}`;
  try {
    const claimed = await pool.query(
      `UPDATE clinic.hardware_measurement_events e
       SET print_job_id = COALESCE(e.print_job_id, $2),
           print_status = 'requested',
           print_attempts = print_attempts + 1,
           print_error_code = NULL,
           print_requested_at = now(),
           updated_at = now()
       FROM clinic.measurements m, clinic.queue_tickets q
       WHERE e.message_id = $1
         AND m.measurement_id = e.measurement_id
         AND q.queue_id = e.queue_id
         AND e.print_attempts < 3
         AND (
           e.print_status IN ('pending', 'failed')
           OR (e.print_status = 'requested' AND e.print_requested_at < now() - interval '30 seconds')
         )
       RETURNING e.device_id, e.print_job_id, m.weight, m.height,
                 m.measured_at, q.queue_number`,
      [messageId, printJobId],
    );

    if (!claimed.rowCount) {
      const existing = await pool.query(
        `SELECT print_job_id, print_status
         FROM clinic.hardware_measurement_events
         WHERE message_id = $1`,
        [messageId],
      );
      if (!existing.rowCount) {
        return res.status(404).json({ code: "MEASUREMENT_NOT_FOUND", message: "Hardware measurement was not found" });
      }
      return res.json({
        print_job_id: existing.rows[0].print_job_id,
        status: existing.rows[0].print_status,
      });
    }

    const row = claimed.rows[0];
    const payload = {
      schema_version: "1.0",
      print_job_id: row.print_job_id,
      message_id: messageId,
      queue_number: row.queue_number,
      weight: Number(row.weight),
      height: Number(row.height),
      bmi: Number(bmi.toFixed(2)),
      measured_at: row.measured_at,
    };

    try {
      await publishJson(topic(row.device_id, "print"), payload);
    } catch (error) {
      await pool.query(
        `UPDATE clinic.hardware_measurement_events
         SET print_status = 'failed', print_error_code = $2, updated_at = now()
         WHERE message_id = $1 AND print_status = 'requested'`,
        [messageId, String(error.code || "MQTT_PUBLISH_FAILED").slice(0, 80)],
      );
      error.status = 503;
      throw error;
    }

    res.json({ print_job_id: row.print_job_id, status: "requested" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
