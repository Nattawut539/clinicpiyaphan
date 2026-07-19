const DAILY_HOURS = [
  { avaliable_date: "morning", hour_of_day: 7 },
  { avaliable_date: "morning", hour_of_day: 8 },
  { avaliable_date: "morning", hour_of_day: 9 },
  { avaliable_date: "morning", hour_of_day: 10 },
  { avaliable_date: "afternoon", hour_of_day: 16 },
  { avaliable_date: "afternoon", hour_of_day: 17 },
  { avaliable_date: "afternoon", hour_of_day: 18 },
  { avaliable_date: "afternoon", hour_of_day: 19 },
];

async function ensureSlotsForRange(db, startDate, endDate) {
  await db.query(
    `
    INSERT INTO clinic.appointment_slots
      (service_date, avaliable_date, hour_of_day, status)
    SELECT
      d.service_date,
      h.avaliable_date,
      h.hour_of_day,
      'open'
    FROM generate_series($1::date, $2::date, interval '1 day') AS d(service_date)
    CROSS JOIN (
      VALUES
        ('morning', 7),
        ('morning', 8),
        ('morning', 9),
        ('morning', 10),
        ('afternoon', 16),
        ('afternoon', 17),
        ('afternoon', 18),
        ('afternoon', 19)
    ) AS h(avaliable_date, hour_of_day)
    WHERE NOT EXISTS (
      SELECT 1
      FROM clinic.appointment_slots s
      WHERE s.service_date = d.service_date
        AND s.hour_of_day = h.hour_of_day
    )
    ON CONFLICT DO NOTHING
    `,
    [startDate, endDate]
  );
}

async function ensureSlotsForDate(db, date) {
  await ensureSlotsForRange(db, date, date);
}

async function reopenBookableSlotsForDate(db, date) {
  await reopenBookableSlotsForRange(db, date, date);
}

async function reopenBookableSlotsForRange(db, startDate, endDate) {
  await db.query(
    `
    UPDATE clinic.appointment_slots s
    SET status = 'open'
    WHERE s.service_date BETWEEN $1::date AND $2::date
      AND s.hour_of_day IN (7, 8, 9, 10, 16, 17, 18, 19)
      AND s.status <> 'open'
      AND (s.bookable_until IS NULL OR s.bookable_until > now())
      AND NOT EXISTS (
        SELECT 1
        FROM clinic.clinic_holidays h
        WHERE h.service_date = s.service_date
      )
      AND (
        EXTRACT(ISODOW FROM s.service_date)::int <> 7
        OR EXISTS (
          SELECT 1
          FROM clinic.clinic_open_days o
          WHERE o.service_date = s.service_date
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM clinic.appointments a
        WHERE a.slot_id = s.slot_id
          AND a.status NOT IN ('cancelled', 'rejected')
      )
    `,
    [startDate, endDate]
  );
}

module.exports = {
  DAILY_HOURS,
  ensureSlotsForDate,
  ensureSlotsForRange,
  reopenBookableSlotsForDate,
  reopenBookableSlotsForRange,
};
