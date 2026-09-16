const express = require("express");
const crypto = require("crypto");
const pool = require("../tools/db");
const router = express.Router();
const { authRequired, requireStaff } = require("../tools/_utils");
const { escapeHtml, sendClinicMail } = require("../tools/mailer");
const { JWT_SECRET } = require("../tools/config");

//เครื่องมือเกี่ยวกับวันหยุดและ slot
const {
  ensureCalendarRulesSchema, //ตรวจสอบโครวสร้างฐานข้อมูลที่เกี่ยวกับวันหยุดและวันเปิดคลินิก
  isAdvanceBookingDate,
  isClinicHoliday, //ตรวจวันที่ผู้ใช้เลิกเป็นวันหยุดของคลินิกหรือไม่
} = require("../tools/calendarRules");
const { reopenBookableSlotsForDate } = require("../tools/slotSeeder"); //reopenBookableSlotsForDate ตรวจ slot ที่เคยปิด เมื่อเปิดให้กลับมาจองได้

//ตัวกำหนดคิวและเวลา
const QUEUE_NUMBER_BY_HOUR = new Map([
  [7, 1], //07:00  , A001
  [8, 2],
  [9, 3],
  [10, 4],
  [16, 5],
  [17, 6],
  [18, 7],
  [19, 8],
]);
const ACCESS_CODE_TTL_MINUTES = 15; //ระยะเวลาของรหัสยืนยัน 15 นาที นับจากเวลาที่จอง 07:00 + 15 นาที

//ฟังก์ชันรับช่วงโมงของนัด แล้วคืนหมายเลขเป็นคิว (get(7) = 1 , get(16) = 5)
function getQueueNoForHour(hourOfDay) {
  return QUEUE_NUMBER_BY_HOUR.get(Number(hourOfDay)) || null;
}

//ฟังก์ชันสร้างคิว (A001)
function formatQueueNumber(prefix, n) {
  return `${prefix}${String(n).padStart(3, "0")}`;
}

//ฟังก์ชันสร้างรหัสด้วยตัวเลขแบบสุ่ม 6 หลัก
function generateAccessCode() {
  let code;
  do {
    code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  } while (code === "999999"); // Reserved for the isolated local hardware test tool.
  return code;
}

//ฟังก์ชันการนำรหัส 6 หลักไป Hash ด้วย SHA256 ก่อนบันทึกลงฐานข้อมูล
function hashAccessCode(code) {
  return crypto
    .createHmac("sha256", JWT_SECRET)
    .update(String(code))
    .digest("hex");
}

// Keep a reversible, authenticated copy only for the authenticated appointment owner/admin UI.
// The hash above remains the value used by the weighing-machine verification flow.
const ACCESS_CODE_ENCRYPTION_KEY = crypto
  .createHash("sha256")
  .update(`clinic-appointment-access-code:${JWT_SECRET}`)
  .digest();

function encryptAccessCode(code) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ACCESS_CODE_ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(code), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), authTag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

function decryptAccessCode(payload) {
  if (!payload) return null;
  try {
    const [version, iv, authTag, encrypted] = String(payload).split(":");
    if (version !== "v1" || !iv || !authTag || !encrypted) return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      ACCESS_CODE_ENCRYPTION_KEY,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(authTag, "base64url"));
    const code = Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return /^\d{6}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

//ฟังก์ชันจัดรูปแบบวันที่และเวลา เป็นเวลาไทยเพื่อส่งไปอีเมล
function appointmentMailDetails(row) {
  const date = row.service_date
    ? new Date(row.service_date).toLocaleDateString("th-TH", {
        timeZone: "Asia/Bangkok",
      })
    : "-";
  const time = Number.isFinite(Number(row.hour_of_day))
    ? `${String(row.hour_of_day).padStart(2, "0")}:00 น.`
    : "-";
  return { date, time };
}

//ฟังก์ชันส่งอีเมลแจ้งผู้ใช้เมื่อจองคิวสำเร็จ แต่รอการอุมัติ
async function sendPendingEmail(row) {
  const { date, time } = appointmentMailDetails(row);
  return sendClinicMail({
    to: row.email,
    subject: "ได้รับคำขอการจองคิวแล้ว  --- รอการอนุมัติ",
    html: `<p>สวัสดี ${escapeHtml(row.first_name || "ผู้ใช้บริการ")} </p>
      <p>คลินิกได้รับคำขอจองคิวของคุณแล้ว ขณะนี้กำลังรอการอนุมัติ</p>
      <p><b>วันที่:</b> ${escapeHtml(date)}<br><b>เวลา:</b> ${escapeHtml(time)}<br><b>บริการ:</b> ${escapeHtml(row.service_type)}</p>
      <p>ระบบจะส่งผลการอนุมัติให้ทางอีเมลอีกครั้ง กรุณารอสักครู่....</p>`,
  });
}

//ฟังก์ชันส่งอีเมลแจ้งผู้ใช้เมื่อจองคิวสำเร็จ และได้รับการอนุมัติแล้ว
async function sendApprovedEmail(row, queue, accessCode, accessCodeExpiresAt = null) {
  const { date, time } = appointmentMailDetails(row);
  const expiryText = accessCodeExpiresAt
    ? new Date(accessCodeExpiresAt).toLocaleString("th-TH", {
        timeZone: "Asia/Bangkok",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : `${ACCESS_CODE_TTL_MINUTES} นาทีหลังเวลานัดหมาย`;
  return sendClinicMail({
    to: row.email,
    subject: `อนุมัติการจองแล้ว — คิว ${queue.queue_number}`,
    html: `<p>สวัสดี ${escapeHtml(row.first_name || "ผู้ใช้บริการ")}</p>
      <p>การจองของคุณได้รับการอนุมัติแล้ว</p>
      <p><b>หมายเลขคิว:</b> ${escapeHtml(queue.queue_number)}<br><b>วันที่:</b> ${escapeHtml(date)}<br><b>เวลา:</b> ${escapeHtml(time)}</p>
      <p>รหัสสำหรับยืนยันที่เครื่องชั่ง:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px">${escapeHtml(accessCode)}</p>
      <p>รหัสนี้ใช้ได้ถึง ${escapeHtml(expiryText)} และใช้ได้เพียงครั้งเดียว กรุณาเก็บรหัสเป็นความลับ</p>`,
  });
}

//ฟังก์ชันส่งอีเมลแจ้งผู้ใช้เมื่อจองคิวถูกยกเลิก
async function sendCancelledEmail(row, reason) {
  const { date, time } = appointmentMailDetails(row);
  return sendClinicMail({
    to: row.email,
    subject: "ไม่สามารถอนุมัติการจองคิวของคุณได้",
    html: `<p>สวัสดี ${escapeHtml(row.first_name || "ผู้ใช้บริการ")}</p>
      <p>การจองวันที่ ${escapeHtml(date)} เวลา ${escapeHtml(time)} ถูกยกเลิก</p>
      <p><b>เหตุผลที่ถูกยกเลิก :</b> ${escapeHtml(reason)}</p>`,
  });
}

//ฟังก์ชันสร้างหมายเลขคิวที่ได้รับอนุมัติ
async function issueQueueFromAppointment(client, appointmentId) {
  const existing = await client.query(
    //ตรวจสอลว่ามีคิวหรือยัง ถ้ามีแล้วก็คืนคิวเดิม
    `SELECT * FROM clinic.queue_tickets
    WHERE appointment_id =$1
    LIMIT 1`,
    [appointmentId],
  );

  if (existing.rowCount) return existing.rows[0];

  const appointment = await client.query(
    //อ่านข้อมูล และดึงข้อมูล
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
    [appointmentId],
  );

  if (!appointment.rowCount) return null;

  const row = appointment.rows[0]; //ดึงข้อมูลของนัด
  const prtfix = "A"; //กำหนด prefix ของคิวเป็น A
  const numericNo = getQueueNoForHour(row.hour_of_day); //แปลงเวลาเป็นคิว

  if (!numericNo) {
    //ถ้าไม่อยู่ในช่วงเวลาที่กำหนดจะแสดง Error
    const error = new Error("ช่วงเวลานี้ไม่อยู่ในคิว A001 - A008");
    error.statusCode = 400;
    throw error;
  }

  const queueNumber = formatQueueNumber(prtfix, numericNo); //สร้างหมายเลขคิว A001 - A008

  const inserted = await client.query(
    //บันทึกลงตาราง
    `INSERT INTO clinic.queue_tickets (queue_number,prefix,numeric_no,service_date,avaliable_date,source,appointment_id,user_id,service_type)
    VALUES ($1,$2,$3,$4,$5, 'online' ,$6,$7,$8)
    RETURNING *`,
    [
      queueNumber,
      prtfix,
      numericNo,
      row.service_date,
      row.avaliable_date,
      row.appointment_id,
      row.user_id,
      row.service_type,
    ],
  );

  return inserted.rows[0]; //คืนข้อมูลคิวที่สร้างใหม่
}

//ฟังก์ชันตรวจสอบสิทธิ์ผู้ดูแลระบบ
//ดูนัดทั้งหมด / อนุมัติหรือยกเลิก / แก้หมายเหตุ / ส่งรหัสใหม่ / ลบนัดหมาย

function verifyAdmin(req, res, next) {
  return requireStaff(req, res, next);
}

//ฟังก์ชันยกเลิกนัดหมายที่หมดอายุแล้ว (Pending / Waiting)
async function cancelExpiredPendingAppointments() {
  await pool.query(
    `WITH expired AS (
      UPDATE clinic.appointments a
      SET status = 'cancelled',
        action_taken = true,
        cancellation_reason = COALESCE(
          NULLIF(BTRIM(a.cancellation_reason), ''),
          'ยกเลิกอัตโนมัติ เนื่องจากเลยวันที่นัดหมายแล้ว'
          )
      FROM clinic.appointment_slots slot
      WHERE a.slot_id = slot.slot_id
        AND a.status IN ('pending','waiting')
        AND slot.service_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date
      RETURNING a.slot_id
      )
    UPDATE clinic.appointment_slots slot
    SET status = 'open'
    FROM expired
    WHERE slot.slot_id = expired.slot_id
    `,
  );
}

//จองคิว เลือกช่องการจอง
//1. กัน slot เดียวถูกจองซ้ำ
//2. กันผู้ใช้คนเดิมจองหลายเวลาในวันเดียวกัน
//3. จองสำเร็จแล้วปิด slot เป็น closed(ปิด)

//ฟังก์ชันบวกหรือลบจำนวนวันจากวันที่เดิม
function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

//ฟังก์ชันเปลี่ยน Date เป็นรูปแบบ YYYY-MM-DD
function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

//ฟังก์ชันวันที่ตาม TimeZone
function getTodayBangkokDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

//ฟังก์ชันคำนวณวันเริ่มต้นและสิ้นสุดของสัปดาห์ปัจจุบัน
function getCurrentWeekRangeBangkok() {
  const todayKey = getTodayBangkokDate();
  const today = new Date(`${todayKey}T00:00:00.000Z`);
  const day = today.getUTCDay();
  const daysFromMonday = (day + 6) % 7;
  const start = addDays(today, -daysFromMonday);
  const end = addDays(start, 6);

  return {
    start: formatUtcDate(start), //2026-07-20
    end: formatUtcDate(end), //2026-07-26
  };
}

//ฟังก์ชันตรวจสอบวันที่อยู่ในสัปดาห์ปัจจุบันหรือไม่
function isDateInCurrentWeek(date) {
  const { start, end } = getCurrentWeekRangeBangkok();
  const value = String(date).slice(0, 10);
  return value >= start && value <= end;
}

//Router ของผู้ใช้จองนัดหมาย
router.post("/", authRequired, async (req, res) => {
  const { slot_id, service_type } = req.body;
  const user_id = req.user.user_id;

  if (!["user", "users"].includes(req.user.role)) {
    return res.status(403).json({ error: "บัญชีผู้ใช้เท่านั้นที่สามารถจองคิวได้" });
  }

  //ตรวจข้อมูลการจอง (service_type ต้องไม่เป็นข้อความว่าง)
  if (!slot_id || !service_type || !String(service_type).trim()) {
    return res
      .status(400)
      .json({ error: "กรุณาเลือกช่วงเวลาและกรอกหัวข้อนัดหมาย" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    //ตรวจสอบบัญชีผู้ใช้ (ตรวจสอบ user_id และ Role)
    const userResult = await client.query(
      `SELECT u.user_id
      FROM clinic.users u
      JOIN clinic.user_details d ON d.user_id = u.user_id
      WHERE u.user_id = $1
        AND LOWER(u.role::text) IN ('user','users')
        AND u.account_status = 'active'
        AND u.email_verified_at IS NOT NULL
        AND u.profile_completed_at IS NOT NULL
        AND d.national_id IS NOT NULL
      LIMIT 1`,
      [user_id],
    );

    //หากบัญชีถูกลบหรือไม่ใช้ผู้ใช้ทั่วไป
    if (!userResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "กรุณายืนยันอีเมลและกรอกข้อมูลผู้ป่วยให้ครบก่อนจองคิว",
        profile_incomplete: true,
      });
    }

    //1. ล็อก slot(ด้วย FOR UPDATE = ล็อกแถว Slot ช่วยป้องกันกรณีผู้ใช้สองคนจอง Slot เดียวกันพร้อมกัน)
    const slotResult = await client.query(
      `
      SELECT slot_id, service_date::text AS service_date, avaliable_date, hour_of_day, status
      FROM clinic.appointment_slots
      WHERE slot_id = $1
      FOR UPDATE`,
      [slot_id],
    );

    //ถ้าไม่พบ Slot ที่เลือก
    if (slotResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "ไม่พบนัดหมายนี้" });
    }

    const slot = slotResult.rows[0]; //ดึงข้อมูล Slot แถวแรกมาเก็บไว้ในตัวแปร slot

    // ผู้ใช้จองได้ในสัปดาห์ปัจจุบัน หรือสัปดาห์ล่วงหน้าที่เจ้าหน้าที่เปิดไว้
    await ensureCalendarRulesSchema(client);
    if (!isDateInCurrentWeek(slot.service_date) && !(await isAdvanceBookingDate(client, slot.service_date))) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "วันที่นี้ยังไม่เปิดให้จอง กรุณาเลือกสัปดาห์ปัจจุบันหรือสัปดาห์ที่คลินิกเปิดล่วงหน้า",
        current_week: getCurrentWeekRangeBangkok(), //ส่งช่วงเวลาปัจจุบันกลับไป
      });
    }

    const holiday = await isClinicHoliday(client, slot.service_date);
    if (holiday) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: holiday.reason || "คลินิกหยุดให้บริการในวันที่เลือก",
        is_holiday: true, //flag ว่าเป็นวันหยุด
      });
    }

    //เปิด Slot ที่สามาถกลับมาจองได้ของวันที่เลือก
    await reopenBookableSlotsForDate(client, slot.service_date);
    const refreshedSlot = await client.query(
      `SELECT status
      FROM clinic.appointment_slots
      WHERE slot_id = $1`,
      [slot_id],
    );
    slot.status = refreshedSlot.rows[0]?.status || slot.status; //อัปเดตสถานะในตัวแปร slot

    if (!getQueueNoForHour(slot.hour_of_day)) {
      //ตรวจสอบว่าเวลานัดอยู่ในช่วงคิวที่กำหยดหรือไม่
      await client.query("ROLLBACK");
      return res.status(400).json({
        error:
          "เลือกได้เฉพาะคิวเช้า 07:00 น. - 10:00 น. หรือคิวบ่าย 16:00 น. - 19:00 น.",
      });
    }

    //นับจำนวนการจองทั้งหมดของวันที่ผู้ใช้เลือก(1 วันจองได้ 8 คิว)
    const dailyCapacityResult = await client.query(
      `SELECT COUNT(*)::int AS booked_count
      FROM clinic.appointments a
      JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
      WHERE s.service_date = $1
        AND s.hour_of_day IN (7, 8, 9, 10, 16, 17, 18, 19)
        AND a.status NOT IN ('cancelled', 'rejected')`,
      [slot.service_date],
    );

    //จำกัดจำนวนคิวออนไลน์สูงสุด 8 คิวต่อวัน
    if (Number(dailyCapacityResult.rows[0]?.booked_count || 0) >= 8) {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({ error: "คิวของวันที่เลือกเต็มแล้ว (สูงสุด 8 คิวต่อวัน)" });
    }

    //2. ถ้า slot ไม่ใช้ open ห้ามจอง
    if (
      String(slot.status || "")
        .trim()
        .toLowerCase() !== "open"
    ) {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({ error: "ช่วงเวลานี้ไม่สามารถจองได้ กรุณาเลือกเวลาอื่น" });
    }

    //3.เช็กว่า slot นี้มีคนจองไปแล้วหรือยัง
    const slotBookedResult = await client.query(
      `SELECT appointment_id
      FROM clinic.appointments
      WHERE slot_id =$1
        AND status NOT IN ('cancelled', 'rejected')
      LIMIT 1`,
      [slot_id],
    );

    //ถ้าพบข้อมูล แสดงว่า Slot ถูกจองแล้ว
    if (slotBookedResult.rows.length > 0) {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({ error: "ช่วงเวลานี้ถูกจองแล้ว กรุณาเลือกเวลาอื่น" });
    }

    // ล็อกระดับ transaction ตาม user + วันที่ เพื่อกันผู้ใช้คนเดียวส่งคำขอ
    // ไปคนละ Slot ในวันเดียวกันพร้อมกันจากหลายอุปกรณ์
    await client.query(
      `SELECT pg_advisory_xact_lock(
         $1::integer,
         ($2::date - DATE '2000-01-01')::integer
       )`,
      [user_id, slot.service_date],
    );

    //4.เช็ก user คนนี้มีนัดในวันเดียวกันหรือไม่
    const userSameDayResult = await client.query(
      `SELECT a.appointment_id
      FROM clinic.appointments a
      JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
      WHERE a.user_id = $1
        AND s.service_date = $2
        AND a.status NOT IN ('cancelled', 'rejected')
      LIMIT 1`,
      [user_id, slot.service_date],
    );

    if (userSameDayResult.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "คุณมีนัดหมายในวันนี้แล้ว ไม่สามารถจองหลายเวลาในวันเดียวกันได้",
        code: "USER_ALREADY_BOOKED_DATE",
      });
    }

    //5. บันทึกการจองคิว
    const result = await client.query(
      `INSERT INTO clinic.appointments(user_id,slot_id,service_type,status)
      VALUES($1,$2,$3, 'pending')
      RETURNING *`,
      [user_id, slot_id, String(service_type).trim()],
    );

    //6. ปิด slot นี้ เพื่อไม่ใช้ผู้ใช้อื่นเห็นเป็นเวลาว่าง
    await client.query(
      `UPDATE clinic.appointment_slots
      SET status ='closed'
      WHERE slot_id = $1`,
      [slot_id],
    );

    //ดึงข้อมูลผู้ใช้งานและข้อมูลนัดหมาย เพื่อใช้ส่งเมล
    const mailResult = await client.query(
      `SELECT COALESCE(u.email,d.email) AS email,
        d.first_name,a.service_type,s.service_date,s.hour_of_day
      FROM clinic.appointments a
      JOIN clinic.users u ON u.user_id = a.user_id
      LEFT JOIN clinic.user_details d ON d.user_id = a.user_id
      JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
      WHERE a.appointment_id = $1`,
      [result.rows[0].appointment_id],
    );

    await client.query("COMMIT"); //ยืนยันการจองคิวสำเร็จ

    let emailSent = false; // กำหนดค่าเริ่มต้นว่ายังส่งอีเมลไม่สำเร็จ

    try {
      await sendPendingEmail(mailResult.rows[0]); //ส่งอีเมลแจ้งว่าการจองกำลังรออนุมัติ
      emailSent = true;
    } catch (mailError) {
      console.error("ส่งอีเมลรอการอนุมัติไม่สำเร็จ :", mailError.message);
    }

    //ส่งผลการจองกลับไปยังผู้ใช้
    res.status(201).json({
      message: "จองนัดหมายสำเร็จ",
      appointment: result.rows[0],
      email_sent: emailSent,
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("POST /appointments error:", error);

    res.status(400).json({ error: error.message || "จองคิวไม่สำเร็จ" });
  } finally {
    client.release();
  }
});

// User ดูนัดหมายของตัวเอง
router.get("/user/:userId", authRequired, async (req, res) => {
  const { userId } = req.params; //รับ userId จาก URL
  const isStaff = ["admin", "super_admin", "superadmin", "doctor", "assistant"].includes(
    req.user.role,
  );

  if (!isStaff && Number(userId) !== Number(req.user.user_id)) {
    return res.status(403).json({ error: "ไม่อนุญาตให้ดูนัดหมายของผู้ใช้อื่น" });
  }

  try {
    const result = await pool.query(
      `SELECT
        a.appointment_id,
        a.status,
        a.service_type,
        a.created_at,
        a.cancellation_reason,
        s.service_date,
        s.avaliable_date,
        s.hour_of_day,
        q.queue_number,
        ac.used_at AS access_code_used_at,
        ac.expires_at AS access_code_expires_at,
        ac.code_ciphertext,
        CASE
          WHEN ac.used_at IS NOT NULL THEN 'used'
          WHEN ac.expires_at <= now() THEN 'expired'
          WHEN ac.access_code_id IS NOT NULL THEN 'available'
          ELSE 'not_issued'
        END AS access_code_status
      FROM clinic.appointments a
      JOIN clinic.appointment_slots s ON a.slot_id = s.slot_id
      LEFT JOIN clinic.queue_tickets q ON q.appointment_id = a.appointment_id AND q.status <> 'cancelled'
      LEFT JOIN clinic.appointment_access_codes ac ON ac.appointment_id = a.appointment_id
      WHERE a.user_id = $1
      ORDER BY s.service_date ASC`,
      [userId],
    );
    const appointments = result.rows.map(({ code_ciphertext, ...appointment }) => ({
      ...appointment,
      access_code: decryptAccessCode(code_ciphertext),
    }));
    res.json(appointments); //ส่งรายการนัดหมายกลับไปหน้าเว็บ
  } catch (error) {
    console.error("GET /appointments/user/:userId error:", error);
    res.status(500).json({ error: "โหลดนัดหมายล้มเหลว" });
  }
});

// Return the already-issued code. Viewing a code must never rotate or invalidate
// the copy that was sent in the approval email.
router.post("/:id/access-code", authRequired, async (req, res, next) => {
  const appointmentId = Number(req.params.id);
  if (!appointmentId) return res.status(400).json({ message: "appointment_id ไม่ถูกต้อง" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT a.appointment_id, a.user_id, a.status, q.queue_id, q.queue_number,
              ac.code_ciphertext, ac.expires_at, ac.used_at
       FROM clinic.appointments a
       JOIN clinic.queue_tickets q ON q.appointment_id = a.appointment_id AND q.status <> 'cancelled'
       LEFT JOIN clinic.appointment_access_codes ac ON ac.appointment_id = a.appointment_id
       WHERE a.appointment_id = $1 FOR UPDATE OF a`,
      [appointmentId],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "ไม่พบนัดหมาย" });
    }
    const row = result.rows[0];
    const isStaff = ["admin", "super_admin", "superadmin", "doctor", "assistant"].includes(req.user.role);
    if (!isStaff && Number(row.user_id) !== Number(req.user.user_id)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "ไม่อนุญาตให้ดูรหัสของนัดหมายอื่น" });
    }
    if (row.status !== "approved") {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "นัดหมายต้องได้รับการอนุมัติก่อน" });
    }
    const accessCode = decryptAccessCode(row.code_ciphertext);
    if (!accessCode) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "ไม่สามารถแสดงรหัสเดิมได้ กรุณาติดต่อ Admin เพื่อออกรหัสใหม่",
        status: row.used_at ? "used" : new Date(row.expires_at) <= new Date() ? "expired" : "unavailable",
      });
    }
    await client.query("COMMIT");
    return res.json({
      appointment_id: appointmentId,
      queue_number: row.queue_number,
      access_code: accessCode,
      expires_at: row.expires_at,
      status: row.used_at ? "used" : new Date(row.expires_at) <= new Date() ? "expired" : "available",
    });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    return next(error);
  } finally {
    client.release();
  }
});

router.get("/check-in/search", requireStaff, async (req, res, next) => {
  const nationalId = String(req.query.national_id || "").replace(/\D/g, "");
  const phone = String(req.query.phone || "").replace(/\D/g, "");
  if (!/^\d{13}$/.test(nationalId) || !/^\d{9,10}$/.test(phone)) {
    return res.status(400).json({ message: "กรุณากรอกเลขบัตรประชาชน 13 หลัก และเบอร์โทรศัพท์ 9-10 หลัก" });
  }
  try {
    const result = await pool.query(
      `SELECT a.appointment_id, a.status, a.service_type,
              s.service_date::text, s.hour_of_day, s.avaliable_date,
              u.user_id, d.first_name, d.last_name,
              CASE
                WHEN u.email IS NULL THEN NULL
                ELSE LEFT(u.email, 2) || '***@' || SPLIT_PART(u.email, '@', 2)
              END AS masked_email,
              q.queue_id, q.queue_number,
              EXISTS (SELECT 1 FROM clinic.measurements m WHERE m.queue_id = q.queue_id) AS has_measurement,
              c.verified_at AS checked_in_at
       FROM clinic.user_details d
       JOIN clinic.users u ON u.user_id = d.user_id
       JOIN clinic.appointments a ON a.user_id = u.user_id
       JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
       LEFT JOIN clinic.queue_tickets q ON q.appointment_id = a.appointment_id AND q.status <> 'cancelled'
       LEFT JOIN clinic.patient_checkins c ON c.appointment_id = a.appointment_id
       WHERE d.national_id = $1
         AND REGEXP_REPLACE(COALESCE(d.phone, ''), '[^0-9]', '', 'g') = $2
         AND s.service_date = (now() AT TIME ZONE 'Asia/Bangkok')::date
       ORDER BY s.hour_of_day`,
      [nationalId, phone],
    );
    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/check-in", requireStaff, async (req, res, next) => {
  const appointmentId = Number(req.params.id);
  const nationalId = String(req.body?.national_id || "").replace(/\D/g, "");
  const phone = String(req.body?.phone || "").replace(/\D/g, "");
  const verificationNote = String(req.body?.verification_note || "ตรวจบัตรประชาชนตัวจริง").trim();
  if (!appointmentId || !/^\d{13}$/.test(nationalId) || !/^\d{9,10}$/.test(phone)) {
    return res.status(400).json({ message: "ข้อมูลตรวจสอบตัวตนไม่ครบ" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const appointment = await client.query(
      `SELECT a.appointment_id, a.user_id, a.status, q.queue_id, q.queue_number
       FROM clinic.appointments a
       JOIN clinic.user_details d ON d.user_id = a.user_id
       LEFT JOIN clinic.queue_tickets q ON q.appointment_id = a.appointment_id AND q.status <> 'cancelled'
       JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
       WHERE a.appointment_id = $1 AND d.national_id = $2
         AND REGEXP_REPLACE(COALESCE(d.phone, ''), '[^0-9]', '', 'g') = $3
         AND s.service_date = (now() AT TIME ZONE 'Asia/Bangkok')::date
       FOR UPDATE OF a`,
      [appointmentId, nationalId, phone],
    );
    if (!appointment.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "ไม่พบนัดหมายที่ตรงกับข้อมูลยืนยันตัวตน" });
    }
    const row = appointment.rows[0];
    if (row.status !== "approved") {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: row.status === "pending" || row.status === "waiting" ? "ต้องอนุมัตินัดหมายก่อน Check-in" : "นัดหมายนี้ถูกยกเลิกแล้ว ให้ดำเนินการเป็น Walk-in" });
    }
    if (!row.queue_id) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "นัดหมายยังไม่มีคิว กรุณาอนุมัตินัดหมายใหม่" });
    }
    const measured = await client.query(
      `SELECT 1 FROM clinic.measurements WHERE queue_id = $1 LIMIT 1`,
      [row.queue_id],
    );
    if (measured.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "ผู้ป่วยชั่งน้ำหนักสำหรับคิวนี้แล้ว" });
    }
    const accessCode = generateAccessCode();
    const code = await client.query(
      `INSERT INTO clinic.appointment_access_codes
       (appointment_id, queue_id, code_hash, code_ciphertext, expires_at, issued_by, issue_reason)
       VALUES ($1,$2,$3,$4,now() + interval '15 minutes',$5,'staff_checkin')
       ON CONFLICT (appointment_id) DO UPDATE
       SET queue_id = EXCLUDED.queue_id, code_hash = EXCLUDED.code_hash,
           code_ciphertext = EXCLUDED.code_ciphertext, used_at = NULL,
           expires_at = EXCLUDED.expires_at, issued_by = EXCLUDED.issued_by,
           issue_reason = EXCLUDED.issue_reason, created_at = now()
       RETURNING expires_at`,
      [appointmentId, row.queue_id, hashAccessCode(accessCode), encryptAccessCode(accessCode), req.user.user_id],
    );
    await client.query(
      `INSERT INTO clinic.patient_checkins
       (appointment_id,user_id,verified_by_user_id,verification_method,verification_note,
        code_issued_at,code_expires_at,reason)
       VALUES ($1,$2,$3,'national_id_phone',$4,now(),$5,'forgot_email')
       ON CONFLICT (appointment_id) DO UPDATE
       SET verified_by_user_id = EXCLUDED.verified_by_user_id,
           verification_method = EXCLUDED.verification_method,
           verification_note = EXCLUDED.verification_note,
           verified_at = now(), code_issued_at = now(), code_expires_at = EXCLUDED.code_expires_at`,
      [appointmentId, row.user_id, req.user.user_id, verificationNote, code.rows[0].expires_at],
    );
    await client.query("COMMIT");
    return res.json({
      message: "ยืนยันตัวตนและ Check-in สำเร็จ",
      appointment_id: appointmentId,
      queue_number: row.queue_number,
      access_code: accessCode,
      expires_at: code.rows[0].expires_at,
    });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    return next(error);
  } finally {
    client.release();
  }
});

//ดูรายการนัดที่อนุมัติแล้ว ในช่วงเวลาที่กำหนด
router.get("/approved-week", requireStaff, async (req, res) => {
  const { start, end } = req.query; //รับวันที่เริ่มต้นและสิ้นสุดจาก URL

  if (!start || !end) {
    //ถ้าไม่ได้ส่งวันที่มา
    return res.status(400).json({ error: "ต้องระบุ start และ end" });
  }

  //ค้นหานัดหมายที่อนุมัติแล้วในช่วงเวลาที่กำหนด
  try {
    const { rows } = await pool.query(
      `SELECT
        a.appointment_id,
        s.service_date,
        s.hour_of_day,
        a.status,
        u.user_id,
        d.first_name,
        d.last_name,
        ac.code_ciphertext,
        ac.expires_at AS access_code_expires_at,
        ac.used_at AS access_code_used_at
      FROM clinic.appointments a
      JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
      JOIN clinic.users u ON u.user_id = a.user_id
      LEFT JOIN clinic.user_details d ON d.user_id = u.user_id
      LEFT JOIN clinic.appointment_access_codes ac ON ac.appointment_id = a.appointment_id
      WHERE a.status = 'approved'
        AND s.service_date BETWEEN $1 AND $2
      ORDER BY s.service_date,s.hour_of_day`,
      [start, end],
    );
    for (const row of rows) {
      row.access_code =
        !row.access_code_used_at && row.access_code_expires_at && new Date(row.access_code_expires_at) > new Date()
          ? decryptAccessCode(row.code_ciphertext)
          : null;
      delete row.code_ciphertext;
    }
    res.json(rows); //ส่งรายการนัดที่อนุมัติแล้วกลับไปหน้าเว็บ
  } catch (error) {
    console.error("GET/appointments/approved-week error:", error);
    res.status(500).json({ error: "โหลดรายการนัดหมายรายสัปดาห์ล้มเหลว" });
  }
});

// Admin ดูนัดหมายทุกคน
router.get("/", verifyAdmin, async (_req, res) => {
  try {
    await cancelExpiredPendingAppointments(); // ยกเลิกนัดที่ยังรออนุมัติแต่เลยวันนัดแล้ว
    const result = await pool.query(
      `SELECT
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
        ac.code_ciphertext,
        ac.expires_at AS access_code_expires_at,
        ac.used_at AS access_code_used_at,
        EXISTS(                        -- ตรวจสอบว่ามีการบันทึกข้อมูลการชั่งน้ำหนักหรือไม่
          SELECT 1
          FROM clinic.measurements m
          WHERE m.queue_id = q.queue_id
        ) AS has_measurement,
        EXISTS(                        -- ตรวจสอบว่ามีการบันทึกข้อมูลการตรวจสุขภาพหรือไม่
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
      LEFT JOIN clinic.appointment_access_codes ac ON ac.appointment_id = a.appointment_id
      ORDER BY
        s.service_date ASC,
        CASE
          WHEN s.avaliable_date = 'morning' THEN 1
          WHEN s.avaliable_date = 'afternoon' THEN 2
          ELSE 3
        END,
        COALESCE(q.numeric_no,s.hour_of_day),
        s.hour_of_day`,
    );
    const appointments = result.rows.map(({ code_ciphertext, ...appointment }) => ({
      ...appointment,
      access_code:
        !appointment.access_code_used_at &&
        appointment.access_code_expires_at &&
        new Date(appointment.access_code_expires_at) > new Date()
          ? decryptAccessCode(code_ciphertext)
          : null,
    }));
    res.json(appointments); //ส่งรายการนัดหมายทั้งหมดกลับไปยัง Admin
  } catch (error) {
    console.error("GET/appointment error:", error);
    res.status(500).json({ error: "โหลดข้อมูลทั้งหมดล้มเหลว" });
  }
});

// Update สถานะ approve / cancel (อนุมัติ / ยกเลิก)
router.patch("/:id/cancellation-reason", verifyAdmin, async (req, res) => {
  const reason = String(req.body?.cancellation_reason || "").trim(); //อ่านเหตุผลยกเลิก แปลงเป็นข้อความ

  if (!reason) {
    return res.status(400).json({ error: "กรุณาระบุหมายเหตุการยกเลิก" });
  }

  if (reason.length > 500) {
    return res.status(400).json({ error: "หมายเหตุต้องไม่เกิน 500 ตัวอักษร" });
  }

  //อัปเดทรายการยกเลิก
  try {
    const result = await pool.query(
      `UPDATE clinic.appointments
      SET cancellation_reason = $1
      WHERE appointment_id =$2
        AND status IN ('cancelled','rejected')
      RETURNING appointment_id,status,cancellation_reason`,
      [reason, req.params.id],
    );

    if (!result.rowCount) {
      return res
        .status(404)
        .json({ error: "ไม่พบรายการยกเลิกที่ต้องการแก้ไข" });
    }

    res.json({ message: "แก้ไขหมายเหตุแล้ว", appointment: result.rows[0] }); //ส่งรายการที่แก้ไข
  } catch (error) {
    console.error("PATCH/appointments/:id/cancellation-reason error:", error);
    res.status(500).json({ error: "แก้ไขหมายเหตุไม่สำเร็จ" });
  }
});

//Admin อัปเดตสถานะนัดหมาย (อนุมัติ / ยกเลิก / ปฎิเสธ)
router.put("/:id", verifyAdmin, async (req, res, next) => {
  const { id } = req.params;
  const { status, cancellation_reason = null } = req.body || {};

  //ตรวจสอบสถานะที่ส่งมา
  if (!status || !["approved", "cancelled", "rejected"].includes(status)) {
    return res.status(400).json({ error: " status ไม่ถูกต้อง" });
  }

  if (
    ["cancelled", "rejected"].includes(status) &&
    !String(cancellation_reason || "").trim()
  ) {
    return res.status(400).json({ error: "กรุณาระบุเหตุผลที่ยกเลิก" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    //ดึงข้อมูลนัดและล็อกแถวไว้ ป้องกันการแก้ไขพร้อมกัน
    const appointmentResult = await client.query(
      `SELECT a.*,COALESCE(u.email, d.email) AS email,d.first_name,s.service_date,s.hour_of_day
      FROM clinic.appointments a
      JOIN clinic.users u ON u.user_id = a.user_id
      LEFT JOIN clinic.user_details d ON d.user_id = a.user_id
      JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
      WHERE a.appointment_id =$1
      FOR UPDATE OF a`,
      [id],
    );

    if (!appointmentResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "ไม่พบนัดหมาย" });
    }

    const appointmentDetails = appointmentResult.rows[0]; // เก็บรายละเอียดนัดไว้สร้างคิวและส่งอีเมล

    //อัปเดตสถานะนัดหมายและเหตุผลการยกเลิก
    const update = await client.query(
      `UPDATE clinic.appointments
      SET status = $1,
        action_taken = true,
        cancellation_reason = $2
      WHERE appointment_id =$3
      RETURNING*`,
      [
        status,
        ["cancelled", "rejected"].includes(status)
          ? String(cancellation_reason).trim()
          : null,
        id,
      ], //ส่งสถานะเฉพาะกรณียกเลิกและรหัส Appointment เข้าฐานข้อมูล
    );

    if (!update.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "ไม่พบนัดหมาย" });
    }

    let queue = null;
    let accessCode = null;

    //ถ้าอนุมัติ ให้สร้างหมายเลขคิวและรหัสยืนยัน
    if (status === "approved") {
      queue = await issueQueueFromAppointment(client, id); //สร้างหรืออ่านหมายเลขคิวจากนัดหมาย
      accessCode = generateAccessCode(); //สร้างรหัสยืนยัน 6 หลัก
      await client.query(
        `INSERT INTO clinic.appointment_access_codes(appointment_id,queue_id,code_hash,code_ciphertext,expires_at)
        VALUES($1,$2,$3,$4,(($5::date +($6::int * interval'1hour')) AT TIME ZONE 'Asia/Bangkok') + interval'15 minutes')
        ON CONFLICT(appointment_id) DO UPDATE
        SET queue_id = EXCLUDED.queue_id,
          code_hash = EXCLUDED.code_hash,
          code_ciphertext = EXCLUDED.code_ciphertext,
          used_at= NULL,
          expires_at = EXCLUDED.expires_at,
          created_at = now()`,
        [
          id,
          queue.queue_id,
          hashAccessCode(accessCode),
          encryptAccessCode(accessCode),
          appointmentDetails.service_date,
          appointmentDetails.hour_of_day,
        ],
      );
    }

    //ถ้ายกเลิก ให้ยกเลิกคิวและคืน slot เป็น Open และลบรหัสยืนยัน
    if (status === "cancelled" || status === "rejected") {
      await client.query(
        `UPDATE clinic.queue_tickets
        SET status = 'cancelled'
        WHERE appointment_id = $1`,
        [id],
      );

      await client.query(
        `UPDATE clinic.appointment_slots s
        SET status = 'open'
        FROM clinic.appointments a
        WHERE a.slot_id = s.slot_id
          AND a.appointment_id = $1`,
        [id],
      );

      await client.query(
        `DELETE FROM clinic.appointment_access_codes WHERE appointment_id = $1`,
        [id],
      );
    }

    await client.query("COMMIT"); //ยืนยันการอัปเดตนัดหมายสำเร็จ

    let emailSent = false; //ส่งเมลแจ้งผู้ใช้งาน
    try {
      if (status === "approved") {
        await sendApprovedEmail(appointmentDetails, queue, accessCode); //ส่งอีเมลอุมัติพร้อมหมายเลขคิวและรหัสยืนยัน
      } else {
        //แต่ถ้ายกเลิกให้ส่งอีเมลพร้อมเหตุผลการยกเลิก
        await sendCancelledEmail(
          appointmentDetails,
          String(cancellation_reason).trim(),
        );
      }
      emailSent = true; //ส่งอีเมลสำเร็จ
    } catch (mailError) {
      console.error("ส่งอีเมลการจองไม่สำเร็จ:", mailError.message);
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

//Admin ส่งรหัสยืนยัน 6 หลักให้ผู้ใช้อีกครั้ง
router.post("/:id/resend-code", verifyAdmin, async (req, res, next) => {
  const { id } = req.params;
  if (!["admin", "super_admin", "superadmin"].includes(req.user.role)) {
    return res.status(403).json({ error: "เฉพาะ Admin หรือ Super Admin เท่านั้นที่ออกรหัสใหม่ได้" });
  }
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    //ดึงข้อมูลนัดหมาย ผู้ใช้ วันเวลา และหมายเลขคิว
    const result = await client.query(
      `SELECT a.*, COALESCE(u.email,d.email) AS email,d.first_name,s.service_date,s.hour_of_day,q.queue_id,q.queue_number
      FROM clinic.appointments a
      JOIN clinic.users u ON u.user_id = a.user_id
      LEFT JOIN clinic.user_details d ON d.user_id = a.user_id
      JOIN clinic.appointment_slots s ON s.slot_id =a.slot_id
      JOIN clinic.queue_tickets q ON q.appointment_id = a.appointment_id
      WHERE a.appointment_id =$1
        AND a.status ='approved'
        AND q.status <> 'cancelled'
      FOR UPDATE OF a`,
      [id],
    );

    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "ไม่พบนัดหมายที่อนุมัติแล้ว" });
    }

    const appointment = result.rows[0]; //ดึงข้อมูลแถวแรกของนัดหมายที่อนุมัติเก็บไว้

    const accessCode = generateAccessCode(); //สร้างรหัสยืนยันใหม้ 6 หลัก
    const savedCode = await client.query(
      `INSERT INTO clinic.appointment_access_codes(appointment_id,queue_id,code_hash,code_ciphertext,expires_at,issued_by,issue_reason)
      VALUES($1,$2,$3,$4,
        GREATEST(
          (($5::date + ($6::int*interval'1 hour')) AT TIME ZONE 'Asia/Bangkok') + interval'15 minutes',
          now() + interval '15 minutes'
        ),$7,'admin_resend')
      ON CONFLICT (appointment_id) DO UPDATE
      SET queue_id = EXCLUDED.queue_id,
        code_hash = EXCLUDED.code_hash,
        code_ciphertext = EXCLUDED.code_ciphertext,
        used_at =NULL,
        expires_at =EXCLUDED.expires_at,
        issued_by = EXCLUDED.issued_by,
        issue_reason = EXCLUDED.issue_reason,
        created_at = now()
      RETURNING expires_at`,
      [
        id,
        appointment.queue_id,
        hashAccessCode(accessCode),
        encryptAccessCode(accessCode),
        appointment.service_date,
        appointment.hour_of_day,
        req.user.user_id,
      ],
    );

    await client.query("COMMIT"); //ยืนยันการบันทึกรหัสใหม่

    let emailSent = false;

    //ส่งอีเมลหมายเลขคิวและรหัสยืนยันใหม่
    try {
      if (appointment.email) {
        await sendApprovedEmail(
          appointment,
          {
            queue_id: appointment.queue_id,
            queue_number: appointment.queue_number,
        },
        accessCode,
        savedCode.rows[0].expires_at,
      );
        emailSent = true; // ส่งอีเมลสำเร็จ
      }
    } catch (mailerror) {
      console.error("ส่งรหัสคิวอีกครั้งไม่สำเร็จ", mailerror.message);
    }

    return res.status(200).json({
      message: emailSent
        ? "ส่งรหัสใหม่ทางอีเมลแล้ว"
        : appointment.email
          ? "สร้างรหัสใหม่แล้ว แต่ส่งอีเมลไม่สำเร็จ กรุณาแจ้งรหัสให้ผู้ป่วยโดยตรง"
          : "สร้างรหัสใหม่แล้ว ผู้ป่วยไม่มีอีเมล กรุณาแจ้งรหัสให้ผู้ป่วยโดยตรง",
      email_sent: emailSent,
      email_available: Boolean(appointment.email),
      access_code: accessCode,
      expires_at: savedCode.rows[0].expires_at,
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    next(error);
  } finally {
    client.release();
  }
});

//Admin ลบนัดหมาย
router.delete("/:id", verifyAdmin, async (req, res) => {
  const appointmentId = Number(req.params.id);

  //ตรวจสอบว่า appointment_id ต้องเป็นจำนวนเต็มและมากกว่า 0
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return res.status(400).json({ error: "appointment_id ไม่ถูกต้อง" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    //ค้นหานัดหมายที่ต้องการลบ
    const appointment = await client.query(
      `SELECT appointment_id, slot_id, status
      FROM clinic.appointments
      WHERE appointment_id = $1
      FOR UPDATE`,
      [appointmentId],
    );

    if (!appointment.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "ไม่พบนัดหมาย" });
    }

    const row = appointment.rows[0];

    //ถ้านัดอนุมัติแล้วจะไม่อนุญาติให้ลบ, ควรเปลี่ยนเป็นยกเลิกแทน
    if (row.status === "approved") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "นัดหมายที่อนุมัติแล้วควรยกเลิกแทนการลบ",
      });
    }

    //ลบนัดหมายออกจากตาราง
    await client.query(
      `DELETE FROM clinic.appointments
        WHERE appointment_id = $1`,
      [appointmentId],
    );

    //ตรวจสอบว่ามี slot_id หรือไม่
    if (row.slot_id) {
      await client.query(
        `UPDATE clinic.appointment_slots
        SET status = 'open'
        WHERE slot_id = $1
          AND NOT EXISTS (
            SELECT 1
            FROM clinic.appointments
            WHERE slot_id = $1
              AND status NOT IN ('cancelled', 'rejected')
          )`,
        [row.slot_id],
      );
    }

    await client.query("COMMIT"); //ยืนยันการลบนัดและเปิด slot

    return res.json({
      message: "ลบนัดหมายแล้ว",
      appointment_id: appointmentId,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("DELETE /appointments/:id error:", error);
    return res.status(500).json({ error: "ลบนัดหมายไม่ได้" });
  } finally {
    client.release();
  }
});

module.exports = router;
