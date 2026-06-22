'use client';

import React, { useEffect, useState } from 'react';
import styles from './calendar.module.css';
import dayjs, { Dayjs } from 'dayjs';
import 'dayjs/locale/th';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('th');

const BANGKOK_TZ = 'Asia/Bangkok';
const daysOfWeek = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:5000';

interface AppointmentStatus {
  date: string;
  status: 'full' | 'almost_full' | 'available' | 'holiday';
  total_slots?: number;
  booked_slots?: number;
  available_slots?: number;
  is_holiday?: boolean;
  holiday_reason?: string | null;
}

interface Props {
  onDateSelect: (date: string) => void;
}

export default function CustomCalendar({ onDateSelect }: Props) {
  const [currentDate, setCurrentDate] = useState(() => dayjs().tz(BANGKOK_TZ));
  const [selectedDate, setSelectedDate] = useState(() => dayjs().tz(BANGKOK_TZ));
  const [showYearDropdown, setShowYearDropdown] = useState(false);
  const [appointmentData, setAppointmentData] = useState<AppointmentStatus[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadMonthStatus = async () => {
      try {
        setLoading(true);

        const year = currentDate.year();
        const month = currentDate.month() + 1;

        const res = await fetch(
          `${API_BASE}/api/slots/month-status?year=${year}&month=${month}`,
          {
            method: 'GET',
          }
        );

        const data = await res.json().catch(() => []);

        console.log('CALENDAR MONTH STATUS =', data);

        if (!res.ok) {
          throw new Error(data?.error || 'โหลดสถานะปฏิทินไม่สำเร็จ');
        }

        setAppointmentData(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Load calendar status error:', err);
        setAppointmentData([]);
      } finally {
        setLoading(false);
      }
    };

    loadMonthStatus();
  }, [currentDate]);

  const buddhistYear = currentDate.year() + 543;
  const monthName = currentDate.format('MMMM');

  const startOfMonth = currentDate.startOf('month');
  const startDay = startOfMonth.day() === 0 ? 6 : startOfMonth.day() - 1;
  const daysInMonth = currentDate.daysInMonth();

  const prevMonth = () => {
    setCurrentDate((prev) => prev.subtract(1, 'month'));
  };

  const nextMonth = () => {
    setCurrentDate((prev) => prev.add(1, 'month'));
  };

  const getStatusInfo = (date: string) => {
    return appointmentData.find((item) => item.date === date);
  };

  const handleDateClick = (date: Dayjs) => {
    const formatted = date.tz(BANGKOK_TZ).format('YYYY-MM-DD');
    const statusInfo = getStatusInfo(formatted);
    const isPastDate = date.isBefore(dayjs().tz(BANGKOK_TZ).startOf('day'), 'day');

    if (isPastDate || statusInfo?.status === 'full' || statusInfo?.status === 'holiday') {
      return;
    }

    setSelectedDate(date);
    onDateSelect(formatted);
  };

  const handleYearSelect = (year: number) => {
    const newDate = currentDate.year(year);
    setCurrentDate(newDate);
    setShowYearDropdown(false);
  };

  const calendarDays: (Dayjs | null)[] = [];

  for (let i = 0; i < startDay; i++) {
    calendarDays.push(null);
  }

  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push(currentDate.date(i));
  }

  const years = Array.from({ length: 30 }, (_, i) => dayjs().year() - 15 + i);

  return (
    <div className={styles.calendarWrapper}>
      <div className={styles.headerRow}>
        <div className={styles.monthSection}>
          <span>
            {monthName} {buddhistYear}
          </span>

          <button
            type="button"
            className={styles.dropdownToggle}
            onClick={() => setShowYearDropdown(!showYearDropdown)}
          >
            ▾
          </button>

          {showYearDropdown && (
            <div className={styles.yearDropdown}>
              {years.map((y) => (
                <div
                  key={y}
                  className={`${styles.yearOption} ${
                    y === currentDate.year() ? styles.yearSelected : ''
                  }`}
                  onClick={() => handleYearSelect(y)}
                >
                  {y + 543}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.navButtons}>
          <button type="button" onClick={prevMonth}>
            &lt;
          </button>

          <button type="button" onClick={nextMonth}>
            &gt;
          </button>
        </div>
      </div>

      {loading && <p className={styles.loadingText}>กำลังโหลดปฏิทิน...</p>}

      <div className={styles.dayLabels}>
        {daysOfWeek.map((d, i) => (
          <div key={i} className={styles.dayLabel}>
            {d}
          </div>
        ))}
      </div>

      <div className={styles.dayGrid}>
        {calendarDays.map((day, i) => {
          if (!day) {
            return <div key={`empty-${i}`} className={styles.dayCell}></div>;
          }

          const formatted = day.format('YYYY-MM-DD');
          const isToday = day.isSame(dayjs(), 'day');
          const isSelected = day.isSame(selectedDate, 'day');
          const isPastDate = day.isBefore(dayjs().startOf('day'), 'day');

          const statusInfo = getStatusInfo(formatted);
          const status = statusInfo?.status;

          const disabledDay = isPastDate || status === 'full' || status === 'holiday';

          return (
            <button
              type="button"
              key={formatted}
              className={`${styles.dayCell}
                ${isToday || isSelected ? styles.today : ''}
                ${isPastDate ? styles.pastDay : ''}
                ${status === 'full' ? styles.fullDay : ''}
                ${status === 'holiday' ? styles.fullDay : ''}
              `}
              onClick={() => handleDateClick(day)}
              disabled={disabledDay}
              title={
                status === 'holiday'
                  ? statusInfo?.holiday_reason || 'วันหยุดของคลินิก ไม่เปิดรับจอง'
                  : statusInfo
                  ? `ว่าง ${statusInfo.available_slots ?? 0} / ทั้งหมด ${
                      statusInfo.total_slots ?? 0
                    } คิว`
                  : isPastDate
                  ? 'ไม่สามารถจองย้อนหลังได้'
                  : ''
              }
            >
              <span className={styles.dayNumber}>{day.date()}</span>

              {status && (
                <span
                  className={`${styles.statusDot} ${
                    status === 'full' || status === 'holiday'
                      ? styles.redDot
                      : status === 'almost_full'
                      ? styles.yellowDot
                      : styles.greenDot
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.availableDot}`}></span>
          <span>ยังมีคิวว่าง</span>
        </div>

        <div className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.almostFullDot}`}></span>
          <span>ใกล้เต็ม</span>
        </div>

        <div className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.fullDot}`}></span>
          <span>คิวเต็มแล้ว</span>
        </div>

        <div className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.fullDot}`}></span>
          <span>วันหยุดคลินิก</span>
        </div>
      </div>
    </div>
  );
}
