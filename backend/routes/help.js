const express = require("express");
const router = express.Router();
const pool = require("../tools/db");
const { authRequired, requireStaff, requireRole, withContext } = require("../tools/_utils");

/* =====================================================
   Helper
===================================================== */
function parsePagination(query) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 100);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/* =====================================================
   USER: สร้าง help request / คำถาม
   POST /api/help
===================================================== */
router.post("/help", authRequired, async (req, res) => {
  const {
    title,
    description,
    category,
    tags,
    visibility,
    related_feedback_id,
  } = req.body;
  const normalizedCategory = String(category || "").trim().toLowerCase();
  const isDeactivationRequest = normalizedCategory === "account_deactivation";

  if (!title || title.trim() === "") {
    return res.status(400).json({ message: "กรุณาระบุหัวข้อคำถาม" });
  }

  try {
    const { rows } = await pool.query(
      `
      INSERT INTO clinic.help_requests
        (user_id, title, description, category, tags, visibility, related_feedback_id)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
      `,
      [
        req.user.user_id,
        title.trim(),
        description || null,
        normalizedCategory || null,
        tags || [],
        isDeactivationRequest ? "private" : visibility || "private",
        related_feedback_id || null,
      ]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("POST /help error:", err);
    res.status(500).json({ message: "ไม่สามารถส่งคำถามได้" });
  }
});

router.put(
  "/help/:id/status",
  requireRole("admin", "super_admin", "superadmin"),
  async (req, res, next) => {
    const helpId = Number(req.params.id);
    const requestStatus = String(req.body?.request_status || "").trim().toLowerCase();
    const reviewNote = String(req.body?.review_note || "").trim();
    const verificationMethod = String(req.body?.verification_method || "").trim();
    if (!helpId || !["approved", "rejected", "cancelled"].includes(requestStatus)) {
      return res.status(400).json({ message: "สถานะคำร้องไม่ถูกต้อง" });
    }
    if (["approved", "rejected"].includes(requestStatus) && !reviewNote) {
      return res.status(400).json({ message: "กรุณาระบุผลหรือเหตุผลการตรวจสอบ" });
    }
    try {
      await withContext(req, async (client) => {
        const requestResult = await client.query(
          `SELECT help_id, user_id, category, request_status
           FROM clinic.help_requests WHERE help_id = $1 FOR UPDATE`,
          [helpId],
        );
        if (!requestResult.rowCount) return res.status(404).json({ message: "ไม่พบคำร้อง" });
        const request = requestResult.rows[0];
        if (request.request_status !== "pending") {
          return res.status(409).json({ message: "คำร้องนี้ได้รับการดำเนินการแล้ว" });
        }
        if (request.category === "account_deactivation" && requestStatus === "approved") {
          if (!verificationMethod) {
            return res.status(400).json({ message: "กรุณาระบุวิธีตรวจสอบตัวตน" });
          }
          await client.query(
            `UPDATE clinic.users
             SET account_status = 'deactivated', deactivated_at = now(),
                 status_reason = $1, status_changed_at = now(), status_changed_by = $2,
                 session_version = session_version + 1
             WHERE user_id = $3`,
            [reviewNote, req.user.user_id, request.user_id],
          );
          const appointments = await client.query(
            `UPDATE clinic.appointments a
             SET status = 'cancelled', action_taken = true,
                 cancellation_reason = 'บัญชีถูกปิดใช้งานตามคำขอของผู้ใช้'
             FROM clinic.appointment_slots s
             WHERE a.slot_id = s.slot_id AND a.user_id = $1
               AND s.service_date >= CURRENT_DATE
               AND a.status IN ('pending','waiting')
             RETURNING a.appointment_id, a.slot_id`,
            [request.user_id],
          );
          const appointmentIds = appointments.rows.map((row) => row.appointment_id);
          const slotIds = appointments.rows.map((row) => row.slot_id);
          if (appointmentIds.length) {
            await client.query(
              `UPDATE clinic.queue_tickets SET status = 'cancelled'
               WHERE appointment_id = ANY($1::int[])`,
              [appointmentIds],
            );
            await client.query(
              `DELETE FROM clinic.appointment_access_codes
               WHERE appointment_id = ANY($1::int[])`,
              [appointmentIds],
            );
          }
          if (slotIds.length) {
            await client.query(
              `UPDATE clinic.appointment_slots SET status = 'open'
               WHERE slot_id = ANY($1::int[])`,
              [slotIds],
            );
          }
        }
        const updated = await client.query(
          `UPDATE clinic.help_requests
           SET request_status = $1, reviewed_by = $2, reviewed_at = now(),
               review_note = $3, verification_method = NULLIF($4, ''), updated_at = now()
           WHERE help_id = $5 RETURNING *`,
          [requestStatus, req.user.user_id, reviewNote, verificationMethod, helpId],
        );
        return res.json(updated.rows[0]);
      });
    } catch (error) {
      return next(error);
    }
  },
);
// PUT /api/help/:id
router.put("/help/:id", requireStaff, async (req, res) => {
  const id = Number(req.params.id);
  const { title, description } = req.body;

  if (!title) {
    return res.status(400).json({ message: "ต้องมี title" });
  }

  try {
    const { rows } = await pool.query(
      `
      UPDATE clinic.help_requests
      SET title = $1,
          description = $2,
          updated_at = NOW()
      WHERE help_id = $3
      RETURNING *
      `,
      [title, description || null, id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "ไม่พบข้อมูล" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("PUT /help/:id error:", err);
    res.status(500).json({ message: "แก้ไขไม่สำเร็จ" });
  }
});
// DELETE /api/help/:id
router.delete("/help/:id", requireStaff, async (req, res) => {
  const id = Number(req.params.id);

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM clinic.help_requests WHERE help_id = $1`,
      [id]
    );

    if (!rowCount) {
      return res.status(404).json({ message: "ไม่พบข้อมูล" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /help/:id error:", err);
    res.status(500).json({ message: "ลบไม่สำเร็จ" });
  }
});

/* =====================================================
   USER: ดู help request ของตัวเอง
   GET /api/help/me
===================================================== */
router.get("/help/me", authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT *
      FROM clinic.help_requests
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [req.user.user_id]
    );

    res.json(rows);
  } catch (err) {
    console.error("GET /help/me error:", err);
    res.status(500).json({ message: "โหลดข้อมูลไม่สำเร็จ" });
  }
});

/* =====================================================
   PUBLIC: FAQ (เฉพาะ shared)
   GET /api/help
   optional: ?category=&tag=&search=
===================================================== */
router.get("/help", async (req, res) => {
  const { category, tag, search } = req.query;

  const conditions = [`visibility = 'shared'`];
  const params = [];

  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }

  if (tag) {
    params.push(tag);
    conditions.push(`$${params.length} = ANY(tags)`);
  }

  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(title ILIKE $${params.length} OR description ILIKE $${params.length})`
    );
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        help_id,
        title,
        description,
        category,
        tags,
        view_count,
        updated_at
      FROM clinic.help_requests
      WHERE ${conditions.join(" AND ")}
      ORDER BY updated_at DESC
      `,
      params
    );

    res.json(rows);
  } catch (err) {
    console.error("GET /help (public) error:", err);
    res.status(500).json({ message: "โหลด FAQ ไม่สำเร็จ" });
  }
});

/* =====================================================
   PUBLIC: เพิ่ม view count เมื่อเปิด FAQ
   GET /api/help/:id/view
===================================================== */
router.get("/help/:id/view", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "id ไม่ถูกต้อง" });

  try {
    await pool.query(
      `
      UPDATE clinic.help_requests
      SET view_count = view_count + 1
      WHERE help_id = $1 AND visibility='shared'
      `,
      [id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("GET /help/:id/view error:", err);
    res.status(500).json({ message: "อัปเดต view ไม่สำเร็จ" });
  }
});

/* =====================================================
   STAFF / ADMIN: ดู help ทั้งหมด (pagination)
   GET /api/help/all?page=&limit=
===================================================== */
router.get("/help/all", requireStaff, async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);

  try {
    const data = await pool.query(
      `
      SELECT
        h.*,
        u.email
      FROM clinic.help_requests h
      LEFT JOIN clinic.users u ON h.user_id = u.user_id
      ORDER BY h.updated_at DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );

    const count = await pool.query(`SELECT COUNT(*) FROM clinic.help_requests`);

    res.json({
      page,
      limit,
      total: Number(count.rows[0].count),
      data: data.rows,
    });
  } catch (err) {
    console.error("GET /help/all error:", err);
    res.status(500).json({ message: "โหลดข้อมูลไม่สำเร็จ" });
  }
});

/* =====================================================
   STAFF / ADMIN: เปลี่ยน visibility (publish / unpublish)
   PUT /api/help/:id/visibility
===================================================== */
router.put("/help/:id/visibility", requireStaff, async (req, res) => {
  const id = Number(req.params.id);
  const { visibility } = req.body;

  if (!["private", "shared"].includes(visibility)) {
    return res.status(400).json({ message: "visibility ไม่ถูกต้อง" });
  }

  try {
    const { rowCount } = await pool.query(
      `
      UPDATE clinic.help_requests
      SET visibility = $1
      WHERE help_id = $2
      `,
      [visibility, id]
    );

    if (!rowCount) {
      return res.status(404).json({ message: "ไม่พบข้อมูล" });
    }

    res.json({ message: "อัปเดตสถานะเรียบร้อย" });
  } catch (err) {
    console.error("PUT /help/:id/visibility error:", err);
    res.status(500).json({ message: "อัปเดตไม่สำเร็จ" });
  }
});

/* =====================================================
   STAFF / ADMIN: Summary Help (Dashboard)
   GET /api/help/summary
===================================================== */
router.get("/help/summary", requireStaff, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)                                   AS total,
        COUNT(*) FILTER (WHERE visibility='shared')  AS published,
        COUNT(*) FILTER (WHERE visibility='private') AS private,
        SUM(view_count)::int                      AS views
      FROM clinic.help_requests
    `);

    res.json(rows[0]);
  } catch (err) {
    console.error("GET /help/summary error:", err);
    res.status(500).json({ message: "โหลด summary ไม่สำเร็จ" });
  }
});

module.exports = router;
