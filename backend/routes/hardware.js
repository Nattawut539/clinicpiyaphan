const express = require("express");
const router = express.Router();
const pool = require("../tools/db");
const { requireStaff } = require("../tools/_utils");
const { mqttStatus, publishJson, topic } = require("../tools/mqttBridge");
const printOutbox = require("../tools/printOutbox");
const { MAX_PRINT_ATTEMPTS } = require("../services/printRetryPolicy");

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
       WHERE e.print_attempts < $1
         AND (
           e.print_status = 'pending'
           OR (
             e.print_status IN ('failed', 'requested')
             AND e.print_retryable = true
             AND e.print_next_attempt_at IS NOT NULL
             AND e.print_next_attempt_at <= now()
           )
         )
       ORDER BY e.created_at
       LIMIT 20`,
      [MAX_PRINT_ATTEMPTS],
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

  try {
    const row = await printOutbox.claim(messageId, { bmi, allowPending: true });

    if (!row) {
      const existing = await printOutbox.status(messageId);
      if (!existing) {
        return res.status(404).json({ code: "MEASUREMENT_NOT_FOUND", message: "Hardware measurement was not found" });
      }
      return res.json({
        print_job_id: existing.print_job_id,
        status: existing.print_status,
        attempts: Number(existing.print_attempts),
        retryable: Boolean(existing.print_retryable),
        next_attempt_at: existing.print_next_attempt_at,
        error_code: existing.print_error_code,
      });
    }

    try {
      await printOutbox.publishClaim(row, publishJson, topic);
    } catch (error) {
      error.status = 503;
      throw error;
    }

    res.json({
      print_job_id: row.print_job_id,
      status: "requested",
      attempts: Number(row.print_attempts),
      next_attempt_at: row.print_next_attempt_at,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
