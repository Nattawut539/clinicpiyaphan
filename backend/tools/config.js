const path = require("path");

const PORT = Number(process.env.PORT || 5000);
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET || (IS_PRODUCTION ? "" : "dev_secret_for_local_only");
const COOKIE_SAME_SITE = String(process.env.COOKIE_SAME_SITE || "lax").toLowerCase();
const COOKIE_SECURE = IS_PRODUCTION || process.env.COOKIE_SECURE === "true";
const COOKIE_DOMAIN = String(process.env.COOKIE_DOMAIN || "").trim() || undefined;
const RUN_MIGRATIONS_ON_START = process.env.RUN_MIGRATIONS_ON_START === "true" || !IS_PRODUCTION;
const TRUST_PROXY = process.env.TRUST_PROXY || (IS_PRODUCTION ? "1" : "false");

const CORS_ORIGINS = (process.env.CORS_ORIGINS || FRONTEND_URL)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (IS_PRODUCTION && (!JWT_SECRET || JWT_SECRET.length < 32 || /change-this|dev_secret/i.test(JWT_SECRET))) {
  throw new Error("JWT_SECRET must be a non-default secret of at least 32 characters in production");
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

if (!['lax', 'strict', 'none'].includes(COOKIE_SAME_SITE)) {
  throw new Error("COOKIE_SAME_SITE must be lax, strict, or none");
}

if (COOKIE_SAME_SITE === "none" && !COOKIE_SECURE) {
  throw new Error("COOKIE_SECURE must be true when COOKIE_SAME_SITE=none");
}

function requireHttpsUrl(name, value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${name} must use HTTPS in production`);
}

if (IS_PRODUCTION) {
  requireHttpsUrl("FRONTEND_URL", FRONTEND_URL);
  for (const origin of CORS_ORIGINS) {
    if (origin === "*") throw new Error("CORS_ORIGINS cannot contain * in production");
    requireHttpsUrl("CORS_ORIGINS entry", origin);
  }

  for (const provider of ["GOOGLE", "LINE"]) {
    const values = [
      process.env[`${provider}_CLIENT_ID`] || process.env[`${provider}_CHANNEL_ID`],
      process.env[`${provider}_CLIENT_SECRET`] || process.env[`${provider}_CHANNEL_SECRET`],
      process.env[`${provider}_REDIRECT_URI`],
    ];
    if (values.some(Boolean) && !values.every(Boolean)) {
      throw new Error(`${provider} OAuth configuration is incomplete`);
    }
    if (process.env[`DISABLE_${provider}_OAUTH`] !== "true" && !values.every(Boolean)) {
      throw new Error(`${provider} OAuth must be configured or explicitly disabled in production`);
    }
    if (values.every(Boolean)) requireHttpsUrl(`${provider}_REDIRECT_URI`, values[2]);
  }

  const smtpValues = [process.env.SMTP_HOST, process.env.SMTP_USER, process.env.SMTP_PASS, process.env.MAIL_FROM];
  if (process.env.DISABLE_EMAIL !== "true" && !smtpValues.every(Boolean)) {
    throw new Error("SMTP_HOST, SMTP_USER, SMTP_PASS, and MAIL_FROM are required in production");
  }

  const uploadDir = String(process.env.UPLOAD_DIR || "").trim();
  if (!uploadDir && process.env.ALLOW_EPHEMERAL_UPLOADS !== "true") {
    throw new Error("UPLOAD_DIR must point to persistent storage in production");
  }
  if (uploadDir && !path.isAbsolute(uploadDir)) {
    throw new Error("UPLOAD_DIR must be an absolute path in production");
  }
}

module.exports = {
  PORT,
  FRONTEND_URL,
  JWT_SECRET,
  CORS_ORIGINS,
  IS_PRODUCTION,
  COOKIE_SAME_SITE,
  COOKIE_SECURE,
  COOKIE_DOMAIN,
  RUN_MIGRATIONS_ON_START,
  TRUST_PROXY,
};
