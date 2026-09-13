-- Idempotent production baseline derived from database/schema.sql and the
-- backend's historical runtime schema initializers. Run in the Supabase SQL
-- Editor as the project/database owner. It preserves existing application data.

BEGIN;

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

GRANT CONNECT ON DATABASE postgres TO cliniccare_runtime;
GRANT USAGE ON SCHEMA clinic TO cliniccare_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA clinic
  TO cliniccare_runtime;

GRANT USAGE, SELECT, UPDATE
  ON ALL SEQUENCES IN SCHEMA clinic
  TO cliniccare_runtime;

GRANT EXECUTE
  ON ALL FUNCTIONS IN SCHEMA clinic
  TO cliniccare_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA clinic
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cliniccare_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA clinic
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO cliniccare_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA clinic
  GRANT EXECUTE ON FUNCTIONS TO cliniccare_runtime;

DO $policies$
DECLARE
  target_table text;
BEGIN
  FOR target_table IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'clinic'
      AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE clinic.%I ENABLE ROW LEVEL SECURITY', target_table);

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'clinic'
        AND tablename = target_table
        AND policyname = 'cliniccare_runtime_backend_full_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY cliniccare_runtime_backend_full_access
         ON clinic.%I
         FOR ALL
         TO cliniccare_runtime
         USING (true)
         WITH CHECK (true)',
        target_table
      );
    END IF;
  END LOOP;
END
$policies$;

COMMIT;

-- One result set audits every table declared by database/schema.sql.
SELECT
  table_name,
  to_regclass(format('clinic.%I', table_name)) IS NOT NULL AS table_exists,
  CASE WHEN to_regclass(format('clinic.%I', table_name)) IS NOT NULL
    THEN has_table_privilege('cliniccare_runtime', format('clinic.%I', table_name), 'SELECT')
    ELSE false END AS can_select,
  CASE WHEN to_regclass(format('clinic.%I', table_name)) IS NOT NULL
    THEN has_table_privilege('cliniccare_runtime', format('clinic.%I', table_name), 'INSERT')
    ELSE false END AS can_insert,
  CASE WHEN to_regclass(format('clinic.%I', table_name)) IS NOT NULL
    THEN has_table_privilege('cliniccare_runtime', format('clinic.%I', table_name), 'UPDATE')
    ELSE false END AS can_update,
  CASE WHEN to_regclass(format('clinic.%I', table_name)) IS NOT NULL
    THEN has_table_privilege('cliniccare_runtime', format('clinic.%I', table_name), 'DELETE')
    ELSE false END AS can_delete
FROM (VALUES
  ('users'), ('provinces'), ('user_details'), ('profile_image_cleanup'),
  ('email_verification_otps'), ('password_reset_otps'), ('password_resets'),
  ('appointment_slot_templates'), ('appointment_slots'), ('appointments'),
  ('queue_tickets'), ('appointment_access_codes'), ('patient_checkins'),
  ('measurements'), ('hardware_otp_sessions'), ('hardware_measurement_events'),
  ('medical_records'), ('user_feedbacks'), ('help_requests'),
  ('user_notifications'), ('clinic_holidays'), ('clinic_open_days'),
  ('weekly_closed_windows'), ('advance_booking_weeks'), ('audit_logs')
) AS required_tables(table_name)
ORDER BY table_name;
