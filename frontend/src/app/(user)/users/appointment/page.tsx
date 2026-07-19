'use client';

import React, { useEffect, useMemo, useState } from 'react';
import styles from './appointment.module.css';
import CustomCalendar from '@/components/calendar/CustomCalendar';
import { CalendarCheck, CalendarDays, Clock, List, Plus, Sun, Sunset } from 'lucide-react';
import dayjs from 'dayjs';
import 'dayjs/locale/th';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import { jwtDecode } from 'jwt-decode';
import { API_BASE } from '@/lib/api';

dayjs.locale('th');

type TokenPayload = {
  user_id?: number | string;
  sub?: number | string;
};

type Appointment = {
  appointment_id: number;
  status: 'pending' | 'approved' | 'cancelled' | 'rejected' | string;
  service_type: string;
  created_at?: string;
  cancellation_reason?: string | null;
  service_date: string;
  avaliable_date: 'morning' | 'afternoon' | string;
  hour_of_day: number;
};

const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

function getUserIdFromToken(token: string) {
  try {
    const decoded = jwtDecode<TokenPayload>(token);
    return decoded.user_id || decoded.sub || '';
  } catch {
    return '';
  }
}

function formatThaiDate(dateStr: string) {
  const d = dayjs(dateStr);
  return d.isValid() ? `${d.format('D MMMM')} ${d.year() + 543}` : '-';
}

function formatTime(hour: number) {
  return `${String(hour).padStart(2, '0')}:00 น.`;
}

function queueNumber(hour: number) {
  const map: Record<number, number> = { 7: 1, 8: 2, 9: 3, 10: 4, 16: 5, 17: 6, 18: 7, 19: 8 };
  const no = map[Number(hour)];
  return no ? `A${String(no).padStart(3, '0')}` : '-';
}

function statusLabel(status: string) {
  if (status === 'approved') return 'อนุมัติแล้ว';
  if (status === 'cancelled' || status === 'rejected') return 'ยกเลิก';
  return 'รอยืนยัน';
}

function daysInMonth(month: string, year: string) {
  if (!month || !year) return 31;
  return dayjs(`${year}-${month}-01`).daysInMonth();
}

function appointmentTime(item: Appointment) {
  const date = dayjs(item.service_date).format('YYYY-MM-DD');
  return dayjs(`${date} ${String(item.hour_of_day).padStart(2, '0')}:00`, 'YYYY-MM-DD HH:mm').valueOf();
}

export default function AppointmentPage() {
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedDay, setSelectedDay] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    const token = Cookies.get('userToken');

    if (!token) {
      router.replace('/userlogin');
      return;
    }

    const userId = getUserIdFromToken(token);
    if (!userId) {
      router.replace('/userlogin');
      return;
    }

    const loadAppointments = async () => {
      try {
        setLoading(true);
        setError('');

        const res = await fetch(`${API_BASE}/appointments/user/${userId}`);
        const data = await res.json().catch(() => []);

        if (!res.ok) {
          throw new Error(data?.error || 'โหลดรายการนัดหมายไม่สำเร็จ');
        }

        setAppointments(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'โหลดรายการนัดหมายไม่สำเร็จ');
      } finally {
        setLoading(false);
        setCheckingAuth(false);
      }
    };

    loadAppointments();
  }, [router]);

  const visibleAppointments = useMemo(() => {
    const todayStart = dayjs().startOf('day').valueOf();
    const sorted = [...appointments].sort((a, b) => {
      const timeA = appointmentTime(a);
      const timeB = appointmentTime(b);
      const upcomingA = timeA >= todayStart;
      const upcomingB = timeB >= todayStart;

      if (upcomingA !== upcomingB) return upcomingA ? -1 : 1;
      return upcomingA ? timeA - timeB : timeB - timeA;
    });

    return selectedDate
      ? sorted.filter((item) => dayjs(item.service_date).format('YYYY-MM-DD') === selectedDate)
      : sorted;
  }, [appointments, selectedDate]);

  const availableYears = useMemo(() => {
    const currentYear = dayjs().year();
    const years = new Set<number>([currentYear - 1, currentYear, currentYear + 1]);
    appointments.forEach((item) => {
      const year = dayjs(item.service_date).year();
      if (Number.isFinite(year)) years.add(year);
    });
    return Array.from(years).sort((a, b) => a - b);
  }, [appointments]);

  const dayOptions = useMemo(() => {
    return Array.from({ length: daysInMonth(selectedMonth, selectedYear) }, (_, index) => index + 1);
  }, [selectedMonth, selectedYear]);

  const setDateParts = (date: dayjs.Dayjs) => {
    setSelectedDay(date.format('DD'));
    setSelectedMonth(date.format('MM'));
    setSelectedYear(date.format('YYYY'));
    setSelectedDate(date.format('YYYY-MM-DD'));
  };

  const handleDatePartChange = (part: 'day' | 'month' | 'year', value: string) => {
    const nextDay = part === 'day' ? value : selectedDay;
    const nextMonth = part === 'month' ? value : selectedMonth;
    const nextYear = part === 'year' ? value : selectedYear;
    const maxDay = daysInMonth(nextMonth, nextYear);
    const safeDay = nextDay && Number(nextDay) > maxDay ? String(maxDay).padStart(2, '0') : nextDay;

    setSelectedDay(safeDay);
    setSelectedMonth(nextMonth);
    setSelectedYear(nextYear);

    if (safeDay && nextMonth && nextYear) {
      setSelectedDate(`${nextYear}-${nextMonth}-${safeDay.padStart(2, '0')}`);
    } else {
      setSelectedDate('');
    }
  };

  const handleCalendarDateSelect = (value: string) => {
    const pickedDate = dayjs(value);
    if (!pickedDate.isValid()) return;
    setDateParts(pickedDate);
    setCalendarOpen(false);
  };

  const showAllAppointments = () => {
    setSelectedDay('');
    setSelectedMonth('');
    setSelectedYear('');
    setSelectedDate('');
    setCalendarOpen(false);
  };

  if (checkingAuth) {
    return null;
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.pageHeader}>
        <div>
          <h1>ตารางนัดหมาย</h1>
          <p>ตรวจสอบสถานะคิวและรายการนัดหมายของคุณ</p>
        </div>

        <div className={styles.toggleButtons}>
          <button className={styles.activeButton} type="button">
            <List size={16} />
            ทั้งหมด
          </button>
          <button
            className={styles.inactiveButton}
            type="button"
            onClick={() => router.push('/users/pending')}
          >
            <Plus size={16} />
            จองคิว
          </button>
        </div>
      </div>

      <div className={styles.main}>
        <section className={styles.leftPanel}>
          <div className={styles.dateFilterCard}>
            <div className={styles.filterPanelHeader}>
              <div className={styles.filterIconBox}>
                <CalendarCheck size={26} />
              </div>
              <div>
                <h2>คิวของฉัน</h2>
                <p>{selectedDate ? formatThaiDate(selectedDate) : `ทั้งหมด ${appointments.length} รายการ`}</p>
              </div>
            </div>

            <div className={styles.dateControls}>
              <select
                value={selectedDay}
                onChange={(event) => handleDatePartChange('day', event.target.value)}
                aria-label="เลือกวัน"
              >
                <option value="">วัน</option>
                {dayOptions.map((day) => (
                  <option key={day} value={String(day).padStart(2, '0')}>
                    {day}
                  </option>
                ))}
              </select>

              <select
                value={selectedMonth}
                onChange={(event) => handleDatePartChange('month', event.target.value)}
                aria-label="เลือกเดือน"
              >
                <option value="">เดือน</option>
                {THAI_MONTHS.map((month, index) => (
                  <option key={month} value={String(index + 1).padStart(2, '0')}>
                    {month}
                  </option>
                ))}
              </select>

              <select
                value={selectedYear}
                onChange={(event) => handleDatePartChange('year', event.target.value)}
                aria-label="เลือกปี"
              >
                <option value="">ปี</option>
                {availableYears.map((year) => (
                  <option key={year} value={String(year)}>
                    {year + 543}
                  </option>
                ))}
              </select>

              <button
                className={styles.datePreview}
                type="button"
                title={selectedDate ? formatThaiDate(selectedDate) : 'เลือกวัน เดือน ปี'}
                onClick={() => setCalendarOpen((open) => !open)}
              >
                <CalendarDays size={34} />
              </button>

              {calendarOpen && (
                <div className={styles.calendarPopoverOverlay} onMouseDown={() => setCalendarOpen(false)}>
                  <div className={styles.calendarPopover} onMouseDown={(event) => event.stopPropagation()}>
                    <CustomCalendar
                      onDateSelect={handleCalendarDateSelect}
                      allowPastDates
                      allowUnavailableDates
                      helperText="เลือกวันที่เพื่อดูคิวของวันนั้น"
                    />
                  </div>
                </div>
              )}
            </div>

            <button className={styles.allQueueButton} type="button" onClick={showAllAppointments}>
              คิวของฉันทั้งหมด
            </button>

            <div className={styles.appointmentResults}>
              {loading && <div className={styles.emptyState}>กำลังโหลดรายการนัดหมาย...</div>}
              {error && <div className={styles.errorState}>{error}</div>}

              {!loading && !error && visibleAppointments.length === 0 && (
                <div className={styles.emptyState}>
                  <CalendarCheck size={42} />
                  <strong>ยังไม่มีรายการนัดหมาย</strong>
                  <span>{selectedDate ? 'ไม่พบคิวในวันที่เลือก' : 'กดจองคิวเพื่อเริ่มนัดหมายใหม่'}</span>
                </div>
              )}

              <div className={styles.appointmentList}>
                {visibleAppointments.map((item) => {
                  const isMorning = item.avaliable_date === 'morning';

                  return (
                    <article key={item.appointment_id} className={styles.appointmentCard}>
                      <div className={isMorning ? styles.sessionMorning : styles.sessionAfternoon}>
                        {isMorning ? <Sun size={22} /> : <Sunset size={22} />}
                      </div>

                      <div className={styles.cardContent}>
                        <div className={styles.cardTop}>
                          <h3>{item.service_type || 'นัดหมายทั่วไป'}</h3>
                          <span className={`${styles.statusBadge} ${styles[`status_${item.status}`] || ''}`}>
                            {statusLabel(item.status)}
                          </span>
                        </div>

                        <div className={styles.metaRow}>
                          <span>
                            <CalendarCheck size={15} />
                            {formatThaiDate(item.service_date)}
                          </span>
                          <span>
                            <Clock size={15} />
                            คิว {queueNumber(item.hour_of_day)} - {formatTime(item.hour_of_day)}
                          </span>
                        </div>

                        {item.cancellation_reason && (
                          <p className={styles.reason}>เหตุผล: {item.cancellation_reason}</p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
