const MAX_PRINT_ATTEMPTS = 3;
const PRINT_RETRY_BASE_SECONDS = 30;
const PRINT_RETRY_MAX_SECONDS = 300;

// These failures require hardware/configuration changes. Re-publishing the same
// job cannot make them succeed and only causes an MQTT retry loop.
const NON_RETRYABLE_PRINT_ERRORS = new Set([
  "PRINTER_NOT_CONNECTED",
  "UNSUPPORTED_SCHEMA",
  "INVALID_PRINT_JOB",
  "INVALID_PRINT_DATA",
]);

function normalizePrintErrorCode(value) {
  return String(value || "UNKNOWN_ERROR").trim().toUpperCase().slice(0, 80) || "UNKNOWN_ERROR";
}

function isRetryablePrintError(errorCode) {
  return !NON_RETRYABLE_PRINT_ERRORS.has(normalizePrintErrorCode(errorCode));
}

function printRetryDelaySeconds(attempts) {
  const completedAttempts = Math.max(1, Number.parseInt(attempts, 10) || 1);
  return Math.min(
    PRINT_RETRY_BASE_SECONDS * (2 ** (completedAttempts - 1)),
    PRINT_RETRY_MAX_SECONDS,
  );
}

function printFailurePolicy(errorCode, attempts) {
  const normalizedErrorCode = normalizePrintErrorCode(errorCode);
  const completedAttempts = Math.max(0, Number.parseInt(attempts, 10) || 0);
  const retryable = isRetryablePrintError(normalizedErrorCode) && completedAttempts < MAX_PRINT_ATTEMPTS;
  return {
    errorCode: normalizedErrorCode,
    retryable,
    delaySeconds: retryable ? printRetryDelaySeconds(completedAttempts) : null,
  };
}

module.exports = {
  MAX_PRINT_ATTEMPTS,
  PRINT_RETRY_BASE_SECONDS,
  PRINT_RETRY_MAX_SECONDS,
  isRetryablePrintError,
  normalizePrintErrorCode,
  printFailurePolicy,
  printRetryDelaySeconds,
};
