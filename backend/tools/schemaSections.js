const fs = require('fs');
const path = require('path');

// Only explicitly marked, repeatable sections may run on an existing database.
function readSchemaSection(name) {
  if (!['measurement_ack_outbox', 'runtime_functions', 'runtime_grants', 'chat'].includes(name)) {
    throw new Error(`Unsupported schema section: ${name}`);
  }
  const sql = fs.readFileSync(path.resolve(__dirname, '../../database/schema.sql'), 'utf8');
  const start = `-- BEGIN SECTION: ${name}`;
  const end = `-- END SECTION: ${name}`;
  if (sql.split(start).length !== 2 || sql.split(end).length !== 2 ||
      sql.indexOf(end) <= sql.indexOf(start)) {
    throw new Error(`Missing or ambiguous ${name} section in database/schema.sql`);
  }
  return sql.slice(sql.indexOf(start) + start.length, sql.indexOf(end));
}

module.exports = { readSchemaSection };
