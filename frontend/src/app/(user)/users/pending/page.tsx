'use client';

import React, { useEffect, useMemo, useState } from 'react';
import styles from './pending.module.css';
import CustomCalendar from '@/components/calendar/CustomCalendar';
import {
  AlertCircle,
  CalendarCheck,
  CheckCircle,
  Clock,
  List,
  Sun,
  Sunset,
} from 'lucide-react';
import dayjs from 'dayjs';
import 'dayjs/locale/th';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import Swal from 'sweetalert2';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import { API_BASE } from '@/lib/api';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('th');

const BANGKOK_TZ = 'Asia/Bangkok';

const TOPICS = [
  'ตรวจโรคทั่วไป',
  'ตรวจสุขภาพประจำปี',
  'ฉีดวัคซีน / ยา',
  'ปรึกษาแพทย์',
  'ทำแผล / ล้างแผล',
  'อื่น ๆ',
];

type Slot = {
  slot_id: number;
  service_date: string;
  avaliable_date: 'morning' | 'afternoon' | string;
  hour_of_day: number;
  status: 'open' | 'locked' | 'closed' | string;
};

function formatThaiDate(dateStr: string) {
  const d = dayjs(dateStr);
  if (!d.isValid()) return '-';
  return `${d.format('D MMMM')} ${d.year() + 543}`;
}

function formatSlotTime(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function formatQueueForSlot(hour: number) {
  const queueByHour: Record<number, number> = {
    7: 1,
    8: 2,
    9: 3,
    10: 4,
    16: 5,
    17: 6,
    18: 7,
    19: 8,
  };
  const queueNo = queueByHour[Number(hour)];
  return queueNo ? `A${String(queueNo).padStart(3, '0')}` : '-';
}

function isSlotOpen(slot: Slot) {
  return String(slot.status || '').trim().toLowerCase() === 'open';
}

function isSlotExpiredToday(slot: Slot) {
  const now = dayjs().tz(BANGKOK_TZ);
  const slotDate = dayjs(slot.service_date).format('YYYY-MM-DD');
  if (slotDate !== now.format('YYYY-MM-DD')) return false;

  const slotStart = dayjs.tz(`${slotDate} ${String(slot.hour_of_day).padStart(2, '0')}:00`, 'YYYY-MM-DD HH:mm', BANGKOK_TZ);
  return !now.isBefore(slotStart);
}

function isSlotBookable(slot: Slot) {
  return isSlotOpen(slot) && !isSlotExpiredToday(slot);
}

function isPastDate(dateStr: string) {
  return dayjs(dateStr).isBefore(dayjs().tz(BANGKOK_TZ).startOf('day'), 'day');
}

function getCurrentWeekRange() {
  const today = dayjs().tz(BANGKOK_TZ).startOf('day');
  const daysFromMonday = (today.day() + 6) % 7;
  const start = today.subtract(daysFromMonday, 'day');
  const end = start.add(6, 'day');

  return {
    start,
    end,
    startKey: start.format('YYYY-MM-DD'),
    endKey: end.format('YYYY-MM-DD'),
  };
}

function isDateInRange(dateStr: string, startKey: string, endKey: string) {
  return Boolean(dateStr && dateStr >= startKey && dateStr <= endKey);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '';
}

function getBookingErrorMessage(message: string) {
  const text = String(message || '').toLowerCase();

  if (
    text.includes('duplicate key value') ||
    text.includes('unique constraint') ||
    text.includes('ช่วงเวลานี้')
  ) {
    return 'ช่วงเวลานี้ถูกจองแล้ว กรุณาเลือกวันหรือช่วงเวลาอื่น';
  }

  if (text.includes('current week') || text.includes('slot date') || text.includes('สัปดาห์ปัจจุบัน')) {
    return 'สามารถจองคิวได้เฉพาะสัปดาห์ปัจจุบันเท่านั้น';
  }

  if (text.includes('token missing') || text.includes('token invalid')) {
    return 'กรุณาเข้าสู่ระบบใหม่ก่อนจองคิว';
  }

  if (text.includes('บัญชีผู้ใช้นี้ไม่มีอยู่ในระบบ') || text.includes('account_deleted')) {
    return 'บัญชีผู้ใช้นี้ไม่มีอยู่ในระบบ กรุณาลงทะเบียนเพื่อจองคิว';
  }

  if (text.includes('slot_id') || text.includes('service_type')) {
    return 'กรุณาเลือกวันที่ หัวข้อ และช่วงเวลาให้ครบ';
  }

  return message || 'จองคิวไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
}

export default function PendingPage() {
  const router = useRouter();

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [selectedDate, setSelectedDate] = useState('');
  const [title, setTitle] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [slotError, setSlotError] = useState('');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const currentWeek = useMemo(() => getCurrentWeekRange(), []);
  const weekLabel = `${formatThaiDate(currentWeek.startKey)} - ${formatThaiDate(currentWeek.endKey)}`;

  const handleDateSelect = (date: string) => {
    if (!isDateInRange(date, currentWeek.startKey, currentWeek.endKey)) {
      setSelectedDate('');
      setSelectedSlotId('');
      setSlots([]);
      setSlotError('เปิดจองเฉพาะสัปดาห์ปัจจุบันเท่านั้น');
      setStep(1);
      return;
    }

    setSelectedDate(date);
  };

  useEffect(() => {
    const token = Cookies.get('userToken');

    if (!token) {
      Swal.fire({
        icon: 'info',
        title: 'กรุณาลงทะเบียนหรือเข้าสู่ระบบเพื่อจองคิว',
        confirmButtonColor: '#0f766e',
      }).then(() => {
        router.replace('/users/userHome');
      });
      return;
    }

    const verifyAccount = async () => {
      try {
        const res = await fetch(`${API_BASE}/me/profile`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
          cache: 'no-store',
        });

        if (!res.ok) {
          Cookies.remove('userToken', { path: '/' });
          Cookies.remove('authToken', { path: '/' });
          await Swal.fire({
            icon: 'warning',
            title: 'บัญชีนี้ไม่มีอยู่ในระบบ',
            text: 'กรุณาลงทะเบียนเพื่อทำการจองคิว',
            confirmButtonColor: '#0f766e',
          });
          router.replace('/users/userHome');
          return;
        }

        setCheckingAuth(false);
      } catch {
        setCheckingAuth(false);
      }
    };

    verifyAccount();
  }, [router]);

  useEffect(() => {
    if (!selectedDate) {
      setSlots([]);
      setSelectedSlotId('');
      setSlotError('');
      setStep(1);
      return;
    }

    if (isPastDate(selectedDate)) {
      setSlots([]);
      setSelectedSlotId('');
      setSlotError('ไม่สามารถจองย้อนหลังได้');
      setStep(1);
      return;
    }

    if (!isDateInRange(selectedDate, currentWeek.startKey, currentWeek.endKey)) {
      setSlots([]);
      setSelectedSlotId('');
      setSlotError('เปิดจองเฉพาะสัปดาห์ปัจจุบันเท่านั้น');
      setStep(1);
      return;
    }

    const loadSlotsByDate = async () => {
      try {
        setLoadingSlots(true);
        setSelectedSlotId('');
        setSlotError('');
        setStep(2);

        const res = await fetch(`${API_BASE}/slots/day?date=${selectedDate}`);
        const data = await res.json().catch(() => []);

        if (!res.ok) {
          throw new Error(data?.error || data?.message || 'โหลดช่วงเวลานัดไม่สำเร็จ');
        }

        setSlots(Array.isArray(data) ? data : []);
      } catch (err: unknown) {
        setSlots([]);
        setSlotError(getErrorMessage(err) || 'ยังไม่สามารถโหลดช่วงเวลาจาก backend ได้');
      } finally {
        setLoadingSlots(false);
      }
    };

    loadSlotsByDate();
  }, [currentWeek.endKey, currentWeek.startKey, selectedDate]);

  const morningSlots = useMemo(
    () => slots.filter((slot) => String(slot.avaliable_date).toLowerCase() === 'morning'),
    [slots]
  );

  const afternoonSlots = useMemo(
    () => slots.filter((slot) => String(slot.avaliable_date).toLowerCase() === 'afternoon'),
    [slots]
  );

  const selectedSlot = slots.find((slot) => String(slot.slot_id) === selectedSlotId);
  const serviceTitle = title === 'อื่น ๆ' ? customTitle.trim() : title.trim();

  const refreshSlots = async () => {
    if (!selectedDate || isPastDate(selectedDate) || !isDateInRange(selectedDate, currentWeek.startKey, currentWeek.endKey)) return;

    try {
      const res = await fetch(`${API_BASE}/slots/day?date=${selectedDate}`);
      const data = await res.json().catch(() => []);

      if (res.ok) {
        setSlots(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Refresh slots error:', err);
    }
  };

  const handleSubmit = async () => {
    if (isPastDate(selectedDate)) {
      Swal.fire({
        icon: 'warning',
        title: 'ไม่สามารถจองย้อนหลังได้',
        text: 'กรุณาเลือกวันที่ปัจจุบันหรือวันที่ในอนาคต',
        confirmButtonColor: '#0f766e',
      });
      return;
    }

    if (!isDateInRange(selectedDate, currentWeek.startKey, currentWeek.endKey)) {
      Swal.fire({
        icon: 'warning',
        title: 'เปิดจองเฉพาะสัปดาห์ปัจจุบัน',
        text: `สัปดาห์นี้เปิดให้จองวันที่ ${weekLabel}`,
        confirmButtonColor: '#0f766e',
      });
      return;
    }

    if (!serviceTitle || !selectedDate || !selectedSlotId) {
      Swal.fire({
        icon: 'warning',
        title: 'กรุณากรอกข้อมูลให้ครบถ้วน',
        text: 'ต้องเลือกวันที่ หัวข้อ และช่วงเวลา',
        confirmButtonColor: '#0f766e',
      });
      return;
    }

    const token = Cookies.get('userToken');

    if (!token) {
      Swal.fire({
        icon: 'warning',
        title: 'กรุณาเข้าสู่ระบบก่อนจองคิว',
        confirmButtonColor: '#0f766e',
      }).then(() => {
        router.push('/userlogin');
      });
      return;
    }

    try {
      setSubmitting(true);

      const res = await fetch(`${API_BASE}/appointments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          slot_id: Number(selectedSlotId),
          service_type: serviceTitle,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setSelectedSlotId('');
        await refreshSlots();

        if (data?.account_deleted) {
          Cookies.remove('userToken', { path: '/' });
          Cookies.remove('authToken', { path: '/' });
          await Swal.fire({
            icon: 'warning',
            title: 'บัญชีนี้ไม่มีอยู่ในระบบ',
            text: 'กรุณาลงทะเบียนเพื่อทำการจองคิว',
            confirmButtonColor: '#0f766e',
          });
          router.replace('/users/userHome');
          return;
        }

        Swal.fire({
          icon: 'warning',
          title: 'จองคิวไม่สำเร็จ',
          text: getBookingErrorMessage(data?.error || data?.message || ''),
          confirmButtonColor: '#0f766e',
        });

        return;
      }

      Swal.fire({
        icon: 'success',
        title: 'จองคิวสำเร็จ',
        text: 'ระบบบันทึกการจองของคุณแล้ว กรุณารอการอนุมัติ',
        confirmButtonColor: '#0f766e',
      }).then(() => {
        router.push('/users/appointment');
      });

      setTitle('');
      setCustomTitle('');
      setSelectedDate('');
      setSlots([]);
      setSelectedSlotId('');
      setSlotError('');
      setStep(1);
    } catch (err: unknown) {
      Swal.fire({
        icon: 'error',
        title: 'จองคิวไม่สำเร็จ',
        text: getBookingErrorMessage(getErrorMessage(err)),
        confirmButtonColor: '#0f766e',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const SlotButton = ({ slot, session }: { slot: Slot; session: 'morning' | 'afternoon' }) => {
    const open = isSlotBookable(slot);
    const expired = isSlotExpiredToday(slot);
    const selected = String(slot.slot_id) === selectedSlotId;

    return (
      <button
        type="button"
        className={`${styles.slotButton} ${styles[session]} ${selected ? styles.selectedSlot : ''} ${!open ? styles.unavailableSlot : ''}`}
        disabled={!open || submitting}
        onClick={() => setSelectedSlotId(String(slot.slot_id))}
      >
        <span>{formatQueueForSlot(slot.hour_of_day)}</span>
        <strong>{formatSlotTime(slot.hour_of_day)}</strong>
        {!open && <em>{expired ? 'หมดเวลา' : 'เต็ม'}</em>}
      </button>
    );
  };

  if (checkingAuth) {
    return null;
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.pageHeader}>
        <div>
          <h1>จองคิว</h1>
          <p>เลือกวัน หัวข้อ และช่วงเวลาที่ต้องการเข้ารับบริการ</p>
        </div>

        <div className={styles.toggleButtons}>
          <button
            className={styles.inactiveButton}
            type="button"
            onClick={() => router.push('/users/appointment')}
          >
            <List size={16} />
            ทั้งหมด
          </button>
          <button className={styles.activeButton} type="button">
            <CalendarCheck size={16} />
            จองคิว
          </button>
        </div>
      </div>

      <section className={styles.weekWindowCard}>
        <div>
          <span>Booking window</span>
          <strong>{weekLabel}</strong>
        </div>
      </section>

      <div className={styles.main}>
        <section className={styles.leftPanel}>
          <CustomCalendar
            onDateSelect={handleDateSelect}
            minDate={currentWeek.startKey}
            maxDate={currentWeek.endKey}
            helperText={`เปิดจองเฉพาะสัปดาห์ปัจจุบัน: ${weekLabel}`}
          />
        </section>

        <section className={styles.rightPanel}>
          {step === 1 && (
            <div className={styles.hintCard}>
              <div className={styles.hintIcon}>
                <CalendarCheck size={30} />
              </div>
              <h2>เลือกวันในปฏิทิน</h2>
              <p>กดวันที่มีคิวว่างเพื่อเลือกหัวข้อและช่วงเวลานัดหมาย</p>
            </div>
          )}

          {step >= 2 && (
            <div className={styles.bookingCard}>
              <div className={styles.selectedDateBar}>
                <div>
                  <span>วันที่เลือก</span>
                  <strong>{formatThaiDate(selectedDate)}</strong>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDate('');
                    setSelectedSlotId('');
                    setStep(1);
                  }}
                >
                  เปลี่ยน
                </button>
              </div>

              <div className={styles.cardBody}>
                <div>
                  <h3>หัวข้อการรักษา</h3>
                  <div className={styles.topicGrid}>
                    {TOPICS.map((topic) => (
                      <button
                        key={topic}
                        type="button"
                        className={title === topic ? styles.topicActive : styles.topicButton}
                        onClick={() => setTitle(topic)}
                      >
                        {topic}
                      </button>
                    ))}
                  </div>

                  {title === 'อื่น ๆ' && (
                    <input
                      className={styles.customInput}
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      placeholder="ระบุหัวข้อที่ต้องการนัด"
                    />
                  )}
                </div>

                <div className={`${styles.sessionBlock} ${styles.morningBlock}`}>
                  <div className={styles.slotTitle}>
                    <Sun size={17} />
                    <h3>ช่วงเช้า</h3>
                  </div>
                  <div className={styles.slotGrid}>
                    {loadingSlots && <p className={styles.note}>กำลังโหลดช่วงเวลา...</p>}
                    {!loadingSlots && morningSlots.map((slot) => (
                      <SlotButton key={slot.slot_id} slot={slot} session="morning" />
                    ))}
                    {!loadingSlots && !slotError && morningSlots.length === 0 && (
                      <p className={styles.note}>ยังไม่มีช่วงเช้าสำหรับวันนี้</p>
                    )}
                  </div>
                </div>

                <div className={`${styles.sessionBlock} ${styles.afternoonBlock}`}>
                  <div className={styles.slotTitle}>
                    <Sunset size={17} />
                    <h3>ช่วงบ่าย</h3>
                  </div>
                  <div className={styles.slotGrid}>
                    {!loadingSlots && afternoonSlots.map((slot) => (
                      <SlotButton key={slot.slot_id} slot={slot} session="afternoon" />
                    ))}
                    {!loadingSlots && !slotError && afternoonSlots.length === 0 && (
                      <p className={styles.note}>ยังไม่มีช่วงบ่ายสำหรับวันนี้</p>
                    )}
                  </div>
                </div>

                {slotError && (
                  <p className={styles.errorNote}>
                    <AlertCircle size={16} />
                    {slotError}
                  </p>
                )}

                {!loadingSlots && !slotError && slots.length > 0 && slots.every((slot) => !isSlotBookable(slot)) && (
                  <p className={styles.errorNote}>
                    <AlertCircle size={16} />
                    วันนี้ไม่มีช่วงเวลาที่สามารถจองได้
                  </p>
                )}

                {selectedSlot && serviceTitle && (
                  <div className={styles.summaryCard}>
                    <h3>สรุปการจอง</h3>
                    <div>
                      <span>วัน</span>
                      <strong>{formatThaiDate(selectedDate)}</strong>
                    </div>
                    <div>
                      <span>คิว</span>
                      <strong>{formatQueueForSlot(selectedSlot.hour_of_day)}</strong>
                    </div>
                    <div>
                      <span>เวลา</span>
                      <strong>
                        <Clock size={15} />
                        {formatSlotTime(selectedSlot.hour_of_day)} น.
                      </strong>
                    </div>
                    <div>
                      <span>เรื่อง</span>
                      <strong>{serviceTitle}</strong>
                    </div>
                  </div>
                )}

                <button
                  className={styles.completedButton}
                  onClick={handleSubmit}
                  disabled={submitting}
                  type="button"
                >
                  <CheckCircle size={18} />
                  {submitting ? 'กำลังจอง...' : 'ยืนยันการจองคิว'}
                </button>

                <p className={styles.note}>หมายเหตุ: กรณีนัดหมายล่วงหน้า กรุณาทักหา Admin</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
