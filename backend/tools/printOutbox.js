const crypto = require("node:crypto");
const pool = require("./db");
const { safeRecordHardwareAudit } = require("./hardwareAudit");
const {
  MAX_PRINT_ATTEMPTS,
  PRINT_RETRY_BASE_SECONDS,
  PRINT_RETRY_MAX_SECONDS,
} = require("../services/printRetryPolicy");

function printJobIdFor(messageId) {
  return `PRINT-${crypto.createHash("sha256").update(messageId).digest("hex").slice(0, 24)}`;
}

async function dueMessageIds(limit = 20) {
  const result = await pool.query(
    `SELECT message_id
     FROM clinic.hardware_measurement_events
     WHERE print_job_id IS NOT NULL
       AND print_attempts < $1
       AND print_retryable = true
       AND print_status IN ('pending', 'requested', 'failed')
       AND print_next_attempt_at IS NOT NULL
       AND print_next_attempt_at <= now()
     ORDER BY print_next_attempt_at, created_at
     LIMIT $2`,
    [MAX_PRINT_ATTEMPTS, limit],
  );
  return result.rows.map((row) => row.message_id);
}

async function claim(messageId, { bmi = null, allowPending = false } = {}) {
  const printJobId = printJobIdFor(messageId);
  const result = await pool.query(
    `WITH measurement_data AS (
       UPDATE clinic.measurements m
       SET bmi = COALESCE(
         m.bmi,
         ROUND((m.weight / POWER(m.height / 100.0, 2))::numeric, 2),
         $6::numeric
       )
       FROM clinic.hardware_measurement_events source
       WHERE source.message_id = $1
         AND m.measurement_id = source.measurement_id
       RETURNING m.measurement_id, m.weight, m.height, m.bmi, m.measured_at
     )
     UPDATE clinic.hardware_measurement_events e
     SET print_job_id = COALESCE(e.print_job_id, $2),
         print_status = 'requested',
         print_attempts = print_attempts + 1,
         print_error_code = NULL,
         print_retryable = (print_attempts + 1 < $3),
         print_requested_at = now(),
         print_next_attempt_at = CASE
           WHEN print_attempts + 1 < $3
             THEN now() + make_interval(secs => LEAST(
               $4::double precision * POWER(2, print_attempts),
               $5::double precision
             ))
           ELSE NULL
         END,
         updated_at = now()
     FROM measurement_data m, clinic.queue_tickets q
     WHERE e.message_id = $1
       AND q.queue_id = e.queue_id
       AND e.print_attempts < $3
       AND (
         ($7::boolean AND e.print_status = 'pending')
         OR (
           e.print_status IN ('failed', 'requested')
           AND e.print_retryable = true
           AND e.print_next_attempt_at IS NOT NULL
           AND e.print_next_attempt_at <= now()
         )
       )
     RETURNING e.device_id, e.print_job_id, e.message_id,
               e.print_attempts, e.print_next_attempt_at,
               m.weight, m.height, m.bmi, m.measured_at, q.queue_number`,
    [
      messageId,
      printJobId,
      MAX_PRINT_ATTEMPTS,
      PRINT_RETRY_BASE_SECONDS,
      PRINT_RETRY_MAX_SECONDS,
      bmi,
      allowPending,
    ],
  );
  return result.rows[0] || null;
}

function payloadFor(row) {
  return {
    schema_version: "1.0",
    print_job_id: row.print_job_id,
    message_id: row.message_id,
    queue_number: row.queue_number,
    weight: Number(row.weight),
    height: Number(row.height),
    bmi: Number(row.bmi),
    measured_at: row.measured_at,
  };
}

async function markPublishFailed(messageId, error) {
  await pool.query(
    `UPDATE clinic.hardware_measurement_events
     SET print_status = 'failed',
         print_error_code = $2,
         print_retryable = (print_attempts < $3),
         print_last_failed_at = now(),
         updated_at = now()
     WHERE message_id = $1 AND print_status = 'requested'`,
    [messageId, String(error?.code || "MQTT_PUBLISH_FAILED").slice(0, 80), MAX_PRINT_ATTEMPTS],
  );
}

async function publishClaim(row, publishJson, makeTopic) {
  try {
    await publishJson(makeTopic(row.device_id, "print"), payloadFor(row));
    await safeRecordHardwareAudit("print_publish", {
      result: "published",
      deviceId: row.device_id,
      messageId: row.message_id,
      printJobId: row.print_job_id,
      details: { attempt: Number(row.print_attempts), queue_number: row.queue_number },
    });
  } catch (error) {
    await markPublishFailed(row.message_id, error);
    await safeRecordHardwareAudit("print_publish", {
      result: "failed",
      deviceId: row.device_id,
      messageId: row.message_id,
      printJobId: row.print_job_id,
      errorCode: error?.code || "MQTT_PUBLISH_FAILED",
      details: { attempt: Number(row.print_attempts) },
    });
    throw error;
  }
}

async function drain(publishJson, makeTopic) {
  let published = 0;
  for (const messageId of await dueMessageIds()) {
    const row = await claim(messageId, { allowPending: true });
    if (!row) continue;
    try {
      await publishClaim(row, publishJson, makeTopic);
      published += 1;
    } catch (error) {
      console.error("MQTT print retry failed", {
        at: new Date().toISOString(),
        message_id: messageId,
        attempt: Number(row.print_attempts),
        error: error.message,
      });
    }
  }
  return published;
}

async function createManualReprint(messageId, actorUserId) {
  const printJobId = `PRINT-${crypto.randomUUID()}`;
  const result = await pool.query(
    `UPDATE clinic.hardware_measurement_events
     SET print_job_id = $2,
         print_status = 'pending',
         print_attempts = 0,
         print_error_code = NULL,
         print_retryable = true,
         print_next_attempt_at = now(),
         print_last_failed_at = NULL,
         print_requested_by_user_id = $3,
         print_last_manual_reprint_at = now(),
         print_manual_reprint_count = print_manual_reprint_count + 1,
         updated_at = now()
     WHERE message_id = $1
       AND print_status IN ('printed', 'failed')
     RETURNING message_id, device_id, print_job_id, print_status,
               print_manual_reprint_count, print_last_manual_reprint_at`,
    [messageId, printJobId, actorUserId],
  );
  const row = result.rows[0] || null;
  if (row) {
    await safeRecordHardwareAudit("manual_reprint", {
      result: "requested",
      deviceId: row.device_id,
      messageId: row.message_id,
      printJobId: row.print_job_id,
      actorUserId,
      details: { reprint_count: Number(row.print_manual_reprint_count) },
    });
  }
  return row;
}

async function status(messageId) {
  const result = await pool.query(
    `SELECT print_job_id, print_status, print_attempts,
            print_retryable, print_next_attempt_at, print_error_code
     FROM clinic.hardware_measurement_events
     WHERE message_id = $1`,
    [messageId],
  );
  return result.rows[0] || null;
}

module.exports = {
  claim,
  createManualReprint,
  drain,
  dueMessageIds,
  markPublishFailed,
  payloadFor,
  printJobIdFor,
  publishClaim,
  status,
};
