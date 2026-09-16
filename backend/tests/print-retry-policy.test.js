const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MAX_PRINT_ATTEMPTS,
  isRetryablePrintError,
  printFailurePolicy,
  printRetryDelaySeconds,
} = require("../services/printRetryPolicy");

test("print retry uses bounded exponential backoff", () => {
  assert.equal(MAX_PRINT_ATTEMPTS, 3);
  assert.equal(printRetryDelaySeconds(1), 30);
  assert.equal(printRetryDelaySeconds(2), 60);
  assert.equal(printRetryDelaySeconds(3), 120);
  assert.equal(printRetryDelaySeconds(20), 300);
});

test("terminal printer errors stop immediately", () => {
  assert.equal(isRetryablePrintError("PRINTER_NOT_CONNECTED"), false);
  assert.equal(isRetryablePrintError("invalid_print_data"), false);
  assert.deepEqual(printFailurePolicy("PRINTER_NOT_CONNECTED", 1), {
    errorCode: "PRINTER_NOT_CONNECTED",
    retryable: false,
    delaySeconds: null,
  });
});

test("transient errors retry only below max attempts", () => {
  assert.deepEqual(printFailurePolicy("PAPER_OUT", 1), {
    errorCode: "PAPER_OUT",
    retryable: true,
    delaySeconds: 30,
  });
  assert.equal(printFailurePolicy("PAPER_OUT", 2).delaySeconds, 60);
  assert.equal(printFailurePolicy("PAPER_OUT", 3).retryable, false);
});
