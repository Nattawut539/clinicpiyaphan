const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../../tools/config");
const pool = require("../../tools/db");
const { authRequired } = require("../../tools/_utils");
const { cookieOptions, clearCookieOptions } = require("../../tools/cookies");
const router = express.Router();

//เข้าสู่ระบบ
router.post("/login", async (req, res) => {
  try {
    const { email, username, password, remember_me } = req.body; //รับค่า จาก const ที่ส่งมาจาก frontend
    if (!password || (!email && !username)) {
      // ตรวจสอบข้อมูลที่จำเป็น (ผู้ใช้ต้องกรอก password ,email หรือ username อย่างน้อยหนึ่งค่า)
      return res
        .status(400)
        .json({ error: "กรอก email หรือ username และ password" });
    }

    //เดาว่า ถ้ามี @ ถือว่าเป็น email
    const identifier = String(email || username || "").trim(); //identifier ค่าที่ระบบนำไปค้นหาในฐานข้อมูล
    const isEmail = !!(email || (username && username.includes("@"))); //ตรวจการเข้าสู่ระบบ front ส่งมา แม้ front กรอกในช่อง username แต่มีเครื่องหมาย @ ระบบจะมองว่าเป็น email

    //เลือกคำสั่ง SQL ตามประเภท (หากเป็น Email ใช้คำสั่งชุดแรก '?' , แต่ถ้าเป็น Username จะใช้อีกคำสั่ง ':')
    const q = isEmail
      ? `SELECT user_id,username,email,password_hash,role,account_status,session_version
    FROM clinic.users
    WHERE LOWER(email) = LOWER($1)
    ORDER BY CASE
      WHEN LOWER(role::text) IN ('super_admin','superadmin','admin','doctor','assistant') THEN 0
      ELSE 1
    END
    LIMIT 1`
      : "SELECT user_id,username,email,password_hash,role,account_status,session_version FROM clinic.users WHERE username = $1";

    //ส่งคำสั่งค้นหาไปยังฐานข้อมูล
    const { rows } = await pool.query(q, [identifier]); //q คือคำสั่ง SQL ที่เลือก ส่วน identifier คือ Email หรือ Username
    if (!rows.length)
      return res.status(401).json({ error: "ไม่พบบัญชีผู้ใช้" });

    //เก็บข้อมูลผู้ใช้ที่ค้นพบ
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash || ""); // ตรวจสอบรหัสผ่าน
    if (!ok) return res.status(401).json({ error: "รหัสผ่านไม่ถูกต้อง" });

    const accountStatus = String(user.account_status || "active").toLowerCase();
    if (accountStatus === "pending_verification") {
      return res.status(403).json({
        error: "กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ",
        code: "EMAIL_VERIFICATION_REQUIRED",
        email: user.email,
      });
    }
    if (accountStatus !== "active") {
      const messages = {
        deactivated: "บัญชีนี้ถูกหยุดใช้งานตามคำขอ หากต้องการกลับมาใช้บัญชีเดิม กรุณาติดต่อคลินิก",
        suspended: "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อคลินิกเพื่อตรวจสอบสถานะบัญชี",
        duplicate: "บัญชีนี้ถูกปิดเนื่องจากเป็นบัญชีซ้ำ กรุณาติดต่อคลินิกเพื่อใช้บัญชีเดิม",
      };
      return res.status(403).json({
        error: messages[accountStatus] || "บัญชีนี้ไม่อยู่ในสถานะพร้อมใช้งาน กรุณาติดต่อคลินิก",
        code: "ACCOUNT_INACTIVE",
        account_status: accountStatus,
      });
    }

    const normalizedRole = String(user.role || "").toLowerCase(); // ปรับ Role เป็นตัวพิมพ์เล็ก(ช่วยให้ตรวจสอบ Role ได้ง่าย)
    const isUserRole = normalizedRole === "user" || normalizedRole === "users"; //ตรวจสอบว่าเป็นผู้ใช้งานทั่วไปหรือเจ้าหน้าที่

    //สร้าง JWT
    const token = jwt.sign(
      { sub: user.user_id, role: normalizedRole, username: user.username, sv: Number(user.session_version || 1) },
      JWT_SECRET,
      { expiresIn: "7d" }, //sub ใช้ระบุ Token เป็นผู้ใช้คนใด ,role ระบุผู้ใช้ , username ระบุชื่อผู้ใช้ เพื่อไม่ต้องค้นหาในฐานข้อมูลทุกครั้ง
    );

    //Cookie authToken (ใช้ตรวจสอบตัวตนของผู้ใช้)
    // 1. httpOnly ช่วยลดความเสี่ยงที่ Token จะถูกขโมย
    // 2. sameSite ช่วยลดความเสี่ยงจากการโจมตีแบบ CSRF
    // 3. secure อนุญาตให้ส่ง Cookie ผ่าน HTTP
    const maxAge = remember_me ? 7 * 24 * 60 * 60 * 1000 : undefined;
    res.cookie("authToken", token, cookieOptions({ httpOnly: true, maxAge }));

    //ถ้า role เป็น user หรือ users
    // 1. ระบบจะลบ adminToken เก่า และสร้าง userToken
    if (isUserRole) {
      //Role ผู้ใช้ทั่วไป
      res.clearCookie("adminToken", clearCookieOptions({ httpOnly: false }));
      res.cookie("userToken", token, cookieOptions({ httpOnly: false, maxAge }));
    } else {
      //หรือ Role admin / super_admin / doctor
      // 1. ถ้าไม่ใช่ user ระบบจะจัดเป็นเจ้าหน้าที่ โดยลบ userToken และสร้าง adminToken
      res.clearCookie("userToken", clearCookieOptions({ httpOnly: false }));
      res.cookie("adminToken", token, cookieOptions({ httpOnly: false, maxAge }));
    }
    delete user.password_hash; //ลบรหัสผ่านออกจากข้อมูลที่จะตอบกลับ
    await pool.query("UPDATE clinic.users SET last_login_at = now() WHERE user_id = $1", [user.user_id]);
    res.json({ token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เข้าสู่ระบบล้มเหลว" });
  }
});

//ออกจากระบบ
router.post("/logout", async (_req, res) => {        //ลบ Token และ Cookie ทั้งหมด
  res.clearCookie("authToken", clearCookieOptions({ httpOnly: true }));
  res.clearCookie("adminToken", clearCookieOptions({ httpOnly: false }));
  res.clearCookie("userToken", clearCookieOptions({ httpOnly: false }));
  res.json({ message: "ออกจากระบบสำเร็จ" });
});

//ตรวจสอบ Token  (user login อยู่หรือไม่ , Token หมดอายุหรือยัง  , user มี role อะไร)
router.get("/me", authRequired, (req, res) => {
  res.json({
    sub: req.user.user_id,
    user_id: req.user.user_id,
    role: req.user.role,
    email: req.user.email,
    account_status: req.user.account_status,
    profile_completed: req.user.profile_completed,
    medical_consent: req.user.medical_consent,
    registration_source: req.user.registration_source,
  });
});

module.exports = router;
