const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const ensureQueueSchema = require("./tools/ensureQueueSchema");
const { PORT, CORS_ORIGINS, JWT_SECRET } = require("./tools/config");
const notificationsRouter = require("./routes/notifications");

const app = express();

process.env.JWT_SECRET = JWT_SECRET;

app.use(cors({
  origin(origin, callback) {
    if (!origin || CORS_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());


// === Auth / user login ===
app.use("/api/users", require("./routes/(userlogin)/register"));
app.use("/api/users", require("./routes/(userlogin)/userlogin"));
app.use("/api/users", require("./routes/(userlogin)/password"));
app.use("/api", require("./routes/(userlogin)/google"));
app.use("/api", require("./routes/(userlogin)/line"));
app.use("/api/provinces", require("./routes/provinces"));

// === Core APIs ===
app.use("/api", require("./routes/help"));
app.use("/api", require("./routes/users"));
app.use("/api", require("./routes/queue"));
app.use("/api", require("./routes/medical"));
app.use("/api", notificationsRouter);
app.use("/api/appointments", require("./routes/appointments"));
app.use("/api", require("./routes/measurements"));
app.use("/api/calendar", require("./routes/calendar"));
app.use("/api", require("./routes/feedbacks"));
app.use("/api/slots", require("./routes/slots"));


app.use("/uploads", express.static(path.join(__dirname, "uploads"))); // ✅ ให้เบราว์เซอร์เข้าถึงไฟล์ได้
app.get("/", (_req, res) => res.send("Clinic API is running"));

async function startServer() {
  try {
    await ensureQueueSchema();
    notificationsRouter.startNotificationJob?.();
    app.listen(PORT, () => console.log(`✅ Server is running on port ${PORT}`));
  } catch (error) {
    console.error("Queue schema migration failed:", error);
    process.exitCode = 1;
  }
}

startServer();
