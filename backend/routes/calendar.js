// routes/calendar.js
const express = require("express");
const router = express.Router();
const pool = require("../tools/db");
const { requireStaff } = require("../tools/_utils");
const {
  DEFAULT_SUNDAY_REASON,
  ensureCalendarRulesSchema,
  monthHolidayQuery,
  validDate,
} = require("../tools/calendarRules");
const {
  ensureSlotsForDate,
  reopenBookableSlotsForDate,
} = require("../tools/slotSeeder");

router.get("/holidays", async (req, res) => {
  const { year, month } = req.query;
  const params = [];
  let where = "";

  if (year || month) {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      return res.status(400).json({ error: "year หรือ month ไม่ถูกต้อง" });
    }
    params.push(y, m);
    where = "WHERE EXTRACT(YEAR FROM service_date) = $1 AND EXTRACT(MONTH FROM service_date) = $2";
  }

  try {
    await ensureCalendarRulesSchema(pool);
    const { rows } = await pool.query(
      monthHolidayQuery(where, Boolean(year && month)),
      year && month ? [Number(year), Number(month), DEFAULT_SUNDAY_REASON] : params
    );
    res.json(rows);
  } catch (error) {
    console.error("GET /calendar/holidays error:", error);
    res.status(500).json({ error: "โหลดวันหยุดไม่สำเร็จ" });
  }
});

router.post("/holidays", requireStaff, async (req, res) => {
  const { holiday_date, reason = null } = req.body || {};
  if (!validDate(holiday_date)) {
    return res.status(400).json({ error: "holiday_date ไม่ถูกต้อง" });
  }

  try {
    await ensureCalendarRulesSchema(pool);
    await pool.query(
      `DELETE FROM clinic.clinic_open_days WHERE service_date = $1::date`,
      [holiday_date]
    );

    const { rows } = await pool.query(
      `INSERT INTO clinic.clinic_holidays (service_date, avaliable_date, reason, created_by)
       SELECT $1::date, 'morning', $2, $3
       WHERE NOT EXISTS (
         SELECT 1 FROM clinic.clinic_holidays WHERE service_date = $1::date
       )
       RETURNING service_date::text AS holiday_date, reason`,
      [holiday_date, reason ? String(reason).trim() : null, req.user.user_id]
    );
    if (!rows[0]) return res.status(409).json({ error: "วันที่นี้เป็นวันหยุดอยู่แล้ว" });
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "วันที่นี้เป็นวันหยุดอยู่แล้ว" });
    }
    console.error("POST /calendar/holidays error:", error);
    res.status(500).json({ error: "เพิ่มวันหยุดไม่สำเร็จ" });
  }
});

router.put("/holidays/:date", requireStaff, async (req, res) => {
  const oldDate = req.params.date;
  const { holiday_date, reason = null } = req.body || {};
  if (!validDate(oldDate) || !validDate(holiday_date)) {
    return res.status(400).json({ error: "วันที่ไม่ถูกต้อง" });
  }

  try {
    await ensureCalendarRulesSchema(pool);
    if (oldDate !== holiday_date) {
      const duplicate = await pool.query(
        `SELECT 1 FROM clinic.clinic_holidays WHERE service_date = $1::date LIMIT 1`,
        [holiday_date]
      );
      if (duplicate.rowCount) {
        return res.status(409).json({ error: "วันที่ใหม่เป็นวันหยุดอยู่แล้ว" });
      }
    }

    const { rows, rowCount } = await pool.query(
      `
      WITH updated AS (
        UPDATE clinic.clinic_holidays
        SET service_date = $1::date,
            reason = $2,
            updated_at = now()
        WHERE service_date = $3::date
        RETURNING service_date, reason
      ),
      opened_old_default AS (
        INSERT INTO clinic.clinic_open_days (service_date, reason, created_by)
        SELECT $3::date, 'เปิดจองโดยผู้ดูแลระบบ', $4
        WHERE NOT EXISTS (SELECT 1 FROM updated)
          AND EXTRACT(ISODOW FROM $3::date) = 7
        ON CONFLICT (service_date) DO UPDATE
        SET reason = EXCLUDED.reason,
            updated_at = now()
        RETURNING service_date
      ),
      removed_new_open_override AS (
        DELETE FROM clinic.clinic_open_days
        WHERE service_date = $1::date
      ),
      inserted AS (
        INSERT INTO clinic.clinic_holidays (service_date, avaliable_date, reason, created_by)
        SELECT $1::date, 'morning', $2, $4
        WHERE NOT EXISTS (SELECT 1 FROM updated)
          AND EXISTS (SELECT 1 FROM opened_old_default)
        RETURNING service_date, reason
      )
      SELECT service_date::text AS holiday_date, reason FROM updated
      UNION ALL
      SELECT service_date::text AS holiday_date, reason FROM inserted
      `,
      [holiday_date, reason ? String(reason).trim() : null, oldDate, req.user.user_id]
    );
    if (!rowCount) return res.status(404).json({ error: "ไม่พบวันหยุด" });
    res.json(rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "วันที่ใหม่เป็นวันหยุดอยู่แล้ว" });
    }
    console.error("PUT /calendar/holidays error:", error);
    res.status(500).json({ error: "แก้ไขวันหยุดไม่สำเร็จ" });
  }
});

router.delete("/holidays/:date", requireStaff, async (req, res) => {
  if (!validDate(req.params.date)) {
    return res.status(400).json({ error: "วันที่ไม่ถูกต้อง" });
  }

  try {
    await ensureCalendarRulesSchema(pool);
    const isSunday = await pool.query(
      `SELECT EXTRACT(ISODOW FROM $1::date)::int = 7 AS is_sunday`,
      [req.params.date]
    );

    const result = await pool.query(
      `DELETE FROM clinic.clinic_holidays WHERE service_date = $1::date`,
      [req.params.date]
    );

    if (isSunday.rows[0]?.is_sunday) {
      await pool.query(
        `INSERT INTO clinic.clinic_open_days (service_date, reason, created_by)
         VALUES ($1::date, $2, $3)
         ON CONFLICT (service_date) DO UPDATE
         SET reason = EXCLUDED.reason,
             updated_at = now()`,
        [req.params.date, "เปิดจองโดยผู้ดูแลระบบ", req.user.user_id]
      );
    } else if (!result.rowCount) {
      return res.status(404).json({ error: "ไม่พบวันหยุด" });
    }

    await ensureSlotsForDate(pool, req.params.date);
    await reopenBookableSlotsForDate(pool, req.params.date);

    res.json({ message: "ยกเลิกวันหยุดแล้ว" });
  } catch (error) {
    console.error("DELETE /calendar/holidays error:", error);
    res.status(500).json({ error: "ยกเลิกวันหยุดไม่สำเร็จ" });
  }
});

router.get("/month", async (req, res) => {
  const { year, month } = req.query;

  if (!year || !month)
    return res.status(400).json({ error: "ต้องมี year & month" });

  try {
    const result = await pool.query(
      `SELECT * 
       FROM clinic.get_calendar_month($1, $2, 'Asia/Bangkok')`,
      [year, month]
    );

    res.json(result.rows);

  } catch (err) {
    res.status(500).json({ error: "โหลดปฏิทินรายเดือนไม่สำเร็จ" });
  }
});


module.exports = router;
