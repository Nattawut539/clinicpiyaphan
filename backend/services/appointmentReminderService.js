const { escapeHtml } = require('../tools/mailer');

// Calendar day in Bangkok, not a rolling 24-hour window. A dedicated sender
// rechecks the appointment so a cancelled/rescheduled reminder cannot be sent.
async function sendAppointmentReminders({ pool, sendMail, now = new Date(), logger = console }) {
  const candidates = await pool.query(`
    SELECT a.appointment_id FROM clinic.appointments a
    JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
    WHERE a.status = 'approved'
      AND s.service_date = ($1::timestamptz AT TIME ZONE 'Asia/Bangkok')::date + 1`, [now]);
  const result = { sent: 0, failed: 0 };
  for (const candidate of candidates.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`
        SELECT a.appointment_id, a.user_id, s.service_date::text AS date_key,
               s.hour_of_day, q.queue_number, COALESCE(NULLIF(u.email, ''), d.email) AS email,
               d.first_name
        FROM clinic.appointments a
        JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
        JOIN clinic.queue_tickets q ON q.appointment_id = a.appointment_id
        JOIN clinic.users u ON u.user_id = a.user_id
        LEFT JOIN clinic.user_details d ON d.user_id = a.user_id
        WHERE a.appointment_id = $1 AND a.status = 'approved'
          AND q.status = 'waiting' AND q.prefix = 'A'
          AND s.service_date = ($2::timestamptz AT TIME ZONE 'Asia/Bangkok')::date + 1
        FOR UPDATE OF a, s, q SKIP LOCKED`, [candidate.appointment_id, now]);
      const row = rows[0];
      if (!row?.email) { await client.query('COMMIT'); continue; }
      const title = `แจ้งเตือน: คุณมีนัดพรุ่งนี้ — คิว ${row.queue_number}`;
      const date = new Date(`${row.date_key}T00:00:00+07:00`).toLocaleDateString('th-TH', {
        timeZone: 'Asia/Bangkok', dateStyle: 'long',
      });
      const time = `${String(row.hour_of_day).padStart(2, '0')}:00 น.`;
      const message = `คุณมีนัดที่ได้รับการอนุมัติแล้วในวันพรุ่งนี้ วันที่ ${date} เวลา ${time} หมายเลขคิว ${row.queue_number} กรุณามาตามเวลานัด`;
      const saved = await client.query(`
        INSERT INTO clinic.user_notifications
          (user_id, source_type, source_id, event_key, title, message, severity, target_url, event_at, email_required)
        VALUES ($1, 'appointment', $2, $3, $4, $5, 'info', '/users/appointment', $6, true)
        ON CONFLICT (user_id, source_type, source_id, event_key)
        DO UPDATE SET title = EXCLUDED.title, message = EXCLUDED.message, updated_at = now()
        RETURNING notification_id, email_sent_at`, [row.user_id, String(row.appointment_id),
        `appointment_reminder:${row.date_key}`, title, message, `${row.date_key}T00:00:00+07:00`]);
      const notification = saved.rows[0];
      if (!notification.email_sent_at) {
        const delivery = await sendMail({ to: row.email, subject: title,
          html: `<p>สวัสดี ${escapeHtml(row.first_name || 'ผู้ใช้บริการ')}</p><p>${escapeHtml(message)}</p><p>กรุณาตรวจสอบรายละเอียดในระบบคลินิก</p>` });
        if (delivery?.rejected?.length || (delivery?.accepted && !delivery.accepted.length)) {
          throw new Error('SMTP did not accept the reminder recipient');
        }
        await client.query(`UPDATE clinic.user_notifications SET email_sent_at = now(), updated_at = now()
          WHERE notification_id = $1`, [notification.notification_id]);
        await client.query('COMMIT');
        result.sent++;
      } else { await client.query('COMMIT'); }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      result.failed++;
      logger.error('Appointment reminder failed:', candidate.appointment_id, error.code || 'DELIVERY_FAILED');
    } finally { client.release(); }
  }
  return result;
}

module.exports = { sendAppointmentReminders };
