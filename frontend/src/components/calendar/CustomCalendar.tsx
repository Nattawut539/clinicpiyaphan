'use client';

import React, { useEffect, useState } from 'react';
import styles from './Calendar.module.css';
import dayjs, { Dayjs } from 'dayjs';
import 'dayjs/locale/th';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { API_BASE } from '@/lib/api';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('th');

const BANGKOK_TZ = 'Asia/Bangkok';
const daysOfWeek = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];

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
  minDate?: string;
  maxDate?: string;
  helperText?: string;
  allowPastDates?: boolean;
  allowUnavailableDates?: boolean;
}

export default function CustomCalendar({
  onDateSelect,
  minDate,
  maxDate,
  helperText,
  allowPastDates = false,
  allowUnavailableDates = false,
}: Props) {
  const [currentDate, setCurrentDate] = useState(() => dayjs().tz(BANGKOK_TZ));
  const [selectedDate, setSelectedDate] = useState<Dayjs | null>(null);
  const [showYearDropdown, setShowYearDropdown] = useState(false);
  const [appointmentData, setAppointmentData] = useState<AppointmentStatus[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadMonthStatus = async () => {
      try {
        setLoading(true);

        const year = currentDate.year();
        const month = currentDate.month() + 1;

        const res = await fetch(`${API_BASE}/slots/month-status?year=${year}&month=${month}`);
        const data = await res.json().catch(() => []);

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
  const monthName = currentDate.locale('th').format('MMMM');

  const startOfMonth = currentDate.startOf('month');
  const startDay = startOfMonth.day() === 0 ? 6 : startOfMonth.day() - 1;
  const daysInMonth = currentDate.daysInMonth();

  const calendarDays: (Dayjs | null)[] = [];

  for (let i = 0; i < startDay; i++) {
    calendarDays.push(null);
  }

  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push(currentDate.date(i));
  }

  const years = Array.from({ length: 30 }, (_, i) => dayjs().year() - 15 + i);

  const getStatusInfo = (date: string) => {
    return appointmentData.find((item) => item.date === date);
  };

  const isOutsideAllowedRange = (date: Dayjs) => {
    const formatted = date.format('YYYY-MM-DD');
    return Boolean((minDate && formatted < minDate) || (maxDate && formatted > maxDate));
  };

  const prevMonth = () => {
    setCurrentDate((prev) => prev.subtract(1, 'month'));
  };

  const nextMonth = () => {
    setCurrentDate((prev) => prev.add(1, 'month'));
  };

  const handleYearSelect = (year: number) => {
    setCurrentDate((prev) => prev.year(year));
    setShowYearDropdown(false);
  };

  const handleDateClick = (date: Dayjs) => {
    const formatted = date.tz(BANGKOK_TZ).format('YYYY-MM-DD');
    const statusInfo = getStatusInfo(formatted);
    const isPastDate = date.isBefore(dayjs().tz(BANGKOK_TZ).startOf('day'), 'day');
    const isRestrictedDate = isOutsideAllowedRange(date);

    if (
      (!allowPastDates && isPastDate) ||
      isRestrictedDate ||
      (!allowUnavailableDates && (statusInfo?.status === 'full' || statusInfo?.status === 'holiday'))
    ) {
      return;
    }

    setSelectedDate(date);
    onDateSelect(formatted);
  };

  const getStatusLabel = (statusInfo: AppointmentStatus | undefined, isPastDate: boolean) => {
    if (statusInfo?.status === 'holiday') return 'ปิด';
    if (statusInfo?.status === 'full') return 'เต็ม';
    if (statusInfo?.status === 'available' || statusInfo?.status === 'almost_full') {
      return `ว่าง ${statusInfo.available_slots ?? 0}`;
    }
    if (isPastDate) return '';
    return '';
  };

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
            aria-label="เลือกปี"
          >
            ▾
          </button>

          {showYearDropdown && (
            <div className={styles.yearDropdown}>
              {years.map((year) => (
                <button
                  type="button"
                  key={year}
                  className={`${styles.yearOption} ${
                    year === currentDate.year() ? styles.yearSelected : ''
                  }`}
                  onClick={() => handleYearSelect(year)}
                >
                  {year + 543}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={styles.navButtons}>
          <button type="button" onClick={prevMonth} aria-label="เดือนก่อนหน้า">
            <ChevronLeft size={17} />
          </button>

          <button type="button" onClick={nextMonth} aria-label="เดือนถัดไป">
            <ChevronRight size={17} />
          </button>
        </div>
      </div>

      {loading && <p className={styles.loadingText}>กำลังโหลดปฏิทิน...</p>}

      <div className={styles.infoBanner} title={helperText}>
        {helperText || 'เลือกวันที่ยังมีคิวว่าง ระบบปิดรับจองวันย้อนหลังและวันที่คิวเต็ม'}
      </div>

      <div className={styles.dayLabels}>
        {daysOfWeek.map((day) => (
          <div key={day} className={styles.dayLabel}>
            {day}
          </div>
        ))}
      </div>

      <div className={styles.dayGrid}>
        {calendarDays.map((day, index) => {
          if (!day) {
            return <div key={`empty-${index}`} className={styles.emptyCell} />;
          }

          const formatted = day.format('YYYY-MM-DD');
          const isToday = day.isSame(dayjs().tz(BANGKOK_TZ), 'day');
          const isSelected = selectedDate ? day.isSame(selectedDate, 'day') : false;
          const isPastDate = day.isBefore(dayjs().tz(BANGKOK_TZ).startOf('day'), 'day');
          const isRestrictedDate = isOutsideAllowedRange(day);
          const statusInfo = getStatusInfo(formatted);
          const status = statusInfo?.status;
          const disabledDay =
            (!allowPastDates && isPastDate) ||
            isRestrictedDate ||
            (!allowUnavailableDates && (status === 'full' || status === 'holiday'));
          const statusLabel = getStatusLabel(statusInfo, isPastDate);

          return (
            <button
              type="button"
              key={formatted}
              className={`${styles.dayCell}
                ${isToday ? styles.today : ''}
                ${isSelected ? styles.selectedDay : ''}
                ${isPastDate ? styles.pastDay : ''}
                ${isRestrictedDate ? styles.restrictedDay : ''}
                ${status === 'full' || status === 'holiday' ? styles.fullDay : ''}
                ${status === 'available' ? styles.availableDay : ''}
                ${status === 'almost_full' ? styles.almostFullDay : ''}
              `}
              onClick={() => handleDateClick(day)}
              disabled={disabledDay}
              title={
                status === 'holiday'
                  ? statusInfo?.holiday_reason || 'คลินิกหยุดให้บริการ'
                  : statusInfo
                  ? `ว่าง ${statusInfo.available_slots ?? 0} / ทั้งหมด ${statusInfo.total_slots ?? 0} คิว`
                  : isPastDate
                  ? 'ไม่สามารถจองย้อนหลังได้'
                  : ''
              }
            >
              <span className={styles.dayNumber}>{day.date()}</span>
              {statusLabel && <span className={styles.statusLabel}>{statusLabel}</span>}
            </button>
          );
        })}
      </div>

      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.availableDot}`} />
          <span>ว่าง</span>
        </div>

        <div className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.almostFullDot}`} />
          <span>ใกล้เต็ม</span>
        </div>

        <div className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.fullDot}`} />
          <span>เต็ม / ปิด</span>
        </div>
      </div>
    </div>
  );
}
