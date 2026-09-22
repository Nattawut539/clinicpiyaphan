const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const ensureQueueSchema = require("./tools/ensureQueueSchema");
const ensureAdvisorRequirementsSchema = require("./tools/ensureAdvisorRequirementsSchema");
const {
  PORT,
  CORS_ORIGINS,
  JWT_SECRET,
  IS_PRODUCTION,
  RUN_MIGRATIONS_ON_START,
  TRUST_PROXY,
} = require("./tools/config");
const notificationsRouter = require("./routes/notifications");
const { ensureAuditSchema, requestAudit } = require("./tools/audit");
const pool = require("./tools/db");
const ensureProfileImageSchema = require("./tools/ensureProfileImageSchema");
const ensureMeasurementAckOutbox = require("./tools/ensureMeasurementAckOutbox");
const securityRateLimit = require("./tools/rateLimit");
const { uploadRoot } = require("./tools/profileImageUpload");
const { startMqttBridge, stopMqttBridge } = require("./tools/mqttBridge");

const app = express();
let httpServer;

process.env.JWT_SECRET = JWT_SECRET;

const trustProxy = /^\d+$/.test(String(TRUST_PROXY))
  ? Number(TRUST_PROXY)
  : String(TRUST_PROXY).toLowerCase() === "true";
app.set("trust proxy", trustProxy);

app.use(cors({
  origin(origin, callback) {
    if (!origin || CORS_ORIGINS.includes(origin)) return callback(null, true);
    const error = new Error(`CORS blocked origin: ${origin}`);
    error.status = 403;
    error.code = "CORS_ORIGIN_DENIED";
    return callback(error);
  },
  credentials: true,
}));
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (IS_PRODUCTION) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
app.use(requestAudit);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(securityRateLimit);
// Legacy local files remain available during migration. Disable after migration.
if (process.env.SERVE_LEGACY_UPLOADS !== "false") app.use("/uploads", express.static(uploadRoot, {
  fallthrough: false,
  maxAge: 0,
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-cache");
  },
}));


// === Auth / user login ===
app.use("/api/users", require("./routes/(userlogin)/register"));
app.use("/api/users", require("./routes/(userlogin)/userlogin"));
app.use("/api/users", require("./routes/(userlogin)/password"));
app.use("/api/users", require("./routes/(userlogin)/emailVerification"));
app.use("/api", require("./routes/(userlogin)/google"));
app.use("/api", require("./routes/(userlogin)/line"));
app.use("/api/provinces", require("./routes/provinces"));

app.use("/api/users", require("./routes/medicalConsent"));

// === Core APIs ===
app.use("/api", require("./routes/help"));
app.use("/api", require("./routes/users"));
app.use("/api", require("./routes/profileImages"));
app.use("/api", require("./routes/queue"));
app.use("/api", require("./routes/medical"));
app.use("/api", notificationsRouter);
app.use("/api/appointments", require("./routes/appointments"));
app.use("/api", require("./routes/measurements"));
app.use("/api/calendar", require("./routes/calendar"));
app.use("/api", require("./routes/feedbacks"));
app.use("/api/slots", require("./routes/slots"));
app.use("/api", require("./routes/audit"));
app.use("/api", require("./routes/hardware"));

app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/readyz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    return res.json({ ok: true });
  } catch {
    return res.status(503).json({ ok: false });
  }
});

app.use((err, req, res, _next) => {
  const invalidJson = err?.type === "entity.parse.failed";
  const uploadError = err?.name === "MulterError";
  const status = invalidJson || uploadError ? 400 : Number(err?.status || err?.statusCode || 500);
  const errorCode = invalidJson ? "INVALID_JSON" : err?.code || "INTERNAL_ERROR";
  res.locals.errorCode = errorCode;
  console.error(`[${req.requestId}]`, {
    status,
    code: errorCode,
    message: invalidJson ? "Invalid JSON request body" : err?.message,
    ...(process.env.NODE_ENV !== "production" && err?.stack ? { stack: err.stack } : {}),
  });
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: invalidJson
      ? "รูปแบบ JSON ไม่ถูกต้อง กรุณาตรวจเครื่องหมาย comma และ double quote"
      : uploadError
        ? err.code === "LIMIT_FILE_SIZE"
          ? "รูปภาพต้องมีขนาดไม่เกิน 3 MB"
          : "อัปโหลดรูปภาพไม่สำเร็จ"
      : status < 500
        ? err.message
        : "Internal server error",
    code: errorCode,
    request_id: req.requestId,
  });
});


app.get("/", (_req, res) => res.send("Clinic API is running"));

async function startServer() {
  try {
    if (RUN_MIGRATIONS_ON_START) {
      await ensureQueueSchema();
      await ensureAdvisorRequirementsSchema();
      await ensureAuditSchema();
      await ensureProfileImageSchema();
      await ensureMeasurementAckOutbox();
    }
    const runtimeRole = await pool.query(
      `SELECT current_user,
              (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser`,
    );
    if (runtimeRole.rows[0]?.is_superuser) {
      const message = `Unsafe database role: ${runtimeRole.rows[0].current_user} is a PostgreSQL superuser`;
      if (process.env.NODE_ENV === "production") throw new Error(message);
      console.warn(`WARNING: ${message}. Use a dedicated non-superuser role before deployment.`);
    }
    if (process.env.MQTT_ENABLED === "true") {
      // Fail before subscribing: without the outbox, accepted measurements
      // would roll back and could not produce a durable ACK.
      try {
        await pool.query("SELECT 1 FROM clinic.hardware_measurement_ack_outbox LIMIT 0");
        await pool.query(
          `SELECT payload_hash, measurement_session_id, print_requested_by_user_id,
                  print_last_manual_reprint_at, print_manual_reprint_count
           FROM clinic.hardware_measurement_events LIMIT 0`,
        );
        await pool.query("SELECT 1 FROM clinic.hardware_event_audit LIMIT 0");
      } catch (error) {
        throw new Error(
          `Hardware backend schema is not ready; run database/migrations.sql (${error.message})`,
        );
      }
    }
    startMqttBridge();
    await new Promise((resolve, reject) => {
      httpServer = app.listen(PORT);
      httpServer.once("error", reject);
      httpServer.once("listening", resolve);
    });
    notificationsRouter.startNotificationJob?.();
    console.log(`✅ Server is running on port ${PORT}`);
  } catch (error) {
    console.error("Server startup failed:", error);
    await stopMqttBridge().catch(() => {});
    await pool.end().catch(() => {});
    process.exitCode = 1;
  }
}

startServer();

async function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  await stopMqttBridge();
  await pool.end();
  process.exit(0);
}

process.once("SIGTERM", () => shutdown("SIGTERM").catch((error) => {
  console.error("Shutdown failed:", error);
  process.exit(1);
}));
process.once("SIGINT", () => shutdown("SIGINT").catch((error) => {
  console.error("Shutdown failed:", error);
  process.exit(1);
}));
