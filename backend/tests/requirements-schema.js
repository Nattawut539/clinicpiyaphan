const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const ensureQueueSchema = require("../tools/ensureQueueSchema");
const ensureAdvisorRequirementsSchema = require("../tools/ensureAdvisorRequirementsSchema");
const pool = require("../tools/db");

async function main() {
  await ensureQueueSchema();
  await ensureAdvisorRequirementsSchema();

  const requiredUserColumns = [
    "account_status",
    "email_verified_at",
    "profile_completed_at",
    "registration_source",
    "status_reason",
    "status_changed_at",
    "status_changed_by",
    "deactivated_at",
    "last_login_at",
    "session_version",
  ];
  const columns = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'clinic' AND table_name = 'users'
       AND column_name = ANY($1::text[])`,
    [requiredUserColumns],
  );
  const found = new Set(columns.rows.map((row) => row.column_name));
  const missing = requiredUserColumns.filter((column) => !found.has(column));
  if (missing.length) throw new Error(`Missing clinic.users columns: ${missing.join(", ")}`);

  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'clinic'
       AND table_name = ANY($1::text[])`,
    [["email_verification_otps", "patient_checkins"]],
  );
  const foundTables = new Set(tables.rows.map((row) => row.table_name));
  for (const table of ["email_verification_otps", "patient_checkins"]) {
    if (!foundTables.has(table)) throw new Error(`Missing clinic.${table}`);
  }

  console.log(JSON.stringify({
    ok: true,
    user_columns: requiredUserColumns,
    tables: [...foundTables].sort(),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
