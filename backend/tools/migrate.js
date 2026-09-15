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

async function migrate() {
  await ensureQueueSchema();
  await ensureAdvisorRequirementsSchema();
  await ensureAuditSchema();
  await ensureProfileImageSchema();
  await ensureMeasurementAckOutbox();
  console.log("Database migrations completed");
}

migrate()
  .catch((error) => {
    console.error("Database migration failed:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
