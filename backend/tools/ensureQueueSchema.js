const pool = require("./db");

async function ensureQueueSchema() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE clinic.measurements
      ADD COLUMN IF NOT EXISTS queue_id integer
    `);

    await client.query(`
      ALTER TABLE clinic.measurements
      ADD COLUMN IF NOT EXISTS chief_complaint text,
      ADD COLUMN IF NOT EXISTS temperature numeric(4,1),
      ADD COLUMN IF NOT EXISTS heart_rate integer,
      ADD COLUMN IF NOT EXISTS respiratory_rate integer,
      ADD COLUMN IF NOT EXISTS systolic_bp integer,
      ADD COLUMN IF NOT EXISTS diastolic_bp integer
    `);

    await client.query(`
      ALTER TABLE clinic.medical_records
      ADD COLUMN IF NOT EXISTS body_drawing_data text
    `);

    await client.query(`
      ALTER TABLE clinic.queue_tickets
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()
    `);

    await client.query(`
      UPDATE clinic.measurements m
      SET queue_id = q.queue_id
      FROM clinic.queue_tickets q
      WHERE m.queue_id IS NULL
        AND m.queue_number = q.queue_number
    `);

    await client.query(`
      ALTER TABLE clinic.measurements
      DROP CONSTRAINT IF EXISTS measurements_queue_number_fkey
    `);

    await client.query(`
      ALTER TABLE clinic.queue_tickets
      DROP CONSTRAINT IF EXISTS queue_tickets_queue_number_key
    `);

    await client.query(`
      UPDATE clinic.queue_tickets q
      SET numeric_no = CASE s.hour_of_day
            WHEN 7 THEN 1
            WHEN 8 THEN 2
            WHEN 9 THEN 3
            WHEN 10 THEN 4
            WHEN 16 THEN 5
            WHEN 17 THEN 6
            WHEN 18 THEN 7
            WHEN 19 THEN 8
          END,
          queue_number = 'A' || LPAD(
            (CASE s.hour_of_day
              WHEN 7 THEN 1
              WHEN 8 THEN 2
              WHEN 9 THEN 3
              WHEN 10 THEN 4
              WHEN 16 THEN 5
              WHEN 17 THEN 6
              WHEN 18 THEN 7
              WHEN 19 THEN 8
            END)::text,
            3,
            '0'
          )
      FROM clinic.appointments a
      JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
      WHERE q.appointment_id = a.appointment_id
        AND q.prefix = 'A'
        AND s.hour_of_day IN (7, 8, 9, 10, 16, 17, 18, 19)
    `);

    await client.query(`
      DROP INDEX IF EXISTS clinic.queue_tickets_service_date_queue_number_key
    `);

    await client.query(`
      CREATE UNIQUE INDEX queue_tickets_service_date_queue_number_key
      ON clinic.queue_tickets (service_date, queue_number)
      WHERE status <> 'cancelled'
    `);

    await client.query(`
      ALTER TABLE clinic.appointments
      DROP CONSTRAINT IF EXISTS appointments_slot_id_key
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS appointments_active_slot_id_key
      ON clinic.appointments (slot_id)
      WHERE status NOT IN ('cancelled', 'rejected')
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS measurements_queue_id_idx
      ON clinic.measurements (queue_id)
    `);

    await client.query(`
      ALTER TABLE clinic.appointments
      ADD COLUMN IF NOT EXISTS cancellation_reason text
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS clinic.appointment_access_codes (
        access_code_id bigserial PRIMARY KEY,
        appointment_id integer NOT NULL UNIQUE
          REFERENCES clinic.appointments(appointment_id) ON DELETE CASCADE,
        queue_id integer NOT NULL UNIQUE
          REFERENCES clinic.queue_tickets(queue_id) ON DELETE CASCADE,
        code_hash varchar(64) NOT NULL UNIQUE,
        used_at timestamptz,
        expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      ALTER TABLE clinic.appointment_access_codes
      ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes')
    `);

    await client.query(`
      UPDATE clinic.appointment_access_codes
      SET expires_at = created_at + interval '15 minutes'
      WHERE expires_at IS NULL
    `);

    await client.query(`
      UPDATE clinic.appointment_access_codes ac
      SET expires_at = ((s.service_date::date + (s.hour_of_day::int * interval '1 hour')) AT TIME ZONE 'Asia/Bangkok') + interval '15 minutes'
      FROM clinic.appointments a
      JOIN clinic.appointment_slots s ON s.slot_id = a.slot_id
      WHERE ac.appointment_id = a.appointment_id
        AND ac.used_at IS NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS appointment_access_codes_unused_idx
      ON clinic.appointment_access_codes (code_hash)
      WHERE used_at IS NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS appointment_access_codes_expires_at_idx
      ON clinic.appointment_access_codes (expires_at)
      WHERE used_at IS NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS clinic.clinic_holidays (
        service_date date NOT NULL,
        avaliable_date varchar(20) NOT NULL DEFAULT 'morning',
        reason text,
        created_by integer,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      ALTER TABLE clinic.clinic_holidays
      ADD COLUMN IF NOT EXISTS created_by integer,
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS clinic_holidays_date_idx
      ON clinic.clinic_holidays (service_date)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS clinic.user_notifications (
        notification_id bigserial PRIMARY KEY,
        user_id integer NOT NULL REFERENCES clinic.users(user_id) ON DELETE CASCADE,
        source_type varchar(40) NOT NULL,
        source_id text NOT NULL,
        event_key varchar(80) NOT NULL,
        title text NOT NULL,
        message text NOT NULL,
        severity varchar(20) NOT NULL DEFAULT 'info',
        target_url text,
        event_at timestamptz,
        email_required boolean NOT NULL DEFAULT false,
        email_sent_at timestamptz,
        is_read boolean NOT NULL DEFAULT false,
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 month'),
        UNIQUE (user_id, source_type, source_id, event_key)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS user_notifications_user_active_idx
      ON clinic.user_notifications (user_id, is_read, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS user_notifications_expiry_idx
      ON clinic.user_notifications (expires_at)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS clinic.clinic_open_days (
        service_date date PRIMARY KEY,
        reason text,
        created_by integer,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION clinic.is_slot_closed(
        p_date date,
        p_avaliable text
      ) RETURNS boolean AS $$
        SELECT (
          EXISTS (
            SELECT 1
            FROM clinic.weekly_closed_windows w
            WHERE w.weekday = EXTRACT(DOW FROM p_date)::smallint
              AND w.avaliable_date = p_avaliable
              AND w.is_closed
          )
          AND NOT EXISTS (
            SELECT 1
            FROM clinic.clinic_open_days o
            WHERE o.service_date = p_date
          )
        )
        OR EXISTS (
          SELECT 1
          FROM clinic.clinic_holidays h
          WHERE h.service_date = p_date
            AND (h.avaliable_date = 'all_day' OR h.avaliable_date = p_avaliable)
        )
      $$ LANGUAGE sql STABLE
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION clinic.guard_appointment_insert()
      RETURNS trigger AS $$
      DECLARE
        s_date   date;
        s_avail  varchar;
        s_hour   smallint;
        s_status clinic.slot_status;
        s_start  timestamp;
        s_until  timestamp;
        ws       date;
        we       date;
      BEGIN
        SELECT service_date, avaliable_date, hour_of_day, status, start_ts, bookable_until
          INTO s_date, s_avail, s_hour, s_status, s_start, s_until
        FROM clinic.appointment_slots
        WHERE slot_id = NEW.slot_id;

        IF s_date IS NULL THEN
          RAISE EXCEPTION 'Slot % not found', NEW.slot_id;
        END IF;

        IF clinic.is_slot_closed(s_date, s_avail::text) THEN
          RAISE EXCEPTION 'Slot % % is closed by clinic schedule', s_date, s_avail;
        END IF;

        IF s_status <> 'open' THEN
          RAISE EXCEPTION 'Slot % on % % is not open (status=%)', NEW.slot_id, s_date, s_avail, s_status;
        END IF;

        IF now() > s_until THEN
          RAISE EXCEPTION 'Booking window closed: % % @% (deadline %)',
            s_date, s_avail, to_char(s_start, 'HH24:MI'), to_char(s_until, 'HH24:MI');
        END IF;

        SELECT week_start, week_end
          INTO ws, we
        FROM clinic.current_week_bounds('Asia/Bangkok');

        IF NOT clinic.is_staff() AND (s_date < ws OR s_date > we) THEN
          RAISE EXCEPTION 'You can only book in current week (% to %). Slot date: %', ws, we, s_date;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'measurements_queue_id_fkey'
            AND conrelid = 'clinic.measurements'::regclass
        ) THEN
          ALTER TABLE clinic.measurements
          ADD CONSTRAINT measurements_queue_id_fkey
          FOREIGN KEY (queue_id)
          REFERENCES clinic.queue_tickets(queue_id)
          ON DELETE CASCADE;
        END IF;
      END
      $$
    `);

    await client.query(`
      DROP FUNCTION IF EXISTS clinic.seed_slots(date, date) CASCADE
    `);

    await client.query(`
      CREATE FUNCTION clinic.seed_slots(
        start_date date,
        end_date date
      ) RETURNS void AS $$
      BEGIN
        -- This function seeds appointment slots for the given date range
        -- For now, this is a placeholder - actual slot seeding logic would go here
        RETURN;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DROP FUNCTION IF EXISTS clinic.lock_timed_out_slots() CASCADE
    `);

    await client.query(`
      CREATE FUNCTION clinic.lock_timed_out_slots() RETURNS void AS $$
      BEGIN
        -- This function locks slots that have timed out
        -- For now, this is a placeholder - actual timeout logic would go here
        RETURN;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DROP FUNCTION IF EXISTS clinic.get_calendar_month(integer, integer, text) CASCADE
    `);

    await client.query(`
      CREATE FUNCTION clinic.get_calendar_month(
        p_year integer,
        p_month integer,
        p_timezone text
      ) RETURNS TABLE (
        date date,
        total_slots integer,
        booked_slots integer,
        available_slots integer,
        status text
      ) AS $$
      BEGIN
        -- This function returns calendar data for the given month
        -- For now, this is a placeholder - actual logic would go here
        RETURN;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DROP VIEW IF EXISTS clinic.calendar_this_week CASCADE
    `);

    await client.query(`
      CREATE VIEW clinic.calendar_this_week AS
      SELECT
        NOW()::date as date,
        0::int as total_slots,
        0::int as booked_slots,
        0::int as available_slots,
        'placeholder'::text as status
      LIMIT 0
    `);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = ensureQueueSchema;
