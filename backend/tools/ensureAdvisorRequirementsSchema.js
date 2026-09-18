const pool = require("./db");

async function ensureAdvisorRequirementsSchema() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE clinic.users
      ADD COLUMN IF NOT EXISTS account_status varchar(32) NOT NULL DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
      ADD COLUMN IF NOT EXISTS profile_completed_at timestamptz,
      ADD COLUMN IF NOT EXISTS medical_consent_at timestamptz,
      ADD COLUMN IF NOT EXISTS medical_consent_version text,
      ADD COLUMN IF NOT EXISTS registration_source varchar(32) NOT NULL DEFAULT 'local',
      ADD COLUMN IF NOT EXISTS status_reason text,
      ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
      ADD COLUMN IF NOT EXISTS status_changed_by integer,
      ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
      ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
      ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 1
    `);

    await client.query(`
      UPDATE clinic.users
      SET registration_source = CASE
            WHEN google_id IS NOT NULL THEN 'google'
            WHEN line_id IS NOT NULL THEN 'line'
            ELSE COALESCE(NULLIF(registration_source, ''), 'local')
          END,
          account_status = COALESCE(NULLIF(account_status, ''), 'active'),
          session_version = GREATEST(COALESCE(session_version, 1), 1)
    `);

    await client.query(`
      UPDATE clinic.users u
      SET email_verified_at = COALESCE(u.email_verified_at, u.created_at, now()),
          profile_completed_at = COALESCE(u.profile_completed_at, u.created_at, now())
      WHERE u.account_status = 'active'
        AND EXISTS (
          SELECT 1 FROM clinic.user_details d
          WHERE d.user_id = u.user_id
            AND NULLIF(BTRIM(d.national_id), '') IS NOT NULL
            AND NULLIF(BTRIM(d.first_name), '') IS NOT NULL
            AND NULLIF(BTRIM(d.last_name), '') IS NOT NULL
            AND d.birth_date IS NOT NULL
            AND NULLIF(BTRIM(d.phone), '') IS NOT NULL
        )
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'users_account_status_check'
            AND conrelid = 'clinic.users'::regclass
        ) THEN
          ALTER TABLE clinic.users ADD CONSTRAINT users_account_status_check
          CHECK (account_status IN ('active','pending_verification','deactivated','suspended','duplicate','unclaimed'));
        END IF;
      END $$
    `);

    // ผู้ป่วย Walk-in ยังไม่มีข้อมูลเข้าสู่ระบบ จึงต้องอนุญาตบัญชีพักแบบ unclaimed
    // ส่วนบัญชีชนิดอื่นยังคงต้องมี password หรือ social identity ตามเดิม
    await client.query(`
      ALTER TABLE clinic.users
      DROP CONSTRAINT IF EXISTS users_auth_chk
    `);
    await client.query(`
      ALTER TABLE clinic.users
      ADD CONSTRAINT users_auth_chk CHECK (
        password_hash IS NOT NULL
        OR google_id IS NOT NULL
        OR line_id IS NOT NULL
        OR (account_status = 'unclaimed' AND registration_source = 'walkin')
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS clinic.email_verification_otps (
        verification_id bigserial PRIMARY KEY,
        user_id integer NOT NULL REFERENCES clinic.users(user_id) ON DELETE CASCADE,
        token_hash varchar(64) NOT NULL,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        attempt_count integer NOT NULL DEFAULT 0,
        last_sent_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      ALTER TABLE clinic.password_reset_otps
      ALTER COLUMN otp DROP NOT NULL,
      ADD COLUMN IF NOT EXISTS otp_hash varchar(64),
      ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS verified_at timestamptz,
      ADD COLUMN IF NOT EXISTS used_at timestamptz
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS email_verification_user_active_idx
      ON clinic.email_verification_otps (user_id, expires_at DESC)
      WHERE used_at IS NULL
    `);

    await client.query(`
      ALTER TABLE clinic.help_requests
      ADD COLUMN IF NOT EXISTS request_status varchar(24) NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS reviewed_by integer,
      ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
      ADD COLUMN IF NOT EXISTS review_note text,
      ADD COLUMN IF NOT EXISTS verification_method varchar(80)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS clinic.patient_checkins (
        checkin_id bigserial PRIMARY KEY,
        appointment_id integer NOT NULL REFERENCES clinic.appointments(appointment_id),
        user_id integer NOT NULL REFERENCES clinic.users(user_id),
        verified_by_user_id integer NOT NULL REFERENCES clinic.users(user_id),
        verification_method varchar(80) NOT NULL,
        verification_note text,
        verified_at timestamptz NOT NULL DEFAULT now(),
        code_issued_at timestamptz,
        code_expires_at timestamptz,
        reason varchar(80) NOT NULL DEFAULT 'forgot_email',
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (appointment_id)
      )
    `);

    await client.query(`
      ALTER TABLE clinic.appointment_access_codes
      ADD COLUMN IF NOT EXISTS issued_by integer,
      ADD COLUMN IF NOT EXISTS issue_reason varchar(80),
      ADD COLUMN IF NOT EXISTS code_ciphertext text
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS user_details_national_id_lookup_idx
      ON clinic.user_details (national_id)
      WHERE national_id IS NOT NULL AND BTRIM(national_id) <> ''
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM clinic.user_details
          WHERE national_id IS NOT NULL AND BTRIM(national_id) <> ''
          GROUP BY national_id HAVING COUNT(*) > 1
        ) THEN
          CREATE UNIQUE INDEX IF NOT EXISTS user_details_national_id_unique_idx
          ON clinic.user_details (national_id)
          WHERE national_id IS NOT NULL AND BTRIM(national_id) <> '';
        END IF;
      END $$
    `);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = ensureAdvisorRequirementsSchema;
