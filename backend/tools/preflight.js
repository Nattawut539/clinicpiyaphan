const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

if (process.env.NODE_ENV !== "production") {
  throw new Error("check:deploy must run with NODE_ENV=production");
}

const { RUN_MIGRATIONS_ON_START } = require("./config");
const pool = require("./db");
const { uploadRoot } = require("./profileImageUpload");
const { STORAGE_PROVIDER } = require("./storageConfig");

async function preflight() {
  if (RUN_MIGRATIONS_ON_START) {
    throw new Error("RUN_MIGRATIONS_ON_START must be false in production");
  }

  let storageCheck;
  if (STORAGE_PROVIDER === "google_drive") {
    storageCheck = await require("./googleDriveStorage").getDriveStorage().checkFolder();
  } else {
    await fs.promises.access(uploadRoot, fs.constants.R_OK | fs.constants.W_OK);
    storageCheck = { upload_directory_writable: true };
  }

  const role = await pool.query(
    `SELECT current_user,
            (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS is_superuser,
            (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypasses_rls`,
  );
  if (role.rows[0]?.is_superuser) {
    throw new Error("DATABASE_URL uses a PostgreSQL superuser");
  }
  if (role.rows[0]?.bypasses_rls) {
    throw new Error("The runtime database role must not bypass row-level security");
  }

  const requiredTables = [
    "users",
    "user_details",
    "appointments",
    "appointment_slots",
    "queue_tickets",
    "medical_records",
    "audit_logs",
    "password_reset_otps",
    "hardware_otp_sessions",
    "hardware_measurement_events",
    "profile_image_cleanup",
  ];
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='clinic' AND table_name=ANY($1::text[])`,
    [requiredTables],
  );
  const foundTables = new Set(tables.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((name) => !foundTables.has(name));
  if (missingTables.length) throw new Error(`Missing database tables: ${missingTables.join(", ")}`);

  const rlsTables = [
    "appointments",
    "clinic_holidays",
    "help_requests",
    "medical_records",
    "queue_tickets",
    "user_details",
    "users",
  ];
  const rls = await pool.query(
    `SELECT c.relname AS table_name,
            c.relrowsecurity AS rls_enabled,
            EXISTS (
              SELECT 1
              FROM pg_policies p
              WHERE p.schemaname = 'clinic'
                AND p.tablename = c.relname
                AND p.policyname = 'cliniccare_runtime_backend_full_access'
                AND current_user = ANY (p.roles)
                AND p.cmd = 'ALL'
            ) AS runtime_policy
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'clinic'
       AND c.relname = ANY($1::text[])`,
    [rlsTables],
  );
  const rlsByTable = new Map(rls.rows.map((row) => [row.table_name, row]));
  const invalidRls = rlsTables.filter((name) => {
    const table = rlsByTable.get(name);
    return !table || !table.rls_enabled || !table.runtime_policy;
  });
  if (invalidRls.length) {
    throw new Error(`Missing enabled RLS or runtime policy on: ${invalidRls.join(", ")}`);
  }
  const column = await pool.query(`SELECT 1 FROM information_schema.columns
    WHERE table_schema='clinic' AND table_name='user_details' AND column_name='profile_image_drive_id'`);
  if (!column.rowCount) throw new Error("Missing profile_image_drive_id; run npm run migrate");
  if (STORAGE_PROVIDER === "google_drive" && process.env.SERVE_LEGACY_UPLOADS === "false") {
    const legacy = await pool.query(`SELECT 1 FROM clinic.user_details
      WHERE profile_image LIKE '/uploads/profiles/%' AND profile_image_drive_id IS NULL LIMIT 1`);
    if (legacy.rowCount) throw new Error("Local profile images still need migration before disabling legacy uploads");
  }

  const functions = await pool.query(
    `SELECT proname, position('placeholder' in pg_get_functiondef(oid)) > 0 AS placeholder
     FROM pg_proc
     WHERE pronamespace='clinic'::regnamespace
       AND proname=ANY($1::text[])`,
    [["seed_slots", "lock_timed_out_slots", "get_calendar_month"]],
  );
  if (functions.rowCount !== 3 || functions.rows.some((row) => row.placeholder)) {
    throw new Error("Calendar database functions are missing or still placeholders");
  }

  console.log(JSON.stringify({
    ok: true,
    database_role: role.rows[0].current_user,
    database_superuser: false,
    database_bypasses_rls: false,
    storage_provider: STORAGE_PROVIDER,
    ...storageCheck,
    required_tables: requiredTables.length,
    rls_tables: rlsTables.length,
    calendar_functions: functions.rowCount,
  }, null, 2));
}

preflight()
  .catch((error) => {
    console.error(`Deployment preflight failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
