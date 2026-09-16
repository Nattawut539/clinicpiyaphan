#!/usr/bin/env node
const fs = require("node:fs");
const { createServer, isIP } = require("node:net");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const readline = require("node:readline/promises");
const mqtt = require("mqtt");
const test = require("./hardwareTestCore");

const storeDir = path.resolve(__dirname, "..", ".hardware-test");
const storeFile = path.join(storeDir, "state.json");
const topic = (suffix) => `${test.TOPIC_PREFIX}/${suffix}`;

function assertLocalEnvironment(env = process.env) {
  if (env.NODE_ENV === "production" || env.RENDER === "true" || env.RENDER_SERVICE_ID) {
    throw new Error("Hardware Test cannot run in Production or on Render");
  }
  if (env.HARDWARE_TEST_ENV && env.HARDWARE_TEST_ENV !== "local") {
    throw new Error("Only HARDWARE_TEST_ENV=local is supported; use a dedicated local broker");
  }
  if (env.HARDWARE_TEST_MQTT_URL) {
    throw new Error("External MQTT URLs are disabled; this tool starts its own local broker");
  }
  const host = env.HARDWARE_TEST_BIND_HOST || "127.0.0.1";
  const parts = host.split(".").map(Number);
  const privateIPv4 = isIP(host) === 4 && parts.length === 4 &&
    (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
     (parts[0] === 192 && parts[1] === 168));
  if (host !== "127.0.0.1" && !privateIPv4) {
    throw new Error("Broker bind host must be 127.0.0.1 or a private LAN IPv4 address");
  }
  const port = Number(env.HARDWARE_TEST_PORT || 1883);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("HARDWARE_TEST_PORT must be an integer between 1024 and 65535");
  }
  return { host, port, url: `mqtt://${host}:${port}` };
}

function loadState() {
  if (!fs.existsSync(storeFile)) return test.createState();
  if (fs.lstatSync(storeDir).isSymbolicLink() || fs.lstatSync(storeFile).isSymbolicLink()) {
    throw new Error("Hardware test store cannot be a symbolic link");
  }
  return test.assertTestState(JSON.parse(fs.readFileSync(storeFile, "utf8")));
}

function saveState(state) {
  test.assertTestState(state);
  if (!fs.existsSync(storeDir)) fs.mkdirSync(storeDir);
  if (fs.lstatSync(storeDir).isSymbolicLink() ||
      (fs.existsSync(storeFile) && fs.lstatSync(storeFile).isSymbolicLink())) {
    throw new Error("Hardware test store cannot be a symbolic link");
  }
  fs.writeFileSync(storeFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function printStatus(state, connected) {
  const active = test.activeAppointment(state);
  console.log(`\nEnvironment: LOCAL TEST ONLY | Broker: ${connected ? "connected" : "offline"}`);
  console.log(`Storage: ${storeFile} (is_test=true; no Clinic database)`);
  console.log(`Device: ${test.DEVICE_ID} | Test OTP: ${state.otp_active ? test.TEST_OTP : "revoked"}`);
  console.log(`Test Patient: ${state.patient?.patient_id || "not created"} | Queue: ${active?.queue_number || "none"} (${active?.queue_status || "none"})`);
}

function copyCommand(value) {
  if (process.platform !== "win32") return false;
  const result = spawnSync("clip.exe", [], { input: value, encoding: "utf8", windowsHide: true });
  return !result.error && result.status === 0;
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Run: npm.cmd run tool:hardware  (from backend/). Local MQTT broker only.");
    console.log("Use --revoke to disable the Test OTP or --clear to reset only the local test store.");
    return;
  }
  const { host, port, url: brokerUrl } = assertLocalEnvironment();
  let state = loadState();
  if (process.argv.includes("--revoke")) {
    test.revokeTestOtp(state);
    saveState(state);
    console.log("Local Test OTP revoked; active sessions invalidated.");
    return;
  }
  if (process.argv.includes("--clear")) {
    state = test.createState();
    saveState(state);
    console.log("Local test data cleared; Test OTP revoked. No Clinic data was touched.");
    return;
  }

  const { Aedes } = await import("aedes");
  const broker = await Aedes.createBroker();
  const allowedActions = new Set(["otp-verify", "otp-result", "measurements", "measurement-ack", "print", "print-ack"]);
  broker.authorizePublish = (_mqttClient, packet, callback) => {
    const action = packet.topic.startsWith(`${test.TOPIC_PREFIX}/`)
      ? packet.topic.slice(test.TOPIC_PREFIX.length + 1) : "";
    callback(allowedActions.has(action) && !packet.retain ? null : new Error("Test topic or retain flag is not allowed"));
  };
  broker.authorizeSubscribe = (_mqttClient, subscription, callback) => {
    const allowed = subscription.topic === `${test.TOPIC_PREFIX}/#` ||
      (subscription.topic.startsWith(`${test.TOPIC_PREFIX}/`) &&
       allowedActions.has(subscription.topic.slice(test.TOPIC_PREFIX.length + 1)));
    callback(allowed ? null : new Error("Only SCALE-001 test topics are allowed"), allowed ? subscription : null);
  };
  const server = createServer(broker.handle);
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => { server.removeListener("error", reject); resolve(); });
    });
  } catch (error) {
    await broker.close();
    throw new Error(`Local test broker cannot bind ${host}:${port}: ${error.message}`);
  }
  console.log(`Local MQTT broker listening on ${host}:${port}; point ESP32 to this address, not Production.`);
  let connected = false;
  const client = mqtt.connect(brokerUrl, {
    clientId: `hardware-test-local-${process.pid}`,
    clean: true, reconnectPeriod: 2000, connectTimeout: 3000,
  });
  const publish = (target, body) => new Promise((resolve, reject) => {
    if (!connected) return reject(new Error("Local MQTT broker is offline"));
    client.publish(target, JSON.stringify(body), { qos: 1, retain: false }, (error) => error ? reject(error) : resolve());
  });
  client.on("connect", () => {
    connected = true;
    client.subscribe([topic("otp-verify"), topic("measurements"), topic("print-ack")], { qos: 1 }, (error, granted) => {
      if (error || granted?.some((entry) => entry.qos !== 1)) {
        console.error("Local MQTT subscription failed:", error?.message || "QoS 1 not granted");
      } else {
        console.log("\nLocal hardware test MQTT connected; waiting for SCALE-001 messages.");
      }
    });
  });
  client.on("close", () => { connected = false; });
  client.on("offline", () => { connected = false; });
  client.on("error", (error) => console.error("Local MQTT broker:", error.message));
  client.on("message", (receivedTopic, buffer, packet) => {
    void handleIncoming(receivedTopic, buffer, packet).catch((error) => console.error("Test message failed:", error.message));
  });

  async function handleIncoming(receivedTopic, buffer, packet) {
    if (![topic("otp-verify"), topic("measurements"), topic("print-ack")].includes(receivedTopic)) return;
    let body;
    try {
      if (buffer.length > 16 * 1024) throw new Error("PAYLOAD_TOO_LARGE");
      body = JSON.parse(buffer.toString("utf8"));
    } catch (error) {
      const suffix = receivedTopic.endsWith("/otp-verify") ? "otp-result" : "measurement-ack";
      if (!receivedTopic.endsWith("/print-ack")) {
        const rejected = { status: "rejected", error_code: error.message === "PAYLOAD_TOO_LARGE" ? error.message : "INVALID_JSON", is_test: true };
        test.recordResult(state, topic(suffix), rejected);
        saveState(state);
        await publish(topic(suffix), rejected);
      }
      return;
    }
    if (receivedTopic === topic("otp-verify")) {
      const reply = test.verifyTestOtp(state, body, test.DEVICE_ID);
      test.recordResult(state, topic("otp-result"), reply);
      saveState(state);
      await publish(topic("otp-result"), reply);
      console.log(`\n/otp-result ${reply.status} ${reply.queue_number || reply.error_code || ""}`);
    } else if (receivedTopic === topic("measurements")) {
      const result = test.processTestMeasurement(state, body, buffer.toString("utf8"), test.DEVICE_ID, new Date(), packet?.retain);
      test.recordResult(state, topic("measurement-ack"), result.ack);
      saveState(state);
      await publish(topic("measurement-ack"), result.ack);
      console.log(`\n/measurement-ack ${result.ack.status} ${result.ack.queue_number || result.ack.error_code || ""}`);
      if (result.print) {
        await publish(topic("print"), result.print);
        test.recordResult(state, topic("print"), result.print);
        saveState(state);
        console.log(`/print sent to ${test.DEVICE_ID}: ${result.print.print_job_id}`);
      }
    } else {
      const errorCode = test.processTestPrintAck(state, body, test.DEVICE_ID);
      test.recordResult(state, topic("print-ack"), { ...body, result: errorCode || "recorded", is_test: true });
      saveState(state);
      console.log(`\n/print-ack ${errorCode || body.status}`);
    }
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      printStatus(state, connected);
      console.log("1 Create test patient + approved A queue | 2 Show Test OTP | 3 Weighing command | 4 Random values");
      console.log("5 New session after accepted | 6 Retry identical MQTT payload | 7 Results | 8 Clear test data | 9 Revoke OTP | 0 Exit");
      const choice = (await rl.question("Select: ")).trim();
      try {
        if (choice === "0") break;
        if (choice === "1") {
          const appointment = state.patient ? test.activeAppointment(state) : test.createAppointment(state);
          saveState(state);
          console.log(`Synthetic ${state.patient.patient_id}; approved queue ${appointment.queue_number}. No real patient created.`);
        } else if (choice === "2") {
          console.log(state.otp_active ? `Test OTP: ${test.TEST_OTP} (reusable until revoked; LOCAL ONLY, ${test.DEVICE_ID})` : "Test OTP is revoked. Create test data to enable it.");
        } else if (choice === "3" || choice === "4") {
          const weight = choice === "4" ? Number((40 + Math.random() * 80).toFixed(1)) : Number(await rl.question("Weight (40–120 kg): "));
          const height = choice === "4" ? Number((140 + Math.random() * 50).toFixed(1)) : Number(await rl.question("Height (140–190 cm): "));
          const command = test.makeTCommand(state, weight, height);
          console.log(`Serial Monitor command: ${command}`);
          if (copyCommand(command)) console.log("Copied to Windows clipboard.");
        } else if (choice === "5") {
          const appointment = test.createNewTestSession(state);
          saveState(state);
          console.log(`New synthetic session: ${appointment.queue_number}; same Test Patient and Test OTP.`);
        } else if (choice === "6") {
          const last = Object.values(state.events).at(-1);
          if (!last) throw new Error("No accepted test measurement to retry");
          if (!connected) throw new Error("Local MQTT broker is offline");
          client.publish(topic("measurements"), last.raw_payload, { qos: 1, retain: false });
          console.log(`Replayed exact raw payload and message_id ${last.message_id}; expect duplicate ${last.queue_number}.`);
        } else if (choice === "7") {
          for (const item of state.results.slice(-12)) console.log(`${item.at} ${item.topic} ${JSON.stringify(item.body)}`);
        } else if (choice === "8") {
          const confirmation = (await rl.question("Type CLEAR to reset only local test data: ")).trim();
          if (confirmation === "CLEAR") { state = test.createState(); saveState(state); console.log("Local test data cleared; Test OTP revoked."); }
        } else if (choice === "9") {
          test.revokeTestOtp(state);
          saveState(state);
          console.log("Test OTP revoked and sessions invalidated.");
        } else {
          console.log("Unknown menu choice.");
        }
      } catch (error) {
        console.error(error.message);
      }
    }
  } finally {
    rl.close();
    await new Promise((resolve) => client.end(false, {}, resolve));
    await new Promise((resolve) => server.close(resolve));
    await broker.close();
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { assertLocalEnvironment, loadState, saveState };
