const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

if (process.env.NODE_ENV !== "production") {
  throw new Error("check:deploy must run with NODE_ENV=production");
}

const { RUN_MIGRATIONS_ON_START } = require("./config");
const pool = require("./db");
const { uploadRoot } = require("./profileImageUpload");

async function preflight() {
  if (RUN_MIGRATIONS_ON_START) {
    throw new Error("RUN_MIGRATIONS_ON_START must be false in production");
  }

  await fs.promises.access(uploadRoot, fs.constants.R_OK | fs.constants.W_OK);

  const role = await pool.query(
    `SELECT current_user,
            (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS is_superuser`,
  );
  if (role.rows[0]?.is_superuser) {
    throw new Error("DATABASE_URL uses a PostgreSQL superuser");
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
  ];
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='clinic' AND table_name=ANY($1::text[])`,
    [requiredTables],
  );
  const foundTables = new Set(tables.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((name) => !foundTables.has(name));
  if (missingTables.length) throw new Error(`Missing database tables: ${missingTables.join(", ")}`);

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
    upload_directory_writable: true,
    required_tables: requiredTables.length,
    calendar_functions: functions.rowCount,
  }, null, 2));
}

preflight()
  .catch((error) => {
    console.error(`Deployment preflight failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
