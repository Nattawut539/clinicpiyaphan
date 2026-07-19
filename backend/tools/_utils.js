// tools/_utils.js
const jwt = require("jsonwebtoken");
const pool = require("./db");
const { JWT_SECRET } = require("./config");

/* ---------- Token helpers ---------- */
// สร้างโทเค็น
function signToken(user) {
  return jwt.sign(
    {
      user_id: user.user_id,
      role: String(user.role || "").toLowerCase(),
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// ดึง token จาก Header หรือ Cookie
function getToken(req) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  if (req.cookies?.userToken) return req.cookies.userToken;
  if (req.cookies?.adminToken) return req.cookies.adminToken;
  // ✅ รองรับคุกกี้ที่ login ตั้งชื่อไว้
  if (req.cookies?.authToken) return req.cookies.authToken;
  return null;
}

// แปลง token → user (ถ้า optional=true จะคืน null แทนการ throw)
function parseUser(req, { optional = false } = {}) {
  const token = getToken(req);
  if (!token) {
    if (optional) return null;
    const e = new Error("Missing token");
    e.status = 401;
    throw e;
  }
  try {
    const p = jwt.verify(token, JWT_SECRET);
    // return {
    // user_id: p.user_id,
    // role: String(p.role || "").toLowerCase(),
    // email: p.email,
    // ✅ รองรับกรณี payload ใช้ sub แทน user_id
    const uid = p.user_id ?? p.sub ?? null;
    return {
      user_id: uid,
      role: String(p.role || "").toLowerCase(),
      email: p.email,
    };
    // };
  } catch {
    const e = new Error("Invalid token");
    e.status = 401;
    throw e;
  }
}

/* ---------- Middlewares ---------- */
// ไม่บังคับล็อกอิน
function authOptional(req, _res, next) {
  try {
    req.user = parseUser(req, { optional: true });
  } catch {
    req.user = null;
  }
  next();
}

// บังคับต้องมี token
function authRequired(req, res, next) {
  try {
    req.user = parseUser(req);
    next();
  } catch (e) {
    res.status(e.status || 401).json({ message: e.message });
  }
}

// บังคับสิทธิ์อย่างน้อยเป็น staff
function requireStaff(req, res, next) {
  try {
    req.user = parseUser(req);
    const ok = ["doctor", "assistant", "admin", "super_admin", "superadmin"].includes(
      req.user.role
    );
    if (!ok) return res.status(403).json({ message: "forbidden" });
    next();
  } catch (e) {
    res.status(e.status || 401).json({ message: e.message });
  }
}

// ระบุสิทธิ์ที่อนุญาตแบบเจาะจง
function requireRole(...roles) {
  return (req, res, next) => {
    try {
      req.user = parseUser(req);
      if (!roles.includes(req.user.role))
        return res.status(403).json({ message: "forbidden" });
      next();
    } catch (e) {
      res.status(e.status || 401).json({ message: e.message });
    }
  };
}

/* ---------- PostgreSQL context / tx ---------- */
// เซ็ต context ให้ฟังก์ชัน/นโยบาย RLS รู้ว่าใครยิง
async function setAppContext(client, user) {
  if (!user) return;

  await client.query(
    `
    SELECT
      set_config('app.user_id', $1::text, false),
      set_config('app.role', $2::text, false)
    `,
    [String(user.user_id), String(user.role)]
  );
}

// ทำงานใน transaction พร้อม set_app_context ถ้าส่ง req มา
async function withContext(req, cb) {
  const user = req?.user || null;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ✅ เพิ่มบรรทัดนี้: ให้ทุก query เห็นตารางใน clinic ก่อน
    await client.query("SET LOCAL search_path TO clinic, public;");

    if (user) {
      await setAppContext(client, user);
    }

    const ret = await cb(client);

    await client.query("COMMIT");
    return ret;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}


// ทำงานใน transaction แบบทั่วไป (ไม่ผูก req.user)
async function withTx(cb) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ret = await cb(client);
    await client.query("COMMIT");
    return ret;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    client.release();
  }
}

/* ---------- PG error → HTTP ---------- */
function pgErrorToHttp(e) {
  if (!e || !e.code)
    return { status: e.status || 500, message: e.message || "Internal error" };
  switch (e.code) {
    case "23505":
      return { status: 409, message: "ข้อมูลซ้ำ (unique violation)" };
    case "23503":
      return {
        status: 400,
        message: "อ้างอิงไม่ถูกต้อง (foreign key violation)",
      };
    case "23514":
      return { status: 400, message: "ข้อมูลผิดจาก CHECK constraint" };
    case "23502":
      return { status: 400, message: "ข้อมูลไม่ครบ (NOT NULL violation)" };
    default:
      return {
        status: 500,
        message: e.detail || e.message || "Database error",
      };
  }
}

module.exports = {
  // token
  signToken,
  getToken,
  parseUser,
  // middlewares
  authOptional,
  authRequired,
  requireRole,
  requireStaff,
  // db helpers
  setAppContext,
  withContext,
  withTx,
  // error helper
  pgErrorToHttp,
};
