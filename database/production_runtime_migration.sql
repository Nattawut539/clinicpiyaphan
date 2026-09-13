-- Run once in the Supabase SQL Editor as the project/database owner.
-- Application requests must not create or alter database objects at runtime.

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
  ADD COLUMN IF NOT EXISTS record_id bigint,
  ADD COLUMN IF NOT EXISTS visit_date date,
  ADD COLUMN IF NOT EXISTS service_type text;

CREATE UNIQUE INDEX IF NOT EXISTS user_feedbacks_user_record_unique
  ON clinic.user_feedbacks (user_id, record_id)
  WHERE record_id IS NOT NULL;

GRANT USAGE ON SCHEMA clinic TO cliniccare_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON clinic.clinic_open_days,
     clinic.advance_booking_weeks,
     clinic.user_feedbacks
  TO cliniccare_runtime;

GRANT USAGE, SELECT, UPDATE
  ON ALL SEQUENCES IN SCHEMA clinic
  TO cliniccare_runtime;

COMMIT;
