const assert = require("node:assert/strict");
const test = require("node:test");

const queries = [];
const fakePool = {
  async query(sql, params = []) {
    queries.push({ sql: String(sql), params });
    if (String(sql).includes("INSERT INTO clinic.hardware_event_audit")) return { rowCount: 1, rows: [] };
    if (String(sql).includes("measurement_ack_backlog")) {
      return {
        rowCount: 1,
        rows: [{
          measurement_ack_backlog: 2,
          print_outbox_backlog: 3,
          ack_latency_avg_ms: "125.50",
          print_failure_rate_percent: "10.00",
        }],
      };
    }
    throw new Error(`Unexpected SQL: ${String(sql).slice(0, 80)}`);
  },
};

function mockModule(filename, exports) {
  const id = require.resolve(filename);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

mockModule("../tools/db", fakePool);
const { recordHardwareAudit } = require("../tools/hardwareAudit");
const hardwareMetrics = require("../tools/hardwareMetrics");

test("hardware audit stores all correlation identifiers", async () => {
  queries.length = 0;
  await recordHardwareAudit("measurement", {
    result: "accepted",
    deviceId: "SCALE-001",
    requestId: "REQ-001",
    measurementSessionId: "00000000-0000-4000-8000-000000000001",
    messageId: "MSG-001",
    printJobId: "PRINT-001",
    actorUserId: 42,
  });
  const insert = queries[0];
  assert.equal(insert.params[3], "REQ-001");
  assert.equal(insert.params[4], "00000000-0000-4000-8000-000000000001");
  assert.equal(insert.params[5], "MSG-001");
  assert.equal(insert.params[6], "PRINT-001");
  assert.equal(insert.params[7], 42);
});

test("hardware health reports MQTT, outbox, latency and failure rate", async () => {
  hardwareMetrics.increment("measurement_accepted_total");
  const snapshot = await hardwareMetrics.operationalSnapshot({ connected: true, subscribed: true });
  assert.equal(snapshot.mqtt.connected, true);
  assert.equal(snapshot.outbox.measurement_ack_backlog, 2);
  assert.equal(snapshot.outbox.print_backlog, 3);
  assert.equal(snapshot.latency.measurement_ack_average_ms, 125.5);
  assert.equal(snapshot.failure_rate.print_percent_last_hour, 10);
  assert.equal(snapshot.runtime.counters.measurement_accepted_total, 1);
});
