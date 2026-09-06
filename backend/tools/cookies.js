const {
  COOKIE_DOMAIN,
  COOKIE_SAME_SITE,
  COOKIE_SECURE,
} = require("./config");

function cookieOptions({ httpOnly = true, maxAge } = {}) {
  return {
    httpOnly,
    sameSite: COOKIE_SAME_SITE,
    secure: COOKIE_SECURE,
    path: "/",
    ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
    ...(maxAge ? { maxAge } : {}),
  };
}

function clearCookieOptions({ httpOnly = true } = {}) {
  const { maxAge: _maxAge, ...options } = cookieOptions({ httpOnly });
  return options;
}

module.exports = { cookieOptions, clearCookieOptions };
