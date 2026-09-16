const assert = require("node:assert/strict");
const test = require("node:test");

const queries = [];
const fakePool = {
  async query(sql, params = []) {
    const text = String(sql);
    queries.push({ sql: text, params });
    if (text.includes("SELECT message_id") && text.includes("print_next_attempt_at")) {
      return { rows: [{ message_id: "MSG-A-PRINT-001" }] };
    }
    if (text.includes("WITH measurement_data AS")) {
      return {
        rows: [{
          message_id: "MSG-A-PRINT-001",
          device_id: "SCALE-001",
          print_job_id: "PRINT-TEST-001",
          print_attempts: 2,
          print_next_attempt_at: new Date(Date.now() + 60_000),
          weight: "60.00",
          height: "170.00",
          bmi: "20.76",
          measured_at: new Date("2026-09-16T02:00:00.000Z"),
          queue_number: "A002",
        }],
      };
    }
    if (text.includes("SET print_status = 'failed'")) return { rowCount: 1, rows: [] };
    throw new Error(`Unexpected SQL: ${text.slice(0, 80)}`);
  },
};

function mockModule(filename, exports) {
  const id = require.resolve(filename);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

mockModule("../tools/db", fakePool);
const printOutbox = require("../tools/printOutbox");

test("backend drains a due print retry with the same job and A queue", async () => {
  queries.length = 0;
  const published = [];
  const count = await printOutbox.drain(
    async (target, body) => { published.push({ target, body }); },
    (deviceId, suffix) => `clinic/v1/devices/${deviceId}/${suffix}`,
  );

  assert.equal(count, 1);
  assert.equal(published.length, 1);
  assert.equal(published[0].target, "clinic/v1/devices/SCALE-001/print");
  assert.equal(published[0].body.print_job_id, "PRINT-TEST-001");
  assert.equal(published[0].body.queue_number, "A002");
  assert.equal(published[0].body.bmi, 20.76);
  const claim = queries.find((entry) => entry.sql.includes("WITH measurement_data AS"));
  assert.equal(claim.params[6], false);
});

test("publish failure is persisted for bounded retry", async () => {
  queries.length = 0;
  const row = await printOutbox.claim("MSG-A-PRINT-001");
  await assert.rejects(
    printOutbox.publishClaim(
      row,
      async () => { const error = new Error("offline"); error.code = "MQTT_UNAVAILABLE"; throw error; },
      (deviceId, suffix) => `clinic/v1/devices/${deviceId}/${suffix}`,
    ),
    /offline/,
  );
  const failure = queries.find((entry) => entry.sql.includes("SET print_status = 'failed'"));
  assert.equal(failure.params[0], "MSG-A-PRINT-001");
  assert.equal(failure.params[1], "MQTT_UNAVAILABLE");
  assert.equal(failure.params[2], 3);
});
