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
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GOOGLE_SCOPES = "openid email profile",
} = process.env;

const randomValue = () => crypto.randomBytes(24).toString("hex");

function oauthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60 * 1000,
  };
}

router.get("/google/login", (_req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    return res.status(500).json({ error: "Google OAuth is not configured" });
  }

  const state = randomValue();
  const nonce = randomValue();
  res.cookie("gg_state", state, oauthCookieOptions());
  res.cookie("gg_nonce", nonce, oauthCookieOptions());

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", GOOGLE_REDIRECT_URI);
  authUrl.searchParams.set("scope", GOOGLE_SCOPES);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("access_type", "online");
  authUrl.searchParams.set("prompt", "select_account");

  return res.redirect(authUrl.toString());
});

router.get("/google/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const stateCookie = req.cookies?.gg_state || "";
  const nonceCookie = req.cookies?.gg_nonce || "";

  const clearOauthCookies = () => {
    res.clearCookie("gg_state", { path: "/" });
    res.clearCookie("gg_nonce", { path: "/" });
  };

  try {
    if (!code || !state || !stateCookie || state !== stateCookie) {
      const error = new Error("Invalid or expired Google OAuth state");
      error.status = 400;
      throw error;
    }
    clearOauthCookies();

    const tokenResponse = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: GOOGLE_REDIRECT_URI,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    const idToken = tokenResponse.data?.id_token;
    if (!idToken) throw new Error("Google did not return an ID token");

    const tokenInfoResponse = await axios.get(
      "https://oauth2.googleapis.com/tokeninfo",
      { params: { id_token: idToken } },
    );
    const googleProfile = tokenInfoResponse.data || {};
    if (googleProfile.aud !== GOOGLE_CLIENT_ID) {
      throw new Error("Google ID token audience is invalid");
    }
    if (nonceCookie && googleProfile.nonce && googleProfile.nonce !== nonceCookie) {
      throw new Error("Google ID token nonce is invalid");
    }

    const googleUserId = String(googleProfile.sub || "");
    const email = String(googleProfile.email || "").trim().toLowerCase();
    const name = String(googleProfile.name || "").trim() || null;
    const picture = String(googleProfile.picture || "").trim() || null;
    if (!googleUserId || !email) {
      throw new Error("Google account does not provide a usable email");
    }

    const client = await pool.connect();
    let userId;
    let role;
    try {
      await client.query("BEGIN");

      const existing = await client.query(
        `SELECT user_id, role
         FROM clinic.users
         WHERE google_id = $1 OR lower(email) = $2
         ORDER BY CASE WHEN google_id = $1 THEN 0 ELSE 1 END
         LIMIT 1
         FOR UPDATE`,
        [googleUserId, email],
      );

      if (existing.rowCount) {
        ({ user_id: userId, role } = existing.rows[0]);
        await client.query(
          `UPDATE clinic.users
           SET google_id = COALESCE(google_id, $1),
               email = COALESCE(email, $2),
               last_login_at = NOW()
           WHERE user_id = $3`,
          [googleUserId, email, userId],
        );

        const detailUpdate = await client.query(
          `UPDATE clinic.user_details
           SET email = COALESCE(email, $1),
               first_name = COALESCE(NULLIF(first_name, ''), $2),
               profile_image = COALESCE(NULLIF(profile_image, ''), $3)
           WHERE user_id = $4`,
          [email, name, picture, userId],
        );
        if (!detailUpdate.rowCount) {
          await client.query(
            `INSERT INTO clinic.user_details (user_id, first_name, profile_image, email)
             VALUES ($1, $2, $3, $4)`,
            [userId, name, picture, email],
          );
        }
      } else {
        const inserted = await client.query(
          `INSERT INTO clinic.users (google_id, email, role)
           VALUES ($1, $2, 'user')
           RETURNING user_id, role`,
          [googleUserId, email],
        );
        ({ user_id: userId, role } = inserted.rows[0]);
        await client.query(
          `INSERT INTO clinic.user_details (user_id, first_name, profile_image, email)
           VALUES ($1, $2, $3, $4)`,
          [userId, name, picture, email],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const normalizedRole = String(role || "user").toLowerCase();
    const token = jwt.sign(
      { sub: userId, role: normalizedRole },
      JWT_SECRET,
      { expiresIn: "7d" },
    );
    const authCookieOptions = {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };

    res.cookie("authToken", token, { ...authCookieOptions, httpOnly: true });
    const isUser = normalizedRole === "user" || normalizedRole === "users";
    res.clearCookie(isUser ? "adminToken" : "userToken", { path: "/" });
    res.cookie(isUser ? "userToken" : "adminToken", token, {
      ...authCookieOptions,
      httpOnly: false,
    });

    return res.redirect(
      new URL(ROLE_HOME[normalizedRole] || "/", FRONTEND_URL).toString(),
    );
  } catch (error) {
    clearOauthCookies();
    console.error(
      "Google OAuth callback failed:",
      error.response?.data || error.message,
    );
    const loginUrl = new URL("/userlogin", FRONTEND_URL);
    loginUrl.searchParams.set("oauth_error", "google");
    return res.redirect(loginUrl.toString());
  }
});

module.exports = router;
