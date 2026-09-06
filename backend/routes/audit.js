const express = require("express");
const pool = require("../tools/db");
const { requireRole } = require("../tools/_utils");

const router = express.Router();

router.get(
  "/audit-logs",
  requireRole("super_admin", "superadmin"),
  async (req, res, next) => {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 100)
      : 50;
    const beforeId = Number.parseInt(req.query.before_id, 10);

    try {
      const params = [];
      let where = "";
      if (Number.isInteger(beforeId) && beforeId > 0) {
        params.push(beforeId);
        where = `WHERE audit_id < $${params.length}`;
      }
      params.push(limit);

      const result = await pool.query(
        `SELECT audit_id, request_id, actor_user_id, actor_role, action,
                entity_type, entity_id, result, http_method, route,
                status_code, ip_address, user_agent, error_code,
                duration_ms, created_at
         FROM clinic.audit_logs
         ${where}
         ORDER BY audit_id DESC
         LIMIT $${params.length}`,
        params,
      );

      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
