const fs = require("fs");
const path = require("path");
const pool = require("./db");

async function ensureMeasurementAckOutbox() {
  const migrationPath = path.resolve(__dirname, "../../database/measurement_ack_outbox_migration.sql");
  const sql = fs.readFileSync(migrationPath, "utf8");
  await pool.query(sql);
}

module.exports = ensureMeasurementAckOutbox;
