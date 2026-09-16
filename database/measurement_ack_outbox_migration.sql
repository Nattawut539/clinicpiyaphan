BEGIN;

CREATE TABLE IF NOT EXISTS clinic.hardware_measurement_ack_outbox (
  message_id varchar(100) PRIMARY KEY
    REFERENCES clinic.hardware_measurement_events(message_id) ON DELETE CASCADE,
  device_id varchar(80) NOT NULL,
  ack_payload jsonb NOT NULL,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now() + interval '10 seconds',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hardware_measurement_ack_outbox_pending_idx
  ON clinic.hardware_measurement_ack_outbox (next_attempt_at, created_at)
  WHERE published_at IS NULL;

DO $runtime$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cliniccare_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON clinic.hardware_measurement_ack_outbox TO cliniccare_runtime;
    ALTER TABLE clinic.hardware_measurement_ack_outbox ENABLE ROW LEVEL SECURITY;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'clinic'
        AND tablename = 'hardware_measurement_ack_outbox'
        AND policyname = 'cliniccare_runtime_backend_full_access'
    ) THEN
      CREATE POLICY cliniccare_runtime_backend_full_access
        ON clinic.hardware_measurement_ack_outbox
        FOR ALL TO cliniccare_runtime
        USING (true) WITH CHECK (true);
    END IF;
  END IF;
END
$runtime$;

COMMIT;
