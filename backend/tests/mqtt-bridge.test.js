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
  processHardwareMeasurement: async (payload) => ({
    message_id: payload.message_id,
    status: resultStatus,
    measurement_id: 57,
    queue_number: "B002",
    print_pending: true,
  }),
  processPrintAck: async () => {},
  verifyOnlineOtp: async () => {},
});
mockModule("../tools/measurementAckOutbox", {
  markPublished: async (id) => { marked.push(id); },
  pending: async () => pendingRows.splice(0),
  recordFailure: async (id, error) => { failed.push({ id, error: error.message }); },
});

const bridge = require("../tools/mqttBridge");
bridge.startMqttBridge();
fakeClient.emit("connect");
assert.deepEqual(bridge.mqttStatus(), { enabled: true, connected: true, subscribed: true });

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
