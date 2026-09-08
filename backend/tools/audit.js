const crypto = require("crypto");
const pool = require("./db");

const SENSITIVE_READ_PREFIXES = [
  "/api/patients",
  "/api/profile-images",
  "/api/medical",
  "/api/appointments",
  "/api/measurements",
  "/api/staff",
  "/api/me",
  "/api/notifications",
  "/api/feedbacks",
  "/api/audit-logs",
  "/api/users",
];

async function ensureAuditSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clinic.audit_logs (
      audit_id bigserial PRIMARY KEY,
      request_id uuid NOT NULL,
      actor_user_id integer,
      actor_role varchar(32),
      action varchar(160) NOT NULL,
      entity_type varchar(80),
      entity_id varchar(100),
      result varchar(20) NOT NULL,
      http_method varchar(10) NOT NULL,
      route text NOT NULL,
      status_code integer NOT NULL,
      ip_address inet,
      user_agent text,
      error_code varchar(100),
      duration_ms integer,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx
    ON clinic.audit_logs (created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS audit_logs_actor_idx
    ON clinic.audit_logs (actor_user_id, created_at DESC)
  `);
  await pool.query(`REVOKE ALL ON clinic.audit_logs FROM PUBLIC`);
}

function shouldPersist(req) {
  if (!req.originalUrl?.startsWith("/api")) return false;
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  return SENSITIVE_READ_PREFIXES.some((prefix) => req.originalUrl.startsWith(prefix));
}

function requestAudit(req, res, next) {
  req.requestId = crypto.randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  const startedAt = Date.now();

  res.on("finish", () => {
    if (!shouldPersist(req)) return;

    const route = String(req.originalUrl || req.url || "").split("?")[0].slice(0, 1000);
    const segments = route.split("/").filter(Boolean);
    const actor = req.user || req.admin || null;
    const statusCode = Number(res.statusCode || 500);
    const result = statusCode < 400 ? "success" : statusCode < 500 ? "denied" : "error";
    const ip = req.ip && /^[0-9a-fA-F:.]+$/.test(req.ip) ? req.ip : null;

    pool.query(
      `INSERT INTO clinic.audit_logs
       (request_id, actor_user_id, actor_role, action, entity_type, entity_id,
        result, http_method, route, status_code, ip_address, user_agent,
        error_code, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        req.requestId,
        actor?.user_id ?? actor?.sub ?? null,
        actor?.role ? String(actor.role).slice(0, 32) : null,
        `${req.method} ${route}`.slice(0, 160),
        segments[1]?.slice(0, 80) || null,
        req.params?.id || req.params?.userId || req.params?.user_id || null,
        result,
        req.method,
        route,
        statusCode,
        ip,
        String(req.headers["user-agent"] || "").slice(0, 1000) || null,
        res.locals?.errorCode ? String(res.locals.errorCode).slice(0, 100) : null,
        Math.max(0, Date.now() - startedAt),
      ],
    ).catch((error) => console.error("audit log write failed:", error.message));
  });

  return next();
}

module.exports = { ensureAuditSchema, requestAudit };
