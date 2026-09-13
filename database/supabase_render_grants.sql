-- Run this in the Supabase SQL Editor after creating the cliniccare_runtime LOGIN role
-- and assigning its password privately. This file intentionally contains no
-- password and is safe to commit.

BEGIN;

GRANT CONNECT ON DATABASE postgres TO cliniccare_runtime;
GRANT USAGE ON SCHEMA clinic TO cliniccare_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA clinic TO cliniccare_runtime;

GRANT USAGE, SELECT, UPDATE
  ON ALL SEQUENCES IN SCHEMA clinic TO cliniccare_runtime;

GRANT EXECUTE
  ON ALL FUNCTIONS IN SCHEMA clinic TO cliniccare_runtime;

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
  FOREACH target_table IN ARRAY ARRAY[
    'appointments',
    'clinic_holidays',
    'help_requests',
    'medical_records',
    'queue_tickets',
    'user_details',
    'users'
  ]
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

SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'clinic'
  AND policyname = 'cliniccare_runtime_backend_full_access'
ORDER BY tablename;
