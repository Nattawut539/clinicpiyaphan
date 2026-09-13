const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const verifySmtp = process.argv.includes("--verify-smtp");
const verifyStorage = process.argv.includes("--verify-storage");
const verifyMqtt = process.argv.includes("--verify-mqtt");
const requireAll = process.argv.includes("--require-all");
const frontendUrl = String(process.env.FRONTEND_URL || "").replace(/\/$/, "");
const isProduction = process.env.NODE_ENV === "production";

function enabled(disableKey) {
  return process.env[disableKey] !== "true";
}

function requireValues(label, names) {
  const missing = names.filter((name) => !String(process.env[name] || "").trim());
  if (missing.length) throw new Error(`${label} is missing: ${missing.join(", ")}`);
}

function requireCallback(name, expectedPath) {
  const value = String(process.env[name] || "");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL`);
  }
  if (isProduction && parsed.protocol !== "https:") throw new Error(`${name} must use HTTPS in production`);
  if (frontendUrl && value !== `${frontendUrl}${expectedPath}`) {
    throw new Error(`${name} must equal ${frontendUrl}${expectedPath}`);
  }
}

function mqttOptions({ verification = false } = {}) {
  const username = String(process.env.MQTT_USERNAME || "").trim();
  const password = String(process.env.MQTT_PASSWORD || "").trim();
  const certFile = String(process.env.MQTT_CERT_FILE || "").trim();
  const keyFile = String(process.env.MQTT_KEY_FILE || "").trim();
  const caFile = String(process.env.MQTT_CA_FILE || "").trim();

  if (Boolean(username) !== Boolean(password)) {
    throw new Error("MQTT_USERNAME and MQTT_PASSWORD must be configured together");
  }
  if (Boolean(certFile) !== Boolean(keyFile)) {
    throw new Error("MQTT_CERT_FILE and MQTT_KEY_FILE must be configured together");
  }

  const options = {
    clientId: String(process.env.MQTT_CLIENT_ID || "clinic-backend").trim(),
    username: username || undefined,
    password: password || undefined,
    clean: verification,
    reconnectPeriod: verification ? 0 : Number(process.env.MQTT_RECONNECT_PERIOD_MS || 5000),
    connectTimeout: 10000,
    rejectUnauthorized: process.env.MQTT_REJECT_UNAUTHORIZED !== "false",
  };
  if (verification) options.clientId = `${options.clientId}-check-${process.pid}`;
  if (caFile) options.ca = fs.readFileSync(caFile);
  if (certFile) options.cert = fs.readFileSync(certFile);
  if (keyFile) options.key = fs.readFileSync(keyFile);

  if (isProduction && !username && !certFile) {
    throw new Error("MQTT authentication is required in production");
  }
  return options;
}

async function verifyMqttConnection(url, options) {
  const mqtt = require("mqtt");
  await new Promise((resolve, reject) => {
    const client = mqtt.connect(url, options);
    const timer = setTimeout(() => {
      client.end(true);
      reject(new Error("MQTT connection timed out after 10 seconds"));
    }, 10000);
    const finish = (error) => {
      clearTimeout(timer);
      client.end(true);
      if (error) reject(new Error(`MQTT connection failed: ${error.message}`));
      else resolve();
    };
    client.once("connect", () => finish());
    client.once("error", finish);
  });
}

async function main() {
  requireValues("Core integration configuration", ["FRONTEND_URL", "JWT_SECRET"]);

  const result = {
    ok: true,
    frontend_url: frontendUrl,
    email: { enabled: enabled("DISABLE_EMAIL"), smtp_verified: false },
    google: { enabled: enabled("DISABLE_GOOGLE_OAUTH") },
    line: { enabled: enabled("DISABLE_LINE_OAUTH") },
    storage: { provider: String(process.env.STORAGE_PROVIDER || "local"), verified: false },
    mqtt: { enabled: process.env.MQTT_ENABLED === "true", verified: false },
    recaptcha: { enabled: process.env.RECAPTCHA_ENABLED === "true" },
  };

  if (requireAll) {
    const disabled = [];
    if (!result.email.enabled) disabled.push("email");
    if (!result.google.enabled) disabled.push("Google OAuth");
    if (!result.line.enabled) disabled.push("LINE OAuth");
    if (result.storage.provider !== "google_drive") disabled.push("Google Drive storage");
    if (!result.mqtt.enabled) disabled.push("MQTT hardware bridge");
    if (!result.recaptcha.enabled) disabled.push("reCAPTCHA");
    if (disabled.length) throw new Error(`Required integrations are not enabled: ${disabled.join(", ")}`);
  }

  if (result.email.enabled) {
    requireValues("Email", ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"]);
    const port = Number(process.env.SMTP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("SMTP_PORT must be an integer between 1 and 65535");
    }
    if (process.env.RENDER === "true" && [25, 465, 587].includes(port)) {
      throw new Error(`Render Free blocks outbound SMTP port ${port}; use a supported provider port or a paid instance`);
    }
    if (verifySmtp) {
      await require("./mailer").verifyMailTransport();
      result.email.smtp_verified = true;
    }
  }

  if (result.google.enabled) {
    requireValues("Google OAuth", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"]);
    requireCallback("GOOGLE_REDIRECT_URI", "/api/google/callback");
  }

  if (result.line.enabled) {
    requireValues("LINE OAuth", ["LINE_CHANNEL_ID", "LINE_CHANNEL_SECRET", "LINE_REDIRECT_URI"]);
    requireCallback("LINE_REDIRECT_URI", "/api/line/callback");
    const scopes = new Set(String(process.env.LINE_SCOPES || "openid profile").split(/\s+/).filter(Boolean));
    for (const scope of ["openid", "profile", "email"]) {
      if (!scopes.has(scope)) throw new Error(`LINE_SCOPES must include ${scope}`);
    }
  }

  if (result.recaptcha.enabled) {
    requireValues("reCAPTCHA", ["RECAPTCHA_SECRET_KEY", "RECAPTCHA_ALLOWED_HOSTNAMES"]);
    const allowed = require("./recaptcha").allowedHostnames(process.env);
    const expectedHostname = new URL(frontendUrl).hostname.toLowerCase();
    if (!allowed.has(expectedHostname)) {
      throw new Error(`RECAPTCHA_ALLOWED_HOSTNAMES must include ${expectedHostname}`);
    }
  }

  const { validateStorageConfig } = require("./storageConfig");
  validateStorageConfig();
  if (verifyStorage) {
    if (result.storage.provider !== "google_drive") {
      throw new Error("--verify-storage requires STORAGE_PROVIDER=google_drive");
    }
    await require("./googleDriveStorage").getDriveStorage().checkFolder();
    result.storage.verified = true;
  }

  if (result.mqtt.enabled) {
    requireValues("MQTT", ["MQTT_URL", "MQTT_CLIENT_ID", "MQTT_TOPIC_PREFIX"]);
    const url = String(process.env.MQTT_URL).trim();
    if (!/^mqtts?:\/\//i.test(url)) throw new Error("MQTT_URL must use mqtt:// or mqtts://");
    if (isProduction && !url.startsWith("mqtts://")) {
      throw new Error("MQTT_URL must use mqtts:// in production");
    }
    const qos = Number(process.env.MQTT_QOS || 1);
    if (![0, 1].includes(qos)) throw new Error("MQTT_QOS must be 0 or 1");
    const reconnectPeriod = Number(process.env.MQTT_RECONNECT_PERIOD_MS || 5000);
    if (!Number.isFinite(reconnectPeriod) || reconnectPeriod < 0) {
      throw new Error("MQTT_RECONNECT_PERIOD_MS must be zero or a positive number");
    }
    const options = mqttOptions({ verification: verifyMqtt });
    if (verifyMqtt) {
      await verifyMqttConnection(url, options);
      result.mqtt.verified = true;
    }
  } else if (verifyMqtt) {
    throw new Error("--verify-mqtt requires MQTT_ENABLED=true");
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(`Integration check failed: ${error.message}`);
  process.exitCode = 1;
});
