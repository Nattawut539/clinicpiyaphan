const fs = require("fs");
const mqtt = require("mqtt");
const ackOutbox = require("./measurementAckOutbox");
const {
  HardwareMessageError,
  processHardwareMeasurement,
  processPrintAck,
  verifyOnlineOtp,
} = require("../services/hardwareMeasurementService");

const enabled = process.env.MQTT_ENABLED === "true";
const topicPrefix = String(process.env.MQTT_TOPIC_PREFIX || "clinic/v1")
  .replace(/^\/+|\/+$/g, "");
const qos = Number(process.env.MQTT_QOS || 1) === 0 ? 0 : 1;
let client = null;
let connected = false;
let subscribed = false;
let drainTimer = null;
let draining = false;
const otpAttempts = new Map();

function log(event, details = {}) {
  console.log(event, { at: new Date().toISOString(), ...details });
}

async function drainMeasurementAcks() {
  if (!connected || !subscribed || draining) return;
  draining = true;
  try {
    for (const row of await ackOutbox.pending()) {
      if (!connected) break;
      const ackTopic = topic(row.device_id, "measurement-ack");
      try {
        await publishJson(ackTopic, row.ack_payload);
        log("MQTT measurement ACK replay published", {
          message_id: row.message_id, topic: ackTopic,
        });
        await ackOutbox.markPublished(row.message_id);
      } catch (error) {
        console.error("MQTT measurement ACK replay failed", {
          at: new Date().toISOString(), message_id: row.message_id,
          topic: ackTopic, error: error.message,
        });
        await ackOutbox.recordFailure(row.message_id, error, row.attempts);
        if (!connected) break;
      }
    }
  } catch (error) {
    console.error("MQTT measurement ACK outbox failed", {
      at: new Date().toISOString(), error: error.message,
    });
  } finally {
    draining = false;
  }
}

function topic(deviceId, suffix) {
  return `${topicPrefix}/devices/${deviceId}/${suffix}`;
}

function publishJson(target, body) {
  return new Promise((resolve, reject) => {
    if (!client || !connected) {
      const error = new Error("MQTT broker is unavailable");
      error.code = "MQTT_UNAVAILABLE";
      return reject(error);
    }
    client.publish(target, JSON.stringify(body), { qos, retain: false }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function parseTopic(value) {
  const parts = String(value).split("/");
  const prefixParts = topicPrefix.split("/");
  if (parts.length !== prefixParts.length + 3) return null;
  if (prefixParts.some((part, index) => parts[index] !== part)) return null;
  if (parts[prefixParts.length] !== "devices") return null;
  return {
    deviceId: parts[prefixParts.length + 1],
    action: parts[prefixParts.length + 2],
  };
}

function parseJson(buffer) {
  if (buffer.length > 16 * 1024) {
    throw new HardwareMessageError("PAYLOAD_TOO_LARGE", "Payload exceeds 16 KB");
  }
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new HardwareMessageError("INVALID_JSON", "Payload must be valid JSON");
  }
}

function enforceOtpRateLimit(deviceId) {
  const now = Date.now();
  const windowStart = now - 60 * 1000;
  const recent = (otpAttempts.get(deviceId) || []).filter((timestamp) => timestamp > windowStart);
  if (recent.length >= 10) {
    throw new HardwareMessageError("RATE_LIMITED", "Too many OTP attempts; retry later");
  }
  recent.push(now);
  otpAttempts.set(deviceId, recent);
}

async function handleMessage(receivedTopic, buffer, packet) {
  const route = parseTopic(receivedTopic);
  if (!route) return;
  let payload = {};
  try {
    payload = parseJson(buffer);
    if (packet?.retain && route.action === "measurements") {
      throw new HardwareMessageError("RETAIN_NOT_ALLOWED", "Measurement messages must not be retained");
    }

    if (route.action === "otp-verify") {
      enforceOtpRateLimit(route.deviceId);
      const result = await verifyOnlineOtp(payload, route.deviceId);
      await publishJson(topic(route.deviceId, "otp-result"), result);
      return;
    }
    if (route.action === "measurements") {
      log("MQTT measurement received", {
        topic: receivedTopic, device_id: route.deviceId,
        message_id: payload?.message_id || null,
      });
      const result = await processHardwareMeasurement(payload, route.deviceId);
      log("MQTT measurement processed", {
        message_id: result.message_id, status: result.status,
        measurement_id: result.measurement_id,
        queue_number: result.queue_number,
      });
      const ackTopic = topic(route.deviceId, "measurement-ack");
      try {
        await publishJson(ackTopic, result);
      } catch (error) {
        console.error("MQTT measurement ACK publish failed", {
          at: new Date().toISOString(), message_id: result.message_id,
          topic: ackTopic, error: error.message,
        });
        await ackOutbox.recordFailure(result.message_id, error).catch((outboxError) => {
          console.error("MQTT measurement ACK outbox update failed", outboxError.message);
        });
        return;
      }
      log("MQTT measurement ACK published", {
        message_id: result.message_id, status: result.status, topic: ackTopic,
      });
      await ackOutbox.markPublished(result.message_id).catch((error) => {
        console.error("MQTT measurement ACK outbox update failed", {
          at: new Date().toISOString(), message_id: result.message_id,
          error: error.message,
        });
      });
      return;
    }
    if (route.action === "print-ack") {
      await processPrintAck(payload, route.deviceId);
    }
  } catch (error) {
    const code = error?.code || "INTERNAL_ERROR";
    console.error("MQTT hardware message rejected", {
      at: new Date().toISOString(),
      topic: receivedTopic,
      device_id: route.deviceId,
      message_id: payload?.message_id || null,
      code,
      message: error?.message,
    });
    if (route.action === "otp-verify") {
      await publishJson(topic(route.deviceId, "otp-result"), {
        request_id: payload?.request_id || null,
        status: "rejected",
        error_code: code,
      }).catch(() => {});
    } else if (route.action === "measurements") {
      const ackTopic = topic(route.deviceId, "measurement-ack");
      await publishJson(ackTopic, {
        message_id: payload?.message_id || null,
        status: "rejected",
        error_code: code,
      }).then(() => log("MQTT measurement ACK published", {
        message_id: payload?.message_id || null, status: "rejected", topic: ackTopic,
      })).catch((publishError) => {
        console.error("MQTT measurement ACK publish failed", {
          at: new Date().toISOString(), message_id: payload?.message_id || null,
          topic: ackTopic, error: publishError.message,
        });
      });
    }
  }
}

function startMqttBridge() {
  if (!enabled) {
    console.log("MQTT hardware bridge is disabled");
    return;
  }
  const url = String(process.env.MQTT_URL || "").trim();
  if (!url) throw new Error("MQTT_URL is required when MQTT_ENABLED=true");
  if (process.env.NODE_ENV === "production" && !url.startsWith("mqtts://")) {
    throw new Error("MQTT_URL must use mqtts:// in production");
  }

  const options = {
    clientId: process.env.MQTT_CLIENT_ID || "clinic-backend",
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    clean: false,
    reconnectPeriod: Number(process.env.MQTT_RECONNECT_PERIOD_MS || 5000),
    rejectUnauthorized: process.env.MQTT_REJECT_UNAUTHORIZED !== "false",
  };
  if (process.env.MQTT_CA_FILE) options.ca = fs.readFileSync(process.env.MQTT_CA_FILE);
  if (process.env.MQTT_CERT_FILE) options.cert = fs.readFileSync(process.env.MQTT_CERT_FILE);
  if (process.env.MQTT_KEY_FILE) options.key = fs.readFileSync(process.env.MQTT_KEY_FILE);

  const hasPasswordAuth = Boolean(options.username && options.password);
  const hasCertificateAuth = Boolean(options.cert && options.key);
  if (Boolean(options.username) !== Boolean(options.password)) {
    throw new Error("MQTT_USERNAME and MQTT_PASSWORD must be configured together");
  }
  if (Boolean(options.cert) !== Boolean(options.key)) {
    throw new Error("MQTT_CERT_FILE and MQTT_KEY_FILE must be configured together");
  }
  if (process.env.NODE_ENV === "production" && !hasPasswordAuth && !hasCertificateAuth) {
    throw new Error("MQTT authentication is required in production");
  }

  client = mqtt.connect(url, options);
  client.on("connect", () => {
    connected = true;
    subscribed = false;
    log("MQTT hardware bridge connected", { client_id: options.clientId });
    const subscriptions = [
      `${topicPrefix}/devices/+/otp-verify`,
      `${topicPrefix}/devices/+/measurements`,
      `${topicPrefix}/devices/+/print-ack`,
    ];
    client.subscribe(subscriptions, { qos }, (error, granted) => {
      if (error || granted?.some((entry) => entry.qos !== qos)) {
        console.error("MQTT subscription failed", error?.message || "Broker did not grant requested QoS");
      } else {
        subscribed = true;
        console.log(`MQTT hardware bridge subscribed to ${topicPrefix}/devices/+`);
        log("MQTT hardware bridge subscriptions ready", {
          topics: granted?.map((entry) => ({ topic: entry.topic, qos: entry.qos })) || subscriptions,
        });
        void drainMeasurementAcks();
      }
    });
  });
  client.on("reconnect", () => {
    connected = false;
    subscribed = false;
    log("MQTT hardware bridge reconnecting", { client_id: options.clientId });
  });
  client.on("close", () => {
    connected = false;
    subscribed = false;
    log("MQTT hardware bridge disconnected", { client_id: options.clientId });
  });
  client.on("offline", () => {
    connected = false;
    subscribed = false;
    log("MQTT hardware bridge offline", { client_id: options.clientId });
  });
  client.on("error", (error) => console.error("MQTT broker error", error.message));
  client.on("message", (receivedTopic, buffer, packet) => {
    handleMessage(receivedTopic, buffer, packet).catch((error) => {
      console.error("MQTT message handler failed", error.message);
    });
  });
  drainTimer = setInterval(() => { void drainMeasurementAcks(); }, 5000);
  drainTimer.unref?.();
}

async function stopMqttBridge() {
  if (drainTimer) clearInterval(drainTimer);
  drainTimer = null;
  if (!client) return;
  await new Promise((resolve) => client.end(false, {}, resolve));
  client = null;
  connected = false;
  subscribed = false;
}

function mqttStatus() {
  return { enabled, connected, subscribed };
}

module.exports = {
  mqttStatus,
  publishJson,
  startMqttBridge,
  stopMqttBridge,
  topic,
};
