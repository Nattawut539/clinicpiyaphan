const fs = require("fs");
const path = require("path");
const pool = require("./db");

async function ensureMeasurementAckOutbox() {
  const migrationPath = path.resolve(__dirname, "../../database/migrations.sql");
  const sql = fs.readFileSync(migrationPath, "utf8");
  // Startup must not execute unrelated migrations or change global runtime grants.
  const start = "-- BEGIN SECTION: measurement_ack_outbox";
  const end = "-- END SECTION: measurement_ack_outbox";
  if (sql.split(start).length !== 2 || sql.split(end).length !== 2 ||
      sql.indexOf(end) <= sql.indexOf(start)) {
    throw new Error("Missing or ambiguous measurement_ack_outbox section in database/migrations.sql");
  }
  const section = sql.slice(sql.indexOf(start) + start.length, sql.indexOf(end));
  await pool.query(`BEGIN;\n${section}\nCOMMIT;`);
}

module.exports = ensureMeasurementAckOutbox;
