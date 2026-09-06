const express = require("express");
const router = express.Router();
const pool = require("../tools/db");
const { authRequired, requireStaff } = require("../tools/_utils");
const {
  DEFAULT_SUNDAY_REASON,
  ensureCalendarRulesSchema,
  isAdvanceBookingDate,
  isClinicHoliday,
  monthHolidayQuery,
} = require("../tools/calendarRules");
const {
  ensureSlotsForDate,
  ensureSlotsForRange,
  reopenBookableSlotsForDate,
  reopenBookableSlotsForRange,
} = require("../tools/slotSeeder");

// วันที่วันนี้ตามเวลาไทย
function getTodayBangkokDate() {
  const now = new Date();

  const bangkokDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  return bangkokDate;
}

// เช็กว่าวันที่เป็นวันย้อนหลังไหม
function isPastDate(date) {
  const today = getTodayBangkokDate();
  return String(date) < today;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
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

// ดึง slot ทั้งหมดของวันเดียว
// ถ้าวันนั้นยังไม่มี slot ให้สร้างจาก template อัตโนมัติก่อน
router.get("/day", async (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ error: "ต้องระบุ date=YYYY-MM-DD" });
  }

  if (isPastDate(date)) {
    return res.status(400).json({
      error: "ไม่สามารถจองย้อนหลังได้",
    });
  }

  try {
    await ensureCalendarRulesSchema(pool);
    if (!isDateInCurrentWeek(date) && !(await isAdvanceBookingDate(pool, date))) {
      return res.status(400).json({
        error: "วันที่นี้ยังไม่เปิดให้จอง กรุณาเลือกสัปดาห์ปัจจุบันหรือสัปดาห์ที่คลินิกเปิดล่วงหน้า",
        current_week: getCurrentWeekRangeBangkok(),
      });
    }
    const holiday = await isClinicHoliday(pool, date);
    if (holiday) {
      return res.status(409).json({
        error: holiday.reason || "คลินิกหยุดให้บริการในวันนี้",
        is_holiday: true,
      });
    }

    // 1) สร้าง slot ของวันที่เลือกก่อน ถ้ายังไม่มี
    try {
      await pool.query(`SELECT clinic.seed_slots($1::date, $1::date)`, [date]);
    } catch (seedErr) {
      console.warn("Warning: seed_slots failed (function may not exist):", seedErr.message);
    }
    await ensureSlotsForDate(pool, date);
    await reopenBookableSlotsForDate(pool, date);

    // 2) ล็อก slot ที่หมดเวลาจองแล้ว
    try {
      await pool.query("SELECT clinic.lock_timed_out_slots()");
    } catch (lockErr) {
      console.warn("Warning: lock_timed_out_slots failed (function may not exist):", lockErr.message);
    }

    // 3) ดึง slot ของวันนั้นกลับไปให้ frontend
    // แก้แล้ว: ถ้ามี appointment อยู่แล้ว ให้ส่ง status เป็น closed
    const result = await pool.query(
      `
      SELECT
        s.slot_id,
        s.service_date,
        s.avaliable_date,
        s.hour_of_day,

        CASE
          WHEN a.appointment_id IS NOT NULL THEN 'closed'
          ELSE s.status
        END AS status,

        s.start_ts,
        s.bookable_until

      FROM clinic.appointment_slots s

      LEFT JOIN clinic.appointments a
        ON a.slot_id = s.slot_id
        AND a.status NOT IN ('cancelled', 'rejected')

      WHERE s.service_date = $1::date
        AND s.hour_of_day IN (7, 8, 9, 10, 16, 17, 18, 19)

      ORDER BY
        CASE
          WHEN s.avaliable_date = 'morning' THEN 1
          WHEN s.avaliable_date = 'afternoon' THEN 2
          ELSE 3
        END,
        s.hour_of_day
      `,
      [date]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("GET /slots/day error:", err);
    res.status(500).json({ error: "ดึง slot รายวันไม่สำเร็จ" });
  }
});

// ดึงสถานะปฏิทินรายเดือน สำหรับแสดงจุดสีในหน้า user
router.get("/month-status", async (req, res) => {
  const { year, month } = req.query;

  if (!year || !month) {
    return res.status(400).json({ error: "ต้องมี year และ month" });
  }

  try {
    await ensureCalendarRulesSchema(pool);
    const y = Number(year);
    const m = Number(month);

    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      return res.status(400).json({ error: "year หรือ month ไม่ถูกต้อง" });
    }

    const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
    // Build this as a UTC calendar date. Using a local midnight followed by
    // toISOString() moves the date back one day when the server runs in
    // Asia/Bangkok.
    const endDate = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

    // สร้าง slot ของเดือนนั้นก่อน เผื่อยังไม่มีข้อมูล slot
    try {
      await pool.query(`SELECT clinic.seed_slots($1::date, $2::date)`, [
        startDate,
        endDate,
      ]);
    } catch (seedErr) {
      console.warn("Warning: seed_slots failed (function may not exist):", seedErr.message);
    }
    await ensureSlotsForRange(pool, startDate, endDate);
    await reopenBookableSlotsForRange(pool, startDate, endDate);

    // ล็อก slot ที่หมดเวลาจองแล้ว
    try {
      await pool.query("SELECT clinic.lock_timed_out_slots()");
    } catch (lockErr) {
      console.warn("Warning: lock_timed_out_slots failed (function may not exist):", lockErr.message);
    }

    const result = await pool.query(
      `
      SELECT
        -- A PostgreSQL DATE has no timezone. Return it as text so the pg
        -- driver cannot turn Bangkok midnight into the previous UTC date.
        s.service_date::text AS date,

        COUNT(s.slot_id)::int AS total_slots,

        COUNT(a.appointment_id)::int AS booked_slots,

        COUNT(s.slot_id) FILTER (
          WHERE s.status = 'open'
            AND a.appointment_id IS NULL
            AND h.service_date IS NULL
        )::int AS available_slots

        ,(
          h.service_date IS NOT NULL
          OR (
            EXTRACT(ISODOW FROM s.service_date)::int = 7
            AND o.service_date IS NULL
          )
        ) AS is_holiday,
        CASE
          WHEN h.service_date IS NOT NULL THEN h.reason
          WHEN EXTRACT(ISODOW FROM s.service_date)::int = 7
            AND o.service_date IS NULL THEN $3::text
          ELSE NULL
        END AS holiday_reason

      FROM clinic.appointment_slots s

      LEFT JOIN clinic.appointments a
        ON a.slot_id = s.slot_id
        AND a.status NOT IN ('cancelled', 'rejected')

      LEFT JOIN (
        SELECT service_date, MAX(reason) AS reason
        FROM clinic.clinic_holidays
        GROUP BY service_date
      ) h ON h.service_date = s.service_date

      LEFT JOIN clinic.clinic_open_days o
        ON o.service_date = s.service_date

      WHERE s.service_date BETWEEN $1::date AND $2::date
        AND s.hour_of_day IN (7, 8, 9, 10, 16, 17, 18, 19)

      GROUP BY s.service_date, h.service_date, h.reason, o.service_date
      ORDER BY s.service_date ASC
      `,
      [startDate, endDate, DEFAULT_SUNDAY_REASON]
    ).catch(err => {
      console.error("Query error for month-status:", {
        message: err.message,
        code: err.code,
        detail: err.detail,
        hint: err.hint,
        startDate,
        endDate,
      });
      throw err;
    });

    const data = result.rows.map((row) => {
      const date = String(row.date).slice(0, 10);

      const totalSlots = Number(row.total_slots || 0);
      const bookedSlots = Number(row.booked_slots || 0);
      const availableSlots = Number(row.available_slots || 0);

      let status = "available";

      if (row.is_holiday) {
        status = "holiday";
      } else if (availableSlots === 0) {
        status = "full";
      } else if (availableSlots <= 2) {
        status = "almost_full";
      } else {
        status = "available";
      }

      return {
        date,
        total_slots: totalSlots,
        booked_slots: bookedSlots,
        available_slots: availableSlots,
        status,
        is_holiday: Boolean(row.is_holiday),
        holiday_reason: row.holiday_reason || null,
      };
    });

    const holidayRows = await pool.query(
      monthHolidayQuery("", true),
      [y, m, DEFAULT_SUNDAY_REASON]
    );
    const knownDates = new Set(data.map((item) => item.date));

    holidayRows.rows.forEach((holiday) => {
      const date = String(holiday.holiday_date).slice(0, 10);
      if (knownDates.has(date)) return;

      data.push({
        date,
        total_slots: 0,
        booked_slots: 0,
        available_slots: 0,
        status: "holiday",
        is_holiday: true,
        holiday_reason: holiday.reason || (holiday.is_default ? DEFAULT_SUNDAY_REASON : "วันหยุดของคลินิก"),
      });
    });

    data.sort((a, b) => a.date.localeCompare(b.date));

    res.json(data);
  } catch (err) {
    console.error("GET /slots/month-status error:", err);
    res.status(500).json({ error: "โหลดสถานะปฏิทินรายเดือนไม่สำเร็จ" });
  }
});

// user เห็นปฏิทิน slot ทั้งหมด และนัดหมายของตนเองเท่านั้น
router.get("/user-calendar", authRequired, async (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ error: "ต้องระบุ date=YYYY-MM-DD" });
  }

  if (isPastDate(date)) {
    return res.status(400).json({
      error: "ไม่สามารถดูหรือจองย้อนหลังได้",
    });
  }

  const user = req.user;

  try {
    await ensureCalendarRulesSchema(pool);
    const holiday = await isClinicHoliday(pool, date);
    if (holiday) {
      return res.status(409).json({
        error: holiday.reason || "คลินิกหยุดให้บริการในวันนี้",
        is_holiday: true,
      });
    }

    await ensureSlotsForDate(pool, date);
    await reopenBookableSlotsForDate(pool, date);

    try {
      await pool.query("SELECT clinic.lock_timed_out_slots()");
    } catch (lockErr) {
      console.warn("Warning: lock_timed_out_slots failed (function may not exist):", lockErr.message);
    }

    const result = await pool.query(
      `
      SELECT
        s.slot_id,
        s.service_date,
        s.avaliable_date,
        s.hour_of_day,

        CASE
          WHEN a.appointment_id IS NOT NULL THEN 'closed'
          ELSE s.status
        END AS status,

        a.appointment_id,
        a.user_id AS appt_user_id,

        CASE
          WHEN a.user_id = $2 THEN true
          ELSE false
        END AS is_mine

      FROM clinic.appointment_slots s

      LEFT JOIN clinic.appointments a
        ON a.slot_id = s.slot_id
        AND a.status NOT IN ('cancelled', 'rejected')

      WHERE s.service_date = $1::date
      ORDER BY s.avaliable_date, s.hour_of_day
      `,
      [date, user.user_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("GET /slots/user-calendar error:", err);
    res.status(500).json({ error: "โหลดปฏิทิน user ไม่สำเร็จ" });
  }
});

// ดึงปฏิทินทั้งสัปดาห์ให้ user เห็นทั้งหมด
router.get("/week", async (_req, res) => {
  try {
    try {
      await pool.query("SELECT clinic.lock_timed_out_slots()");
    } catch (lockErr) {
      console.warn("Warning: lock_timed_out_slots failed (function may not exist):", lockErr.message);
    }

    const result = await pool.query(`
      SELECT *
      FROM clinic.calendar_this_week
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("GET /slots/week error:", err);
    res.status(500).json({ error: "โหลดปฏิทินสัปดาห์ไม่สำเร็จ" });
  }
});

// ดึงปฏิทินรายเดือน
router.get("/month", async (req, res) => {
  const { year, month } = req.query;

  if (!year || !month) {
    return res.status(400).json({ error: "ต้องมี year & month" });
  }

  try {
    try {
      await pool.query("SELECT clinic.lock_timed_out_slots()");
    } catch (lockErr) {
      console.warn("Warning: lock_timed_out_slots failed (function may not exist):", lockErr.message);
    }

    const result = await pool.query(
      `
      SELECT *
      FROM clinic.get_calendar_month($1, $2, 'Asia/Bangkok')
      `,
      [Number(year), Number(month)]
    ).catch(err => {
      if (err.message.includes("does not exist")) {
        console.warn("Warning: clinic.get_calendar_month function does not exist");
        // Return empty array if function doesn't exist
        return { rows: [] };
      }
      throw err;
    });

    res.json(result.rows);
  } catch (err) {
    console.error("GET /slots/month error:", err);
    res.status(500).json({ error: "โหลดปฏิทินเดือนไม่สำเร็จ" });
  }
});

// STAFF เท่านั้น: generate slot ล่วงหน้า
router.post("/seed", requireStaff, async (req, res) => {
  const { start, end } = req.body;

  if (!start || !end) {
    return res.status(400).json({ error: "ต้องระบุ start & end" });
  }

  try {
    await pool.query(`SELECT clinic.seed_slots($1::date, $2::date)`, [
      start,
      end,
    ]);

    res.json({ message: "สร้าง slot สำเร็จ" });
  } catch (err) {
    console.error("POST /slots/seed error:", err);
    res.status(500).json({ error: "seed slot ล้มเหลว" });
  }
});

module.exports = router;
