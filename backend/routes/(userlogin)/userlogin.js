const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../../tools/config");
const pool = require("../../tools/db"); // ปรับ path ตามโปรเจกต์ของคุณ

const router = express.Router();

// POST /api/users/login
router.post("/login", async (req, res) => {
  try {
    const { email, username, password, remember_me } = req.body;
    if (!password || (!email && !username)) {
      return res
        .status(400)
        .json({ error: "กรอก email/username และ password" });
    }

    // เดาจาก front: ถ้ามี @ ถือว่าเป็น email
    const identifier = String(email || username || "").trim();
    const isEmail = !!(email || (username && username.includes("@")));

    const q = isEmail
      ? `SELECT user_id, username, email, password_hash, role
         FROM clinic.users
         WHERE LOWER(email) = LOWER($1)
         ORDER BY CASE
           WHEN LOWER(role::text) IN ('super_admin', 'superadmin', 'admin', 'doctor', 'assistant') THEN 0
           ELSE 1
         END
         LIMIT 1`
      : "SELECT user_id, username, email, password_hash, role FROM clinic.users WHERE username = $1";

    const { rows } = await pool.query(q, [identifier]);
    if (!rows.length)
      return res.status(401).json({ error: "ไม่พบบัญชีผู้ใช้" });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash || "");
    if (!ok) return res.status(401).json({ error: "รหัสผ่านไม่ถูกต้อง" });

    const normalizedRole = String(user.role || "").toLowerCase();
    const isUserRole = normalizedRole === "user" || normalizedRole === "users";

    const token = jwt.sign(
      { sub: user.user_id, role: normalizedRole, username: user.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    // ส่ง cookie ให้ front ใช้ได้ (เลือกจะใช้/ไม่ใช้ก็ได้ – front เก็บใน cookie เองอยู่แล้ว)
    // 1) httpOnly ปลอดภัย ใช้ฝั่ง backend ตรวจ token อัตโนมัติ
    // 1) cookie สำหรับ backend ใช้ตรวจ token (ตามเดิม)
    res.cookie("authToken", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // true ถ้าใช้ HTTPS
      path: "/",
      ...(remember_me ? { maxAge: 7 * 24 * 60 * 60 * 1000 } : {}),
    });

    // 2) cookie ที่ฝั่ง frontend จะอ่านด้วย js-cookie
    if (isUserRole) {
      // ผู้ใช้ทั่วไป
      res.clearCookie("adminToken", { path: "/" });
      res.cookie("userToken", token, {
        httpOnly: false,
        sameSite: "lax",
        secure: false,
        path: "/",
        ...(remember_me ? { maxAge: 7 * 24 * 60 * 60 * 1000 } : {}),
      });
    } else {
      // staff / admin / super_admin / doctor
      res.clearCookie("userToken", { path: "/" });
      res.cookie("adminToken", token, {
        httpOnly: false,
        sameSite: "lax",
        secure: false,
        path: "/",
        ...(remember_me ? { maxAge: 7 * 24 * 60 * 60 * 1000 } : {}),
      });
    }

    delete user.password_hash;
    res.json({ token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Login error" });
  }
});

// (ทางเลือก) GET /api/users/me ตรวจ token
router.get("/me", (req, res) => {
  try {
    const h = req.headers.authorization || "";
    const t = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!t) return res.status(401).json({ error: "Missing token" });
    const payload = jwt.verify(t, JWT_SECRET);
    res.json(payload);
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
});

module.exports = router;
