const pool = require('./db');
const { readSchemaSection } = require('./schemaSections');
module.exports = async function ensureChatSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(readSchemaSection('chat'));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
};
