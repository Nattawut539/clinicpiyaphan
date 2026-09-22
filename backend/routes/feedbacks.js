const express = require("express");
const router = express.Router();
const pool = require("../tools/db");
const { authRequired, requireStaff } = require("../tools/_utils");

let feedbackSchemaReady = false;

async function ensureFeedbackSchema() {
  if (feedbackSchemaReady) return;

  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (
        WHERE column_name IN ('record_id', 'visit_date', 'service_type')
      )::int AS required_column_count,
      to_regclass('clinic.user_feedbacks_user_record_unique') IS NOT NULL AS has_unique_index
    FROM information_schema.columns
    WHERE table_schema = 'clinic'
      AND table_name = 'user_feedbacks'
  `);

  if (
    Number(rows[0]?.required_column_count || 0) !== 3 ||
    !rows[0]?.has_unique_index
  ) {
    const error = new Error(
      'Feedback schema is not ready; run database/migrations.sql as the database owner',
    );
    error.code = 'FEEDBACK_SCHEMA_NOT_READY';
    throw error;
  }

  feedbackSchemaReady = true;
}

function getDefaultYearMonth() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  };
}

function parseYearMonth(query) {
  const fallback = getDefaultYearMonth();
  const year = Number(query.year ?? fallback.year);
  const month = Number(query.month ?? fallback.month);

  if (!Number.isInteger(year) || year < 2000 || year > 3000) {
    return { ok: false, message: "year ไม่ถูกต้อง" };
  }

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { ok: false, message: "month ไม่ถูกต้อง (1-12)" };
  }

  return { ok: true, year, month };
}

router.post("/feedbacks", authRequired, async (req, res) => {
  const { record_id, visit_date, score, liked, category, service_type, comment } = req.body || {};

  if (score !== null && score !== undefined) {
    const parsedScore = Number(score);
    if (!Number.isInteger(parsedScore) || parsedScore < 1 || parsedScore > 5) {
      return res.status(400).json({ message: "score ต้องอยู่ในช่วง 1-5" });
    }
  }

  if (liked !== null && liked !== undefined && typeof liked !== "boolean") {
    return res.status(400).json({ message: "liked ต้องเป็น boolean" });
  }

  try {
    await ensureFeedbackSchema();

    let record = null;
    if (record_id) {
      const recordResult = await pool.query(
        `
        SELECT record_id, visit_date, diagnosis, treatment
        FROM clinic.medical_records
        WHERE record_id = $1 AND user_id = $2
        LIMIT 1
        `,
        [record_id, req.user.user_id]
      );

      record = recordResult.rows[0] || null;
      if (!record) {
        return res.status(404).json({ message: "ไม่พบประวัติการรักษาของผู้ใช้" });
      }
    }

    const feedbackVisitDate = visit_date || record?.visit_date || null;
    const feedbackCategory =
      category || service_type || record?.diagnosis || record?.treatment || "ไม่ระบุ";

    const { rows } = await pool.query(
      `
      INSERT INTO clinic.user_feedbacks
        (user_id, record_id, visit_date, score, liked, category, service_type, comment)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id, record_id)
        WHERE record_id IS NOT NULL
      DO UPDATE SET
        visit_date = EXCLUDED.visit_date,
        score = EXCLUDED.score,
        liked = EXCLUDED.liked,
        category = EXCLUDED.category,
        service_type = EXCLUDED.service_type,
        comment = EXCLUDED.comment
      RETURNING *
      `,
      [
        req.user.user_id,
        record_id || null,
        feedbackVisitDate,
        score ?? null,
        liked ?? null,
        feedbackCategory,
        service_type ?? null,
        comment ?? null,
      ]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("POST /feedbacks error:", err);
    res.status(500).json({ message: "บันทึก feedback ไม่สำเร็จ" });
  }
});

router.get("/feedbacks/me", authRequired, async (req, res) => {
  try {
    await ensureFeedbackSchema();

    const { rows } = await pool.query(
      `
      SELECT *
      FROM clinic.user_feedbacks
      WHERE user_id = $1
      ORDER BY COALESCE(visit_date, created_at::date) DESC, created_at DESC
      `,
      [req.user.user_id]
    );

    res.json(rows);
  } catch (err) {
    console.error("GET /feedbacks/me error:", err);
    res.status(500).json({ message: "โหลด feedback ไม่สำเร็จ" });
  }
});

router.get("/feedbacks", requireStaff, async (_req, res) => {
  try {
    await ensureFeedbackSchema();

    const { rows } = await pool.query(`
      SELECT
        f.*,
        u.email,
        TRIM(CONCAT(COALESCE(d.first_name, ''), ' ', COALESCE(d.last_name, ''))) AS name
      FROM clinic.user_feedbacks f
      LEFT JOIN clinic.users u ON f.user_id = u.user_id
      LEFT JOIN clinic.user_details d ON d.user_id = f.user_id
      ORDER BY COALESCE(f.visit_date, f.created_at::date) DESC, f.created_at DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error("GET /feedbacks error:", err);
    res.status(500).json({ message: "โหลด feedback ไม่สำเร็จ" });
  }
});

router.get("/feedbacks/summary", requireStaff, async (req, res) => {
  const ym = parseYearMonth(req.query);
  const hasFilter = req.query.year || req.query.month;
  if (hasFilter && !ym.ok) return res.status(400).json({ message: ym.message });

  try {
    await ensureFeedbackSchema();

    const params = [];
    let where = "";

    if (hasFilter) {
      params.push(ym.year, ym.month);
      where = `
        WHERE EXTRACT(YEAR FROM COALESCE(visit_date, created_at::date)) = $1
          AND EXTRACT(MONTH FROM COALESCE(visit_date, created_at::date)) = $2
      `;
    }

    const { rows } = await pool.query(
      `
      SELECT
        COUNT(*)::int AS total,
        AVG(score)::numeric(4,2) AS avg_score,
        COUNT(*) FILTER (WHERE liked = true)::int AS likes,
        COUNT(*) FILTER (WHERE liked = false)::int AS dislikes
      FROM clinic.user_feedbacks
      ${where}
      `,
      params
    );

    const row = rows[0] || { total: 0, avg_score: null, likes: 0, dislikes: 0 };
    res.json({ ...row, empty: Number(row.total || 0) === 0 });
  } catch (err) {
    console.error("GET /feedbacks/summary error:", err);
    res.status(500).json({ message: "โหลด summary ไม่สำเร็จ" });
  }
});

router.get("/feedbacks/summary/category", requireStaff, async (req, res) => {
  const ym = parseYearMonth(req.query);
  if (!ym.ok) return res.status(400).json({ message: ym.message });

  try {
    await ensureFeedbackSchema();

    const { rows } = await pool.query(
      `
      WITH service_categories AS (
        SELECT COALESCE(NULLIF(a.service_type, ''), 'ตรวจทั่วไป') AS category
        FROM clinic.appointments a
        JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
        WHERE a.status IN ('approved', 'completed')
          AND EXTRACT(YEAR FROM s.service_date) = $1
          AND EXTRACT(MONTH FROM s.service_date) = $2
      ),
      medical_categories AS (
        SELECT COALESCE(NULLIF(diagnosis, ''), NULLIF(treatment, ''), 'ตรวจทั่วไป') AS category
        FROM clinic.medical_records
        WHERE EXTRACT(YEAR FROM visit_date) = $1
          AND EXTRACT(MONTH FROM visit_date) = $2
      ),
      feedback_categories AS (
        SELECT COALESCE(NULLIF(category, ''), NULLIF(service_type, ''), 'ไม่ระบุ') AS category
        FROM clinic.user_feedbacks
        WHERE EXTRACT(YEAR FROM COALESCE(visit_date, created_at::date)) = $1
          AND EXTRACT(MONTH FROM COALESCE(visit_date, created_at::date)) = $2
      )
      SELECT category, COUNT(*)::int AS total
      FROM (
        SELECT category FROM service_categories
        UNION ALL
        SELECT category FROM medical_categories
        UNION ALL
        SELECT category FROM feedback_categories
      ) source
      GROUP BY category
      ORDER BY total DESC, category ASC
      `,
      [ym.year, ym.month]
    );

    res.json({ year: ym.year, month: ym.month, data: rows, empty: rows.length === 0 });
  } catch (err) {
    console.error("GET /feedbacks/summary/category error:", err);
    res.status(500).json({ message: "โหลดข้อมูล category ไม่สำเร็จ" });
  }
});

router.get("/feedbacks/summary/like-dislike", requireStaff, async (req, res) => {
  const ym = parseYearMonth(req.query);
  if (!ym.ok) return res.status(400).json({ message: ym.message });

  try {
    await ensureFeedbackSchema();

    const { rows } = await pool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE liked = true)::int AS likes,
        COUNT(*) FILTER (WHERE liked = false)::int AS dislikes,
        COUNT(*) FILTER (WHERE liked IS NOT NULL)::int AS total
      FROM clinic.user_feedbacks
      WHERE EXTRACT(YEAR FROM COALESCE(visit_date, created_at::date)) = $1
        AND EXTRACT(MONTH FROM COALESCE(visit_date, created_at::date)) = $2
      `,
      [ym.year, ym.month]
    );

    const row = rows[0] || { likes: 0, dislikes: 0, total: 0 };
    res.json({
      year: ym.year,
      month: ym.month,
      likes: row.likes ?? 0,
      dislikes: row.dislikes ?? 0,
      total: row.total ?? 0,
      empty: Number(row.total || 0) === 0,
    });
  } catch (err) {
    console.error("GET /feedbacks/summary/like-dislike error:", err);
    res.status(500).json({ message: "โหลด like/dislike ไม่สำเร็จ" });
  }
});

router.get("/feedbacks/summary/score", requireStaff, async (req, res) => {
  const ym = parseYearMonth(req.query);
  if (!ym.ok) return res.status(400).json({ message: ym.message });

  try {
    await ensureFeedbackSchema();

    const { rows } = await pool.query(
      `
      SELECT
        AVG(score)::numeric(4,2) AS avg_score,
        COUNT(*) FILTER (WHERE score IS NOT NULL)::int AS total
      FROM clinic.user_feedbacks
      WHERE EXTRACT(YEAR FROM COALESCE(visit_date, created_at::date)) = $1
        AND EXTRACT(MONTH FROM COALESCE(visit_date, created_at::date)) = $2
      `,
      [ym.year, ym.month]
    );

    const row = rows[0] || { avg_score: null, total: 0 };
    res.json({
      year: ym.year,
      month: ym.month,
      avg_score: row.avg_score,
      total: row.total ?? 0,
      empty: Number(row.total || 0) === 0,
    });
  } catch (err) {
    console.error("GET /feedbacks/summary/score error:", err);
    res.status(500).json({ message: "โหลด score ไม่สำเร็จ" });
  }
});

router.get("/feedbacks/summary/daily", requireStaff, async (req, res) => {
  const ym = parseYearMonth(req.query);
  if (!ym.ok) return res.status(400).json({ message: ym.message });

  try {
    const { rows } = await pool.query(
      `
      WITH visits AS (
        SELECT a.user_id, s.service_date::date AS day
        FROM clinic.appointments a
        JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
        WHERE a.status IN ('approved', 'completed')
          AND EXTRACT(YEAR FROM s.service_date) = $1
          AND EXTRACT(MONTH FROM s.service_date) = $2
        UNION
        SELECT user_id, visit_date::date AS day
        FROM clinic.medical_records
        WHERE EXTRACT(YEAR FROM visit_date) = $1
          AND EXTRACT(MONTH FROM visit_date) = $2
      )
      SELECT
        day,
        COUNT(*)::int AS total
      FROM visits
      GROUP BY day
      ORDER BY day ASC
      `,
      [ym.year, ym.month]
    );

    res.json({ year: ym.year, month: ym.month, data: rows, empty: rows.length === 0 });
  } catch (err) {
    console.error("GET /feedbacks/summary/daily error:", err);
    res.status(500).json({ message: "โหลด daily trend ไม่สำเร็จ" });
  }
});

router.get("/feedbacks/summary/age-groups", requireStaff, async (req, res) => {
  const ym = parseYearMonth(req.query);
  if (!ym.ok) return res.status(400).json({ message: ym.message });

  try {
    const { rows } = await pool.query(
      `
      WITH visits AS (
        SELECT DISTINCT a.user_id
        FROM clinic.appointments a
        JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
        WHERE a.status IN ('approved', 'completed')
          AND EXTRACT(YEAR FROM s.service_date) = $1
          AND EXTRACT(MONTH FROM s.service_date) = $2
        UNION
        SELECT DISTINCT user_id
        FROM clinic.medical_records
        WHERE EXTRACT(YEAR FROM visit_date) = $1
          AND EXTRACT(MONTH FROM visit_date) = $2
      ),
      grouped AS (
        SELECT
          CASE
            WHEN d.birth_date IS NULL THEN 'ไม่ระบุ'
            WHEN DATE_PART('year', AGE(CURRENT_DATE, d.birth_date)) < 18 THEN 'ต่ำกว่า 18'
            WHEN DATE_PART('year', AGE(CURRENT_DATE, d.birth_date)) BETWEEN 18 AND 35 THEN '18-35'
            WHEN DATE_PART('year', AGE(CURRENT_DATE, d.birth_date)) BETWEEN 36 AND 59 THEN '36-59'
            ELSE '60+'
          END AS label,
          COUNT(*)::int AS total
        FROM visits v
        LEFT JOIN clinic.user_details d ON d.user_id = v.user_id
        GROUP BY label
      ),
      totals AS (
        SELECT COALESCE(SUM(total), 0)::numeric AS grand_total FROM grouped
      )
      SELECT
        grouped.label,
        grouped.total,
        CASE
          WHEN totals.grand_total = 0 THEN 0
          ELSE ROUND((grouped.total::numeric / totals.grand_total) * 100)::int
        END AS percent
      FROM grouped
      CROSS JOIN totals
      ORDER BY
        CASE grouped.label
          WHEN 'ต่ำกว่า 18' THEN 1
          WHEN '18-35' THEN 2
          WHEN '36-59' THEN 3
          WHEN '60+' THEN 4
          ELSE 5
        END
      `,
      [ym.year, ym.month]
    );

    res.json({ year: ym.year, month: ym.month, data: rows, empty: rows.length === 0 });
  } catch (err) {
    console.error("GET /feedbacks/summary/age-groups error:", err);
    res.status(500).json({ message: "โหลดข้อมูลช่วงอายุไม่สำเร็จ" });
  }
});

router.get("/feedbacks/summary/period/:period", requireStaff, async (req, res) => {
  const { period } = req.params;

  let groupExpr;
  if (period === "daily") groupExpr = "DATE(COALESCE(f.visit_date, f.created_at::date))";
  else if (period === "monthly") groupExpr = "DATE_TRUNC('month', COALESCE(f.visit_date, f.created_at::date))";
  else if (period === "yearly") groupExpr = "DATE_TRUNC('year', COALESCE(f.visit_date, f.created_at::date))";
  else return res.status(400).json({ message: "period ไม่ถูกต้อง" });

  const hasFilter = period === "daily" && (req.query.year || req.query.month);
  const ym = hasFilter ? parseYearMonth(req.query) : null;
  if (hasFilter && !ym.ok) return res.status(400).json({ message: ym.message });

  try {
    await ensureFeedbackSchema();

    const params = [];
    let where = "";

    if (hasFilter) {
      params.push(ym.year, ym.month);
      where = `
        WHERE EXTRACT(YEAR FROM COALESCE(f.visit_date, f.created_at::date)) = $1
          AND EXTRACT(MONTH FROM COALESCE(f.visit_date, f.created_at::date)) = $2
      `;
    }

    const { rows } = await pool.query(
      `
      SELECT
        ${groupExpr} AS period,
        COUNT(*)::int AS total,
        AVG(f.score)::numeric(4,2) AS avg_score,
        COUNT(*) FILTER (WHERE f.liked = true)::int AS likes,
        COUNT(*) FILTER (WHERE f.liked = false)::int AS dislikes,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'name', NULLIF(TRIM(CONCAT(COALESCE(d.first_name, ''), ' ', COALESCE(d.last_name, ''))), ''),
              'comment', f.comment,
              'score', f.score
            )
            ORDER BY f.created_at DESC
          ) FILTER (WHERE NULLIF(TRIM(f.comment), '') IS NOT NULL),
          '[]'::json
        ) AS comments
      FROM clinic.user_feedbacks f
      LEFT JOIN clinic.user_details d ON d.user_id = f.user_id
      ${where}
      GROUP BY period
      ORDER BY period ASC
      `,
      params
    );

    res.json({
      period,
      ...(hasFilter ? { year: ym.year, month: ym.month } : {}),
      data: rows,
      empty: rows.length === 0,
    });
  } catch (err) {
    console.error("GET /feedbacks/summary/period/:period error:", err);
    res.status(500).json({ message: "โหลด summary ตาม period ไม่สำเร็จ" });
  }
});

module.exports = router;
