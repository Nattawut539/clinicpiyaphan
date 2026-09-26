const express = require("express");
const router = express.Router();
const pool = require("../tools/db");
const { authRequired } = require("../tools/_utils");
const { escapeHtml, sendClinicMail } = require("../tools/mailer");
const { sendAppointmentReminders } = require('../services/appointmentReminderService');

function thaiDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function queueTime(row) {
  if (Number.isFinite(Number(row.hour_of_day))) {
    return `${String(row.hour_of_day).padStart(2, "0")}:00 น.`;
  }
  if (row.avaliable_date === "morning") return "07:00 - 11:00 น.";
  if (row.avaliable_date === "afternoon") return "16:00 - 20:00 น.";
  return "-";
}

function appointmentEndAt(row) {
  const dateKey = new Date(row.service_date).toISOString().slice(0, 10);
  const endHour = row.avaliable_date === "afternoon" ? 20 : 11;
  return new Date(`${dateKey}T${String(endHour).padStart(2, "0")}:00:00+07:00`);
}

function appointmentNotice(row) {
  const status = String(row.status || "").toLowerCase();
  const queueNumber = row.queue_number || "รอออกคิว";
  const date = thaiDate(row.service_date);
  const time = queueTime(row);
  const isOverdue = status === "approved" && new Date() > appointmentEndAt(row);

  if (isOverdue) {
    return {
      title: `เลยเวลาคิว ${queueNumber}`,
      message: `คิวออนไลน์ ${queueNumber} วันที่ ${date} ช่วงเวลา ${time} เลยเวลาหรือช่วงเวลารับบริการแล้ว`,
      severity: "warning",
      emailRequired: row.prefix === "A" && Boolean(row.email),
    };
  }

  if (status === "approved") {
    return {
      title: `คิวออนไลน์ ${queueNumber} ได้รับการอนุมัติ`,
      message: `คุณมีคิวออนไลน์ ${queueNumber} วันที่ ${date} เวลา ${time} กรุณามาตามเวลานัด`,
      severity: "success",
      emailRequired: false,
    };
  }

  if (status === "pending" || status === "waiting") {
    return {
      title: "คำขอจองคิวอยู่ระหว่างรออนุมัติ",
      message: `คำขอจองวันที่ ${date} เวลา ${time} อยู่ระหว่างรอเจ้าหน้าที่ตรวจสอบ`,
      severity: "info",
      emailRequired: false,
    };
  }

  if (status === "cancelled" || status === "rejected") {
    return {
      title: "การจองคิวถูกยกเลิก",
      message: `การจองวันที่ ${date} เวลา ${time} ถูกยกเลิก${row.cancellation_reason ? ` เหตุผล: ${row.cancellation_reason}` : ""}`,
      severity: "danger",
      emailRequired: false,
    };
  }

  return null;
}

function followUpNotice(row) {
  if (!row.follow_up_date) return null;

  const followUpDate = new Date(row.follow_up_date);
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  today.setHours(0, 0, 0, 0);
  const dateOnly = new Date(followUpDate);
  dateOnly.setHours(0, 0, 0, 0);
  const date = thaiDate(row.follow_up_date);
  const isOverdue = dateOnly < today;
  const isToday = dateOnly.getTime() === today.getTime();

  return {
    title: isOverdue ? "เลยวันนัดติดตามผลรักษา" : isToday ? "วันนี้มีนัดติดตามผลรักษา" : "นัดติดตามผลรักษา",
    message: `แพทย์นัดติดตามผลรักษาวันที่ ${date}${row.diagnosis ? ` จากการวินิจฉัย: ${row.diagnosis}` : ""}`,
    severity: isOverdue ? "warning" : isToday ? "success" : "info",
    emailRequired: false,
  };
}

async function upsertNotification(client, userId, item) {
  const result = await client.query(
    `INSERT INTO clinic.user_notifications
       (user_id, source_type, source_id, event_key, title, message, severity, target_url, event_at, email_required, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() + interval '1 month')
     ON CONFLICT (user_id, source_type, source_id, event_key)
     DO UPDATE SET
       title = EXCLUDED.title,
       message = EXCLUDED.message,
       severity = EXCLUDED.severity,
       target_url = EXCLUDED.target_url,
       event_at = EXCLUDED.event_at,
       email_required = clinic.user_notifications.email_required OR EXCLUDED.email_required,
       updated_at = now(),
       expires_at = GREATEST(clinic.user_notifications.expires_at, now() + interval '1 month')
     RETURNING *`,
    [
      userId,
      item.sourceType,
      String(item.sourceId),
      item.eventKey,
      item.title,
      item.message,
      item.severity,
      item.targetUrl || null,
      item.eventAt || null,
      Boolean(item.emailRequired),
    ]
  );

  return result.rows[0];
}

async function syncUserNotifications(client, userId) {
  await client.query(
    `DELETE FROM clinic.user_notifications
     WHERE expires_at < now()
        OR (user_id = $1 AND expires_at < now())`,
    [userId]
  );

  const appointments = await client.query(
    `SELECT
       a.appointment_id,
       a.status,
       a.service_type,
       a.cancellation_reason,
       s.service_date::date AS service_date,
       s.avaliable_date,
       s.hour_of_day,
       q.queue_number,
       q.prefix,
       q.source,
       COALESCE(u.email, d.email) AS email
     FROM clinic.appointments a
     JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
     JOIN clinic.users u ON u.user_id = a.user_id
     LEFT JOIN clinic.user_details d ON d.user_id = a.user_id
     LEFT JOIN clinic.queue_tickets q ON q.appointment_id = a.appointment_id
     WHERE a.user_id = $1
       AND s.service_date BETWEEN ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date - interval '30 days')
                              AND ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date + interval '90 days')
       AND a.status IN ('pending', 'waiting', 'approved', 'cancelled', 'rejected')
     ORDER BY s.service_date, s.hour_of_day`,
    [userId]
  );

  const created = [];
  for (const row of appointments.rows) {
    const notice = appointmentNotice(row);
    if (!notice) continue;

    const saved = await upsertNotification(client, userId, {
      sourceType: "appointment",
      sourceId: row.appointment_id,
      eventKey: "appointment_status",
      title: notice.title,
      message: notice.message,
      severity: notice.severity,
      targetUrl: "/users/appointment",
      eventAt: row.service_date,
      emailRequired: notice.emailRequired,
    });
    created.push({ ...saved, email: row.email, queue_number: row.queue_number });
  }

  const followUps = await client.query(
    `SELECT record_id, follow_up_date::date AS follow_up_date, diagnosis
     FROM clinic.medical_records
     WHERE user_id = $1
       AND follow_up_date IS NOT NULL
       AND follow_up_date BETWEEN ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date - interval '30 days')
                              AND ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date + interval '90 days')
     ORDER BY follow_up_date`,
    [userId]
  );

  for (const row of followUps.rows) {
    const notice = followUpNotice(row);
    if (!notice) continue;

    await upsertNotification(client, userId, {
      sourceType: "follow_up",
      sourceId: row.record_id,
      eventKey: "follow_up_date",
      title: notice.title,
      message: notice.message,
      severity: notice.severity,
      targetUrl: "/users/history",
      eventAt: row.follow_up_date,
      emailRequired: false,
    });
  }

  return created;
}

async function sendDueEmails(userId) {
  const { rows } = await pool.query(
    `SELECT n.notification_id, n.title, n.message, COALESCE(u.email, d.email) AS email, d.first_name
     FROM clinic.user_notifications n
     JOIN clinic.users u ON u.user_id = n.user_id
     LEFT JOIN clinic.user_details d ON d.user_id = n.user_id
     WHERE n.user_id = $1
       AND n.email_required = true
       AND n.email_sent_at IS NULL
       AND n.event_key NOT LIKE 'appointment_reminder:%'
       AND COALESCE(u.email, d.email) IS NOT NULL
     ORDER BY n.created_at ASC
     LIMIT 10`,
    [userId]
  );

  for (const row of rows) {
    try {
      await sendClinicMail({
        to: row.email,
        subject: row.title,
        html: `<p>สวัสดี ${escapeHtml(row.first_name || "ผู้ใช้บริการ")}</p>
          <p>${escapeHtml(row.message)}</p>
          <p>กรุณาตรวจสอบรายละเอียดในระบบคลินิก</p>`,
      });
      await pool.query(
        `UPDATE clinic.user_notifications
         SET email_sent_at = now(), updated_at = now()
         WHERE notification_id = $1`,
        [row.notification_id]
      );
    } catch (error) {
      console.error("send notification email failed:", error.message);
    }
  }
}

function mapNotification(row) {
  return {
    notification_id: row.notification_id,
    title: row.title,
    message: row.message,
    severity: row.severity,
    target_url: row.target_url,
    source_type: row.source_type,
    is_read: row.is_read,
    email_sent_at: row.email_sent_at,
    created_at: row.created_at,
    event_at: row.event_at,
  };
}

router.get("/notifications/me", authRequired, async (req, res, next) => {
  const userId = req.user?.user_id;

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path TO clinic, public;");
      await syncUserNotifications(client, userId);
      await client.query("COMMIT");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }

    await sendDueEmails(userId);

    const { rows } = await pool.query(
      `SELECT *
       FROM clinic.user_notifications
       WHERE user_id = $1
         AND expires_at > now()
       ORDER BY is_read ASC, created_at DESC`,
      [userId]
    );

    const active = rows.filter((row) => !row.is_read).map(mapNotification);
    const history = rows.filter((row) => row.is_read).map(mapNotification);

    res.json({
      active,
      history,
      unread_count: active.length,
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/notifications/:id/read", authRequired, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE clinic.user_notifications
       SET is_read = true,
           read_at = COALESCE(read_at, now()),
           updated_at = now()
       WHERE notification_id = $1
         AND user_id = $2
       RETURNING *`,
      [req.params.id, req.user.user_id]
    );

    if (!rows.length) return res.status(404).json({ message: "ไม่พบการแจ้งเตือน" });
    res.json(mapNotification(rows[0]));
  } catch (error) {
    next(error);
  }
});

router.post("/notifications/read-all", authRequired, async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE clinic.user_notifications
       SET is_read = true,
           read_at = COALESCE(read_at, now()),
           updated_at = now()
       WHERE user_id = $1
         AND is_read = false`,
      [req.user.user_id]
    );

    res.json({ updated: rowCount });
  } catch (error) {
    next(error);
  }
});

async function syncSingleUser(userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path TO clinic, public;");
    await syncUserNotifications(client, userId);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }

  await sendDueEmails(userId);
}

async function syncAllUsersNotifications() {
  const { rows } = await pool.query(
    `SELECT DISTINCT user_id
     FROM (
       SELECT a.user_id
       FROM clinic.appointments a
       JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
       WHERE s.service_date BETWEEN ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date - interval '30 days')
                                AND ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date + interval '90 days')
       UNION
       SELECT mr.user_id
       FROM clinic.medical_records mr
       WHERE mr.follow_up_date IS NOT NULL
         AND mr.follow_up_date BETWEEN ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date - interval '30 days')
                                  AND ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date + interval '90 days')
     ) users_with_events`
  );

  for (const row of rows) {
    try {
      await syncSingleUser(row.user_id);
    } catch (error) {
      console.error("sync user notifications failed:", row.user_id, error.message);
    }
  }
}

let notificationJobStarted = false;
let notificationJobRunning = false;

function startNotificationJob() {
  if (notificationJobStarted) return;
  notificationJobStarted = true;

  const run = async () => {
    if (notificationJobRunning) return;
    notificationJobRunning = true;
    try {
      if (process.env.DISABLE_EMAIL !== 'true') {
        await sendAppointmentReminders({ pool, sendMail: sendClinicMail });
      }
      await syncAllUsersNotifications();
    } catch (error) {
      console.error("notification job failed:", error.message);
    } finally { notificationJobRunning = false; }
  };

  setTimeout(run, 10000);
  setInterval(run, 15 * 60 * 1000);
}

module.exports = router;
module.exports.startNotificationJob = startNotificationJob;
