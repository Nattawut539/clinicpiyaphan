const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../../tools/db");
const { FRONTEND_URL, JWT_SECRET } = require("../../tools/config");
const { cookieOptions, clearCookieOptions } = require("../../tools/cookies");

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
  return cookieOptions({ httpOnly: true, maxAge: 10 * 60 * 1000 });
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
    res.clearCookie("gg_state", clearCookieOptions({ httpOnly: true }));
    res.clearCookie("gg_nonce", clearCookieOptions({ httpOnly: true }));
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
    if (nonceCookie && googleProfile.nonce !== nonceCookie) {
      throw new Error("Google ID token nonce is invalid");
    }

    const googleUserId = String(googleProfile.sub || "");
    const email = String(googleProfile.email || "").trim().toLowerCase();
    const name = String(googleProfile.name || "").trim() || null;
    const picture = String(googleProfile.picture || "").trim() || null;
    if (!googleUserId || !email) {
      throw new Error("Google account does not provide a usable email");
    }
    if (String(googleProfile.email_verified).toLowerCase() !== "true") {
      throw new Error("Google email is not verified");
    }

    const client = await pool.connect();
    let userId;
    let role;
    let sessionVersion = 1;
    let profileCompleted = false;
    try {
      await client.query("BEGIN");

      const existing = await client.query(
        `SELECT user_id, role, account_status, session_version
         FROM clinic.users
         WHERE google_id = $1 OR lower(email) = $2
         ORDER BY CASE WHEN google_id = $1 THEN 0 ELSE 1 END
         LIMIT 1
         FOR UPDATE`,
        [googleUserId, email],
      );

      if (existing.rowCount) {
        ({ user_id: userId, role } = existing.rows[0]);
        sessionVersion = Number(existing.rows[0].session_version || 1);
        const existingStatus = String(existing.rows[0].account_status || "active");
        if (!["active", "pending_verification"].includes(existingStatus)) {
          const error = new Error("Account is not active");
          error.status = 403;
          error.code = "ACCOUNT_INACTIVE";
          error.accountStatus = existingStatus.toLowerCase();
          throw error;
        }
        await client.query(
          `UPDATE clinic.users
           SET google_id = COALESCE(google_id, $1),
               email = COALESCE(email, $2),
               email_verified_at = COALESCE(email_verified_at, now()),
               account_status = CASE WHEN account_status = 'pending_verification' THEN 'active' ELSE account_status END,
               registration_source = 'google',
               last_login_at = NOW()
           WHERE user_id = $3`,
          [googleUserId, email, userId],
        );

        const detailUpdate = await client.query(
          `UPDATE clinic.user_details
           SET email = COALESCE(email, $1),
               first_name = COALESCE(NULLIF(first_name, ''), $2),
               profile_image = COALESCE(NULLIF(profile_image, ''), $3)
           WHERE user_id = $4
           RETURNING national_id, first_name, last_name, birth_date, phone`,
          [email, name, picture, userId],
        );
        if (!detailUpdate.rowCount) {
          await client.query(
            `INSERT INTO clinic.user_details (user_id, first_name, profile_image, email)
             VALUES ($1, $2, $3, $4)`,
            [userId, name, picture, email],
          );
        } else {
          const detail = detailUpdate.rows[0];
          profileCompleted = Boolean(detail.national_id && detail.first_name && detail.last_name && detail.birth_date && detail.phone);
          if (profileCompleted) {
            await client.query(
              `UPDATE clinic.users SET profile_completed_at = COALESCE(profile_completed_at, now()) WHERE user_id = $1`,
              [userId],
            );
          }
        }
      } else {
        const inserted = await client.query(
          `INSERT INTO clinic.users
           (google_id, email, role, account_status, email_verified_at, registration_source)
           VALUES ($1, $2, 'user', 'active', now(), 'google')
           RETURNING user_id, role, session_version`,
          [googleUserId, email],
        );
        ({ user_id: userId, role } = inserted.rows[0]);
        sessionVersion = Number(inserted.rows[0].session_version || 1);
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
      { sub: userId, role: normalizedRole, sv: sessionVersion },
      JWT_SECRET,
      { expiresIn: "7d" },
    );
    const authCookieMaxAge = 7 * 24 * 60 * 60 * 1000;
    res.cookie("authToken", token, cookieOptions({ httpOnly: true, maxAge: authCookieMaxAge }));
    const isUser = normalizedRole === "user" || normalizedRole === "users";
    res.clearCookie(isUser ? "adminToken" : "userToken", clearCookieOptions({ httpOnly: false }));
    res.cookie(isUser ? "userToken" : "adminToken", token, {
      ...cookieOptions({ httpOnly: false, maxAge: authCookieMaxAge }),
    });

    return res.redirect(
      new URL(
        isUser && !profileCompleted ? "/google/complete-profile" : ROLE_HOME[normalizedRole] || "/",
        FRONTEND_URL,
      ).toString(),
    );
  } catch (error) {
    clearOauthCookies();
    console.error(
      "Google OAuth callback failed:",
      error.response?.data || error.message,
    );
    const loginUrl = new URL("/userlogin", FRONTEND_URL);
    loginUrl.searchParams.set("oauth_error", error.code === "ACCOUNT_INACTIVE" ? "account_inactive" : "provider_error");
    loginUrl.searchParams.set("provider", "google");
    if (error.accountStatus) loginUrl.searchParams.set("account_status", error.accountStatus);
    return res.redirect(loginUrl.toString());
  }
});

module.exports = router;
