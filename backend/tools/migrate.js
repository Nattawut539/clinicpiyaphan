const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

// A schema owner can be used for the one-off migration while the API keeps a
// least-privilege runtime connection in DATABASE_URL.
if (process.env.MIGRATION_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
}

const ensureQueueSchema = require("./ensureQueueSchema");
const ensureAdvisorRequirementsSchema = require("./ensureAdvisorRequirementsSchema");
const { ensureAuditSchema } = require("./audit");
const pool = require("./db");
const ensureProfileImageSchema = require("./ensureProfileImageSchema");
const ensureMeasurementAckOutbox = require("./ensureMeasurementAckOutbox");
const { readSchemaSection } = require("./schemaSections");

async function migrate() {
  await ensureQueueSchema();
  await ensureAdvisorRequirementsSchema();
  await ensureAuditSchema();
  await ensureProfileImageSchema();
  await ensureMeasurementAckOutbox();
  // Explicit owner-run migration only: never execute the full new-install schema.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(readSchemaSection("runtime_functions"));
    await client.query(readSchemaSection("runtime_grants"));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  console.log("Database migrations completed");
}

migrate()
  .catch((error) => {
    console.error("Database migration failed:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
