const pool = require("./db");

function cleanIdentifier(value, maxLength = 100) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function cleanUuid(value) {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

async function recordHardwareAudit(eventType, data = {}) {
  const details = data.details && typeof data.details === "object" ? data.details : {};
  await pool.query(
    `INSERT INTO clinic.hardware_event_audit
       (event_type, result, device_id, request_id, measurement_session_id,
        message_id, print_job_id, actor_user_id, error_code, details)
     VALUES ($1,$2,$3,$4,$5::uuid,$6,$7,$8,$9,$10::jsonb)`,
    [
      cleanIdentifier(eventType, 80),
      cleanIdentifier(data.result, 20) || "accepted",
      cleanIdentifier(data.deviceId, 80),
      cleanIdentifier(data.requestId),
      cleanUuid(data.measurementSessionId),
      cleanIdentifier(data.messageId),
      cleanIdentifier(data.printJobId),
      data.actorUserId || null,
      cleanIdentifier(data.errorCode),
      JSON.stringify(details),
    ],
  );
}

async function safeRecordHardwareAudit(eventType, data = {}) {
  try {
    await recordHardwareAudit(eventType, data);
  } catch (error) {
    console.error("MQTT hardware audit write failed", {
      at: new Date().toISOString(),
      event_type: eventType,
      message_id: data.messageId || null,
      print_job_id: data.printJobId || null,
      error: error.message,
    });
  }
}

module.exports = { recordHardwareAudit, safeRecordHardwareAudit };
