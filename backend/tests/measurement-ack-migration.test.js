const test = require('node:test');
const assert = require('node:assert/strict');

const queries = [];
require.cache[require.resolve('../tools/db')] = {
  exports: { query: async (sql) => queries.push(sql) },
};
const ensureMeasurementAckOutbox = require('../tools/ensureMeasurementAckOutbox');

test('startup reads only ACK SQL from schema without running new-install DDL or global grants', async () => {
  await ensureMeasurementAckOutbox();
  assert.equal(queries.length, 1);
  const sql = queries[0];
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS clinic\.hardware_measurement_ack_outbox/);
  assert.match(sql, /hardware_measurement_ack_outbox_pending_idx/);
  assert.match(sql, /WHERE rolname = 'cliniccare_runtime'/);
  assert.match(sql, /COMMIT;$/);
  assert.doesNotMatch(sql, /ALTER DEFAULT PRIVILEGES|GRANT CONNECT|clinic\.users|print_retryable|seed_slots/);
});
