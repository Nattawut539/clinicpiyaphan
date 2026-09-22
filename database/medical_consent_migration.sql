-- Run once with the schema owner before deploying the API. Safe to rerun.
BEGIN;
ALTER TABLE clinic.users
  ADD COLUMN IF NOT EXISTS medical_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS medical_consent_version text;
-- Do not infer consent for existing accounts. They must accept on next access.
COMMIT;
