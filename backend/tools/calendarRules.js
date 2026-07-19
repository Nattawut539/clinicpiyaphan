const OPEN_DAYS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS clinic.clinic_open_days (
    service_date date PRIMARY KEY,
    reason text,
    created_by integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )
`;

const DEFAULT_SUNDAY_REASON = "วันหยุดประจำสัปดาห์ของคลินิก";

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

async function ensureCalendarRulesSchema(db) {
  await db.query(OPEN_DAYS_TABLE_SQL);
}

async function isClinicHoliday(db, date) {
  const { rows } = await db.query(
    `
    SELECT
      h.service_date IS NOT NULL AS is_explicit_holiday,
      h.reason AS explicit_reason,
      EXTRACT(ISODOW FROM $1::date)::int = 7 AS is_sunday,
      o.service_date IS NOT NULL AS is_open_override
    FROM (SELECT $1::date AS service_date) d
    LEFT JOIN (
      SELECT service_date, MAX(reason) AS reason
      FROM clinic.clinic_holidays
      WHERE service_date = $1::date
      GROUP BY service_date
    ) h ON h.service_date = d.service_date
    LEFT JOIN clinic.clinic_open_days o ON o.service_date = d.service_date
    LIMIT 1
    `,
    [date]
  );

  const row = rows[0];
  if (!row) return null;

  if (row.is_explicit_holiday) {
    return { reason: row.explicit_reason || "วันหยุดของคลินิก", is_default: false };
  }

  if (row.is_sunday && !row.is_open_override) {
    return { reason: DEFAULT_SUNDAY_REASON, is_default: true };
  }

  return null;
}

function monthHolidayQuery(where, includeDefaultSundays) {
  if (!includeDefaultSundays) {
    return `
      SELECT DISTINCT ON (service_date)
             service_date::text AS holiday_date,
             reason,
             false AS is_default,
             created_at,
             updated_at
      FROM clinic.clinic_holidays
      ${where}
      ORDER BY service_date, updated_at DESC
    `;
  }

  return `
    WITH month_days AS (
      SELECT generate_series(
        make_date($1::int, $2::int, 1),
        (make_date($1::int, $2::int, 1) + interval '1 month - 1 day')::date,
        interval '1 day'
      )::date AS service_date
    ),
    explicit_holidays AS (
      SELECT DISTINCT ON (service_date)
             service_date,
             reason,
             false AS is_default,
             created_at,
             updated_at
      FROM clinic.clinic_holidays
      WHERE EXTRACT(YEAR FROM service_date) = $1
        AND EXTRACT(MONTH FROM service_date) = $2
      ORDER BY service_date, updated_at DESC
    ),
    default_sundays AS (
      SELECT
        d.service_date,
        $3::text AS reason,
        true AS is_default,
        NULL::timestamptz AS created_at,
        NULL::timestamptz AS updated_at
      FROM month_days d
      LEFT JOIN explicit_holidays h ON h.service_date = d.service_date
      LEFT JOIN clinic.clinic_open_days o ON o.service_date = d.service_date
      WHERE EXTRACT(ISODOW FROM d.service_date) = 7
        AND h.service_date IS NULL
        AND o.service_date IS NULL
    )
    SELECT service_date::text AS holiday_date, reason, is_default, created_at, updated_at
    FROM explicit_holidays
    UNION ALL
    SELECT service_date::text AS holiday_date, reason, is_default, created_at, updated_at
    FROM default_sundays
    ORDER BY holiday_date
  `;
}

module.exports = {
  DEFAULT_SUNDAY_REASON,
  ensureCalendarRulesSchema,
  isClinicHoliday,
  monthHolidayQuery,
  validDate,
};
