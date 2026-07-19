const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../tools/db");
const router = express.Router();
const authContext = require("../tools/authContext");
const { escapeHtml, sendClinicMail } = require("../tools/mailer");
const { JWT_SECRET } = require("../tools/config");
const {
  ensureCalendarRulesSchema,
  isClinicHoliday,
} = require("../tools/calendarRules");
const { reopenBookableSlotsForDate } = require("../tools/slotSeeder");

const QUEUE_NUMBER_BY_HOUR = new Map([
  [7, 1],
  [8, 2],
  [9, 3],
  [10, 4],
  [16, 5],
  [17, 6],
  [18, 7],
  [19, 8],
]);
const ACCESS_CODE_TTL_MINUTES = 15;

function getQueueNoForHour(hourOfDay) {
  return QUEUE_NUMBER_BY_HOUR.get(Number(hourOfDay)) || null;
}

function formatQueueNumber(prefix, n) {
  return `${prefix}${String(n).padStart(3, "0")}`;
}

function generateAccessCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function hashAccessCode(code) {
  return crypto
    .createHmac("sha256", JWT_SECRET)
    .update(String(code))
    .digest("hex");
}

function appointmentMailDetails(row) {
  const date = row.service_date
    ? new Date(row.service_date).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })
    : "-";
  const time = Number.isFinite(Number(row.hour_of_day))
    ? `${String(row.hour_of_day).padStart(2, "0")}:00 น.`
    : "-";

  return { date, time };
}

async function sendPendingEmail(row) {
  const { date, time } = appointmentMailDetails(row);
  return sendClinicMail({
    to: row.email,
    subject: "ได้รับคำขอจองคิวแล้ว — รอการอนุมัติ",
    html: `<p>สวัสดี ${escapeHtml(row.first_name || "ผู้ใช้บริการ")}</p>
      <p>คลินิกได้รับคำขอจองคิวของคุณแล้ว ขณะนี้กำลังรอการอนุมัติจาก Admin</p>
      <p><b>วันที่:</b> ${escapeHtml(date)}<br><b>เวลา:</b> ${escapeHtml(time)}<br><b>บริการ:</b> ${escapeHtml(row.service_type)}</p>
      <p>ระบบจะส่งผลการอนุมัติให้ทางอีเมลอีกครั้ง</p>`,
  });
}

async function sendApprovedEmail(row, queue, accessCode) {
  const { date, time } = appointmentMailDetails(row);
  return sendClinicMail({
    to: row.email,
    subject: `อนุมัติการจองแล้ว — คิว ${queue.queue_number}`,
    html: `<p>สวัสดี ${escapeHtml(row.first_name || "ผู้ใช้บริการ")}</p>
      <p>การจองของคุณได้รับการอนุมัติแล้ว</p>
      <p><b>หมายเลขคิว:</b> ${escapeHtml(queue.queue_number)}<br><b>วันที่:</b> ${escapeHtml(date)}<br><b>เวลา:</b> ${escapeHtml(time)}</p>
      <p>รหัสสำหรับยืนยันที่เครื่องชั่ง:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px">${escapeHtml(accessCode)}</p>
      <p>รหัสนี้ใช้ได้ถึง ${ACCESS_CODE_TTL_MINUTES} นาทีหลังเวลานัดหมาย และใช้ได้เพียงครั้งเดียว กรุณาเก็บรหัสเป็นความลับ</p>`,
  });
}

async function sendCancelledEmail(row, reason) {
  const { date, time } = appointmentMailDetails(row);
  return sendClinicMail({
    to: row.email,
    subject: "ไม่สามารถอนุมัติการจองคิวได้",
    html: `<p>สวัสดี ${escapeHtml(row.first_name || "ผู้ใช้บริการ")}</p>
      <p>การจองวันที่ ${escapeHtml(date)} เวลา ${escapeHtml(time)} ถูกยกเลิก</p>
      <p><b>เหตุผลจาก Admin:</b> ${escapeHtml(reason)}</p>`,
  });
}

async function issueQueueFromAppointment(client, appointmentId) {
  const existing = await client.query(
    `SELECT *
     FROM clinic.queue_tickets
     WHERE appointment_id = $1
     LIMIT 1`,
    [appointmentId]
  );

  if (existing.rowCount) return existing.rows[0];

  const appointment = await client.query(
    `SELECT
       a.appointment_id,
       a.user_id,
       a.service_type,
       s.service_date::date AS service_date,
       s.avaliable_date,
       s.hour_of_day
     FROM clinic.appointments a
     JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
     WHERE a.appointment_id = $1`,
    [appointmentId]
  );

  if (!appointment.rowCount) return null;

  const row = appointment.rows[0];
  const prefix = "A";
  const numericNo = getQueueNoForHour(row.hour_of_day);

  if (!numericNo) {
    const error = new Error("ช่วงเวลานี้ไม่อยู่ในคิว A001-A008");
    error.statusCode = 400;
    throw error;
  }

  const queueNumber = formatQueueNumber(prefix, numericNo);

  const inserted = await client.query(
    `INSERT INTO clinic.queue_tickets
       (queue_number, prefix, numeric_no, service_date, avaliable_date, source, appointment_id, user_id, service_type)
     VALUES ($1, $2, $3, $4, $5, 'online', $6, $7, $8)
     RETURNING *`,
    [
      queueNumber,
      prefix,
      numericNo,
      row.service_date,
      row.avaliable_date,
      row.appointment_id,
      row.user_id,
      row.service_type,
    ]
  );

  return inserted.rows[0];
}

// ตรวจสอบว่าเป็น Admin หรือ staff
function verifyAdmin(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(403).json({ error: "No token provided" });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(403).json({ error: "Invalid token format" });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: "Token verification failed" });
    }

    const role = String(decoded.role || "").toLowerCase();
    if (!["admin", "super_admin", "superadmin", "doctor", "assistant"].includes(role)) {
      return res.status(403).json({ error: "Admin or staff permission required" });
    }

    req.admin = decoded;
    next();
  });
}

async function cancelExpiredPendingAppointments() {
  await pool.query(`
    WITH expired AS (
      UPDATE clinic.appointments a
      SET status = 'cancelled',
          action_taken = true,
          cancellation_reason = COALESCE(
            NULLIF(BTRIM(a.cancellation_reason), ''),
            'ยกเลิกอัตโนมัติ เนื่องจากเลยวันที่นัดหมายแล้ว'
          )
      FROM clinic.appointment_slots slot
      WHERE a.slot_id = slot.slot_id
        AND a.status IN ('pending', 'waiting')
        AND slot.service_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date
      RETURNING a.slot_id
    )
    UPDATE clinic.appointment_slots slot
    SET status = 'open'
    FROM expired
    WHERE slot.slot_id = expired.slot_id
  `);
}

// จองนัด เลือก slot_id
// แก้ไขส่วนนี้:
// 1. กัน slot เดียวถูกจองซ้ำ
// 2. กัน user คนเดิมจองหลายเวลาในวันเดียวกัน
// 3. จองสำเร็จแล้วปิด slot เป็น closed
function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function getTodayBangkokDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getCurrentWeekRangeBangkok() {
  const todayKey = getTodayBangkokDate();
  const today = new Date(`${todayKey}T00:00:00.000Z`);
  const day = today.getUTCDay();
  const daysFromMonday = (day + 6) % 7;
  const start = addDays(today, -daysFromMonday);
  const end = addDays(start, 6);

  return {
    start: formatUtcDate(start),
    end: formatUtcDate(end),
  };
}

function isDateInCurrentWeek(date) {
  const { start, end } = getCurrentWeekRangeBangkok();
  const value = String(date).slice(0, 10);
  return value >= start && value <= end;
}

router.post("/", async (req, res) => {
  const { slot_id, service_type } = req.body;
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(403).json({ error: "Token missing" });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return res.status(403).json({ error: "Token invalid" });
  }

  const user_id = decoded.user_id || decoded.sub;

  if (!user_id) {
    return res.status(403).json({ error: "ไม่พบ user_id ใน token" });
  }

  if (!slot_id || !service_type || !String(service_type).trim()) {
    return res.status(400).json({
      error: "กรุณาเลือกช่วงเวลาและกรอกหัวข้อนัดหมาย",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT user_id
       FROM clinic.users
       WHERE user_id = $1
         AND LOWER(role::text) IN ('user', 'users')
       LIMIT 1`,
      [user_id]
    );

    if (!userResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "บัญชีผู้ใช้นี้ไม่มีอยู่ในระบบ กรุณาลงทะเบียนเพื่อจองคิว",
        account_deleted: true,
      });
    }

    // 1) ล็อก slot นี้ก่อน เพื่อกันกรณีผู้ใช้หลายคนกดจองพร้อมกัน
    const slotResult = await client.query(
      `
      SELECT
        slot_id,
        service_date::text AS service_date,
        avaliable_date,
        hour_of_day,
        status
      FROM clinic.appointment_slots
      WHERE slot_id = $1
      FOR UPDATE
      `,
      [slot_id]
    );

    if (slotResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "ไม่พบช่วงเวลานัดหมายนี้",
      });
    }

    const slot = slotResult.rows[0];

    if (!isDateInCurrentWeek(slot.service_date)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "เปิดจองเฉพาะสัปดาห์ปัจจุบันเท่านั้น",
        current_week: getCurrentWeekRangeBangkok(),
      });
    }

    await ensureCalendarRulesSchema(client);
    const holiday = await isClinicHoliday(client, slot.service_date);
    if (holiday) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: holiday.reason || "คลินิกหยุดให้บริการในวันที่เลือก",
        is_holiday: true,
      });
    }

    await reopenBookableSlotsForDate(client, slot.service_date);
    const refreshedSlot = await client.query(
      `SELECT status
       FROM clinic.appointment_slots
       WHERE slot_id = $1`,
      [slot_id]
    );
    slot.status = refreshedSlot.rows[0]?.status || slot.status;

    if (!getQueueNoForHour(slot.hour_of_day)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "เลือกได้เฉพาะคิวเช้า 07:00-10:00 หรือคิวบ่าย 16:00-19:00",
      });
    }

    const dailyCapacityResult = await client.query(
      `SELECT COUNT(*)::int AS booked_count
       FROM clinic.appointments a
       JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
       WHERE s.service_date = $1
         AND s.hour_of_day IN (7, 8, 9, 10, 16, 17, 18, 19)
         AND a.status NOT IN ('cancelled', 'rejected')`,
      [slot.service_date]
    );

    if (Number(dailyCapacityResult.rows[0]?.booked_count || 0) >= 8) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "คิวของวันที่เลือกเต็มแล้ว (สูงสุด 8 คิวต่อวัน)",
      });
    }

    // 2) ถ้า slot ไม่ใช่ open ห้ามจอง
    if (String(slot.status || "").trim().toLowerCase() !== "open") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "ช่วงเวลานี้ไม่สามารถจองได้แล้ว กรุณาเลือกเวลาอื่น",
      });
    }

    // 3) เช็กว่า slot นี้มีคนจองไปแล้วหรือยัง
    const slotBookedResult = await client.query(
      `
      SELECT appointment_id
      FROM clinic.appointments
      WHERE slot_id = $1
        AND status NOT IN ('cancelled', 'rejected')
      LIMIT 1
      `,
      [slot_id]
    );

    if (slotBookedResult.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "ช่วงเวลานี้ถูกจองแล้ว กรุณาเลือกเวลาอื่น",
      });
    }

    // 4) เช็กว่า user คนนี้มีนัดในวันเดียวกันแล้วหรือยัง
    const userSameDayResult = await client.query(
      `
      SELECT a.appointment_id
      FROM clinic.appointments a
      JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
      WHERE a.user_id = $1
        AND s.service_date = $2
        AND a.status NOT IN ('cancelled', 'rejected')
      LIMIT 1
      `,
      [user_id, slot.service_date]
    );

    if (userSameDayResult.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "คุณมีนัดในวันนี้แล้ว ไม่สามารถจองหลายเวลาในวันเดียวกันได้",
      });
    }

    // 5) บันทึกการจอง
    const result = await client.query(
      `
      INSERT INTO clinic.appointments (user_id, slot_id, service_type, status)
      VALUES ($1, $2, $3, 'pending')
      RETURNING *
      `,
      [user_id, slot_id, String(service_type).trim()]
    );

    // 6) ปิด slot นี้ เพื่อไม่ให้คนอื่นเห็นเป็นเวลาว่างอีก
    await client.query(
      `
      UPDATE clinic.appointment_slots
      SET status = 'closed'
      WHERE slot_id = $1
      `,
      [slot_id]
    );

    const mailResult = await client.query(
      `SELECT COALESCE(u.email, d.email) AS email,
              d.first_name, a.service_type, s.service_date, s.hour_of_day
       FROM clinic.appointments a
       JOIN clinic.users u ON u.user_id = a.user_id
       LEFT JOIN clinic.user_details d ON d.user_id = a.user_id
       JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
       WHERE a.appointment_id = $1`,
      [result.rows[0].appointment_id]
    );

    await client.query("COMMIT");

    let emailSent = false;
    try {
      await sendPendingEmail(mailResult.rows[0]);
      emailSent = true;
    } catch (mailError) {
      console.error("ส่งอีเมลรออนุมัติไม่สำเร็จ:", mailError.message);
    }

    res.status(201).json({
      message: "จองนัดหมายสำเร็จ",
      appointment: result.rows[0],
      email_sent: emailSent,
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("POST /appointments error:", error);

    res.status(400).json({
      error: error.message || "จองคิวไม่สำเร็จ",
    });
  } finally {
    client.release();
  }
});

// User ดูนัดของตัวเอง
router.get("/user/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    await cancelExpiredPendingAppointments();
    const result = await pool.query(
      `
      SELECT
        a.appointment_id,
        a.status,
        a.service_type,
        a.created_at,
        a.cancellation_reason,
        s.service_date,
        s.avaliable_date,
        s.hour_of_day
      FROM clinic.appointments a
      JOIN clinic.appointment_slots s ON a.slot_id = s.slot_id
      WHERE a.user_id = $1
      ORDER BY s.service_date ASC
      `,
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("GET /appointments/user/:userId error:", error);
    res.status(500).json({ error: "โหลดนัดหมายล้มเหลว" });
  }
});

router.get("/approved-week", authContext, async (req, res) => {
  const { start, end } = req.query;

  if (!start || !end) {
    return res.status(400).json({ error: "ต้องระบุ start และ end" });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        a.appointment_id,
        s.service_date,
        s.hour_of_day,
        a.status,
        u.user_id,
        d.first_name,
        d.last_name
      FROM clinic.appointments a
      JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
      JOIN clinic.users u ON u.user_id = a.user_id
      LEFT JOIN clinic.user_details d ON d.user_id = u.user_id
      WHERE a.status = 'approved'
        AND s.service_date BETWEEN $1 AND $2
      ORDER BY s.service_date, s.hour_of_day
      `,
      [start, end]
    );

    res.json(rows);
  } catch (error) {
    console.error("GET /appointments/approved-week error:", error);
    res.status(500).json({ error: "โหลดรายการนัดหมายรายสัปดาห์ล้มเหลว" });
  }
});

// Admin ดูนัดทุกคน
router.get("/", verifyAdmin, async (_req, res) => {
  try {
    await cancelExpiredPendingAppointments();
    const result = await pool.query(
      `
      SELECT
        a.appointment_id,
        a.status,
        a.service_type,
        a.created_at,
        a.cancellation_reason,
        u.user_id,
        ud.first_name,
        ud.last_name,
        s.service_date,
        s.avaliable_date,
        s.hour_of_day,
        q.queue_id,
        q.queue_number,
        q.prefix,
        q.numeric_no,
        q.status AS queue_status,
        EXISTS (
          SELECT 1
          FROM clinic.measurements m
          WHERE m.queue_id = q.queue_id
        ) AS has_measurement,
        EXISTS (
          SELECT 1
          FROM clinic.medical_records mr
          WHERE mr.user_id = a.user_id
            AND mr.visit_date::date = s.service_date
        ) AS has_medical_record
      FROM clinic.appointments a
      JOIN clinic.users u ON u.user_id = a.user_id
      LEFT JOIN clinic.user_details ud ON ud.user_id = u.user_id
      JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
      LEFT JOIN clinic.queue_tickets q ON q.appointment_id = a.appointment_id
      ORDER BY
        s.service_date ASC,
        CASE
          WHEN s.avaliable_date = 'morning' THEN 1
          WHEN s.avaliable_date = 'afternoon' THEN 2
          ELSE 3
        END,
        COALESCE(q.numeric_no, s.hour_of_day),
        s.hour_of_day
      `
    );

    res.json(result.rows);
  } catch (error) {
    console.error("GET /appointments error:", error);
    res.status(500).json({ error: "โหลดข้อมูลทั้งหมดล้มเหลว" });
  }
});

// อัปเดตสถานะ approve / cancel
router.patch("/:id/cancellation-reason", verifyAdmin, async (req, res) => {
  const reason = String(req.body?.cancellation_reason || "").trim();

  if (!reason) {
    return res.status(400).json({ error: "กรุณาระบุหมายเหตุการยกเลิก" });
  }

  if (reason.length > 500) {
    return res.status(400).json({ error: "หมายเหตุต้องไม่เกิน 500 ตัวอักษร" });
  }

  try {
    const result = await pool.query(
      `UPDATE clinic.appointments
       SET cancellation_reason = $1
       WHERE appointment_id = $2
         AND status IN ('cancelled', 'rejected')
       RETURNING appointment_id, status, cancellation_reason`,
      [reason, req.params.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "ไม่พบรายการยกเลิกที่ต้องการแก้ไข" });
    }

    res.json({ message: "แก้ไขหมายเหตุแล้ว", appointment: result.rows[0] });
  } catch (error) {
    console.error("PATCH /appointments/:id/cancellation-reason error:", error);
    res.status(500).json({ error: "แก้ไขหมายเหตุไม่สำเร็จ" });
  }
});

router.put("/:id", verifyAdmin, async (req, res, next) => {
  const { id } = req.params;
  const { status, cancellation_reason = null } = req.body || {};

  if (!status || !["approved", "cancelled", "rejected"].includes(status)) {
    return res.status(400).json({ error: "status ไม่ถูกต้อง" });
  }

  if (["cancelled", "rejected"].includes(status) && !String(cancellation_reason || "").trim()) {
    return res.status(400).json({ error: "กรุณาระบุเหตุผลที่ยกเลิก" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const appointmentResult = await client.query(
      `SELECT a.*, COALESCE(u.email, d.email) AS email,
              d.first_name, s.service_date, s.hour_of_day
       FROM clinic.appointments a
       JOIN clinic.users u ON u.user_id = a.user_id
       LEFT JOIN clinic.user_details d ON d.user_id = a.user_id
       JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
       WHERE a.appointment_id = $1
       FOR UPDATE OF a`,
      [id]
    );

    if (!appointmentResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "ไม่พบนัดหมาย" });
    }

    const appointmentDetails = appointmentResult.rows[0];

    const update = await client.query(
      `UPDATE clinic.appointments
       SET status = $1,
           action_taken = true,
           cancellation_reason = $2
       WHERE appointment_id = $3
       RETURNING *`,
      [status, ["cancelled", "rejected"].includes(status) ? String(cancellation_reason).trim() : null, id]
    );

    if (!update.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "ไม่พบนัดหมาย" });
    }

    let queue = null;
    let accessCode = null;

    if (status === "approved") {
      queue = await issueQueueFromAppointment(client, id);
      accessCode = generateAccessCode();
      await client.query(
        `INSERT INTO clinic.appointment_access_codes
           (appointment_id, queue_id, code_hash, expires_at)
         VALUES (
           $1,
           $2,
           $3,
           (($4::date + ($5::int * interval '1 hour')) AT TIME ZONE 'Asia/Bangkok') + interval '15 minutes'
         )
         ON CONFLICT (appointment_id) DO UPDATE
         SET queue_id = EXCLUDED.queue_id,
             code_hash = EXCLUDED.code_hash,
             used_at = NULL,
             expires_at = EXCLUDED.expires_at,
             created_at = now()`,
        [id, queue.queue_id, hashAccessCode(accessCode), appointmentDetails.service_date, appointmentDetails.hour_of_day]
      );
    }

    if (status === "cancelled" || status === "rejected") {
      await client.query(
        `UPDATE clinic.queue_tickets
         SET status = 'cancelled'
         WHERE appointment_id = $1`,
        [id]
      );

      await client.query(
        `UPDATE clinic.appointment_slots s
         SET status = 'open'
         FROM clinic.appointments a
         WHERE a.slot_id = s.slot_id
           AND a.appointment_id = $1`,
        [id]
      );

      await client.query(
        `DELETE FROM clinic.appointment_access_codes WHERE appointment_id = $1`,
        [id]
      );
    }

    await client.query("COMMIT");

    let emailSent = false;
    try {
      if (status === "approved") {
        await sendApprovedEmail(appointmentDetails, queue, accessCode);
      } else {
        await sendCancelledEmail(appointmentDetails, String(cancellation_reason).trim());
      }
      emailSent = true;
    } catch (mailError) {
      console.error("ส่งอีเมลผลการจองไม่สำเร็จ:", mailError.message);
    }

    res.json({
      message: "อัปเดตสถานะสำเร็จ",
      appointment: update.rows[0],
      queue,
      email_sent: emailSent,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

router.post("/:id/resend-code", verifyAdmin, async (req, res, next) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT a.*, COALESCE(u.email, d.email) AS email,
              d.first_name, s.service_date, s.hour_of_day,
              q.queue_id, q.queue_number
       FROM clinic.appointments a
       JOIN clinic.users u ON u.user_id = a.user_id
       LEFT JOIN clinic.user_details d ON d.user_id = a.user_id
       JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
       JOIN clinic.queue_tickets q ON q.appointment_id = a.appointment_id
       WHERE a.appointment_id = $1
         AND a.status = 'approved'
         AND q.status <> 'cancelled'
       FOR UPDATE OF a`,
      [id]
    );

    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "ไม่พบนัดที่อนุมัติแล้ว" });
    }

    const appointment = result.rows[0];
    if (!appointment.email) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "ผู้ใช้ยังไม่มีอีเมลในระบบ" });
    }

    const accessCode = generateAccessCode();
    await client.query(
      `INSERT INTO clinic.appointment_access_codes
         (appointment_id, queue_id, code_hash, expires_at)
       VALUES (
         $1,
         $2,
         $3,
         (($4::date + ($5::int * interval '1 hour')) AT TIME ZONE 'Asia/Bangkok') + interval '15 minutes'
       )
       ON CONFLICT (appointment_id) DO UPDATE
       SET queue_id = EXCLUDED.queue_id,
           code_hash = EXCLUDED.code_hash,
           used_at = NULL,
           expires_at = EXCLUDED.expires_at,
           created_at = now()`,
      [id, appointment.queue_id, hashAccessCode(accessCode), appointment.service_date, appointment.hour_of_day]
    );

    await client.query("COMMIT");

    let emailSent = false;
    try {
      await sendApprovedEmail(
        appointment,
        { queue_id: appointment.queue_id, queue_number: appointment.queue_number },
        accessCode
      );
      emailSent = true;
    } catch (mailError) {
      console.error("ส่งรหัสคิวอีกครั้งไม่สำเร็จ:", mailError.message);
    }

    return res.status(emailSent ? 200 : 502).json({
      message: emailSent ? "ส่งรหัสใหม่ทางอีเมลแล้ว" : "สร้างรหัสใหม่แล้ว แต่ส่งอีเมลไม่สำเร็จ",
      email_sent: emailSent,
    });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    next(error);
  } finally {
    client.release();
  }
});

// ลบนัด Admin เท่านั้น
router.delete("/:id", verifyAdmin, async (req, res) => {
  try {
    await pool.query(
      `
      DELETE FROM clinic.appointments
      WHERE appointment_id = $1
      `,
      [req.params.id]
    );

    res.json({ message: "ลบนัดหมายแล้ว" });
  } catch (error) {
    console.error("DELETE /appointments/:id error:", error);
    res.status(500).json({ error: "ลบนัดไม่ได้" });
  }
});

module.exports = router;
