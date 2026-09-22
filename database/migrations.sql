-- ClinicCare consolidated migration (run after schema.sql, never instead of it).
-- Execute the entire file in pgAdmin/psql as the schema owner.
-- Safe to rerun: preserves application rows and does not infer patient consent.
-- Runtime grants apply only when cliniccare_runtime already exists. Create that
-- role and set its password privately before running this file for production.
-- Local databases do not need that role. No credentials belong in this file.
-- Startup reads ONLY the measurement_ack_outbox section; keep its markers.

BEGIN;
SET LOCAL search_path TO clinic, public;

-- BEGIN SECTION: production_baseline
-- Idempotent production baseline derived from database/schema.sql and the
-- backend's historical runtime schema initializers. Run in the Supabase SQL
-- Editor as the project/database owner. It preserves existing application data.


CREATE TABLE IF NOT EXISTS clinic.clinic_open_days (
  service_date date PRIMARY KEY,
  reason text,
  created_by integer REFERENCES clinic.users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clinic.advance_booking_weeks (
  week_start date PRIMARY KEY,
  week_end date NOT NULL,
  created_by integer REFERENCES clinic.users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT advance_booking_weeks_valid_range CHECK (week_end >= week_start),
  CONSTRAINT advance_booking_weeks_same_month CHECK (
    date_trunc('month', week_start::timestamp) =
      date_trunc('month', week_end::timestamp)
  )
);

ALTER TABLE clinic.user_feedbacks
  ADD COLUMN IF NOT EXISTS record_id integer,
  ADD COLUMN IF NOT EXISTS visit_date date,
  ADD COLUMN IF NOT EXISTS service_type text;

-- Bring older installations up to the column contract used by the backend.
ALTER TABLE clinic.users
  ADD COLUMN IF NOT EXISTS account_status varchar(32) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS profile_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS registration_source varchar(32) NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by integer,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
  ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 1;

ALTER TABLE clinic.user_details
  ADD COLUMN IF NOT EXISTS profile_image_drive_id text;

ALTER TABLE clinic.password_reset_otps
  ALTER COLUMN otp DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS otp_hash varchar(64),
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS used_at timestamptz;

ALTER TABLE clinic.help_requests
  ADD COLUMN IF NOT EXISTS request_status varchar(24) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_by integer,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS verification_method varchar(80);

ALTER TABLE clinic.appointment_access_codes
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  ADD COLUMN IF NOT EXISTS issued_by integer,
  ADD COLUMN IF NOT EXISTS issue_reason varchar(80),
  ADD COLUMN IF NOT EXISTS code_ciphertext text;

ALTER TABLE clinic.measurements
  ADD COLUMN IF NOT EXISTS queue_id integer,
  ADD COLUMN IF NOT EXISTS chief_complaint text,
  ADD COLUMN IF NOT EXISTS temperature numeric(4,1),
  ADD COLUMN IF NOT EXISTS heart_rate integer,
  ADD COLUMN IF NOT EXISTS respiratory_rate integer,
  ADD COLUMN IF NOT EXISTS systolic_bp integer,
  ADD COLUMN IF NOT EXISTS diastolic_bp integer,
  ADD COLUMN IF NOT EXISTS source varchar(20) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS device_id varchar(80),
  ADD COLUMN IF NOT EXISTS hardware_message_id varchar(100),
  ADD COLUMN IF NOT EXISTS measured_at timestamptz;

ALTER TABLE clinic.medical_records
  ADD COLUMN IF NOT EXISTS body_drawing_data text;

ALTER TABLE clinic.queue_tickets
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE clinic.appointments
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

ALTER TABLE clinic.hardware_measurement_events
  ADD COLUMN IF NOT EXISTS print_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE clinic.clinic_holidays
  ADD COLUMN IF NOT EXISTS created_by integer,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS user_feedbacks_user_record_unique
  ON clinic.user_feedbacks (user_id, record_id)
  WHERE record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_details_profile_image_drive_idx
  ON clinic.user_details (profile_image_drive_id)
  WHERE profile_image_drive_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS measurements_queue_id_idx
  ON clinic.measurements (queue_id);
CREATE UNIQUE INDEX IF NOT EXISTS measurements_hardware_message_id_key
  ON clinic.measurements (hardware_message_id)
  WHERE hardware_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS clinic_holidays_date_idx
  ON clinic.clinic_holidays (service_date);
CREATE INDEX IF NOT EXISTS appointment_access_codes_expires_at_idx
  ON clinic.appointment_access_codes (expires_at)
  WHERE used_at IS NULL;

CREATE OR REPLACE FUNCTION clinic.seed_slots(start_date date, end_date date)
RETURNS void AS $$
BEGIN
  IF start_date IS NULL OR end_date IS NULL OR end_date < start_date THEN
    RAISE EXCEPTION 'Invalid slot date range';
  END IF;

  INSERT INTO clinic.appointment_slots
    (service_date, avaliable_date, hour_of_day, status)
  SELECT d.service_date::date, h.avaliable_date, h.hour_of_day,
         'open'::clinic.slot_status
  FROM generate_series(start_date, end_date, interval '1 day') d(service_date)
  CROSS JOIN (VALUES
    ('morning'::varchar, 7::smallint), ('morning'::varchar, 8::smallint),
    ('morning'::varchar, 9::smallint), ('morning'::varchar, 10::smallint),
    ('afternoon'::varchar, 16::smallint), ('afternoon'::varchar, 17::smallint),
    ('afternoon'::varchar, 18::smallint), ('afternoon'::varchar, 19::smallint)
  ) h(avaliable_date, hour_of_day)
  ON CONFLICT (service_date, avaliable_date, hour_of_day) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION clinic.lock_timed_out_slots()
RETURNS void AS $$
BEGIN
  UPDATE clinic.appointment_slots s
  SET status = 'locked'
  WHERE s.status = 'open'
    AND s.bookable_until < (now() AT TIME ZONE 'Asia/Bangkok')
    AND NOT EXISTS (
      SELECT 1 FROM clinic.appointments a
      WHERE a.slot_id = s.slot_id
        AND a.status NOT IN ('cancelled', 'rejected')
    );
END;
$$ LANGUAGE plpgsql;
-- END SECTION: production_baseline

-- BEGIN SECTION: hardware_reliability
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
-- END SECTION: hardware_reliability

-- BEGIN SECTION: hardware_admin
ALTER TABLE clinic.hardware_measurement_events
  ADD COLUMN IF NOT EXISTS payload_hash varchar(64),
  ADD COLUMN IF NOT EXISTS measurement_session_id uuid,
  ADD COLUMN IF NOT EXISTS print_requested_by_user_id integer
    REFERENCES clinic.users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS print_last_manual_reprint_at timestamptz,
  ADD COLUMN IF NOT EXISTS print_manual_reprint_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS clinic.hardware_event_audit (
  audit_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  event_type varchar(80) NOT NULL,
  result varchar(20) NOT NULL
    CHECK (result IN ('accepted', 'duplicate', 'rejected', 'published', 'failed', 'requested')),
  device_id varchar(80),
  request_id varchar(100),
  measurement_session_id uuid,
  message_id varchar(100),
  print_job_id varchar(100),
  actor_user_id integer REFERENCES clinic.users(user_id) ON DELETE SET NULL,
  error_code varchar(100),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hardware_event_audit_request_idx
  ON clinic.hardware_event_audit (request_id, created_at DESC)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS hardware_event_audit_session_idx
  ON clinic.hardware_event_audit (measurement_session_id, created_at DESC)
  WHERE measurement_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS hardware_event_audit_message_idx
  ON clinic.hardware_event_audit (message_id, created_at DESC)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS hardware_event_audit_print_job_idx
  ON clinic.hardware_event_audit (print_job_id, created_at DESC)
  WHERE print_job_id IS NOT NULL;

DROP INDEX IF EXISTS clinic.hardware_measurement_events_print_retry_idx;
CREATE INDEX hardware_measurement_events_print_retry_idx
  ON clinic.hardware_measurement_events (print_next_attempt_at, created_at)
  WHERE print_retryable = true
    AND print_status IN ('pending', 'requested', 'failed');

DO $runtime$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cliniccare_runtime') THEN
    GRANT SELECT, INSERT, UPDATE
      ON clinic.hardware_measurement_events TO cliniccare_runtime;
    GRANT SELECT, INSERT
      ON clinic.hardware_event_audit TO cliniccare_runtime;
    GRANT USAGE, SELECT
      ON SEQUENCE clinic.hardware_event_audit_audit_id_seq TO cliniccare_runtime;

    ALTER TABLE clinic.hardware_event_audit ENABLE ROW LEVEL SECURITY;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'clinic'
        AND tablename = 'hardware_event_audit'
        AND policyname = 'cliniccare_runtime_backend_access'
    ) THEN
      CREATE POLICY cliniccare_runtime_backend_access
        ON clinic.hardware_event_audit
        FOR ALL TO cliniccare_runtime
        USING (true) WITH CHECK (true);
    END IF;
  END IF;
END
$runtime$;
-- END SECTION: hardware_admin

-- BEGIN SECTION: measurement_ack_outbox
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
-- END SECTION: measurement_ack_outbox

-- BEGIN SECTION: medical_consent
-- Run once with the schema owner before deploying the API. Safe to rerun.

ALTER TABLE clinic.users
  ADD COLUMN IF NOT EXISTS medical_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS medical_consent_version text;
-- Do not infer consent for existing accounts. They must accept on next access.
-- END SECTION: medical_consent

-- BEGIN SECTION: runtime_grants
DO $grants$
DECLARE
  target_table text;
BEGIN
  -- Local installations need not create the production runtime role.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cliniccare_runtime') THEN
    RAISE NOTICE 'Skipping runtime grants: cliniccare_runtime does not exist';
    RETURN;
  END IF;

  EXECUTE format('GRANT CONNECT ON DATABASE %I TO cliniccare_runtime', current_database());
  GRANT USAGE ON SCHEMA clinic TO cliniccare_runtime;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA clinic TO cliniccare_runtime;
  GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA clinic TO cliniccare_runtime;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA clinic TO cliniccare_runtime;

  -- Run as the schema/migration owner so future objects receive these grants.
  ALTER DEFAULT PRIVILEGES IN SCHEMA clinic
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cliniccare_runtime;
  ALTER DEFAULT PRIVILEGES IN SCHEMA clinic
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO cliniccare_runtime;
  ALTER DEFAULT PRIVILEGES IN SCHEMA clinic
    GRANT EXECUTE ON FUNCTIONS TO cliniccare_runtime;

  FOR target_table IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'clinic' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE clinic.%I ENABLE ROW LEVEL SECURITY', target_table);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'clinic' AND tablename = target_table
        AND policyname = 'cliniccare_runtime_backend_full_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY cliniccare_runtime_backend_full_access ON clinic.%I
         FOR ALL TO cliniccare_runtime USING (true) WITH CHECK (true)', target_table);
    END IF;
  END LOOP;
END
$grants$;
-- END SECTION: runtime_grants

COMMIT;

-- Production verification: includes the seven tables required by preflight.
SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'clinic'
  AND policyname = 'cliniccare_runtime_backend_full_access'
ORDER BY tablename;
