require("dotenv").config();
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const pool = require("../tools/db");
const printOutbox = require("../tools/printOutbox");
const {
  processPrintAck,
  verifyOnlineOtp,
} = require("../services/hardwareMeasurementService");

async function main() {
  const missingId = `SQL-SMOKE-${crypto.randomUUID()}`;
  assert.ok(Array.isArray(await printOutbox.dueMessageIds(1)));
  assert.equal(await printOutbox.claim(missingId, { bmi: 20.76, allowPending: true }), null);

  await assert.rejects(
    verifyOnlineOtp({
      request_id: missingId,
      device_id: "SCALE-001",
      otp: "000000",
    }, "SCALE-001"),
    (error) => error.code === "OTP_NOT_FOUND",
  );

  await assert.rejects(
    processPrintAck({
      print_job_id: missingId,
      device_id: "SCALE-001",
      status: "failed",
      error_code: "PAPER_OUT",
    }, "SCALE-001"),
    (error) => error.code === "PRINT_JOB_NOT_FOUND",
  );

  console.log("Hardware reliability SQL smoke test passed against the configured database.");
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end().catch(() => {});
    process.exitCode = 1;
  });
