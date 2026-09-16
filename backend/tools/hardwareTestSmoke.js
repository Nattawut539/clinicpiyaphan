#!/usr/bin/env node
const mqtt = require("mqtt");
const { randomUUID } = require("node:crypto");
const { assertLocalEnvironment } = require("./hardwareTestCli");
const { TEST_OTP, DEVICE_ID, TOPIC_PREFIX } = require("./hardwareTestCore");

async function main() {
  const { url } = assertLocalEnvironment();
  const client = mqtt.connect(url, { clientId: `SCALE-001-local-smoke-${process.pid}`, clean: true });
  const topic = (suffix) => `${TOPIC_PREFIX}/${suffix}`;
  const id = `MSG-A-LOCAL-${randomUUID()}`;
  let rawMeasurement = null;
  let accepted = false;
  let duplicate = false;
  let printed = false;
  const timeout = setTimeout(() => {
    console.error("Local hardware smoke test timed out");
    process.exitCode = 1;
    client.end();
  }, 15000);
  client.on("error", (error) => console.error("Local MQTT:", error.message));
  client.on("connect", () => {
    client.subscribe([topic("otp-result"), topic("measurement-ack"), topic("print")], { qos: 1 }, (error) => {
      if (error) throw error;
      client.publish(topic("otp-verify"), JSON.stringify({
        schema_version: "1.0", request_id: `REQ-${id}`, device_id: DEVICE_ID, otp: TEST_OTP,
      }), { qos: 1, retain: false });
    });
  });
  client.on("message", (receivedTopic, buffer) => {
    const body = JSON.parse(buffer.toString("utf8"));
    console.log(`${receivedTopic}: ${body.status || body.print_job_id} ${body.queue_number || body.error_code || ""}`);
    if (receivedTopic === topic("otp-result")) {
      if (body.status !== "accepted") { process.exitCode = 1; client.end(); return; }
      rawMeasurement = JSON.stringify({
        schema_version: "1.0", message_id: id, device_id: DEVICE_ID, mode: "online",
        measurement_session_id: body.measurement_session_id,
        measured_at: new Date().toISOString(), weight: 63.5, height: 171.2,
      });
      client.publish(topic("measurements"), rawMeasurement, { qos: 1, retain: false });
    } else if (receivedTopic === topic("measurement-ack")) {
      if (body.status === "accepted") {
        accepted = true;
        client.publish(topic("measurements"), rawMeasurement, { qos: 1, retain: false });
      } else if (body.status === "duplicate") {
        duplicate = true;
      } else {
        process.exitCode = 1;
        client.end();
      }
    } else if (receivedTopic === topic("print")) {
      printed = true;
      client.publish(topic("print-ack"), JSON.stringify({
        print_job_id: body.print_job_id, device_id: DEVICE_ID, status: "printed",
      }), { qos: 1, retain: false });
    }
    if (accepted && duplicate && printed) {
      clearTimeout(timeout);
      console.log("Local smoke test passed: OTP accepted, A queue accepted, duplicate same queue, print sent.");
      client.end();
    }
  });
  client.on("end", () => clearTimeout(timeout));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
