const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_for_local";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const CORS_ORIGINS = (process.env.CORS_ORIGINS || FRONTEND_URL)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (IS_PRODUCTION && !process.env.JWT_SECRET) {
  console.warn("JWT_SECRET is not set. Set a long random JWT_SECRET before production deploy.");
}

module.exports = {
  PORT,
  FRONTEND_URL,
  JWT_SECRET,
  CORS_ORIGINS,
};
