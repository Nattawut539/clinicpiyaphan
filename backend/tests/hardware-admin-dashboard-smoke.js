require("dotenv").config();

const assert = require("node:assert/strict");
const pool = require("../tools/db");
const { signToken } = require("../tools/_utils");
const hardwareRouter = require("../routes/hardware");

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function runMiddleware(middleware, req, res) {
  let continued = false;
  await middleware(req, res, () => {
    continued = true;
  });
  return continued;
}

async function main() {
  const layer = hardwareRouter.stack.find(
    (entry) => entry.route?.path === "/hardware/admin-dashboard",
  );
  assert.ok(layer, "admin dashboard route must exist");
  assert.equal(layer.route.stack.length, 2, "route must have authorization and handler layers");

  const [authorize, handler] = layer.route.stack.map((entry) => entry.handle);
  const deniedReq = {
    headers: {},
    cookies: {},
    authenticatedUserVerified: true,
    user: { user_id: 999999, role: "admin" },
  };
  const deniedRes = responseRecorder();
  assert.equal(await runMiddleware(authorize, deniedReq, deniedRes), false);
  assert.equal(deniedRes.statusCode, 403, "ordinary admin must not access hardware logs");

  const userResult = await pool.query(
    `SELECT user_id, role::text AS role, email, session_version
     FROM clinic.users
     WHERE lower(role::text) IN ('super_admin', 'superadmin')
       AND account_status = 'active'
     ORDER BY user_id
     LIMIT 1`,
  );
  assert.equal(userResult.rowCount, 1, "an active super admin is required for this smoke test");

  const token = signToken(userResult.rows[0]);
  const req = { headers: { authorization: `Bearer ${token}` }, cookies: {} };
  const res = responseRecorder();
  assert.equal(await runMiddleware(authorize, req, res), true, "super admin must be authorized");

  let routeError = null;
  await handler(req, res, (error) => {
    routeError = error;
  });
  assert.ifError(routeError);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body?.generated_at);
  assert.ok(res.body?.health?.mqtt);
  assert.ok(Array.isArray(res.body?.otps));
  assert.ok(Array.isArray(res.body?.devices));
  assert.ok(Array.isArray(res.body?.measurements));
  assert.ok(Array.isArray(res.body?.timeline));

  if (res.body.measurements.length) {
    const measurement = res.body.measurements[0];
    assert.ok(Object.hasOwn(measurement, "weight"));
    assert.ok(Object.hasOwn(measurement, "height"));
    assert.ok(Object.hasOwn(measurement, "bmi"));
    assert.ok(["pending", "printed", "failed"].includes(measurement.print_status));
  }

  console.log("Hardware super-admin dashboard smoke test passed against the configured database.");
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end().catch(() => {});
    process.exitCode = 1;
  });
