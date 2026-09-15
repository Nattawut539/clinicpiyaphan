const pool = require("./db");

function retryDelayMs(attempts) {
  return Math.min(60000, 5000 * (2 ** Math.min(Math.max(attempts, 0), 4)));
}

async function markPublished(messageId) {
  await pool.query(
    `UPDATE clinic.hardware_measurement_ack_outbox
     SET published_at = COALESCE(published_at, now()),
         last_error = NULL,
         updated_at = now()
     WHERE message_id = $1`,
    [messageId],
  );
}

async function recordFailure(messageId, error, attempts = 0) {
  const delay = retryDelayMs(attempts);
  await pool.query(
    `UPDATE clinic.hardware_measurement_ack_outbox
     SET attempts = attempts + 1,
         last_error = $2,
         next_attempt_at = now() + ($3::integer * interval '1 millisecond'),
         updated_at = now()
     WHERE message_id = $1 AND published_at IS NULL`,
    [messageId, String(error?.message || error).slice(0, 500), delay],
  );
}

async function pending(limit = 50) {
  const result = await pool.query(
    `SELECT message_id, device_id, ack_payload, attempts
     FROM clinic.hardware_measurement_ack_outbox
     WHERE published_at IS NULL AND next_attempt_at <= now()
     ORDER BY next_attempt_at, created_at
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

module.exports = { markPublished, pending, recordFailure, retryDelayMs };
