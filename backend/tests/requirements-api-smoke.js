const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const jwt = require("jsonwebtoken");
const pool = require("../tools/db");
const { JWT_SECRET, PORT } = require("../tools/config");

async function request(route, token, options = {}) {
  const response = await fetch(`http://127.0.0.1:${PORT}/api${route}`, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function main() {
  const staff = await pool.query(
    `SELECT user_id, role::text AS role, session_version
     FROM clinic.users
     WHERE lower(role::text) IN ('admin','super_admin','superadmin','doctor','assistant')
       AND account_status = 'active'
     ORDER BY user_id LIMIT 1`,
  );
  if (!staff.rowCount) throw new Error("No active staff account available for smoke test");
  const actor = staff.rows[0];
  const token = jwt.sign(
    { sub: actor.user_id, role: String(actor.role).toLowerCase(), sv: Number(actor.session_version || 1) },
    JWT_SECRET,
    { expiresIn: "5m" },
  );

  const me = await request("/users/me", token);
  const invalidSearch = await request(
    "/appointments/check-in/search?national_id=1&first_name=A&last_name=B",
    token,
  );
  if (me.status !== 200) throw new Error(`/users/me expected 200, got ${me.status}`);
  if (invalidSearch.status !== 400) throw new Error(`check-in validation expected 400, got ${invalidSearch.status}`);

  console.log(JSON.stringify({
    ok: true,
    session_validation: me.status,
    checkin_input_validation: invalidSearch.status,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
