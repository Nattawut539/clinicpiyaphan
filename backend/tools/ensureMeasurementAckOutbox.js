const pool = require("./db");
const { readSchemaSection } = require("./schemaSections");

async function ensureMeasurementAckOutbox() {
  // Startup must not execute unrelated migrations or change global runtime grants.
  const section = readSchemaSection("measurement_ack_outbox");
  await pool.query(`BEGIN;\n${section}\nCOMMIT;`);
}

module.exports = ensureMeasurementAckOutbox;
