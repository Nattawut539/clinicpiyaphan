const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../tools/hardwareTestCore");
const { assertLocalEnvironment } = require("../tools/hardwareTestCli");

const now = new Date("2026-09-16T00:00:00.000Z");

function acceptedFixture() {
  const state = core.createState();
  core.createAppointment(state, now);
  const otpResult = core.verifyTestOtp(state, {
    request_id: "REQ-TEST-001", device_id: core.DEVICE_ID, otp: core.TEST_OTP,
  }, core.DEVICE_ID, now);
  const payload = {
    schema_version: "1.0", message_id: "MSG-A-TEST-001", device_id: core.DEVICE_ID,
    mode: "online", measurement_session_id: otpResult.measurement_session_id,
    measured_at: now.toISOString(), weight: 63.5, height: 171.2,
  };
  const raw = JSON.stringify(payload);
  return { state, otpResult, payload, raw };
}

test("synthetic patient, approved A queue and reusable local OTP", () => {
  const state = core.createState();
  const appointment = core.createAppointment(state, now);
  assert.equal(appointment.queue_number, "A001");
  assert.equal(appointment.status, "approved");
  assert.equal(appointment.is_test, true);
  assert.equal(state.patient.is_test, true);
  assert.equal(core.makeTCommand(state, 63.5, 171.2), "T 999999 63.5 171.2");
  const result1 = core.verifyTestOtp(state, {
    request_id: "REQ-1", device_id: core.DEVICE_ID, otp: core.TEST_OTP,
  }, core.DEVICE_ID, now);
  const result2 = core.verifyTestOtp(state, {
    request_id: "REQ-2", device_id: core.DEVICE_ID, otp: core.TEST_OTP,
  }, core.DEVICE_ID, now);
  assert.equal(result1.status, "accepted");
  assert.equal(result2.status, "accepted");
  assert.notEqual(result1.measurement_session_id, result2.measurement_session_id);
  assert.equal(result1.queue_number, "A001");
  assert.equal(result1.is_test, true);
});

test("accepted online measurement, identical retry is duplicate with the same A queue", () => {
  const { state, payload, raw } = acceptedFixture();
  const first = core.processTestMeasurement(state, payload, raw, core.DEVICE_ID, now);
  const retry = core.processTestMeasurement(state, payload, raw, core.DEVICE_ID, now);
  assert.equal(first.ack.status, "accepted");
  assert.equal(first.ack.queue_number, "A001");
  assert.equal(first.print.queue_number, "A001");
  assert.equal(first.print.is_test, true);
  assert.equal(retry.ack.status, "duplicate");
  assert.equal(retry.ack.measurement_id, first.ack.measurement_id);
  assert.equal(retry.ack.queue_number, first.ack.queue_number);
  assert.equal(Object.keys(state.events).length, 1);
  assert.equal(state.appointments.length, 1);
  assert.equal(core.processTestPrintAck(state, {
    print_job_id: first.print.print_job_id, device_id: core.DEVICE_ID, status: "printed",
  }, core.DEVICE_ID), null);
  assert.equal(state.events[payload.message_id].print_status, "printed");
});

test("same message_id with changed payload is rejected without allocating a queue", () => {
  const { state, payload, raw } = acceptedFixture();
  core.processTestMeasurement(state, payload, raw, core.DEVICE_ID, now);
  const changed = { ...payload, weight: 64 };
  const result = core.processTestMeasurement(state, changed, JSON.stringify(changed), core.DEVICE_ID, now);
  assert.equal(result.ack.status, "rejected");
  assert.equal(result.ack.error_code, "MESSAGE_ID_CONFLICT");
  assert.equal(state.appointments.length, 1);
});

test("new test session reuses the patient and OTP, but creates a new A queue only after accepted", () => {
  const { state, payload, raw } = acceptedFixture();
  assert.throws(() => core.createNewTestSession(state, now), /not received/);
  core.processTestMeasurement(state, payload, raw, core.DEVICE_ID, now);
  const next = core.createNewTestSession(state, now);
  assert.equal(next.queue_number, "A002");
  assert.equal(next.patient_id, state.patient.patient_id);
  assert.equal(state.otp_active, true);
  assert.equal(state.appointments.length, 2);
});

test("OTP revoke invalidates current session and device/range guards reject bad input", () => {
  const { state, payload, raw } = acceptedFixture();
  const wrongDevice = core.verifyTestOtp(state, {
    request_id: "REQ-BAD", device_id: "OTHER", otp: core.TEST_OTP,
  }, core.DEVICE_ID, now);
  assert.equal(wrongDevice.error_code, "INVALID_DEVICE");
  assert.throws(() => core.makeTCommand(state, 39.9, 171.2), /Weight/);
  core.revokeTestOtp(state);
  assert.equal(core.verifyTestOtp(state, {
    request_id: "REQ-NEW", device_id: core.DEVICE_ID, otp: core.TEST_OTP,
  }, core.DEVICE_ID, now).error_code, "INVALID_OTP");
  assert.equal(core.processTestMeasurement(state, payload, raw, core.DEVICE_ID, now).ack.error_code, "INVALID_SESSION");
});

test("tool refuses production and any external/public MQTT endpoint", () => {
  assert.deepEqual(assertLocalEnvironment({}), { host: "127.0.0.1", port: 1883, url: "mqtt://127.0.0.1:1883" });
  assert.throws(() => assertLocalEnvironment({ NODE_ENV: "production" }), /Production/);
  assert.throws(() => assertLocalEnvironment({ RENDER: "true" }), /Render/);
  assert.throws(() => assertLocalEnvironment({ HARDWARE_TEST_ENV: "staging" }), /Only/);
  assert.throws(() => assertLocalEnvironment({ HARDWARE_TEST_MQTT_URL: "mqtts://cloud-intl.emqx.com:8883" }), /External/);
  assert.throws(() => assertLocalEnvironment({ HARDWARE_TEST_BIND_HOST: "203.158.200.12" }), /private LAN/);
  assert.deepEqual(assertLocalEnvironment({ HARDWARE_TEST_BIND_HOST: "192.168.1.20" }),
    { host: "192.168.1.20", port: 1883, url: "mqtt://192.168.1.20:1883" });
});
