'use client';

import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/th';
import styles from './ThaiDatePicker.module.css';

type ThaiDatePickerProps = {
  value?: string;
  onChange?: (value: string) => void;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
  startYear?: number;
  endYear?: number;
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

function parseDate(value?: string) {
  const parsed = value ? dayjs(value) : null;
  if (!parsed?.isValid()) return { day: '', month: '', year: '' };

  return {
    day: String(parsed.date()),
    month: String(parsed.month() + 1),
    year: String(parsed.year()),
  };
}

function toDateValue(day: string, month: string, year: string) {
  if (!day || !month || !year) return '';

  const parsed = dayjs(
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  );

  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : '';
}

export default function ThaiDatePicker({
  value = '',
  onChange,
  name,
  required,
  disabled,
  min,
  max,
  startYear,
  endYear,
}: ThaiDatePickerProps) {
  const initial = parseDate(value);
  const [day, setDay] = useState(initial.day);
  const [month, setMonth] = useState(initial.month);
  const [year, setYear] = useState(initial.year);

  useEffect(() => {
    const next = parseDate(value);
    setDay(next.day);
    setMonth(next.month);
    setYear(next.year);
  }, [value]);

  const today = dayjs();
  const minYear = startYear ?? (min && dayjs(min).isValid() ? dayjs(min).year() : today.year() - 120);
  const maxYear = endYear ?? (max && dayjs(max).isValid() ? dayjs(max).year() : today.year() + 5);
  const selectedYear = Number(year) || maxYear;
  const selectedMonth = Number(month) || 1;
  const daysInMonth = dayjs(`${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`).daysInMonth();

  const years = useMemo(() => {
    const direction = minYear <= maxYear ? 1 : -1;
    const length = Math.abs(maxYear - minYear) + 1;
    return Array.from({ length }, (_, index) => minYear + index * direction);
  }, [minYear, maxYear]);

  const currentValue = toDateValue(day, month, year);

  const update = (nextDay: string, nextMonth: string, nextYear: string) => {
    const maxDay = dayjs(
      `${nextYear || today.year()}-${String(nextMonth || 1).padStart(2, '0')}-01`
    ).daysInMonth();
    const safeDay = nextDay && Number(nextDay) > maxDay ? String(maxDay) : nextDay;
    const nextValue = toDateValue(safeDay, nextMonth, nextYear);

    setDay(safeDay);
    setMonth(nextMonth);
    setYear(nextYear);
    onChange?.(nextValue);
  };

  return (
    <div className={styles.wrap}>
      {name && <input type="hidden" name={name} value={currentValue} required={required} />}

      <select
        value={day}
        onChange={(event) => update(event.target.value, month, year)}
        disabled={disabled}
        aria-label="วัน"
        required={required}
      >
        <option value="">วัน</option>
        {Array.from({ length: daysInMonth }, (_, index) => index + 1).map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>

      <select
        value={month}
        onChange={(event) => update(day, event.target.value, year)}
        disabled={disabled}
        aria-label="เดือน"
        required={required}
      >
        <option value="">เดือน</option>
        {THAI_MONTHS.map((item, index) => (
          <option key={item} value={index + 1}>
            {item}
          </option>
        ))}
      </select>

      <select
        value={year}
        onChange={(event) => update(day, month, event.target.value)}
        disabled={disabled}
        aria-label="ปี"
        required={required}
      >
        <option value="">ปี พ.ศ.</option>
        {years.map((item) => (
          <option key={item} value={item}>
            {item + 543}
          </option>
        ))}
      </select>
    </div>
  );
}
