const jwt = require("jsonwebtoken");
const pool = require("./db");
const { JWT_SECRET } = require("./config");

/**
 * อ่าน token แล้ว set context ให้ RLS ผ่าน set_config (ปลอดภัยสุดสำหรับ RLS)
 * ใช้คู่กับ withContext ใน route ที่ query DB
 */
function authContext(required = true) {
  return (req, res, next) => {
    try {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

      if (!token) {
        if (!required) return next();
        return res.status(401).json({ message: "No token" });
      }

      const decoded = jwt.verify(token, JWT_SECRET);

      const user_id = decoded.user_id ?? decoded.id ?? decoded.sub;
      const role = String(decoded.role || "").toLowerCase();

      if (!user_id || !role) {
        return res.status(401).json({ message: "Invalid token payload" });
      }

      req.user = { user_id, role };

      // ✅ อย่าทำ pool.query set_config ตรงนี้ (มันไม่การันตีว่าเป็น connection เดียวกับ query ถัดไป)
      // ให้ใช้ withContext ใน route แทน
      return next();
    } catch (err) {
      console.error("authContext error:", err);
      return res.status(401).json({ message: "Unauthorized" });
    }
  };
}

module.exports = authContext;
