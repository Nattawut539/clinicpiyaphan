require("dotenv").config();
const assert = require("node:assert/strict");
const pool = require("../tools/db");

async function main() {
  const columns = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'clinic'
       AND table_name = 'hardware_measurement_events'
       AND column_name = ANY($1::text[])`,
    [["print_retryable", "print_next_attempt_at", "print_last_failed_at"]],
  );
  assert.deepEqual(
    columns.rows.map((row) => row.column_name).sort(),
    ["print_last_failed_at", "print_next_attempt_at", "print_retryable"],
  );

  const indexes = await pool.query(
    `SELECT indexname
     FROM pg_indexes
     WHERE schemaname = 'clinic'
       AND indexname = ANY($1::text[])`,
    [[
      "hardware_measurement_events_device_message_key",
      "hardware_measurement_events_print_retry_idx",
      "measurements_device_hardware_message_key",
    ]],
  );
  assert.deepEqual(
    indexes.rows.map((row) => row.indexname).sort(),
    [
      "hardware_measurement_events_device_message_key",
      "hardware_measurement_events_print_retry_idx",
      "measurements_device_hardware_message_key",
    ],
  );

  const duplicateEvents = await pool.query(
    `SELECT device_id, message_id, COUNT(*)::int AS count
     FROM clinic.hardware_measurement_events
     GROUP BY device_id, message_id
     HAVING COUNT(*) > 1`,
  );
  assert.equal(duplicateEvents.rowCount, 0, "duplicate device_id + message_id events found");

  const duplicateMeasurements = await pool.query(
    `SELECT device_id, hardware_message_id, COUNT(*)::int AS count
     FROM clinic.measurements
     WHERE device_id IS NOT NULL AND hardware_message_id IS NOT NULL
     GROUP BY device_id, hardware_message_id
     HAVING COUNT(*) > 1`,
  );
  assert.equal(duplicateMeasurements.rowCount, 0, "duplicate hardware measurements found");

  console.log("Hardware reliability schema verified: retry columns/indexes present; no duplicate device/message rows.");
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error.message);
    await pool.end().catch(() => {});
    process.exitCode = 1;
  });
