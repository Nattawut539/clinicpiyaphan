const crypto = require("crypto");
const pool = require("../tools/db");
const { JWT_SECRET } = require("../tools/config");

class HardwareMessageError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function hashAccessCode(code) {
  return crypto
    .createHmac("sha256", JWT_SECRET)
    .update(String(code))
    .digest("hex");
}

function requireIdentifier(value, field, maxLength = 100) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength || !/^[A-Za-z0-9._:-]+$/.test(text)) {
    throw new HardwareMessageError("INVALID_PAYLOAD", `${field} is invalid`);
  }
  return text;
}

function requireMeasurement(value, field, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new HardwareMessageError(
      field === "weight" ? "WEIGHT_OUT_OF_RANGE" : "HEIGHT_OUT_OF_RANGE",
      `${field} must be between ${min} and ${max}`,
    );
  }
  return number;
}

function parseMeasuredAt(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new HardwareMessageError("INVALID_PAYLOAD", "measured_at must be an ISO-8601 timestamp");
  }
  if (date.getTime() > Date.now() + 5 * 60 * 1000) {
    throw new HardwareMessageError("INVALID_PAYLOAD", "measured_at is too far in the future");
  }
  return date.toISOString();
}

async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path TO clinic, public");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function verifyOnlineOtp(payload, topicDeviceId) {
  const requestId = requireIdentifier(payload?.request_id, "request_id");
  const deviceId = requireIdentifier(payload?.device_id, "device_id", 80);
  const otp = String(payload?.otp || "").trim();

  if (deviceId !== topicDeviceId || !/^\d{6}$/.test(otp)) {
    throw new HardwareMessageError("INVALID_OTP", "OTP is invalid or expired");
  }

  return withTransaction(async (client) => {
    const access = await client.query(
      `SELECT ac.access_code_id, ac.queue_id, ac.expires_at, q.queue_number
       FROM clinic.appointment_access_codes ac
       JOIN clinic.queue_tickets q ON q.queue_id = ac.queue_id
       JOIN clinic.appointments a ON a.appointment_id = ac.appointment_id
       WHERE ac.code_hash = $1
         AND ac.used_at IS NULL
         AND ac.expires_at > now()
         AND a.status = 'approved'
         AND q.prefix = 'A'
         AND q.service_date = (now() AT TIME ZONE 'Asia/Bangkok')::date
         AND q.status <> 'cancelled'
       LIMIT 1`,
      [hashAccessCode(otp)],
    );

    if (!access.rowCount) {
      throw new HardwareMessageError("INVALID_OTP", "OTP is invalid or expired");
    }

    const sessionId = crypto.randomUUID();
    const row = access.rows[0];
    const inserted = await client.query(
      `INSERT INTO clinic.hardware_otp_sessions
         (session_id, device_id, access_code_id, queue_id, expires_at)
       VALUES ($1,$2,$3,$4,LEAST($5::timestamptz, now() + interval '5 minutes'))
       RETURNING expires_at`,
      [sessionId, deviceId, row.access_code_id, row.queue_id, row.expires_at],
    );

    return {
      request_id: requestId,
      status: "accepted",
      measurement_session_id: sessionId,
      queue_number: row.queue_number,
      expires_at: inserted.rows[0].expires_at,
    };
  });
}

async function findDuplicate(client, messageId) {
  const result = await client.query(
    `SELECT e.message_id, e.device_id, e.measurement_id, q.queue_number
     FROM clinic.hardware_measurement_events e
     JOIN clinic.queue_tickets q ON q.queue_id = e.queue_id
     WHERE e.message_id = $1`,
    [messageId],
  );
  return result.rows[0] || null;
}

async function insertMeasurement(client, { queue, messageId, deviceId, measuredAt, weight, height, mode }) {
  const measurement = await client.query(
    `INSERT INTO clinic.measurements
       (queue_id, queue_number, weight, height, bmi, source, device_id,
        hardware_message_id, measured_at)
     VALUES ($1,$2,$3,$4,NULL,'mqtt',$5,$6,$7)
     RETURNING measurement_id`,
    [queue.queue_id, queue.queue_number, weight, height, deviceId, messageId, measuredAt],
  );

  await client.query(
    `INSERT INTO clinic.hardware_measurement_events
       (message_id, device_id, mode, queue_id, measurement_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [messageId, deviceId, mode, queue.queue_id, measurement.rows[0].measurement_id],
  );

  const ack = {
    message_id: messageId,
    status: "accepted",
    measurement_id: measurement.rows[0].measurement_id,
    queue_number: queue.queue_number,
    print_pending: true,
  };
  await client.query(
    `INSERT INTO clinic.hardware_measurement_ack_outbox
       (message_id, device_id, ack_payload)
     VALUES ($1,$2,$3::jsonb)`,
    [messageId, deviceId, JSON.stringify(ack)],
  );
  return ack;
}

async function processOnlineMeasurement(client, values, payload) {
  const sessionId = String(payload?.measurement_session_id || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(sessionId)) {
    throw new HardwareMessageError("INVALID_SESSION", "measurement_session_id is invalid");
  }

  const session = await client.query(
    `SELECT s.session_id, s.access_code_id, s.queue_id, q.queue_number
     FROM clinic.hardware_otp_sessions s
     JOIN clinic.appointment_access_codes ac ON ac.access_code_id = s.access_code_id
     JOIN clinic.queue_tickets q ON q.queue_id = s.queue_id
     WHERE s.session_id = $1
       AND s.device_id = $2
       AND s.used_at IS NULL
       AND s.expires_at > now()
       AND ac.used_at IS NULL
       AND ac.expires_at > now()
       AND q.prefix = 'A'
       AND q.service_date = (now() AT TIME ZONE 'Asia/Bangkok')::date
       AND q.status <> 'cancelled'
     FOR UPDATE OF s, ac, q`,
    [sessionId, values.deviceId],
  );

  if (!session.rowCount) {
    throw new HardwareMessageError("INVALID_SESSION", "Measurement session is invalid or expired");
  }

  const row = session.rows[0];
  const result = await insertMeasurement(client, {
    ...values,
    mode: "online",
    queue: row,
  });
  await client.query(
    `UPDATE clinic.hardware_otp_sessions SET used_at = now() WHERE session_id = $1`,
    [sessionId],
  );
  await client.query(
    `UPDATE clinic.appointment_access_codes SET used_at = now() WHERE access_code_id = $1`,
    [row.access_code_id],
  );
  return result;
}

async function processWalkinMeasurement(client, values) {
  // Serialise B-number allocation so two scales cannot issue the same queue.
  await client.query("LOCK TABLE clinic.queue_tickets IN SHARE ROW EXCLUSIVE MODE");
  const clock = await client.query(
    `SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date::text AS service_date,
            CASE WHEN (now() AT TIME ZONE 'Asia/Bangkok')::time < time '12:00'
                 THEN 'morning' ELSE 'afternoon' END AS avaliable_date`,
  );
  const { service_date: serviceDate, avaliable_date: availableDate } = clock.rows[0];
  const number = await client.query(
    `SELECT COALESCE(MAX(numeric_no), 0) + 1 AS value
     FROM clinic.queue_tickets
     WHERE prefix = 'B' AND service_date = $1::date`,
    [serviceDate],
  );
  const numericNo = Number(number.rows[0].value);
  const queueNumber = `B${String(numericNo).padStart(3, "0")}`;
  const queue = await client.query(
    `INSERT INTO clinic.queue_tickets
       (queue_number, prefix, numeric_no, service_date, avaliable_date,
        source, service_type)
     VALUES ($1,'B',$2,$3::date,$4,'kiosk','Walk-in')
     RETURNING queue_id, queue_number`,
    [queueNumber, numericNo, serviceDate, availableDate],
  );

  return insertMeasurement(client, {
    ...values,
    mode: "walk_in",
    queue: queue.rows[0],
  });
}

async function processHardwareMeasurement(payload, topicDeviceId) {
  const messageId = requireIdentifier(payload?.message_id, "message_id");
  const deviceId = requireIdentifier(payload?.device_id, "device_id", 80);
  if (deviceId !== topicDeviceId) {
    throw new HardwareMessageError("DEVICE_MISMATCH", "device_id does not match MQTT topic");
  }
  const mode = String(payload?.mode || "").trim();
  if (!['online', 'walk_in'].includes(mode)) {
    throw new HardwareMessageError("INVALID_MODE", "mode must be online or walk_in");
  }

  const values = {
    messageId,
    deviceId,
    measuredAt: parseMeasuredAt(payload?.measured_at),
    weight: requireMeasurement(payload?.weight, "weight", 1, 300),
    height: requireMeasurement(payload?.height, "height", 30, 250),
  };

  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`hardware:${messageId}`]);
    const duplicate = await findDuplicate(client, messageId);
    if (duplicate) {
      if (duplicate.device_id !== deviceId) {
        throw new HardwareMessageError("MESSAGE_ID_CONFLICT", "message_id belongs to another device");
      }
      return {
        message_id: messageId,
        status: "duplicate",
        measurement_id: duplicate.measurement_id,
        queue_number: duplicate.queue_number,
        print_pending: true,
      };
    }

    if (mode === "online") return processOnlineMeasurement(client, values, payload);
    return processWalkinMeasurement(client, values);
  });
}

async function processPrintAck(payload, topicDeviceId) {
  const printJobId = requireIdentifier(payload?.print_job_id, "print_job_id");
  const deviceId = requireIdentifier(payload?.device_id, "device_id", 80);
  const status = String(payload?.status || "").trim();
  if (deviceId !== topicDeviceId || !["printed", "failed"].includes(status)) {
    throw new HardwareMessageError("INVALID_PRINT_ACK", "Print acknowledgement is invalid");
  }
  const errorCode = status === "failed"
    ? String(payload?.error_code || "UNKNOWN_ERROR").trim().slice(0, 80)
    : null;

  const result = await pool.query(
    `UPDATE clinic.hardware_measurement_events
     SET print_status = $1,
         print_error_code = $2,
         printed_at = CASE WHEN $1 = 'printed' THEN now() ELSE printed_at END,
         updated_at = now()
     WHERE print_job_id = $3 AND device_id = $4
     RETURNING message_id`,
    [status, errorCode, printJobId, deviceId],
  );
  if (!result.rowCount) {
    throw new HardwareMessageError("PRINT_JOB_NOT_FOUND", "Print job was not found");
  }
  return { print_job_id: printJobId, status };
}

module.exports = {
  HardwareMessageError,
  processHardwareMeasurement,
  processPrintAck,
  verifyOnlineOtp,
};
