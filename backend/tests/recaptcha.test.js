const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyRecaptchaToken } = require("../tools/recaptcha");

const enabledEnv = {
  RECAPTCHA_ENABLED: "true",
  RECAPTCHA_SECRET_KEY: "test-secret",
  RECAPTCHA_ALLOWED_HOSTNAMES: "cliniccare-frontend-umdi.onrender.com",
};

test("skips verification when reCAPTCHA is disabled", async () => {
  const result = await verifyRecaptchaToken(null, { env: { RECAPTCHA_ENABLED: "false" } });
  assert.equal(result.skipped, true);
});

test("rejects a missing token when enabled", async () => {
  await assert.rejects(
    verifyRecaptchaToken(null, { env: enabledEnv }),
    (error) => error.status === 400 && error.code === "RECAPTCHA_REQUIRED",
  );
});

test("accepts a valid response from an allowed hostname", async () => {
  const result = await verifyRecaptchaToken("valid-token", {
    env: enabledEnv,
    post: async () => ({ data: { success: true, hostname: "cliniccare-frontend-umdi.onrender.com" } }),
  });
  assert.equal(result.success, true);
});

test("rejects a token issued for another hostname", async () => {
  await assert.rejects(
    verifyRecaptchaToken("valid-token", {
      env: enabledEnv,
      post: async () => ({ data: { success: true, hostname: "evil.example" } }),
    }),
    (error) => error.status === 400 && error.code === "RECAPTCHA_HOSTNAME_INVALID",
  );
});

test("fails closed when Google verification is unavailable", async () => {
  await assert.rejects(
    verifyRecaptchaToken("valid-token", {
      env: enabledEnv,
      post: async () => { throw new Error("network failure"); },
    }),
    (error) => error.status === 503 && error.code === "RECAPTCHA_UNAVAILABLE",
  );
});
