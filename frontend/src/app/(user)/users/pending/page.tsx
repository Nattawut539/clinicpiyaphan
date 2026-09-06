'use client';

import styles from './pending.module.css';
import CustomCalendar from '@/components/calendar/CustomCalendar';
import { AlertCircle, CalendarCheck, CheckCircle, Clock, List, Sun, Sunset, } from 'lucide-react';
import dayjs from 'dayjs';
import 'dayjs/locale/th'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone';
import Swal from 'sweetalert2';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import { API_BASE } from '@/lib/api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';


dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('th');

const BANGKOK_TZ = 'Asia/Bangkok';

const OTHER_TOPIC = 'อื่น ๆ (ระบุหมายเหตุ)';

const TOPICS = [
  'ตรวจโรคทั่วไป',
  'ตรวจสุขภาพ',
  'ฉีดวัคซีน / ยา',
  'ปรึกษาแพทย์',
  'ทำแผล / ล้างแผล',
  OTHER_TOPIC,
];

type Slot = {
  slot_id: number;
  service_date: string;
  avaliable_date: 'morning' | 'afternoon' | string;
  hour_of_day: number;
  status: 'open' | 'locked' | 'closed' | string;
};

type BookingRange = {
  start: string;
  end: string;
  kind: 'current' | 'advance';
};

//แปลงวันที่ให้เป็นรูปแบบ พ.ศ.
function formatThaiDate(dateStr: string) {
  const d = dayjs(dateStr);
  if (!d.isValid()) return '-';
  return `${d.format('D MMMM')} ${d.year() + 543}`;
}

//แปลงตัวเลขชั่วโมงให้เป็นรูปแบบเวลา (7 -> 07:00)
function formatSlotTime(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`;
}

//นำเวลานัดแปลงเป็นหมายเลขคิว
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
  return queueNo ? `A${String(queueNo).padStart(3, '0')}` : '-'
}

//ตรวจสอบ slot ยังเปิดจองหรือไม่ (open = true , closed = false)
function isSlotOpen(slot: Slot) {
  return String(slot.status || '').trim().toLowerCase() === 'open';
}

//ตรวจสอบ Slot ว่าหมดเวลาหรือยัง
function isSlotExpiredToday(slot: Slot) {
  const now = dayjs().tz(BANGKOK_TZ);
  const slotDate = dayjs(slot.service_date).format('YYYY-MM-DD');
  if (slotDate !== now.format('YYYY-MM-DD')) return false;

  //สร้างวันและเวลาเริ่มต้นของ slot
  const slotStart = dayjs.tz(
    `${slotDate} ${String(slot.hour_of_day).padStart(2, '0')}:00`,
    BANGKOK_TZ
  );
  return !now.isBefore(slotStart);
}

//ตรวจสอบ Slot สามารถจองได้หรือไม่
function isSlotBookable(slot: Slot) {
  return isSlotOpen(slot) && !isSlotExpiredToday(slot); // สถานะต้องเป็น open
}

//ตรวจสอบเลือกวันที่ย้อนหลังหรือไม่
function isPastDate(dateStr: string) {
  return dayjs(dateStr).isBefore(dayjs().tz(BANGKOK_TZ).startOf('day'), 'day');
}

// ตรวจหาวันจันทร์และวันอาทิตย์ของสัปดาห์ปัจจุบัน
function getCurrentWeekRange() {
  const today = dayjs().tz(BANGKOK_TZ).startOf('day'); //วันที่ตามเวลาประเทศไทย
  const daysFromMonday = (today.day() + 6) % 7;        //คำนวณจันทร์ถึงอาทิตย์
  const start = today.subtract(daysFromMonday, 'day');  //หาวันจันทร์ของสัปดาห์นี้
  const end = start.add(6, 'day');

  //start= วันจันทร์ ,end = วันอาทิตย์
  return {
    start, end,
    startKey: start.format('YYYY-MM-DD'),
    endKey: end.format('YYYY-MM-DD'),
  };
}

// ตรวจสอบว่าวันที่อยู่ระหว่างวันจันทร์และวันอาทิตย์หรือไม่
function isDateInRange(dateStr: string, startKey: string, endKey: string) {
  return Boolean(dateStr && dateStr >= startKey && dateStr <= endKey);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '';
}

//เปลี่ยน error จาก Backend เป็นข้อความให้ผู้ใช้
function getBookingErrorMessage(message: string) {
  const text = String(message || '').toLowerCase(); //แปลงเป็นตัวพิมพ์เล็ก

  //ตรวจ Error ที่เกี่ยวกับการจอง slot ซ้ำ
  if (
    text.includes('duplicate key value') ||
    text.includes('unique constraint') ||
    text.includes('ช่วงเวลานี้')
  ) {
    return 'ช่วงเวลานี้ถูกจองแล้ว กรุณาเลือกวันหรือช่วงเวลาอื่น';
  }

  //ตรวจการจองนอกสัปดาห์
  if (text.includes('current week') || text.includes('slot date') || text.includes('สัปดาห์ปัจจุบัน')) {
    return 'สามารถจองคิวได้เฉพาะสัปดาห์ปัจจุบันเท่านั้น';
  }

  //ตรวจเกี่ยวกับ Token
  if (text.includes('token missing') || text.includes('token invalid')) {
    return 'กรุณาเข้าสู่ระบบใหม่ก่อนจองคิว'
  }

  //ตรวจกรณีบัญชีถูกลบ
  if (
    text.includes('บัญชีผู้ใช้นี้ไม่มีในระบบ') ||
    text.includes('บัญชีผู้ใช้นี้ไม่มีอยู่ในระบบ') ||
    text.includes('account_deleted')
  ) {
    return 'บัญชีผู้ใช้นี้ไม่มีอยู่ในระบบ กรุณาลงทะเบียนเพื่อจองคิว';
  }

  //ตรวจกรณีข้อมูลการจองไม่ครบ
  if (text.includes('slot_id') || text.includes('service_type')) {
    return 'กรุณาเลือกวันที่ หัวข้อ และช่วงเวลาให้ครบ'
  }

  return message || 'จองคิวไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
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
  const refreshingSlotsRef = useRef(false);
  const currentWeek = useMemo(() => getCurrentWeekRange(), []);
  const [bookingRanges, setBookingRanges] = useState<BookingRange[]>([
    { start: currentWeek.startKey, end: currentWeek.endKey, kind: 'current' },
  ]);
  const bookingEnd = useMemo(
    () => bookingRanges.reduce((latest, range) => range.end > latest ? range.end : latest, currentWeek.endKey),
    [bookingRanges, currentWeek.endKey],
  );
  const weekLabel = bookingRanges
    .map((range) => `${formatThaiDate(range.start)} - ${formatThaiDate(range.end)}`)
    .join(' และ ');
  const isBookingDate = useCallback(
    (date: string) => bookingRanges.some((range) => isDateInRange(date, range.start, range.end)),
    [bookingRanges],
  );

  const handleDateSelect = (date: string) => {
    if (!isBookingDate(date)) {
      setSelectedDate('');
      setSelectedSlotId('');
      setSlots([]);
      setSlotError('วันที่นี้ยังไม่อยู่ในช่วงที่คลินิกเปิดให้จอง');
      setStep(1);
      return;
    }

    setSelectedDate(date);
  };

  const refreshBookingWindows = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/calendar/booking-windows`, { cache: 'no-store' });
      const data = await response.json().catch(() => []);
      if (!response.ok || !Array.isArray(data)) return;

      const ranges = data
        .map((item): BookingRange | null => {
          const start = String(item?.range_start || '');
          const end = String(item?.range_end || '');
          if (!start || !end) return null;
          return { start, end, kind: item?.kind === 'advance' ? 'advance' : 'current' };
        })
        .filter((item): item is BookingRange => Boolean(item));

      const currentRange = ranges.find((range) => range.kind === 'current');
      const uniqueRanges = ranges.filter((range, index, items) => {
        const duplicateIndex = items.findIndex(
          (item) => item.start === range.start && item.end === range.end,
        );
        const overlapsCurrent = Boolean(
          range.kind === 'advance' && currentRange &&
          range.start <= currentRange.end && range.end >= currentRange.start
        );
        return duplicateIndex === index && !overlapsCurrent;
      });

      if (uniqueRanges.length) setBookingRanges(uniqueRanges);
    } catch (error) {
      console.error('Load booking windows error:', error);
    }
  }, []);

  useEffect(() => {
    const syncWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshBookingWindows();
    };

    void refreshBookingWindows();
    const intervalId = window.setInterval(syncWhenVisible, 30_000);
    window.addEventListener('focus', syncWhenVisible);
    document.addEventListener('visibilitychange', syncWhenVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', syncWhenVisible);
      document.removeEventListener('visibilitychange', syncWhenVisible);
    };
  }, [refreshBookingWindows]);

  useEffect(() => {
    const token = Cookies.get('userToken');

    if (!token) {
      Swal.fire({
        icon: 'info',
        title: 'กรุณาลงทะเบียนหรือเข้าสู่ระบบเพื่อดำเนินการจองคิว',
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
          cache: 'no-store'
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
    }
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

    if (!isBookingDate(selectedDate)) {
      setSlots([]);
      setSelectedSlotId('');
      setSlotError('วันที่นี้ยังไม่อยู่ในช่วงที่คลินิกเปิดให้จอง');
      setStep(1);
      return;
    }

    const loadSlotsByDate = async () => {
      try {
        setLoadingSlots(true);
        setSelectedSlotId('');
        setSlotError('');
        setStep(2);

        const res = await fetch(`${API_BASE}/slots/day?date=${selectedDate}`, {
          cache: 'no-store',
        });
        const date = await res.json().catch(() => []);

        if (!res.ok) {
          throw new Error(date?.error || date?.message || 'โหลดช่วงเวลานัดหมายไม่สำเร็จ')
        }

        setSlots(Array.isArray(date) ? date : []);
      } catch (err: unknown) {
        setSlots([]);
        setSlotError(getErrorMessage(err) || 'ยังไม่สามารถโหลดช่วงเวลาจาก backend ได้');
      } finally {
        setLoadingSlots(false);
      }
    };

    loadSlotsByDate();
  }, [isBookingDate, selectedDate]);


  const morningSlots = useMemo(() => slots.filter((slot) => String(slot.avaliable_date).toLowerCase() === 'morning'), [slots]);
  const afternoonSlots = useMemo(() => slots.filter((slot) => String(slot.avaliable_date).toLowerCase() === 'afternoon'), [slots]);

  const selectedSlot = slots.find((slot) => String(slot.slot_id) === selectedSlotId);
  const serviceTitle = title === OTHER_TOPIC ? customTitle.trim() : title.trim();

  const refreshSlots = useCallback(async () => {
    if (!selectedDate || isPastDate(selectedDate) || !isBookingDate(selectedDate)) return;
    if (refreshingSlotsRef.current) return;

    try {
      refreshingSlotsRef.current = true;
      const res = await fetch(`${API_BASE}/slots/day?date=${selectedDate}`, {
        cache: 'no-store',
      });
      const data = await res.json().catch(() => []);

      if (res.ok) {
        const nextSlots = Array.isArray(data) ? data : [];
        setSlots(nextSlots);
        setSelectedSlotId((currentSlotId) => {
          if (!currentSlotId) return currentSlotId;
          const currentSlot = nextSlots.find(
            (slot: Slot) => String(slot.slot_id) === currentSlotId,
          );
          return currentSlot && isSlotBookable(currentSlot) ? currentSlotId : '';
        });
      }
    } catch (err) {
      console.error('Refresh slots error:', err);
    } finally {
      refreshingSlotsRef.current = false;
    }
  }, [isBookingDate, selectedDate]);

  useEffect(() => {
    if (!selectedDate || isPastDate(selectedDate) || !isBookingDate(selectedDate)) return;

    const syncVisibleSlots = () => {
      if (document.visibilityState === 'visible') void refreshSlots();
    };
    const intervalId = window.setInterval(syncVisibleSlots, 3000);

    window.addEventListener('focus', syncVisibleSlots);
    document.addEventListener('visibilitychange', syncVisibleSlots);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', syncVisibleSlots);
      document.removeEventListener('visibilitychange', syncVisibleSlots);
    };
  }, [isBookingDate, refreshSlots, selectedDate]);

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

    if (!isBookingDate(selectedDate)) {
      Swal.fire({
        icon: 'warning',
        title: 'วันที่นี้ยังไม่เปิดให้จอง',
        text: `ช่วงที่เปิดให้จองคือ ${weekLabel}`,
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

    if (!selectedSlot || !isSlotBookable(selectedSlot)) {
      setSelectedSlotId('');
      await refreshSlots();
      await Swal.fire({
        icon: 'warning',
        title: 'ช่วงเวลานี้ไม่สามารถจองได้',
        text: 'กรุณาเลือกช่วงเวลาอื่น',
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

      // ตรวจสถานะล่าสุดอีกครั้งก่อนส่งคำขอจอง เพื่อลดความสับสนเมื่อมีหลายคนเลือกเวลาเดียวกัน
      const availabilityRes = await fetch(`${API_BASE}/slots/day?date=${selectedDate}`, {
        cache: 'no-store',
      });
      const latestSlotsData = await availabilityRes.json().catch(() => []);

      if (!availabilityRes.ok || !Array.isArray(latestSlotsData)) {
        setSelectedSlotId('');
        await Swal.fire({
          icon: 'warning',
          title: 'สถานะการจองมีการเปลี่ยนแปลง',
          text: latestSlotsData?.error || 'กรุณาเลือกวันและช่วงเวลาใหม่อีกครั้ง',
          confirmButtonColor: '#0f766e',
        });
        return;
      }

      const latestSlots = latestSlotsData as Slot[];
      setSlots(latestSlots);
      const latestSelectedSlot = latestSlots.find(
        (slot) => String(slot.slot_id) === selectedSlotId,
      );
      if (!latestSelectedSlot || !isSlotBookable(latestSelectedSlot)) {
        setSelectedSlotId('');
        await Swal.fire({
          icon: 'warning',
          title: 'ช่วงเวลานี้เพิ่งถูกจองไป',
          text: 'มีผู้ใช้อื่นจองช่วงเวลานี้ก่อนหน้า กรุณาเลือกช่วงเวลาอื่น',
          confirmButtonColor: '#0f766e',
        });
        return;
      }

      const res = await fetch(`${API_BASE}/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, },
        body: JSON.stringify({ slot_id: Number(selectedSlotId), service_type: serviceTitle, }),
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

        if (
          data?.code === 'USER_ALREADY_BOOKED_DATE' ||
          String(data?.error || '').includes('มีนัดหมายในวันนี้แล้ว')
        ) {
          const result = await Swal.fire({
            icon: 'info',
            title: 'คุณมีนัดหมายในวันนี้แล้ว',
            text: 'หนึ่งบัญชีสามารถจองได้หนึ่งช่วงเวลาต่อวัน กรุณาเลือกวันอื่นหรือดูรายการนัดหมายเดิม',
            showCancelButton: true,
            confirmButtonText: 'ดูรายการนัดหมาย',
            cancelButtonText: 'เลือกวันอื่น',
            confirmButtonColor: '#0f766e',
          });

          if (result.isConfirmed) {
            router.push('/users/appointment');
          }
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
      <button type='button'
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
          <button type='button' className={styles.inactiveButton}
            onClick={() => router.push('/users/appointment')}
          >
            <List size={16} /> ทั้งหมด
          </button>
          <button type='button' className={styles.activeButton}>
            <CalendarCheck size={16} />
            จองคิว
          </button>
        </div>
      </div>

      <section className={styles.weekWindowCard}>
        <div className={styles.weekWindowHeading}>
          <span>ช่วงวันที่เปิดให้จอง</span>
          <small>อัปเดตอัตโนมัติ</small>
        </div>
        <div className={styles.weekWindowList}>
          {bookingRanges.map((range) => (
            <div
              className={`${styles.weekWindowItem} ${range.kind === 'advance' ? styles.advanceWindowItem : ''}`}
              key={`${range.kind}-${range.start}-${range.end}`}
            >
              <span>{range.kind === 'current' ? 'สัปดาห์ปัจจุบัน' : 'เปิดจองล่วงหน้า'}</span>
              <strong>{formatThaiDate(range.start)} - {formatThaiDate(range.end)}</strong>
            </div>
          ))}
        </div>
      </section>

      <div className={styles.main}>
        <section className={styles.leftPanel}>
          <CustomCalendar
            onDateSelect={handleDateSelect}
            minDate={currentWeek.startKey}
            maxDate={bookingEnd}
            allowedRanges={bookingRanges}
            helperText={`ช่วงวันที่เปิดให้จอง: ${weekLabel}`}
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
                <button type='button'
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
                      <button type='button'
                        key={topic}
                        className={title === topic ? styles.topicActive : styles.topicButton}
                        onClick={() => setTitle(topic)}
                      >
                        {topic}
                      </button>
                    ))}
                  </div>

                  {title === OTHER_TOPIC && (
                    <input className={styles.customInput}
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder='ระบุหัวข้อที่ต้องการนัดหมาย'
                    />
                  )}
                </div>

                  <div className={`${styles.sessionBlock} ${styles.morningBlock}`}>
                    <div className={styles.slotTitle}>
                      <Sun size={17}/>
                      <h3>ช่วงเช้า</h3>
                    </div>
                    <div className={styles.slotGrid}>
                      {loadingSlots && <p className={styles.note}>กำลังโหลดช่วงเวลา...</p>}
                      {!loadingSlots && morningSlots.map((slot) =>(
                        <SlotButton key={slot.slot_id} slot={slot} session='morning'/>
                      ))}
                      {!loadingSlots && !slotError && morningSlots.length === 0 && (
                        <p className={styles.note}>ยังไม่มีช่วงเวลาในช่วงเช้าสำหรับวันนี้</p>
                      )}
                    </div>
                  </div>

                  <div className={`${styles.sessionBlock} ${styles.afternoonBlock}`}>
                    <div className={styles.slotTitle}>
                      <Sunset size={17}/>
                      <h3>ช่วงบ่าย</h3>
                    </div>
                    <div className={styles.slotGrid}>
                      {!loadingSlots && afternoonSlots.map((slot) =>(
                        <SlotButton key={slot.slot_id} slot={slot} session='afternoon'/>
                      ))}
                      {!loadingSlots && !slotError && afternoonSlots.length === 0 && (
                        <p className={styles.note}>ยังไม่มีช่วงเวลาในช่วงบ่ายสำหรับวันนี้</p>
                      )}
                    </div>
                  </div>

                  {slotError && (
                    <p className={styles.errorNote}>
                      <AlertCircle size={16} />
                      {slotError}
                    </p>
                  )}

                  {!loadingSlots && !slotError && slots.length > 0 && slots.every((slot) => !isSlotBookable(slot)) &&(
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

                  <button type='button'
                    className={styles.completedButton}
                    disabled={submitting}
                    onClick={handleSubmit}
                    >
                      <CheckCircle size={18} />
                      {submitting ? 'กำลังดำเนินการจองคิวของท่าน' :'ยืนยันการจองคิวของท่าน'}
                    </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
