const buckets = new Map();

const RULES = [
  { method: "POST", path: "/api/users/login", limit: 10, windowMs: 15 * 60 * 1000 },
  { method: "POST", path: "/api/users/register", limit: 5, windowMs: 60 * 60 * 1000 },
  { method: "POST", path: "/api/measurements/access-code", limit: 8, windowMs: 15 * 60 * 1000 },
  { method: "POST", pathPrefix: "/api/users/forgot-password/", limit: 10, windowMs: 15 * 60 * 1000 },
  { method: "POST", pathPrefix: "/api/users/email-verification/", limit: 10, windowMs: 15 * 60 * 1000 },
  { method: "POST", pathPrefix: "/api/appointments/", limit: 20, windowMs: 15 * 60 * 1000 },
];

function findRule(req) {
  const path = String(req.originalUrl || req.url || "").split("?")[0];
  return RULES.find((rule) =>
    rule.method === req.method && (rule.path === path || (rule.pathPrefix && path.startsWith(rule.pathPrefix)))
  );
}

function securityRateLimit(req, res, next) {
  const rule = findRule(req);
  if (!rule) return next();

  const now = Date.now();
  const key = `${req.ip || req.socket?.remoteAddress || "unknown"}:${rule.path || rule.pathPrefix}`;
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + rule.windowMs }
    : current;
  bucket.count += 1;
  buckets.set(key, bucket);

  res.setHeader("X-RateLimit-Limit", String(rule.limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, rule.limit - bucket.count)));

  if (bucket.count > rule.limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    res.locals.errorCode = "RATE_LIMITED";
    return res.status(429).json({ message: "Too many attempts. Please try again later." });
  }

  return next();
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 10 * 60 * 1000);
cleanupTimer.unref?.();

module.exports = securityRateLimit;
