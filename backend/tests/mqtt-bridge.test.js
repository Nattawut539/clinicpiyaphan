const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

process.env.MQTT_ENABLED = "true";
process.env.MQTT_URL = "mqtts://example.test:8883";
process.env.MQTT_CLIENT_ID = "clinic-backend-test";
process.env.MQTT_TOPIC_PREFIX = "clinic/v1";

const published = [];
const marked = [];
const failed = [];
let failNextPublish = false;
let pendingRows = [];
let resultStatus = "accepted";
let measurementError = null;

class FakeClient extends EventEmitter {
  subscribe(topics, options, callback) {
    callback(null, topics.map((topic) => ({ topic, qos: options.qos })));
  }

  publish(target, body, options, callback) {
    published.push({ target, body: JSON.parse(body), options });
    if (failNextPublish) {
      failNextPublish = false;
      callback(new Error("broker unavailable"));
    } else {
      callback(null);
    }
  }

  end(_force, _options, callback) { callback(); }
}

const fakeClient = new FakeClient();
function mockModule(filename, exports) {
  const id = require.resolve(filename);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

mockModule("mqtt", { connect: () => fakeClient });
mockModule("../services/hardwareMeasurementService", {
  HardwareMessageError: class HardwareMessageError extends Error {},
  processHardwareMeasurement: async (payload) => {
    if (measurementError) throw measurementError;
    return {
      message_id: payload.message_id,
      status: resultStatus,
      measurement_id: 57,
      queue_number: "B002",
      print_pending: true,
    };
  },
  processPrintAck: async () => {},
  verifyOnlineOtp: async () => {},
});
mockModule("../tools/measurementAckOutbox", {
  markPublished: async (id) => { marked.push(id); },
  pending: async () => pendingRows.splice(0),
  recordFailure: async (id, error) => { failed.push({ id, error: error.message }); },
});
mockModule("../tools/hardwareAudit", {
  safeRecordHardwareAudit: async () => {},
});
mockModule("../tools/hardwareMetrics", {
  increment: () => {},
  markConnected: () => {},
  markDisconnected: () => {},
  markMessage: () => {},
  runtimeSnapshot: () => ({ connectedAt: null, disconnectedAt: null, lastMessageAt: null, counters: {} }),
});
mockModule("../tools/printOutbox", {
  drain: async () => 0,
});

const bridge = require("../tools/mqttBridge");
bridge.startMqttBridge();
fakeClient.emit("connect");
assert.deepEqual(bridge.mqttStatus(), {
  enabled: true,
  connected: true,
  subscribed: true,
  connected_at: null,
  disconnected_at: null,
  last_message_at: null,
});

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for MQTT handler");
}

function send(messageId) {
  fakeClient.emit("message", "clinic/v1/devices/SCALE-001/measurements",
    Buffer.from(JSON.stringify({ message_id: messageId })), { retain: false });
}

test("publishes accepted ACK and marks outbox delivered", async () => {
  send("MSG-NEW");
  await waitFor(() => marked.includes("MSG-NEW"));
  const ack = published.find((item) => item.body.message_id === "MSG-NEW");
  assert.equal(ack.target, "clinic/v1/devices/SCALE-001/measurement-ack");
  assert.equal(ack.body.status, "accepted");
  assert.equal(ack.options.qos, 1);
  assert.equal(ack.options.retain, false);
});

test("does not falsely reject a persisted measurement when ACK publish fails", async () => {
  failNextPublish = true;
  send("MSG-PUBLISH-FAIL");
  await waitFor(() => failed.some((item) => item.id === "MSG-PUBLISH-FAIL"));
  assert.equal(published.filter((item) => item.body.message_id === "MSG-PUBLISH-FAIL").length, 1);
  assert.equal(marked.includes("MSG-PUBLISH-FAIL"), false);
});

test("maps PostgreSQL errors to INTERNAL_ERROR and returns schema diagnostics only in backend logs", async () => {
  const originalConsoleError = console.error;
  const errorLogs = [];
  console.error = (...args) => errorLogs.push(args);
  measurementError = Object.assign(
    new Error('null value in column "queue_id" of relation "hardware_measurement_events" violates not-null constraint'),
    { code: "23502", schema: "clinic", table: "hardware_measurement_events", column: "queue_id" },
  );
  try {
    send("MSG-DB-ERROR");
    await waitFor(() => published.some((item) => item.body.message_id === "MSG-DB-ERROR"));
    const ack = published.find((item) => item.body.message_id === "MSG-DB-ERROR");
    assert.equal(ack.body.status, "rejected");
    assert.equal(ack.body.error_code, "INTERNAL_ERROR");
    assert.equal(errorLogs[0][1].code, "23502");
    assert.equal(errorLogs[0][1].table, "hardware_measurement_events");
    assert.equal(errorLogs[0][1].column, "queue_id");
    assert.equal(errorLogs[0][1].public_error_code, "INTERNAL_ERROR");
  } finally {
    measurementError = null;
    console.error = originalConsoleError;
  }
});

test("replays pending ACK after reconnect", async () => {
  pendingRows = [{
    message_id: "MSG-REPLAY", device_id: "SCALE-001", attempts: 0,
    ack_payload: { message_id: "MSG-REPLAY", status: "accepted", queue_number: "B003" },
  }];
  fakeClient.emit("close");
  fakeClient.emit("connect");
  await waitFor(() => marked.includes("MSG-REPLAY"));
  const ack = published.find((item) => item.body.message_id === "MSG-REPLAY");
  assert.equal(ack.body.status, "accepted");
  await bridge.stopMqttBridge();
});
