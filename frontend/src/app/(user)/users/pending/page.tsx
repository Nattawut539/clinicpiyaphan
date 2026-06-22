'use client';

import React, { useState, useEffect } from 'react';
import styles from './pending.module.css';
import CustomCalendar from '@/app/calendar/calendar';
import { Calendar as CalendarIcon, Clock as ClockIcon } from 'lucide-react';
import dayjs from 'dayjs';
import 'dayjs/locale/th';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import Swal from 'sweetalert2';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('th');

const BANGKOK_TZ = 'Asia/Bangkok';

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:5000';

type Slot = {
  slot_id: number;
  service_date: string;
  avaliable_date: 'morning' | 'afternoon' | string;
  hour_of_day: number;
  status: 'open' | 'locked' | 'closed' | string;
  start_ts?: string;
  bookable_until?: string;
};

export default function PendingPage() {
  const router = useRouter();

  const [checkingAuth, setCheckingAuth] = useState(true);

  const [selectedDate, setSelectedDate] = useState('');
  const [title, setTitle] = useState('');

  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);

  const [morningSlotId, setMorningSlotId] = useState('');
  const [afternoonSlotId, setAfternoonSlotId] = useState('');

  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [slotError, setSlotError] = useState('');

  useEffect(() => {
    const token = Cookies.get('userToken');

    if (!token) {
      Swal.fire({
        icon: 'warning',
        title: 'กรุณาเข้าสู่ระบบก่อนจองคิว',
        confirmButtonColor: '#2f86a5',
      }).then(() => {
        router.replace('/userlogin');
      });
      return;
    }

    setCheckingAuth(false);
  }, [router]);

  const formatThaiDate = (dateStr: string) => {
    const d = dayjs(dateStr);
    const buddhistYear = d.year() + 543;
    return `${d.format('DD/MM')}/${buddhistYear}`;
  };

  const formatSlotTime = (hour: number) => {
    return `${String(hour).padStart(2, '0')}:00`;
  };

  const getErrorMessage = (error: unknown) => {
    return error instanceof Error ? error.message : '';
  };

  const formatQueueForSlot = (hour: number) => {
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
  };

  // เพิ่มใหม่: เช็กว่าวันนี้เป็นวันย้อนหลังไหม
  const isPastDate = (dateStr: string) => {
    return dayjs(dateStr).isBefore(dayjs().tz(BANGKOK_TZ).startOf('day'), 'day');
  };

  // เพิ่มใหม่: เช็กว่า slot นี้ยังเลือกจองได้ไหม
  const isSlotOpen = (slot: Slot) => {
    return String(slot.status || '').trim().toLowerCase() === 'open';
  };

  const getBookingErrorMessage = (message: string) => {
    const text = String(message || '').toLowerCase();

    if (
      text.includes('appointments_slot_id_key') ||
      text.includes('duplicate key value') ||
      text.includes('unique constraint') ||
      text.includes('ช่วงเวลานี้ถูกจองแล้ว') ||
      text.includes('ช่วงเวลานี้ไม่สามารถจองได้แล้ว')
    ) {
      return 'ช่วงเวลานี้ถูกจองแล้ว กรุณาเลือกวันหรือช่วงเวลาอื่น';
    }

    if (
      text.includes('มีนัดในวันนี้แล้ว') ||
      text.includes('ไม่สามารถจองหลายเวลาในวันเดียวกันได้')
    ) {
      return 'คุณมีนัดในวันนี้แล้ว ไม่สามารถจองหลายเวลาในวันเดียวกันได้';
    }

    if (
      text.includes('you can only book in current week') ||
      text.includes('current week') ||
      text.includes('slot date')
    ) {
      return 'สามารถจองคิวได้เฉพาะสัปดาห์ปัจจุบันเท่านั้น กรุณาเลือกวันที่อยู่ในสัปดาห์นี้';
    }

    if (text.includes('token missing') || text.includes('token invalid')) {
      return 'กรุณาเข้าสู่ระบบใหม่ก่อนจองคิว';
    }

    if (text.includes('slot_id') || text.includes('service_type')) {
      return 'กรุณาเลือกวันที่ ช่วงเวลา และกรอกหัวข้อนัดหมายให้ครบ';
    }

    return message || 'จองคิวไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
  };

  // วันที่เลือกได้ 7 วันทำการ นับจากวันนี้ และข้ามวันอาทิตย์
  useEffect(() => {
    const today = dayjs().tz(BANGKOK_TZ).startOf('day');
    const dates: string[] = [];

    let current = today;

    while (dates.length < 7) {
      const isSunday = current.day() === 0;

      if (!isSunday) {
        dates.push(current.format('YYYY-MM-DD'));
      }

      current = current.add(1, 'day');
    }

    setAvailableDates(dates);
  }, []);

  // โหลด slot ตามวันที่ที่เลือก
  useEffect(() => {
    if (!selectedDate) {
      setSlots([]);
      setMorningSlotId('');
      setAfternoonSlotId('');
      setSlotError('');
      return;
    }

    if (isPastDate(selectedDate)) {
      setSlots([]);
      setMorningSlotId('');
      setAfternoonSlotId('');
      setSlotError('ไม่สามารถจองย้อนหลังได้');
      return;
    }

    const loadSlotsByDate = async () => {
      try {
        setLoadingSlots(true);
        setMorningSlotId('');
        setAfternoonSlotId('');
        setSlotError('');

        const url = `${API_BASE}/api/slots/day?date=${selectedDate}`;
        console.log('LOAD SLOT URL =', url);

        const res = await fetch(url, {
          method: 'GET',
        });

        const data = await res.json().catch(() => []);

        console.log('SLOT RESPONSE STATUS =', res.status);
        console.log('SLOTS FROM API =', data);

        if (!res.ok) {
          throw new Error(
            data?.error || data?.message || 'โหลดช่วงเวลานัดไม่สำเร็จ'
          );
        }

        setSlots(Array.isArray(data) ? data : []);
      } catch (err: unknown) {
        setSlots([]);
        setSlotError(
          getErrorMessage(err) || 'ยังไม่สามารถโหลดช่วงเวลาจาก backend ได้'
        );
      } finally {
        setLoadingSlots(false);
      }
    };

    loadSlotsByDate();
  }, [selectedDate]);

  // ยังใช้เช็กว่าเหลือเวลาว่างไหม
  const openSlots = slots.filter(isSlotOpen);

  // แก้ใหม่: dropdown ต้องเห็นทุกเวลา ไม่กรองเฉพาะ open
  const morningSlots = slots.filter((slot) => {
    return String(slot.avaliable_date || '').trim().toLowerCase() === 'morning';
  });

  // แก้ใหม่: dropdown ต้องเห็นทุกเวลา ไม่กรองเฉพาะ open
  const afternoonSlots = slots.filter((slot) => {
    return (
      String(slot.avaliable_date || '').trim().toLowerCase() === 'afternoon'
    );
  });

  const dateOptions = Array.from(
    new Set([selectedDate, ...availableDates].filter(Boolean))
  );

  const refreshSlots = async () => {
    if (!selectedDate || isPastDate(selectedDate)) return;

    try {
      const res = await fetch(`${API_BASE}/api/slots/day?date=${selectedDate}`);
      const data = await res.json().catch(() => []);

      if (res.ok) {
        setSlots(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Refresh slots error:', err);
    }
  };

  const handleSubmit = async () => {
    const selectedSlotId = morningSlotId || afternoonSlotId;

    if (isPastDate(selectedDate)) {
      Swal.fire({
        icon: 'warning',
        title: 'ไม่สามารถจองย้อนหลังได้',
        text: 'กรุณาเลือกวันที่ปัจจุบันหรือวันที่ในอนาคต',
        confirmButtonColor: '#2f86a5',
      });
      return;
    }

    if (!title.trim() || !selectedDate || !selectedSlotId) {
      Swal.fire({
        icon: 'warning',
        title: 'กรุณากรอกข้อมูลให้ครบถ้วน',
        text: 'ต้องใส่หัวข้อนัด เลือกวันที่ และเลือกช่วงเวลา',
        confirmButtonColor: '#2f86a5',
      });
      return;
    }

    const token = Cookies.get('userToken');

    if (!token) {
      Swal.fire({
        icon: 'warning',
        title: 'กรุณาเข้าสู่ระบบก่อนจองคิว',
        confirmButtonColor: '#2f86a5',
      }).then(() => {
        router.push('/userlogin');
      });
      return;
    }

    try {
      setSubmitting(true);

      const payload = {
        slot_id: Number(selectedSlotId),
        service_type: title.trim(),
      };

      console.log('BOOKING PAYLOAD =', payload);
      console.log('HAS USER TOKEN =', Boolean(token));

      const res = await fetch(`${API_BASE}/api/appointments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      console.log('BOOKING STATUS =', res.status);
      console.log('BOOKING RESPONSE =', data);

      if (!res.ok) {
        const rawMessage =
          data?.error || data?.message || 'จองคิวไม่สำเร็จ';

        const friendlyMessage = getBookingErrorMessage(rawMessage);

        setMorningSlotId('');
        setAfternoonSlotId('');
        await refreshSlots();

        Swal.fire({
          icon: 'warning',
          title: 'จองคิวไม่สำเร็จ',
          text: friendlyMessage,
          confirmButtonColor: '#2f86a5',
        });

        return;
      }

      Swal.fire({
        icon: 'success',
        title: 'จองคิวสำเร็จ',
        text: 'ระบบบันทึกการจองของคุณแล้ว',
        confirmButtonColor: '#2f86a5',
      }).then(() => {
        router.push('/appointment');
      });

      setTitle('');
      setSelectedDate('');
      setSlots([]);
      setMorningSlotId('');
      setAfternoonSlotId('');
      setSlotError('');
    } catch (err: unknown) {
      const friendlyMessage = getBookingErrorMessage(getErrorMessage(err));

      Swal.fire({
        icon: 'error',
        title: 'จองคิวไม่สำเร็จ',
        text: friendlyMessage,
        confirmButtonColor: '#2f86a5',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (checkingAuth) {
    return null;
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.main}>
        <div className={styles.leftPanel}>
          <div className={styles.headerRow}>
            <h2 className={styles.heading}>ตารางนัด</h2>

            <div className={styles.toggleButtons}>
              <button
                className={styles.activeButton}
                onClick={() => router.push('/appointment')}
              >
                ทั้งหมด
              </button>

              <button className={styles.inactiveButton}>จองคิว</button>
            </div>
          </div>

          <CustomCalendar onDateSelect={(date) => setSelectedDate(date)} />
        </div>

        <div className={styles.rightPanel}>
          <h3 className={styles.appointmentTitle}>
            กำหนดการนัดหมายแบบจองคิว
          </h3>

          <p className={styles.warning}>กรุณาใส่หัวข้อนัดหมาย</p>

          <input
            type="text"
            placeholder="หัวข้อที่ต้องการนัด เช่น ตรวจสุขภาพ"
            className={styles.input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <div className={styles.rowCenter}>
            <CalendarIcon size={22} className={styles.icon} />

            <label className={styles.inlineLabel}>วันที่นัดได้</label>

            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className={styles.inlineSelect}
              disabled={submitting}
            >
              <option value="">-- เลือกวันที่ --</option>

              {dateOptions.map((date) => (
                <option
                  key={date}
                  value={date}
                  disabled={isPastDate(date)}
                  className={isPastDate(date) ? styles.disabledOption : ''}
                >
                  {formatThaiDate(date)}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.rowCenterColumn}>
            <div className={styles.iconLabelRow}>
              <ClockIcon size={22} className={styles.icon} />

              <label className={styles.inlineLabel}>เลือกช่วงเวลา</label>
            </div>
          </div>

          <div className={styles.timeSelectRow}>
            <select
              value={morningSlotId}
              onChange={(e) => {
                setMorningSlotId(e.target.value);
                setAfternoonSlotId('');
              }}
              className={styles.inlineSelect}
              disabled={!selectedDate || loadingSlots || submitting}
            >
              <option value="">
                {loadingSlots ? 'กำลังโหลด...' : 'ช่วงเช้า'}
              </option>

              {morningSlots.map((slot) => {
                const slotOpen = isSlotOpen(slot);

                return (
                  <option
                    key={slot.slot_id}
                    value={slot.slot_id}
                    disabled={!slotOpen}
                    className={!slotOpen ? styles.disabledOption : ''}
                  >
                    {formatQueueForSlot(slot.hour_of_day)} - {formatSlotTime(slot.hour_of_day)}
                  </option>
                );
              })}
            </select>

            <select
              value={afternoonSlotId}
              onChange={(e) => {
                setAfternoonSlotId(e.target.value);
                setMorningSlotId('');
              }}
              className={styles.inlineSelect}
              disabled={!selectedDate || loadingSlots || submitting}
            >
              <option value="">
                {loadingSlots ? 'กำลังโหลด...' : 'ช่วงบ่าย'}
              </option>

              {afternoonSlots.map((slot) => {
                const slotOpen = isSlotOpen(slot);

                return (
                  <option
                    key={slot.slot_id}
                    value={slot.slot_id}
                    disabled={!slotOpen}
                    className={!slotOpen ? styles.disabledOption : ''}
                  >
                    {formatQueueForSlot(slot.hour_of_day)} - {formatSlotTime(slot.hour_of_day)}
                  </option>
                );
              })}
            </select>
          </div>

          {slotError && <p className={styles.note}>{slotError}</p>}

          {selectedDate &&
            !loadingSlots &&
            !slotError &&
            slots.length > 0 &&
            openSlots.length === 0 && (
              <p className={styles.note}>
                วันนี้ไม่มีช่วงเวลาที่สามารถจองได้ หรือ slot ถูกปิดแล้ว
              </p>
            )}

          <div className={styles.submitSection}>
            <button
              className={styles.completedButton}
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? 'กำลังจอง...' : 'ยืนยันการจองคิว'}
            </button>

            <p className={styles.note}>
              หมายเหตุ: กรณีนัดหมายล่วงหน้า ทักหา Admin
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
