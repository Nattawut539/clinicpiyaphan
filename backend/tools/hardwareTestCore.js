const { createHash, randomUUID } = require("node:crypto");

const DEVICE_ID = "SCALE-001";
const TEST_OTP = "999999";
const TOPIC_PREFIX = "clinic/v1/devices/SCALE-001";
const WEIGHT_RANGE = [40, 120];
const HEIGHT_RANGE = [140, 190];

function createState() {
  return {
    version: 1,
    environment: "local",
    is_test: true,
    otp_active: false,
    patient: null,
    appointments: [],
    sessions: {},
    events: {},
    results: [],
    next_queue_no: 1,
    next_measurement_id: 1,
  };
}

function assertTestState(state) {
  if (!state || state.version !== 1 || state.environment !== "local" || state.is_test !== true ||
      !Array.isArray(state.appointments) || !state.sessions || !state.events || !Array.isArray(state.results)) {
    throw new Error("Hardware test store is invalid; refusing to use it");
  }
  return state;
}

function bangkokDate(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

function activeAppointment(state) {
  return state.appointments.find((item) => item.queue_number === state.active_queue_number) || null;
}

function createAppointment(state, now = new Date()) {
  assertTestState(state);
  if (!state.patient) {
    state.patient = {
      patient_id: "TEST-PATIENT-001", first_name: "Test", last_name: "Patient",
      is_test: true, created_at: now.toISOString(),
    };
  }
  if (state.next_queue_no > 999) throw new Error("Test queue numbers are exhausted; clear test data first");
  const queueNumber = `A${String(state.next_queue_no++).padStart(3, "0")}`;
  const appointment = {
    appointment_id: `TEST-APPT-${queueNumber}`,
    patient_id: state.patient.patient_id,
    status: "approved",
    queue_number: queueNumber,
    queue_status: "waiting",
    service_date: bangkokDate(now),
    device_id: DEVICE_ID,
    is_test: true,
    created_at: now.toISOString(),
  };
  state.appointments.push(appointment);
  state.active_queue_number = queueNumber;
  state.otp_active = true;
  return appointment;
}

function createNewTestSession(state, now = new Date()) {
  const active = activeAppointment(assertTestState(state));
  if (active && active.queue_status !== "measured") {
    throw new Error("Current A queue has not received an accepted measurement yet");
  }
  return createAppointment(state, now);
}

function revokeTestOtp(state) {
  assertTestState(state);
  state.otp_active = false;
  state.sessions = {};
}

function recordResult(state, topic, body, now = new Date()) {
  state.results.push({ at: now.toISOString(), topic, body, is_test: true });
  if (state.results.length > 200) state.results.splice(0, state.results.length - 200);
}

function reject(body, code, idField, id) {
  return { [idField]: id || null, status: "rejected", error_code: code, is_test: true };
}

function verifyTestOtp(state, payload, topicDeviceId, now = new Date()) {
  assertTestState(state);
  const requestId = String(payload?.request_id || "").trim();
  if (!requestId || requestId.length > 100) return reject(payload, "INVALID_REQUEST_ID", "request_id", requestId);
  if (topicDeviceId !== DEVICE_ID || payload?.device_id !== DEVICE_ID) {
    return reject(payload, "INVALID_DEVICE", "request_id", requestId);
  }
  if (!state.otp_active || payload?.otp !== TEST_OTP) {
    return reject(payload, "INVALID_OTP", "request_id", requestId);
  }
  const appointment = activeAppointment(state);
  if (!appointment || appointment.queue_status !== "waiting" || appointment.status !== "approved") {
    return reject(payload, "NO_ACTIVE_TEST_SESSION", "request_id", requestId);
  }
  const id = randomUUID();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  state.sessions[id] = {
    session_id: id, queue_number: appointment.queue_number,
    device_id: DEVICE_ID, expires_at: expiresAt, used_at: null, is_test: true,
  };
  return {
    request_id: requestId, status: "accepted", measurement_session_id: id,
    queue_number: appointment.queue_number, expires_at: expiresAt, is_test: true,
  };
}

function validNumber(value, [min, max]) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function processTestMeasurement(state, payload, rawPayload, topicDeviceId, now = new Date(), retain = false) {
  assertTestState(state);
  const messageId = String(payload?.message_id || "").trim();
  if (!messageId || messageId.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(messageId)) {
    return { ack: reject(payload, "INVALID_MESSAGE_ID", "message_id", messageId) };
  }
  if (retain) return { ack: reject(payload, "RETAIN_NOT_ALLOWED", "message_id", messageId) };
  const previous = state.events[messageId];
  if (previous) {
    if (previous.raw_payload !== rawPayload) {
      return { ack: reject(payload, "MESSAGE_ID_CONFLICT", "message_id", messageId) };
    }
    return {
      ack: {
        message_id: messageId, status: "duplicate", measurement_id: previous.measurement_id,
        queue_number: previous.queue_number, print_pending: previous.print_status !== "printed",
        is_test: true,
      },
    };
  }
  if (topicDeviceId !== DEVICE_ID || payload?.device_id !== DEVICE_ID) {
    return { ack: reject(payload, "INVALID_DEVICE", "message_id", messageId) };
  }
  if (payload?.mode !== "online") return { ack: reject(payload, "INVALID_MODE", "message_id", messageId) };
  if (!validNumber(payload?.weight, WEIGHT_RANGE) || !validNumber(payload?.height, HEIGHT_RANGE)) {
    return { ack: reject(payload, "MEASUREMENT_OUT_OF_RANGE", "message_id", messageId) };
  }
  const measuredAt = new Date(payload?.measured_at);
  if (!payload?.measured_at || Number.isNaN(measuredAt.getTime()) || measuredAt.getTime() > now.getTime() + 5 * 60 * 1000) {
    return { ack: reject(payload, "INVALID_MEASURED_AT", "message_id", messageId) };
  }
  const session = state.sessions[String(payload?.measurement_session_id || "")];
  const appointment = activeAppointment(state);
  if (!state.otp_active || !session || session.used_at || new Date(session.expires_at) <= now ||
      session.device_id !== DEVICE_ID || session.queue_number !== appointment?.queue_number ||
      appointment.queue_status !== "waiting") {
    return { ack: reject(payload, "INVALID_SESSION", "message_id", messageId) };
  }
  const measurementId = state.next_measurement_id++;
  const bmi = Number((payload.weight / ((payload.height / 100) ** 2)).toFixed(2));
  const printJobId = `PRINT-TEST-${createHash("sha256").update(messageId).digest("hex").slice(0, 16)}`;
  const event = {
    message_id: messageId, raw_payload: rawPayload,
    measurement_id: measurementId, queue_number: session.queue_number,
    print_job_id: printJobId, print_status: "pending",
    weight: payload.weight, height: payload.height, bmi,
    measured_at: measuredAt.toISOString(), is_test: true,
  };
  state.events[messageId] = event;
  session.used_at = now.toISOString();
  appointment.queue_status = "measured";
  return {
    ack: {
      message_id: messageId, status: "accepted", measurement_id: measurementId,
      queue_number: event.queue_number, print_pending: true, is_test: true,
    },
    print: {
      schema_version: "1.0", print_job_id: printJobId, message_id: messageId,
      queue_number: event.queue_number, weight: event.weight, height: event.height,
      bmi, measured_at: event.measured_at, is_test: true,
    },
  };
}

function processTestPrintAck(state, payload, topicDeviceId) {
  assertTestState(state);
  if (topicDeviceId !== DEVICE_ID || payload?.device_id !== DEVICE_ID) return "INVALID_DEVICE";
  const event = Object.values(state.events).find((item) => item.print_job_id === payload?.print_job_id);
  if (!event) return "PRINT_JOB_NOT_FOUND";
  if (payload?.status !== "printed" && payload?.status !== "failed") return "INVALID_PRINT_STATUS";
  event.print_status = payload.status;
  event.print_error_code = payload.status === "failed" ? String(payload.error_code || "UNKNOWN") : null;
  return null;
}

function makeTCommand(state, weight, height) {
  assertTestState(state);
  if (!state.otp_active || !activeAppointment(state)) throw new Error("Create test data and activate the Test OTP first");
  if (!validNumber(weight, WEIGHT_RANGE) || !validNumber(height, HEIGHT_RANGE)) {
    throw new Error("Weight must be 40–120 kg and height must be 140–190 cm");
  }
  return `T ${TEST_OTP} ${weight} ${height}`;
}

module.exports = {
  DEVICE_ID, TEST_OTP, TOPIC_PREFIX, WEIGHT_RANGE, HEIGHT_RANGE,
  createState, assertTestState, activeAppointment, createAppointment,
  createNewTestSession, revokeTestOtp, recordResult,
  verifyTestOtp, processTestMeasurement, processTestPrintAck, makeTCommand,
};
