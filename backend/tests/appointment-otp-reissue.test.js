const assert = require("node:assert/strict");
const test = require("node:test");

let appointmentRow;
let queryLog;

const client = {
  async query(sql) {
    const query = String(sql);
    queryLog.push(query);
    if (query.includes("FROM clinic.appointments a") && query.includes("FOR UPDATE OF a")) {
      return appointmentRow
        ? { rowCount: 1, rows: [appointmentRow] }
        : { rowCount: 0, rows: [] };
    }
    if (query.includes("INSERT INTO clinic.appointment_access_codes")) {
      return { rowCount: 1, rows: [{ expires_at: "2026-09-28T10:15:00.000Z" }] };
    }
    return { rowCount: 0, rows: [] };
  },
  release() {},
};

const fakePool = {
  async connect() { return client; },
};

function mockModule(filename, exports) {
  const id = require.resolve(filename);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

const passMiddleware = (_req, _res, next) => next();
mockModule("../tools/db", fakePool);
mockModule("../tools/_utils", { authRequired: passMiddleware, requireStaff: passMiddleware });
mockModule("../tools/mailer", {
  escapeHtml: (value) => String(value),
  sendClinicMail: async () => ({ accepted: [] }),
});
mockModule("../tools/config", { JWT_SECRET: "appointment-otp-reissue-test-secret" });
mockModule("../tools/calendarRules", {
  ensureCalendarRulesSchema: async () => {},
  isAdvanceBookingDate: async () => false,
  isClinicHoliday: async () => null,
});
mockModule("../tools/slotSeeder", { reopenBookableSlotsForDate: async () => {} });

const appointmentsRouter = require("../routes/appointments");
const resendLayer = appointmentsRouter.stack.find(
  (layer) => layer.route?.path === "/:id/resend-code",
);
assert.ok(resendLayer, "admin OTP reissue endpoint must exist");
const [staffMiddleware, resendHandler] = resendLayer.route.stack.map((layer) => layer.handle);

function baseAppointment(overrides = {}) {
  return {
    appointment_id: 42,
    email: null,
    first_name: "Test Patient",
    service_date: "2026-09-28",
    hour_of_day: 17,
    queue_service_date: "2026-09-28",
    queue_date_matches_appointment: true,
    is_service_date_today: true,
    service_date_is_future: false,
    queue_id: 99,
    queue_number: "A006",
    ...overrides,
  };
}

async function invokeResend(row) {
  appointmentRow = row;
  queryLog = [];
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const req = { params: { id: "42" }, user: { role: "admin", user_id: 7 } };
  let middlewareError = null;
  staffMiddleware(req, res, (error) => { middlewareError = error || null; });
  assert.ifError(middlewareError);
  let routeError = null;
  await resendHandler(req, res, (error) => { routeError = error; });
  assert.ifError(routeError);
  return res;
}

test("resend-code rejects a future queue date without replacing an existing code", async () => {
  const res = await invokeResend(baseAppointment({
    service_date: "2026-09-29",
    queue_service_date: "2026-09-29",
    is_service_date_today: false,
    service_date_is_future: true,
  }));

  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /ยังไม่ถึงวันนัด/);
  assert.ok(queryLog.includes("ROLLBACK"));
  assert.equal(queryLog.some((query) => query.includes("INSERT INTO clinic.appointment_access_codes")), false);
});

test("resend-code rejects a past queue date and directs the patient to walk-in", async () => {
  const res = await invokeResend(baseAppointment({
    service_date: "2026-09-27",
    queue_service_date: "2026-09-27",
    is_service_date_today: false,
    service_date_is_future: false,
  }));

  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /Walk-in/);
  assert.ok(queryLog.includes("ROLLBACK"));
  assert.equal(queryLog.some((query) => query.includes("INSERT INTO clinic.appointment_access_codes")), false);
});

test("resend-code reports appointment and queue date mismatches", async () => {
  const res = await invokeResend(baseAppointment({
    queue_service_date: "2026-09-29",
    queue_date_matches_appointment: false,
    is_service_date_today: false,
    service_date_is_future: true,
  }));

  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /2026-09-28.*2026-09-29/);
  assert.ok(queryLog.includes("ROLLBACK"));
  assert.equal(queryLog.some((query) => query.includes("INSERT INTO clinic.appointment_access_codes")), false);
});

test("resend-code issues a code when the queue and appointment dates match today", async () => {
  const res = await invokeResend(baseAppointment());

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.email_sent, false);
  assert.match(res.body.access_code, /^\d{6}$/);
  assert.ok(queryLog.includes("COMMIT"));
  assert.ok(queryLog.some((query) => query.includes("INSERT INTO clinic.appointment_access_codes")));
  const lookup = queryLog.find((query) => query.includes("FROM clinic.appointments a") && query.includes("FOR UPDATE OF a"));
  assert.match(lookup, /q\.service_date = s\.service_date/);
  assert.match(lookup, /now\(\) AT TIME ZONE 'Asia\/Bangkok'/);
});
