const express = require("express");
const router = express.Router();
const pool = require("../tools/db");
const { requireRole, requireStaff } = require("../tools/_utils");
const { mqttStatus, publishJson, topic } = require("../tools/mqttBridge");
const printOutbox = require("../tools/printOutbox");
const hardwareMetrics = require("../tools/hardwareMetrics");
const { MAX_PRINT_ATTEMPTS } = require("../services/printRetryPolicy");

const requireHardwareAdmin = requireRole("super_admin", "superadmin");

router.get("/hardware/admin-dashboard", requireHardwareAdmin, async (_req, res, next) => {
  try {
    const [health, otpResult, deviceResult, measurementResult, timelineResult] = await Promise.all([
      hardwareMetrics.operationalSnapshot(mqttStatus()),
      pool.query(
        `SELECT a.appointment_id, q.queue_id, q.queue_number,
                s.service_date::text, s.hour_of_day,
                NULLIF(BTRIM(CONCAT_WS(' ', d.first_name, d.last_name)), '') AS patient_name,
                ac.access_code_id, ac.created_at AS issued_at,
                ac.expires_at, ac.used_at,
                EXISTS (
                  SELECT 1 FROM clinic.measurements m WHERE m.queue_id = q.queue_id
                ) AS has_measurement,
                CASE
                  WHEN ac.access_code_id IS NULL THEN 'not_issued'
                  WHEN ac.used_at IS NOT NULL THEN 'used'
                  WHEN s.service_date > (now() AT TIME ZONE 'Asia/Bangkok')::date THEN 'not_active_yet'
                  WHEN ac.expires_at <= now()
                    OR s.service_date < (now() AT TIME ZONE 'Asia/Bangkok')::date THEN 'expired'
                  ELSE 'available'
                END AS status
         FROM clinic.appointments a
         JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
         LEFT JOIN clinic.queue_tickets q
           ON q.appointment_id = a.appointment_id AND q.status <> 'cancelled'
         LEFT JOIN clinic.appointment_access_codes ac ON ac.appointment_id = a.appointment_id
         LEFT JOIN clinic.user_details d ON d.user_id = a.user_id
         WHERE a.status = 'approved'
           AND s.service_date BETWEEN
             (now() AT TIME ZONE 'Asia/Bangkok')::date - 1
             AND (now() AT TIME ZONE 'Asia/Bangkok')::date + 7
         ORDER BY s.service_date, s.hour_of_day, q.queue_number
         LIMIT 100`,
      ),
      pool.query(
        `WITH activity AS (
           SELECT device_id, created_at AS seen_at
           FROM clinic.hardware_event_audit
           WHERE device_id IS NOT NULL
           UNION ALL
           SELECT device_id, updated_at AS seen_at
           FROM clinic.hardware_measurement_events
           WHERE device_id IS NOT NULL
         )
         SELECT device_id, MAX(seen_at) AS last_seen_at,
                CASE WHEN MAX(seen_at) >= now() - interval '2 minutes'
                  THEN 'online' ELSE 'offline' END AS status,
                COUNT(*)::integer AS event_count
         FROM activity
         GROUP BY device_id
         ORDER BY MAX(seen_at) DESC
         LIMIT 50`,
      ),
      pool.query(
        `SELECT e.message_id, e.device_id, e.mode, e.measurement_session_id,
                e.print_job_id,
                CASE WHEN e.print_status = 'requested' THEN 'pending'
                  ELSE e.print_status END AS print_status,
                e.print_status AS raw_print_status,
                e.print_attempts, e.print_error_code, e.print_retryable,
                e.print_next_attempt_at, e.print_requested_at,
                e.print_last_manual_reprint_at, e.print_manual_reprint_count,
                e.printed_at, e.created_at, e.updated_at,
                q.queue_number,
                NULLIF(BTRIM(CONCAT_WS(' ', d.first_name, d.last_name)), '') AS patient_name,
                m.measurement_id, m.weight, m.height, m.bmi,
                m.measured_at, m.source
         FROM clinic.hardware_measurement_events e
         JOIN clinic.measurements m ON m.measurement_id = e.measurement_id
         JOIN clinic.queue_tickets q ON q.queue_id = e.queue_id
         LEFT JOIN clinic.user_details d ON d.user_id = q.user_id
         ORDER BY e.created_at DESC
         LIMIT 100`,
      ),
      pool.query(
        `SELECT * FROM (
           SELECT 'audit-' || audit_id::text AS event_key,
                  event_type, result, device_id, request_id,
                  measurement_session_id, message_id, print_job_id,
                  actor_user_id, error_code, details, created_at
           FROM clinic.hardware_event_audit
           UNION ALL
           SELECT 'otp-' || ac.access_code_id::text AS event_key,
                  'otp_issued'::varchar AS event_type,
                  'requested'::varchar AS result,
                  NULL::varchar AS device_id,
                  NULL::varchar AS request_id,
                  NULL::uuid AS measurement_session_id,
                  NULL::varchar AS message_id,
                  NULL::varchar AS print_job_id,
                  ac.issued_by AS actor_user_id,
                  NULL::varchar AS error_code,
                  jsonb_build_object(
                    'appointment_id', ac.appointment_id,
                    'queue_number', q.queue_number,
                    'expires_at', ac.expires_at
                  ) AS details,
                  ac.created_at
           FROM clinic.appointment_access_codes ac
           LEFT JOIN clinic.queue_tickets q ON q.queue_id = ac.queue_id
         ) timeline
         ORDER BY created_at DESC
         LIMIT 200`,
      ),
    ]);

    return res.json({
      generated_at: new Date().toISOString(),
      health,
      otps: otpResult.rows,
      devices: deviceResult.rows,
      measurements: measurementResult.rows,
      timeline: timelineResult.rows,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/hardware/mqtt-status", requireStaff, (_req, res) => {
  res.json(mqttStatus());
});

router.get("/hardware/health", requireStaff, async (_req, res, next) => {
  try {
    res.json(await hardwareMetrics.operationalSnapshot(mqttStatus()));
  } catch (error) {
    next(error);
  }
});

router.get("/hardware/events", requireStaff, async (req, res, next) => {
  try {
    const filters = [];
    const params = [];
    const addFilter = (column, value, maxLength = 100) => {
      const text = String(value || "").trim();
      if (!text) return;
      params.push(text.slice(0, maxLength));
      filters.push(`${column} = $${params.length}`);
    };
    addFilter("request_id", req.query.request_id);
    addFilter("measurement_session_id::text", req.query.measurement_session_id);
    addFilter("message_id", req.query.message_id);
    addFilter("print_job_id", req.query.print_job_id);
    addFilter("device_id", req.query.device_id, 80);
    params.push(Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 100)));
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT audit_id, event_type, result, device_id, request_id,
              measurement_session_id, message_id, print_job_id,
              actor_user_id, error_code, details, created_at
       FROM clinic.hardware_event_audit
       ${where}
       ORDER BY created_at DESC, audit_id DESC
       LIMIT $${params.length}`,
      params,
    );
    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
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
  if (!messageId || messageId.length > 100) {
    return res.status(400).json({ code: "INVALID_PRINT_DATA", message: "message_id is invalid" });
  }

  try {
    const row = await printOutbox.claim(messageId, { allowPending: true });

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

router.post("/hardware/reprint", requireStaff, async (req, res, next) => {
  const messageId = String(req.body?.message_id || "").trim();
  if (!messageId || messageId.length > 100) {
    return res.status(400).json({ code: "INVALID_PRINT_DATA", message: "message_id is invalid" });
  }

  try {
    const created = await printOutbox.createManualReprint(messageId, req.user.user_id);
    if (!created) {
      return res.status(409).json({
        code: "PRINT_NOT_REPRINTABLE",
        message: "Print job must be printed or failed before manual reprint",
      });
    }

    const row = await printOutbox.claim(messageId, { allowPending: true });
    if (!row) {
      return res.status(409).json({ code: "PRINT_CLAIM_FAILED", message: "Manual reprint could not be claimed" });
    }
    try {
      await printOutbox.publishClaim(row, publishJson, topic);
    } catch (error) {
      error.status = 503;
      throw error;
    }
    return res.status(201).json({
      message_id: messageId,
      print_job_id: row.print_job_id,
      status: "requested",
      attempts: Number(row.print_attempts),
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
