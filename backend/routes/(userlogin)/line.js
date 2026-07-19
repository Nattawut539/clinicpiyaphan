// routes/line.js
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../../tools/db");
const { FRONTEND_URL, JWT_SECRET } = require("../../tools/config");

const router = express.Router();

const ROLE_HOME = {
  super_admin: "/admin/dashboard",
  superadmin: "/admin/dashboard",
  admin: "/admin/dashboard",
  doctor: "/admin/dashboard",
  assistant: "/admin/dashboard",
  user: "/users/userHome",
  users: "/users/userHome",
};

const {
  LINE_CHANNEL_ID,
  LINE_CHANNEL_SECRET,
  LINE_REDIRECT_URI,
  LINE_SCOPES = "openid profile",
} = process.env;

const rand = () => crypto.randomBytes(16).toString("hex");

function createOAuthState(nonce) {
  const payload = Buffer.from(
    JSON.stringify({ nonce, iat: Date.now() }),
    "utf8"
  ).toString("base64url");
  const sig = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

function verifyOAuthState(value) {
  if (!value || typeof value !== "string") return null;

  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;

  const expected = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(payload)
    .digest("base64url");

  const sigBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);
  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (Date.now() - Number(data.iat) > 10 * 60 * 1000) return null;
    return data;
  } catch {
    return null;
  }
}

// เริ่ม LINE Login
router.get("/line/login", (req, res) => {
  if (
    !LINE_CHANNEL_ID ||
    /YOUR_LINE_CHANNEL_ID/i.test(String(LINE_CHANNEL_ID))
  ) {
    return res
      .status(500)
      .json({ error: "LINE_CHANNEL_ID is not set properly" });
  }
  if (!LINE_REDIRECT_URI)
    return res.status(500).json({ error: "LINE_REDIRECT_URI is not set" });

  const nonce = rand();
  const state = createOAuthState(nonce);
  res.cookie("line_state", state, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 10 * 60 * 1000,
  });
  res.cookie("line_nonce", nonce, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 10 * 60 * 1000,
  });

  const authURL = new URL("https://access.line.me/oauth2/v2.1/authorize");
  authURL.searchParams.set("response_type", "code");
  authURL.searchParams.set("client_id", String(LINE_CHANNEL_ID)); // ← ใช้ .env
  authURL.searchParams.set("redirect_uri", LINE_REDIRECT_URI); // ← ใช้ .env
  authURL.searchParams.set("state", state);
  authURL.searchParams.set("scope", LINE_SCOPES);
  authURL.searchParams.set("nonce", nonce);

  return res.redirect(authURL.toString());
});

// Callback
router.get("/line/callback", async (req, res, next) => {
  const { code, state } = req.query;
  const stateCookie = req.cookies?.line_state;
  const nonceCookie = req.cookies?.line_nonce;

  try {
    const stateData =
      stateCookie && state === stateCookie ? { nonce: nonceCookie } : verifyOAuthState(String(state));

    if (!code || !state || !stateData) {
      const e = new Error("Invalid state");
      e.status = 400;
      throw e;
    }

    res.clearCookie("line_state", { path: "/" });
    res.clearCookie("line_nonce", { path: "/" });

    const tokenRes = await axios.post(
      "https://api.line.me/oauth2/v2.1/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: LINE_REDIRECT_URI,
        client_id: LINE_CHANNEL_ID,
        client_secret: LINE_CHANNEL_SECRET,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    const { access_token } = tokenRes.data;

    const verifiedIdToken = await axios.post(
      "https://api.line.me/oauth2/v2.1/verify",
      new URLSearchParams({
        id_token: tokenRes.data.id_token,
        client_id: LINE_CHANNEL_ID,
        nonce: nonceCookie || stateData.nonce || "",
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const prof = await axios.get("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const lineUserId = prof.data.userId;
    const displayName = prof.data.displayName || null;
    const pictureUrl = prof.data.pictureUrl || null;
    const email = verifiedIdToken.data.email
      ? String(verifiedIdToken.data.email).trim().toLowerCase()
      : null;

    const client = await pool.connect();
    let user_id, role;
    try {
      await client.query("BEGIN");
      let found = await client.query(
        "SELECT user_id, role FROM clinic.users WHERE line_id=$1",
        [lineUserId]
      );

      if (!found.rowCount && email) {
        found = await client.query(
          `SELECT u.user_id, u.role
           FROM clinic.users u
           LEFT JOIN clinic.user_details d ON d.user_id = u.user_id
           WHERE LOWER(u.email) = $1
              OR LOWER(d.email) = $1
           ORDER BY CASE
             WHEN LOWER(u.role::text) IN ('super_admin', 'superadmin', 'admin', 'doctor', 'assistant') THEN 0
             ELSE 1
           END
           LIMIT 1`,
          [email]
        );
      }

      if (found.rowCount) {
        ({ user_id, role } = found.rows[0]);
        await client.query(
          `UPDATE clinic.users
           SET line_id = COALESCE(line_id, $1),
               email = COALESCE(email, $2),
               last_login_at = NOW()
           WHERE user_id = $3`,
          [lineUserId, email, user_id]
        );
        await client.query(
          `UPDATE clinic.user_details
           SET email = COALESCE(email, $1),
               first_name = COALESCE(first_name, $2),
               profile_image = COALESCE(NULLIF(profile_image, ''), $3)
           WHERE user_id = $4`,
          [email, displayName, pictureUrl, user_id]
        );
      } else {
        const ins = await client.query(
          "INSERT INTO clinic.users (line_id, email, role) VALUES ($1, $2, $3) RETURNING user_id, role",
          [lineUserId, email, "user"]
        );
        ({ user_id, role } = ins.rows[0]);
        await client.query(
          "INSERT INTO clinic.user_details (user_id, first_name, profile_image, email) VALUES ($1,$2,$3,$4)",
          [user_id, displayName, pictureUrl, email]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const normalizedRole = String(role || "").toLowerCase();
    const token = jwt.sign(
      { sub: user_id, role: normalizedRole },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("authToken", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const isUserRole = normalizedRole === "user" || normalizedRole === "users";
    res.clearCookie(isUserRole ? "adminToken" : "userToken", { path: "/" });
    res.cookie(isUserRole ? "userToken" : "adminToken", token, {
      httpOnly: false,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const dest = new URL(ROLE_HOME[normalizedRole] || "/", FRONTEND_URL).toString();
    return res.redirect(dest);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
