BEGIN;

ALTER TABLE clinic.hardware_measurement_events
  ADD COLUMN IF NOT EXISTS print_retryable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS print_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS print_last_failed_at timestamptz;

-- Existing terminal test failures must not be republished after this migration.
UPDATE clinic.hardware_measurement_events
SET print_retryable = false,
    print_next_attempt_at = NULL
WHERE print_status = 'printed'
   OR print_attempts >= 3
   OR UPPER(COALESCE(print_error_code, '')) IN
      ('PRINTER_NOT_CONNECTED', 'UNSUPPORTED_SCHEMA', 'INVALID_PRINT_JOB', 'INVALID_PRINT_DATA');

-- Existing in-flight/transient jobs enter the same bounded exponential schedule.
UPDATE clinic.hardware_measurement_events
SET print_next_attempt_at = COALESCE(updated_at, now())
  + make_interval(secs => LEAST(
      30::double precision * POWER(2, GREATEST(print_attempts - 1, 0)),
      300::double precision
    ))
WHERE print_retryable = true
  AND print_attempts < 3
  AND print_status IN ('requested', 'failed')
  AND print_next_attempt_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS hardware_measurement_events_device_message_key
  ON clinic.hardware_measurement_events (device_id, message_id);

CREATE UNIQUE INDEX IF NOT EXISTS measurements_device_hardware_message_key
  ON clinic.measurements (device_id, hardware_message_id)
  WHERE device_id IS NOT NULL AND hardware_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS hardware_measurement_events_print_retry_idx
  ON clinic.hardware_measurement_events (print_next_attempt_at, created_at)
  WHERE print_retryable = true
    AND print_status IN ('requested', 'failed');

GRANT SELECT, INSERT, UPDATE ON clinic.hardware_measurement_events TO cliniccare_runtime;

COMMIT;
