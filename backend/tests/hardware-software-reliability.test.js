const assert = require("node:assert/strict");
const test = require("node:test");

const queries = [];
const poolQueries = [];
let otpRow = null;

const client = {
  async query(sql, params = []) {
    queries.push({ sql: String(sql), params });
    if (String(sql).includes("FROM clinic.appointment_access_codes ac") &&
        String(sql).includes("WHERE ac.code_hash")) {
      return otpRow ? { rowCount: 1, rows: [otpRow] } : { rowCount: 0, rows: [] };
    }
    if (String(sql).includes("FROM clinic.hardware_measurement_events e") &&
        String(sql).includes("WHERE e.message_id")) {
      return {
        rowCount: 1,
        rows: [{
          message_id: "MSG-A-RETRY-001",
          device_id: "SCALE-001",
          measurement_id: 67,
          queue_number: "A002",
        }],
      };
    }
    if (String(sql).includes("INSERT INTO clinic.hardware_otp_sessions")) {
      return { rowCount: 1, rows: [{ expires_at: new Date(Date.now() + 5 * 60_000) }] };
    }
    return { rowCount: 0, rows: [] };
  },
  release() {},
};

const fakePool = {
  async connect() { return client; },
  async query(sql, params = []) {
    poolQueries.push({ sql: String(sql), params });
    if (String(sql).includes("UPDATE clinic.hardware_measurement_events")) {
      return {
        rowCount: 1,
        rows: [{
          message_id: "MSG-PRINT-001",
          print_attempts: 1,
          print_retryable: params[2],
          print_next_attempt_at: params[2] ? new Date() : null,
        }],
      };
    }
    throw new Error("Unexpected pool.query in this test");
  },
};

function mockModule(filename, exports) {
  const id = require.resolve(filename);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

mockModule("../tools/db", fakePool);
mockModule("../tools/config", { JWT_SECRET: "hardware-reliability-test-secret" });
const service = require("../services/hardwareMeasurementService");

async function expectOtpError(row, code) {
  otpRow = row;
  queries.length = 0;
  await assert.rejects(
    service.verifyOnlineOtp({
      request_id: `REQ-${code}`,
      device_id: "SCALE-001",
      otp: "123456",
    }, "SCALE-001"),
    (error) => error.code === code,
  );
  assert.equal(queries.some((entry) => /^\s*INSERT\s/i.test(entry.sql)), false);
}

test("OTP errors distinguish used, future and expired codes", async () => {
  const base = {
    access_code_id: 1,
    queue_id: 2,
    expires_at: new Date(Date.now() + 60_000),
    queue_number: "A002",
    prefix: "A",
    queue_status: "waiting",
    appointment_status: "approved",
    used_at: null,
    is_expired: false,
    service_date_passed: false,
    not_active_yet: false,
  };
  await expectOtpError({ ...base, used_at: new Date() }, "OTP_USED");
  await expectOtpError({ ...base, not_active_yet: true }, "OTP_NOT_ACTIVE_YET");
  await expectOtpError({ ...base, is_expired: true }, "OTP_EXPIRED");
  await expectOtpError({ ...base, service_date_passed: true }, "OTP_EXPIRED");
  await expectOtpError(null, "INVALID_OTP");
});

test("active OTP still returns accepted A002 session", async () => {
  otpRow = {
    access_code_id: 1,
    queue_id: 2,
    expires_at: new Date(Date.now() + 15 * 60_000),
    queue_number: "A002",
    prefix: "A",
    queue_status: "waiting",
    appointment_status: "approved",
    used_at: null,
    is_expired: false,
    service_date_passed: false,
    not_active_yet: false,
  };
  const result = await service.verifyOnlineOtp({
    request_id: "REQ-ACTIVE",
    device_id: "SCALE-001",
    otp: "123456",
  }, "SCALE-001");
  assert.equal(result.status, "accepted");
  assert.equal(result.queue_number, "A002");
  assert.match(result.measurement_session_id, /^[0-9a-f-]{36}$/);
});

test("same device/message retry returns one duplicate measurement tied to A002", async () => {
  otpRow = null;
  queries.length = 0;
  const result = await service.processHardwareMeasurement({
    schema_version: "1.0",
    message_id: "MSG-A-RETRY-001",
    device_id: "SCALE-001",
    mode: "online",
    measurement_session_id: "00000000-0000-4000-8000-000000000000",
    measured_at: new Date().toISOString(),
    weight: 60,
    height: 170,
  }, "SCALE-001");

  assert.deepEqual(result, {
    message_id: "MSG-A-RETRY-001",
    status: "duplicate",
    measurement_id: 67,
    queue_number: "A002",
    print_pending: true,
  });
  assert.equal(queries.filter((entry) => /INSERT INTO clinic\.measurements/i.test(entry.sql)).length, 0);
  assert.equal(queries.some((entry) =>
    entry.sql.includes("pg_advisory_xact_lock") && entry.params[0] === "hardware:MSG-A-RETRY-001"), true);
});

test("print ACK stops terminal failure and schedules transient failure", async () => {
  poolQueries.length = 0;
  const terminal = await service.processPrintAck({
    print_job_id: "PRINT-001",
    device_id: "SCALE-001",
    status: "failed",
    error_code: "PRINTER_NOT_CONNECTED",
  }, "SCALE-001");
  assert.equal(terminal.retryable, false);
  assert.equal(poolQueries.at(-1).params[2], false);

  const transient = await service.processPrintAck({
    print_job_id: "PRINT-002",
    device_id: "SCALE-001",
    status: "failed",
    error_code: "PAPER_OUT",
  }, "SCALE-001");
  assert.equal(transient.retryable, true);
  assert.equal(poolQueries.at(-1).params[2], true);
});
