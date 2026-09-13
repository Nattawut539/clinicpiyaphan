const axios = require("axios");

const VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";

function captchaError(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}

function allowedHostnames(env) {
  const configured = String(env.RECAPTCHA_ALLOWED_HOSTNAMES || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length) return new Set(configured);

  try {
    return new Set([new URL(env.FRONTEND_URL).hostname.toLowerCase()]);
  } catch {
    return new Set();
  }
}

async function verifyRecaptchaToken(token, {
  remoteIp,
  env = process.env,
  post = axios.post,
} = {}) {
  if (env.RECAPTCHA_ENABLED !== "true") return { skipped: true };

  const secret = String(env.RECAPTCHA_SECRET_KEY || "").trim();
  if (!secret) {
    throw captchaError("reCAPTCHA is temporarily unavailable", "RECAPTCHA_NOT_CONFIGURED", 503);
  }
  if (!String(token || "").trim()) {
    throw captchaError("กรุณายืนยันว่าไม่ใช่โปรแกรมอัตโนมัติ", "RECAPTCHA_REQUIRED", 400);
  }

  const body = new URLSearchParams({ secret, response: String(token).trim() });
  if (remoteIp) body.set("remoteip", String(remoteIp));

  let data;
  try {
    const response = await post(VERIFY_URL, body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000,
    });
    data = response?.data || {};
  } catch {
    throw captchaError("ไม่สามารถตรวจสอบ reCAPTCHA ได้ กรุณาลองใหม่", "RECAPTCHA_UNAVAILABLE", 503);
  }

  if (data.success !== true) {
    throw captchaError("reCAPTCHA ไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่", "RECAPTCHA_INVALID", 400);
  }

  const allowed = allowedHostnames(env);
  const hostname = String(data.hostname || "").trim().toLowerCase();
  if (allowed.size && (!hostname || !allowed.has(hostname))) {
    throw captchaError("reCAPTCHA hostname ไม่ถูกต้อง", "RECAPTCHA_HOSTNAME_INVALID", 400);
  }

  return { success: true, hostname };
}

module.exports = { allowedHostnames, verifyRecaptchaToken };
