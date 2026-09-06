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
  ensureSlotsForRange,
  ensureSlotsForDate,
  reopenBookableSlotsForRange,
  reopenBookableSlotsForDate,
} = require("../tools/slotSeeder");

router.get("/booking-windows", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH bangkok_today AS (
        SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date AS today
      ), current_week AS (
        SELECT
          (today - (EXTRACT(ISODOW FROM today)::int - 1))::date AS range_start,
          (today + (7 - EXTRACT(ISODOW FROM today)::int))::date AS range_end
        FROM bangkok_today
      )
      SELECT range_start::text, range_end::text, 'current'::text AS kind
      FROM current_week
      UNION ALL
      SELECT week_start::text, week_end::text, 'advance'::text AS kind
      FROM clinic.advance_booking_weeks
      WHERE week_end >= (SELECT today FROM bangkok_today)
        AND NOT EXISTS (
          SELECT 1
          FROM current_week
          WHERE week_start <= range_end
            AND week_end >= range_start
        )
      ORDER BY range_start
    `);
    res.json(rows);
  } catch (error) {
    console.error("GET /calendar/booking-windows error:", error);
    res.status(500).json({ error: "โหลดช่วงวันที่เปิดจองไม่สำเร็จ" });
  }
});

router.get("/advance-booking-weeks", requireStaff, async (req, res) => {
  try {
    await ensureCalendarRulesSchema(pool);
    const { rows } = await pool.query(`
      SELECT week_start::text, week_end::text, created_at
      FROM clinic.advance_booking_weeks
      WHERE date_trunc('month', week_start::timestamp) =
            date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok')::timestamp)
      ORDER BY week_start
    `);
    res.json(rows);
  } catch (error) {
    console.error("GET /calendar/advance-booking-weeks error:", error);
    res.status(500).json({ error: "โหลดข้อมูลการเปิดจองล่วงหน้าไม่สำเร็จ" });
  }
});

router.post("/advance-booking-weeks", requireStaff, async (req, res) => {
  const { week_start: requestedWeekStart } = req.body || {};
  if (!validDate(requestedWeekStart)) {
    return res.status(400).json({ error: "week_start ไม่ถูกต้อง" });
  }

  try {
    await ensureCalendarRulesSchema(pool);
    const rangeResult = await pool.query(`
      WITH dates AS (
        SELECT
          (now() AT TIME ZONE 'Asia/Bangkok')::date AS today,
          (date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok') + interval '1 month - 1 day')::date AS month_end
      ), next_week AS (
        SELECT
          (today + (8 - EXTRACT(ISODOW FROM today)::int))::date AS week_start,
          month_end
        FROM dates
      )
      SELECT
        week_start::text,
        LEAST(week_start + 6, month_end)::text AS week_end,
        week_start <= month_end AS is_in_current_month
      FROM next_week
    `);

    const range = rangeResult.rows[0];
    if (!range?.is_in_current_month) {
      return res.status(400).json({ error: "ไม่มีสัปดาห์ล่วงหน้าเหลืออยู่ภายในเดือนปัจจุบัน" });
    }
    if (requestedWeekStart !== range.week_start) {
      return res.status(400).json({
        error: "เปิดได้เฉพาะสัปดาห์ถัดไปและต้องอยู่ภายในเดือนปัจจุบันเท่านั้น",
        allowed_week: { week_start: range.week_start, week_end: range.week_end },
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const insertResult = await client.query(
        `INSERT INTO clinic.advance_booking_weeks (week_start, week_end, created_by)
         VALUES ($1::date, $2::date, $3)
         ON CONFLICT (week_start) DO NOTHING
         RETURNING week_start::text, week_end::text, created_at`,
        [range.week_start, range.week_end, req.user.user_id]
      );
      if (!insertResult.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "สัปดาห์นี้เปิดให้จองล่วงหน้าแล้ว" });
      }

      await ensureSlotsForRange(client, range.week_start, range.week_end);
      await reopenBookableSlotsForRange(client, range.week_start, range.week_end);
      await client.query("COMMIT");
      res.status(201).json(insertResult.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("POST /calendar/advance-booking-weeks error:", error);
    res.status(500).json({ error: "เปิดจองล่วงหน้าไม่สำเร็จ" });
  }
});

router.delete("/advance-booking-weeks/:weekStart", requireStaff, async (req, res) => {
  const weekStart = req.params.weekStart;
  if (!validDate(weekStart)) {
    return res.status(400).json({ error: "week_start ไม่ถูกต้อง" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureCalendarRulesSchema(client);

    const weekResult = await client.query(
      `SELECT week_start::text, week_end::text
       FROM clinic.advance_booking_weeks
       WHERE week_start = $1::date
       FOR UPDATE`,
      [weekStart]
    );
    const week = weekResult.rows[0];
    if (!week) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "ไม่พบสัปดาห์ที่เปิดจองล่วงหน้า" });
    }

    const appointmentResult = await client.query(
      `SELECT COUNT(*)::int AS appointment_count
       FROM clinic.appointments a
       JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
       WHERE s.service_date BETWEEN $1::date AND $2::date
         AND a.status NOT IN ('cancelled', 'rejected')`,
      [week.week_start, week.week_end]
    );
    if (Number(appointmentResult.rows[0]?.appointment_count || 0) > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "ไม่สามารถยกเลิกการเปิดจองได้ เนื่องจากมีผู้ใช้จองคิวในสัปดาห์นี้แล้ว",
      });
    }

    await client.query(
      `DELETE FROM clinic.advance_booking_weeks WHERE week_start = $1::date`,
      [weekStart]
    );
    await client.query("COMMIT");
    res.json({ message: "ยกเลิกการเปิดจองล่วงหน้าแล้ว", ...week });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("DELETE /calendar/advance-booking-weeks error:", error);
    res.status(500).json({ error: "ยกเลิกการเปิดจองล่วงหน้าไม่สำเร็จ" });
  } finally {
    client.release();
  }
});

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
