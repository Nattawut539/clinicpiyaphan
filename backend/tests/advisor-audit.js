const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
const jwt = require("jsonwebtoken");
const pool = require("../tools/db");
const { JWT_SECRET } = require("../tools/config");

if (process.env.AUDIT_TEST_ALLOW_MUTATION !== "true") {
  throw new Error("Set AUDIT_TEST_ALLOW_MUTATION=true to run the self-cleaning integration audit");
}

const BASE = process.env.AUDIT_TEST_BASE_URL || "http://localhost:5000/api";
const runId = `advisor_audit_${Date.now()}`;
const identityPrefix = `audit_${Date.now().toString(36)}`;
const createdUserIds = new Set();
const touchedSlotIds = new Set();
const report = { run_id: runId, workflow: {}, races: {}, lifecycle: {}, authorization: {}, audit: {}, cleanup: {}, errors: [] };
const startedAt = new Date();

function sign(user) {
  return jwt.sign({ sub: user.user_id, role: String(user.role).toLowerCase() }, JWT_SECRET, {
    expiresIn: "10m",
  });
}

async function request(path, { method = "GET", token, body, timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    return {
      status: response.status,
      data: await response.json().catch(() => null),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function createUser(label) {
  const inserted = await pool.query(
    `INSERT INTO clinic.users
       (username, password_hash, role, account_status,
        email_verified_at, profile_completed_at, registration_source)
     VALUES ($1, 'integration-test-no-login', 'user', 'active', now(), now(), 'test')
     RETURNING user_id, role`,
    [`${identityPrefix}_${label}`],
  );
  const user = inserted.rows[0];
  createdUserIds.add(user.user_id);
  await pool.query(
    `INSERT INTO clinic.user_details
       (user_id, national_id, first_name, last_name, birth_date, phone)
     VALUES ($1, $2, 'AdvisorAudit', $3, '2000-01-01', '0800000000')`,
    [
      user.user_id,
      `6${String(user.user_id).padStart(12, "0").slice(-12)}`,
      label,
    ],
  );
  return user;
}

async function availableSlots(count, sameDate = false) {
  const result = await pool.query(
    `WITH candidate_date AS (
       SELECT MIN(service_date) AS service_date
       FROM clinic.appointment_slots s
       WHERE s.service_date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date
         AND EXTRACT(ISODOW FROM s.service_date)::int <> 7
         AND s.status = 'open'
         AND NOT EXISTS (
           SELECT 1 FROM clinic.appointments a
           WHERE a.slot_id = s.slot_id AND a.status NOT IN ('cancelled', 'rejected')
         )
     )
     SELECT s.slot_id, s.service_date::text AS service_date, s.hour_of_day
     FROM clinic.appointment_slots s
     CROSS JOIN candidate_date c
     WHERE s.service_date ${sameDate ? "=" : ">="} c.service_date
       AND EXTRACT(ISODOW FROM s.service_date)::int <> 7
       AND s.status = 'open'
       AND NOT EXISTS (
         SELECT 1 FROM clinic.appointments a
         WHERE a.slot_id = s.slot_id AND a.status NOT IN ('cancelled', 'rejected')
       )
     ORDER BY s.service_date, s.hour_of_day
     LIMIT $1`,
    [count],
  );
  if (result.rowCount < count) throw new Error(`need ${count} available slots`);
  result.rows.forEach((row) => touchedSlotIds.add(row.slot_id));
  return result.rows;
}

async function testWorkflow(staffToken) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const created = await request("/issue-walkin", {
    method: "POST",
    token: staffToken,
    body: {
      avaliable_date: "morning",
      service_date: today,
      source: "staff",
      patient: {
        national_id: String(Date.now()).slice(-13).padStart(13, "8"),
        first_name: "AdvisorAudit",
        last_name: runId,
        phone: "0800000000",
        birth_date: "2000-01-01",
      },
      vitals: { weight: 65, height: 170, temperature: 36.7, bp: "120/80" },
    },
  });
  if (created.status !== 200) throw new Error(`create patient failed: ${created.status}`);
  const userId = created.data.user_id;
  createdUserIds.add(userId);
  const saved = await request("/medical-records", {
    method: "POST",
    token: staffToken,
    body: {
      user_id: userId,
      queue_id: created.data.ticket.queue_id,
      visit_date: `${today}T09:00:00`,
      symptoms: "audit symptom",
      diagnosis: "audit diagnosis",
      treatment: "audit treatment",
      medications: [],
      notes: runId,
    },
  });
  const first = await request(`/medical/by-user/${userId}`, { token: staffToken });
  const refreshed = await request(`/medical/by-user/${userId}`, { token: staffToken });
  const own = await request("/medical/my", { token: sign({ user_id: userId, role: "user" }) });
  const recordId = saved.data?.record_id;
  const persisted = [first, refreshed].every(
    (item) => item.status === 200 && item.data?.some?.((row) => row.record_id === recordId),
  ) && own.status === 403;
  report.workflow = {
    create_patient: created.status,
    save_record: saved.status,
    first_read: first.status,
    after_refresh: refreshed.status,
    own_history: own.status,
    persisted,
  };
}

async function testRaces() {
  const [slot] = await availableSlots(1);
  const userA = await createUser("slot_a");
  const userB = await createUser("slot_b");
  const payload = { slot_id: slot.slot_id, service_type: runId };
  const sameSlotResponses = await Promise.all([
    request("/appointments", { method: "POST", token: sign(userA), body: payload }),
    request("/appointments", { method: "POST", token: sign(userB), body: payload }),
  ]);
  const sameSlotRows = await pool.query(
    `SELECT COUNT(*)::int AS count FROM clinic.appointments
     WHERE slot_id = $1 AND status NOT IN ('cancelled', 'rejected')`,
    [slot.slot_id],
  );

  const sameUser = await createUser("same_user_day");
  const twoSlots = await availableSlots(2, true);
  const sameUserResponses = await Promise.all(
    twoSlots.map((candidate) => request("/appointments", {
      method: "POST",
      token: sign(sameUser),
      body: { slot_id: candidate.slot_id, service_type: runId },
    })),
  );
  const sameUserRows = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM clinic.appointments a
     JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
     WHERE a.user_id = $1 AND s.service_date = $2
       AND a.status NOT IN ('cancelled', 'rejected')`,
    [sameUser.user_id, twoSlots[0].service_date],
  );

  report.races = {
    two_users_same_slot: {
      statuses: sameSlotResponses.map((item) => item.status).sort(),
      active_rows: sameSlotRows.rows[0].count,
    },
    same_user_two_slots_same_day: {
      statuses: sameUserResponses.map((item) => item.status).sort(),
      active_rows: sameUserRows.rows[0].count,
    },
  };

  return { userA, userB, winnerId: sameSlotResponses[0].status === 201 ? userA.user_id : userB.user_id };
}

async function testAppointmentLifecycle(staff, raceUsers) {
  const appointment = await pool.query(
    `SELECT appointment_id, slot_id
     FROM clinic.appointments
     WHERE user_id = $1 AND service_type = $2
       AND status NOT IN ('cancelled', 'rejected')
     ORDER BY appointment_id DESC LIMIT 1`,
    [raceUsers.winnerId, runId],
  );
  if (!appointment.rowCount) throw new Error("No appointment available for lifecycle test");

  const { appointment_id: appointmentId, slot_id: slotId } = appointment.rows[0];
  const staffToken = sign(staff);
  const approved = await request(`/appointments/${appointmentId}`, {
    method: "PUT",
    token: staffToken,
    body: { status: "approved" },
  });
  const accessAfterApproval = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM clinic.appointment_access_codes WHERE appointment_id = $1`,
    [appointmentId],
  );
  const resendWithoutEmail = await request(`/appointments/${appointmentId}/resend-code`, {
    method: "POST",
    token: staffToken,
  });
  const cancelled = await request(`/appointments/${appointmentId}`, {
    method: "PUT",
    token: staffToken,
    body: { status: "cancelled", cancellation_reason: "advisor lifecycle test" },
  });
  const state = await pool.query(
    `SELECT a.status AS appointment_status, s.status AS slot_status,
            (SELECT status FROM clinic.queue_tickets WHERE appointment_id = a.appointment_id LIMIT 1) AS queue_status,
            (SELECT COUNT(*)::int FROM clinic.appointment_access_codes WHERE appointment_id = a.appointment_id) AS access_code_count
     FROM clinic.appointments a
     JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
     WHERE a.appointment_id = $1 AND s.slot_id = $2`,
    [appointmentId, slotId],
  );

  report.lifecycle = {
    approve_status: approved.status,
    access_code_after_approval: accessAfterApproval.rows[0].count,
    resend_without_email_status: resendWithoutEmail.status,
    resend_without_email_sent: resendWithoutEmail.data?.email_sent,
    cancel_status: cancelled.status,
    ...state.rows[0],
  };
  if (
    approved.status !== 200 ||
    accessAfterApproval.rows[0].count !== 1 ||
    resendWithoutEmail.status !== 200 ||
    resendWithoutEmail.data?.email_sent !== false ||
    cancelled.status !== 200 ||
    state.rows[0]?.appointment_status !== "cancelled" ||
    state.rows[0]?.slot_status !== "open" ||
    state.rows[0]?.queue_status !== "cancelled" ||
    state.rows[0]?.access_code_count !== 0
  ) {
    throw new Error("Appointment approve/cancel lifecycle failed");
  }
}

async function testAuthorization(staff, raceUsers) {
  const staffToken = sign(staff);
  const userToken = sign(raceUsers.userA);
  const otherUserId = raceUsers.userB.user_id;
  const checks = {
    patients_no_token: () => request("/patients"),
    patients_user: () => request("/patients", { token: userToken }),
    patients_staff: () => request("/patients", { token: staffToken }),
    medical_no_token: () => request("/medical-records"),
    medical_user: () => request("/medical-records", { token: userToken }),
    medical_staff: () => request("/medical-records", { token: staffToken }),
    own_appointments: () => request(`/appointments/user/${raceUsers.userA.user_id}`, { token: userToken }),
    other_appointments: () => request(`/appointments/user/${otherUserId}`, { token: userToken }),
    appointments_no_token: () => request(`/appointments/user/${raceUsers.userA.user_id}`),
    approved_week_user: () => request("/appointments/approved-week?start=2026-01-01&end=2026-12-31", { token: userToken }),
    approved_week_staff: () => request("/appointments/approved-week?start=2026-01-01&end=2026-12-31", { token: staffToken }),
    slots_seed_no_token: () => request("/slots/seed", { method: "POST", body: {} }),
    slots_seed_user: () => request("/slots/seed", { method: "POST", token: userToken, body: {} }),
    audit_logs_no_token: () => request("/audit-logs?limit=5"),
    audit_logs_user: () => request("/audit-logs?limit=5", { token: userToken }),
    audit_logs_staff: () => request("/audit-logs?limit=5", { token: staffToken }),
  };
  for (const [name, run] of Object.entries(checks)) {
    report.authorization[name] = (await run()).status;
  }

  const revoked = await createUser("revoked");
  const revokedToken = sign(revoked);
  await pool.query(`DELETE FROM clinic.user_details WHERE user_id = $1`, [revoked.user_id]);
  await pool.query(`DELETE FROM clinic.users WHERE user_id = $1`, [revoked.user_id]);
  createdUserIds.delete(revoked.user_id);
  report.authorization.deleted_account_token = (await request("/users/me", { token: revokedToken })).status;
}

async function cleanup() {
  const ids = [...createdUserIds];
  if (!ids.length) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM clinic.medical_records WHERE user_id = ANY($1::int[])`, [ids]);
    await client.query(
      `DELETE FROM clinic.measurements WHERE queue_id IN
       (SELECT queue_id FROM clinic.queue_tickets WHERE user_id = ANY($1::int[]))`,
      [ids],
    );
    await client.query(`DELETE FROM clinic.queue_tickets WHERE user_id = ANY($1::int[])`, [ids]);
    const appointments = await client.query(
      `DELETE FROM clinic.appointments WHERE user_id = ANY($1::int[]) RETURNING slot_id`,
      [ids],
    );
    appointments.rows.forEach((row) => touchedSlotIds.add(row.slot_id));
    await client.query(`DELETE FROM clinic.user_details WHERE user_id = ANY($1::int[])`, [ids]);
    await client.query(`DELETE FROM clinic.users WHERE user_id = ANY($1::int[])`, [ids]);
    for (const slotId of touchedSlotIds) {
      await client.query(
        `UPDATE clinic.appointment_slots s SET status = 'open'
         WHERE slot_id = $1 AND NOT EXISTS (
           SELECT 1 FROM clinic.appointments a
           WHERE a.slot_id = s.slot_id AND a.status NOT IN ('cancelled', 'rejected')
         )`,
        [slotId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

(async () => {
  try {
    const staffResult = await pool.query(
      `SELECT user_id, role::text AS role FROM clinic.users
       WHERE LOWER(role::text) IN ('doctor','super_admin','superadmin')
       ORDER BY user_id LIMIT 1`,
    );
    if (!staffResult.rowCount) throw new Error("No staff account available");
    const staff = staffResult.rows[0];
    await testWorkflow(sign(staff));
    const raceUsers = await testRaces();
    await testAppointmentLifecycle(staff, raceUsers);
    await testAuthorization(staff, raceUsers);
    const superAdmin = await pool.query(
      `SELECT user_id, role::text AS role FROM clinic.users
       WHERE LOWER(role::text) IN ('super_admin', 'superadmin')
       ORDER BY user_id LIMIT 1`,
    );
    report.authorization.audit_logs_superadmin = superAdmin.rowCount
      ? (await request("/audit-logs?limit=5", { token: sign(superAdmin.rows[0]) })).status
      : "SKIPPED_NO_SUPER_ADMIN";
    await new Promise((resolve) => setTimeout(resolve, 250));
    const auditRows = await pool.query(
      `SELECT COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE result = 'denied')::int AS denied_count
       FROM clinic.audit_logs WHERE created_at >= $1`,
      [startedAt],
    );
    report.audit = auditRows.rows[0];
  } catch (error) {
    report.errors.push(error.message);
  } finally {
    try { await cleanup(); } catch (error) { report.errors.push(`cleanup: ${error.message}`); }
    const leftovers = await pool.query(
      `SELECT COUNT(DISTINCT u.user_id)::int AS count
       FROM clinic.users u
       LEFT JOIN clinic.user_details d ON d.user_id = u.user_id
       WHERE u.username LIKE $1 OR d.last_name = $2`,
      [`${identityPrefix}%`, runId],
    ).catch(() => ({ rows: [{ count: -1 }] }));
    report.cleanup.synthetic_users_remaining = leftovers.rows[0].count;
    console.log(JSON.stringify(report, null, 2));
    await pool.end();
    process.exitCode = report.errors.length ? 1 : 0;
  }
})();
