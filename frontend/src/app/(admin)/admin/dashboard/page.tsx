'use client';


import React, { useEffect, useMemo, useRef, useState } from 'react';
import Cookies from 'js-cookie';
import dayjs from 'dayjs';
import 'dayjs/locale/th';
import Swal from 'sweetalert2';
import styles from './Dashboard.module.css';
import { API_BASE } from '@/lib/api';
import Sidebar from '@/components/admin-shell/AdminSidebar';
import AdminHeaderActions from '@/components/admin-shell/AdminHeaderActions';
import ThaiDatePicker from '@/components/date/ThaiDatePicker';


dayjs.locale('th');

type QueueTicket = {
    queue_id: number;
    queue_number: string;
    prefix: string;
    numeric_no: number;
    service_date: string;
    avaliable_date: 'morning' | 'afternoon';
    source: string;
    appointment_id: number | null;
    user_id: number | null;
    service_type: string | null;
    status: string;
    created_at?: string;
    has_measurement?: boolean;
    has_medical_record?: boolean;
};

type PatientDetail = {
    user_id: number;
    patient_code?: string;
    first_name?: string;
    last_name?: string;
    dob?: string;
    birth_date?: string;
    gender?: string;
    blood_type?: string;
    phone?: string;
    congenital_disease?: string;
    drug_allergy?: string;
    food_allergy?: string;
};

type Measurement = {
    measurement_id: number;
    queue_number: string;
    weight: number | null;
    height: number | null;
    bmi: number | null;
    chief_complaint?: string | null;
    temperature?: number | null;
    heart_rate?: number | null;
    respiratory_rate?: number | null;
    systolic_bp?: number | null;
    diastolic_bp?: number | null;
    created_at: string;
};

type VitalDraft = {
    cc: string;
    bw: string;
    ht: string;
    tp: string;
    hr: string;
    rr: string;
    bp: string;
};

type PatientDraft = {
    first_name: string;
    last_name: string;
    birth_date: string;
    gender: string;
    blood_type: string;
    phone: string;
};

type QueueFilter = 'all' | 'A' | 'B';

type WalkinDraft = {
    service_date: string;
    visit_time: string;
    receipt_queue: string;
    user_id: string;
    first_name: string;
    last_name: string;
    national_id: string;
    birth_date: string;
    age: string;
    gender: string;
    blood_type: string;
    phone: string;
    emergency_phone: string;
    drug_allergy: string;
    food_allergy: string;
    weight: string;
    height: string;
    bmi: string;
    temperature: string;
    heart_rate: string;
    respiratory_rate: string;
    bp: string;
    chief_complaint: string;
};

const emptyVitalDraft: VitalDraft = {
    cc: '',
    bw: '',
    ht: '',
    tp: '',
    hr: '',
    rr: '',
    bp: '',
};

const emptyPatientDraft: PatientDraft = {
    first_name: '',
    last_name: '',
    birth_date: '',
    gender: '',
    blood_type: '',
    phone: '',
};

function getEmptyWalkinDraft(): WalkinDraft {
    return {
        service_date: dayjs().format('YYYY-MM-DD'),
        visit_time: dayjs().format('HH:mm'),
        receipt_queue: '',
        user_id: '',
        first_name: '',
        last_name: '',
        national_id: '',
        birth_date: '',
        age: '',
        gender: '',
        blood_type: '',
        phone: '',
        emergency_phone: '',
        drug_allergy: '',
        food_allergy: '',
        weight: '',
        height: '',
        bmi: '',
        temperature: '',
        heart_rate: '',
        respiratory_rate: '',
        bp: '',
        chief_complaint: '',
    };
}

function stringifyMeasurement(value?: string | number | null) {
    return value === null || value === undefined ? '' : String(value);
}

function formatBpValue(systolic?: string | number | null, diastolic?: string | number | null) {
    if (!systolic || !diastolic) return '';
    return `${systolic}/${diastolic}`;
}

function parseBpValue(value: string) {
    const text = value.trim();
    if (!text) return { systolic_bp: null, diastolic_bp: null };

    const match = text.match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
    if (!match) return null;

    return {
        systolic_bp: Number(match[1]),
        diastolic_bp: Number(match[2]),
    };
}

function calcBmiText(weight: string, height: string) {
    const w = Number.parseFloat(weight);
    const h = Number.parseFloat(height);
    if (!(w > 0) || !(h > 0)) return '';
    return (w / ((h / 100) * (h / 100))).toFixed(2);
}

function calcAgeText(birthDate: string) {
    const birth = dayjs(birthDate);
    if (!birth.isValid()) return '';
    const today = dayjs();
    let years = today.year() - birth.year();
    let months = today.month() - birth.month();
    if (today.date() < birth.date()) months -= 1;
    if (months < 0) {
        years -= 1;
        months += 12;
    }
    return `${Math.max(years, 0)} ปี ${months} เดือน`;
}

function calcAgeYearsText(birthDate: string) {
    const birth = dayjs(birthDate);
    if (!birth.isValid()) return '-';

    const today = dayjs();
    let years = today.year() - birth.year();
    if (
        today.month() < birth.month() ||
        (today.month() === birth.month() && today.date() < birth.date())
    ) {
        years -= 1;
    }

    return `${Math.max(years, 0)} ปี`;
}

type ApprovedAppointment = {
    appointment_id: number;
    queue_id?: number | null;
    queue_number?: string | null;
    prefix?: string | null;
    numeric_no?: number | null;
    queue_status?: string | null;
    service_date: string;
    avaliable_date?: 'morning' | 'afternoon';
    hour_of_day: number;
    status: string;
    user_id: number;
    first_name?: string;
    last_name?: string;
    service_type?: string | null;
    has_measurement?: boolean;
    has_medical_record?: boolean;
};

type CalendarSlot = {
    service_date: string;
    avaliable_date: 'morning' | 'afternoon';
    hour_of_day: number;
    status: 'open' | 'locked' | 'closed';
    is_empty?: boolean;
    is_bookable?: boolean;
};

const API = API_BASE.endsWith('/api') ? API_BASE : `${API_BASE}/api`;
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
const THAI_TIME_HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const THAI_TIME_MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));

function getToken() {
    return (
        Cookies.get('adminToken') ||
        Cookies.get('staffToken') ||
        Cookies.get('token') ||
        ''
    );
}

function authHeaders() {
    const token = getToken();

    return {
        Authorization: `Bearer ${token}`,
    };
}

function jsonHeaders() {
    const token = getToken();

    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
    };
}

function getQueueTime(queue?: QueueTicket | null) {
    if (!queue) return '-';

    if (queue.avaliable_date === 'morning') {
        return '07:00 น. - 11:00 น.';
    }

    if (queue.avaliable_date === 'afternoon') {
        return '16:00 น. - 20:00 น.';
    }

    return '-';
}

function getAppointmentTime(appointment?: ApprovedAppointment | null) {
    if (!appointment) return '-';
    return `${String(appointment.hour_of_day).padStart(2, '0')}:00 น.`;
}

function getAppointmentQueueLabel(appointment: ApprovedAppointment) {
    return appointment.queue_number || getAppointmentTime(appointment);
}

function getAppointmentOrderLabel(appointment: ApprovedAppointment, index: number) {
    return appointment.numeric_no ?? index + 1;
}

function sortAppointmentsByRealQueue(items: ApprovedAppointment[]) {
    return [...items].sort((a, b) => {
        const aOrder = a.numeric_no ?? a.hour_of_day;
        const bOrder = b.numeric_no ?? b.hour_of_day;

        return aOrder - bOrder;
    });
}

function buildThaiDateSelectHtml(prefix: string, value: string) {
    const selected = dayjs(value).isValid() ? dayjs(value) : dayjs();
    const currentYear = dayjs().year();
    const years = Array.from({ length: 8 }, (_, index) => currentYear - 1 + index);

    const dayOptions = Array.from({ length: 31 }, (_, index) => index + 1)
        .map((day) => `<option value="${day}" ${day === selected.date() ? 'selected' : ''}>${day}</option>`)
        .join('');
    const monthOptions = THAI_MONTHS
        .map((month, index) => `<option value="${index + 1}" ${index === selected.month() ? 'selected' : ''}>${month}</option>`)
        .join('');
    const yearOptions = years
        .map((year) => `<option value="${year}" ${year === selected.year() ? 'selected' : ''}>${year + 543}</option>`)
        .join('');

    return `
        <div class="${styles.holidayDateGrid}">
            <select id="${prefix}-day" class="${styles.holidayFormControl}" aria-label="วัน">${dayOptions}</select>
            <select id="${prefix}-month" class="${styles.holidayFormControl}" aria-label="เดือน">${monthOptions}</select>
            <select id="${prefix}-year" class="${styles.holidayFormControl}" aria-label="ปี">${yearOptions}</select>
        </div>
    `;
}

function readThaiDateSelect(prefix: string) {
    const daySelect = document.getElementById(`${prefix}-day`) as HTMLSelectElement | null;
    const monthSelect = document.getElementById(`${prefix}-month`) as HTMLSelectElement | null;
    const yearSelect = document.getElementById(`${prefix}-year`) as HTMLSelectElement | null;

    const day = Number(daySelect?.value || 0);
    const month = Number(monthSelect?.value || 0);
    const year = Number(yearSelect?.value || 0);

    if (!day || !month || !year) return '';

    const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const parsed = dayjs(value);

    if (!parsed.isValid() || parsed.date() !== day || parsed.month() + 1 !== month || parsed.year() !== year) {
        return '';
    }

    return parsed.format('YYYY-MM-DD');
}

function sortQueuesByType(items: QueueTicket[]) {
    const prefixOrder: Record<string, number> = { A: 0, B: 1 };
    const aQueueMinutes: Record<number, number> = {
        1: 7 * 60,
        2: 8 * 60,
        3: 9 * 60,
        4: 10 * 60,
        5: 16 * 60,
        6: 17 * 60,
        7: 18 * 60,
        8: 19 * 60,
    };
    const queueMinutes = (queue: QueueTicket) => {
        if (queue.prefix === 'A') return aQueueMinutes[queue.numeric_no] ?? Number.MAX_SAFE_INTEGER;
        const created = dayjs(queue.created_at);
        if (created.isValid()) return created.hour() * 60 + created.minute();
        return Number.MAX_SAFE_INTEGER;
    };

    return [...items].sort((a, b) => {
        const timeDifference = queueMinutes(a) - queueMinutes(b);
        if (timeDifference !== 0) return timeDifference;

        const prefixDifference = (prefixOrder[a.prefix] ?? 99) - (prefixOrder[b.prefix] ?? 99);
        if (prefixDifference !== 0) return prefixDifference;

        return a.numeric_no - b.numeric_no;
    });
}

function getQueueTypeLabel(prefix?: string) {
    if (prefix === 'A') return 'A · จองออนไลน์';
    if (prefix === 'B') return 'B · มาถึงคลินิก';
    return 'คิวทั่วไป';
}

function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

function formatMeasurement(value?: number | null, unit?: string) {
    if (value === null || value === undefined) return 'ยังไม่มีข้อมูล';
    return unit ? `${value} ${unit}` : String(value);
}

export default function DashboardPage() {
    const [, setLoading] = useState(true);
    const [now, setNow] = useState(() => dayjs());

    const [queues, setQueues] = useState<QueueTicket[]>([]);
    const [selectedQueue, setSelectedQueue] = useState<QueueTicket | null>(null);
    const [selectedAppointment, setSelectedAppointment] = useState<ApprovedAppointment | null>(null);
    const [patientPanelOpen, setPatientPanelOpen] = useState(false);
    const [patient, setPatient] = useState<PatientDetail | null>(null);
    const [latestMeasurement, setLatestMeasurement] = useState<Measurement | null>(null);
    const [syncedMeasurementId, setSyncedMeasurementId] = useState<number | null>(null);

    const [appointments, setAppointments] = useState<ApprovedAppointment[]>([]);
    const [calendarSlots, setCalendarSlots] = useState<CalendarSlot[]>([]);
    const [calendarMonth, setCalendarMonth] = useState(dayjs());
    const [selectedCalendarDate, setSelectedCalendarDate] = useState(dayjs().format('YYYY-MM-DD'));
    const [queueFilter, setQueueFilter] = useState<QueueFilter>('all');
    const [walkinOpen, setWalkinOpen] = useState(false);
    const [walkinSaving, setWalkinSaving] = useState(false);
    const [walkinLookupStatus, setWalkinLookupStatus] = useState<'idle' | 'searching' | 'found' | 'not_found'>('idle');
    const [walkinDraft, setWalkinDraft] = useState<WalkinDraft>(() => getEmptyWalkinDraft());
    const lastWalkinLookupKey = useRef('');

    const [, setSymptoms] = useState('');
    const [vitalDraft, setVitalDraft] = useState<VitalDraft>(emptyVitalDraft);
    const [vitalTouched, setVitalTouched] = useState(false);
    const [patientDraft, setPatientDraft] = useState<PatientDraft>(emptyPatientDraft);
    const [patientDraftDirty, setPatientDraftDirty] = useState(false);
    const [customHolidays, setCustomHolidays] = useState<string[]>([]);
    // const todayText = `${dayjs(selectedCalendarDate).format('D MMMM')} ${dayjs(selectedCalendarDate).year() + 543}`;
    const todayText = dayjs().locale("th").format("D MMMM");
    const buddhistYear = dayjs().year() + 543;

    const setVitalValue = (key: keyof VitalDraft, value: string) => {
        setVitalTouched(true);
        setVitalDraft((current) => ({ ...current, [key]: value }));
    };

    const setPatientValue = (key: keyof PatientDraft, value: string) => {
        setPatientDraftDirty(true);
        setPatientDraft((current) => ({ ...current, [key]: value }));
    };

    const setWalkinValue = (key: keyof WalkinDraft, value: string) => {
        if (key === 'national_id' || key === 'first_name' || key === 'last_name') {
            setWalkinLookupStatus('idle');
        }

        setWalkinDraft((current) => {
            const next = { ...current, [key]: value };
            if (key === 'weight' || key === 'height') {
                next.bmi = calcBmiText(next.weight, next.height);
            }
            if (key === 'birth_date') {
                next.age = calcAgeText(value);
            }
            return next;
        });
    };

    const openWalkinForm = () => {
        setWalkinDraft(getEmptyWalkinDraft());
        setWalkinLookupStatus('idle');
        lastWalkinLookupKey.current = '';
        setWalkinOpen(true);
    };

    const useCurrentWalkinDateTime = () => {
        const current = dayjs();
        setWalkinDraft((draft) => ({
            ...draft,
            service_date: current.format('YYYY-MM-DD'),
            visit_time: current.format('HH:mm'),
        }));
    };

    const applyWalkinPatient = (data: Record<string, unknown>) => {
        setWalkinDraft((current) => ({
            ...current,
            user_id: stringifyMeasurement(data.user_id as string | number | null),
            national_id: stringifyMeasurement(data.national_id as string | number | null) || current.national_id,
            first_name: stringifyMeasurement(data.first_name as string | number | null) || current.first_name,
            last_name: stringifyMeasurement(data.last_name as string | number | null) || current.last_name,
            phone: stringifyMeasurement(data.phone as string | number | null),
            emergency_phone: stringifyMeasurement(data.emergency_phone as string | number | null),
            birth_date: data.dob ? dayjs(String(data.dob)).format('YYYY-MM-DD') : '',
            age: data.dob ? calcAgeText(dayjs(String(data.dob)).format('YYYY-MM-DD')) : '',
            gender: stringifyMeasurement(data.gender as string | number | null),
            blood_type: stringifyMeasurement(data.blood_type as string | number | null),
            drug_allergy: stringifyMeasurement(data.drug_allergy as string | number | null),
            food_allergy: stringifyMeasurement(data.food_allergy as string | number | null),
            weight: stringifyMeasurement(data.weight as string | number | null),
            height: stringifyMeasurement(data.height as string | number | null),
            bmi: stringifyMeasurement(data.bmi as string | number | null),
        }));
    };

    const lookupWalkinPatientSilently = async () => {
        const params = new URLSearchParams();
        const nationalId = walkinDraft.national_id.trim();
        const firstName = walkinDraft.first_name.trim();
        const lastName = walkinDraft.last_name.trim();

        if (nationalId.length >= 13) params.set('national_id', nationalId);
        if (!params.has('national_id') && firstName && lastName) {
            params.set('first_name', firstName);
            params.set('last_name', lastName);
        }

        if (!params.toString()) {
            setWalkinLookupStatus('idle');
            lastWalkinLookupKey.current = '';
            return;
        }

        const lookupKey = params.toString();
        if (lookupKey === lastWalkinLookupKey.current) return;
        lastWalkinLookupKey.current = lookupKey;
        setWalkinLookupStatus('searching');

        try {
            const res = await fetch(`${API}/patients/lookup?${lookupKey}`, {
                headers: authHeaders(),
                cache: 'no-store',
            });
            const data = await res.json().catch(() => null);

            if (!res.ok || !data) {
                setWalkinLookupStatus('not_found');
                return;
            }

            applyWalkinPatient(data);
            setWalkinLookupStatus('found');
        } catch {
            setWalkinLookupStatus('idle');
        }
    };

    const saveWalkinQueue = async () => {
        if (!walkinDraft.service_date || !walkinDraft.visit_time || !walkinDraft.first_name || !walkinDraft.last_name) {
            Swal.fire({
                icon: 'warning',
                title: 'กรอกข้อมูลคิว B ไม่ครบ',
                text: 'ต้องมีวันที่ เวลา ชื่อ และนามสกุล',
                confirmButtonColor: '#0f766e',
            });
            return;
        }

        const parsedBp = parseBpValue(walkinDraft.bp);
        if (walkinDraft.bp.trim() && !parsedBp) {
            Swal.fire({
                icon: 'warning',
                title: 'รูปแบบ BP ไม่ถูกต้อง',
                text: 'กรุณากรอกความดันเป็นรูปแบบ เช่น 120/80',
                confirmButtonColor: '#0f766e',
            });
            return;
        }

        try {
            setWalkinSaving(true);
            const hour = Number(walkinDraft.visit_time.split(':')[0] || 0);
            const avaliableDate = hour < 12 ? 'morning' : 'afternoon';

            const res = await fetch(`${API}/issue-walkin`, {
                method: 'POST',
                headers: jsonHeaders(),
                body: JSON.stringify({
                    service_date: walkinDraft.service_date,
                    visit_time: walkinDraft.visit_time,
                    avaliable_date: avaliableDate,
                    receipt_queue: walkinDraft.receipt_queue || null,
                    service_type: walkinDraft.receipt_queue || 'Walk-in',
                    patient: {
                        first_name: walkinDraft.first_name,
                        last_name: walkinDraft.last_name,
                        national_id: walkinDraft.national_id,
                        birth_date: walkinDraft.birth_date,
                        gender: walkinDraft.gender,
                        blood_type: walkinDraft.blood_type,
                        phone: walkinDraft.phone,
                        emergency_phone: walkinDraft.emergency_phone,
                        drug_allergy: walkinDraft.drug_allergy,
                        food_allergy: walkinDraft.food_allergy,
                    },
                    vitals: {
                        weight: walkinDraft.weight || null,
                        height: walkinDraft.height || null,
                        temperature: walkinDraft.temperature || null,
                        heart_rate: walkinDraft.heart_rate || null,
                        respiratory_rate: walkinDraft.respiratory_rate || null,
                        bp: walkinDraft.bp || null,
                        chief_complaint: walkinDraft.chief_complaint || null,
                    },
                }),
            });
            const data = await res.json().catch(() => null);

            if (!res.ok) throw new Error(data?.message || 'บันทึกคิว B ไม่สำเร็จ');

            await fetchQueuesToday();
            await fetchApprovedAppointments();
            setWalkinOpen(false);
            if (data?.ticket) {
                selectQueue(data.ticket);
            }

            Swal.fire({
                icon: 'success',
                title: 'บันทึกคิว B สำเร็จ',
                timer: 1200,
                showConfirmButton: false,
            });
        } catch (error) {
            Swal.fire({
                icon: 'error',
                title: 'บันทึกคิว B ไม่สำเร็จ',
                text: getErrorMessage(error, 'เกิดข้อผิดพลาด'),
                confirmButtonColor: '#0f766e',
            });
        } finally {
            setWalkinSaving(false);
        }
    };

    const customHolidaySet = useMemo(() => {
        return new Set(customHolidays);
    }, [customHolidays]);

    const selectQueue = (queue: QueueTicket) => {
        setSelectedAppointment(null);
        setSelectedQueue(queue);
        setPatientPanelOpen(true);
    };

    const selectAppointment = (appointment: ApprovedAppointment) => {
        setSelectedQueue(null);
        setSelectedAppointment(appointment);
        setPatientPanelOpen(true);
    };

    const getCalendarDateStatus = (dateKey: string) => {
        if (customHolidaySet.has(dateKey)) return 'closed';

        return slotStatusByDate.get(dateKey) || 'normal';
    };

    const openHolidayManager = async () => {
        const currentDate = selectedCalendarDate;
        const isClosed = customHolidaySet.has(currentDate);

        const currentDateLabel = `${dayjs(currentDate).locale('th').format('D MMMM')} ${dayjs(currentDate).year() + 543
            }`;

        if (!isClosed) {
            const result = await Swal.fire<{ holidayDate: string; reason: string }>({
                icon: 'info',
                title: 'จัดการวันหยุด',
                html: `
                    <div class="${styles.holidayForm}">
                        <label for="holiday-reason-select">หมายเหตุวันหยุด</label>
                        <select id="holiday-reason-select" class="${styles.holidayFormControl}">
                            <option value="วันหยุดของคลินิก">วันหยุดของคลินิก</option>
                            <option value="วันหยุดนักขัตฤกษ์">วันหยุดนักขัตฤกษ์</option>
                            <option value="ปิดปรับปรุงคลินิก">ปิดปรับปรุงคลินิก</option>
                            <option value="บุคลากรเข้าร่วมอบรม">บุคลากรเข้าร่วมอบรม</option>
                        </select>

                        <label for="holiday-date-input">เลือกวันที่สำหรับวันหยุด</label>
                        ${buildThaiDateSelectHtml('holiday-date', currentDate)}
                    </div>
                `,
                showCancelButton: true,
                confirmButtonText: 'เพิ่มวันหยุด',
                cancelButtonText: 'ยกเลิก',
                confirmButtonColor: '#dc2626',
                customClass: {
                    popup: styles.holidayModal,
                    title: styles.holidayModalTitle,
                    htmlContainer: styles.holidayModalContent,
                },
                preConfirm: () => {
                    const reasonSelect = document.getElementById('holiday-reason-select') as HTMLSelectElement | null;
                    const holidayDate = readThaiDateSelect('holiday-date');

                    if (!holidayDate) {
                        Swal.showValidationMessage('กรุณาเลือกวันที่สำหรับวันหยุด');
                        return false;
                    }

                    return {
                        holidayDate,
                        reason: reasonSelect?.value || 'วันหยุดของคลินิก',
                    };
                },
            });

            if (result.isConfirmed && result.value) {
                const { holidayDate, reason } = result.value;
                const response = await fetch(`${API}/calendar/holidays`, {
                    method: 'POST',
                    headers: jsonHeaders(),
                    body: JSON.stringify({
                        holiday_date: holidayDate,
                        reason,
                    }),
                });

                const data = await response.json().catch(() => null);
                if (!response.ok) {
                    Swal.fire({ icon: 'error', title: 'เพิ่มวันหยุดไม่สำเร็จ', text: data?.error });
                    return;
                }

                setCustomHolidays((prev) => prev.includes(holidayDate) ? prev : [...prev, holidayDate]);
                setSelectedCalendarDate(holidayDate);
                setCalendarMonth(dayjs(holidayDate).startOf('month'));

                Swal.fire({
                    icon: 'success',
                    title: 'เพิ่มวันหยุดแล้ว',
                    timer: 1200,
                    showConfirmButton: false,
                });
            }

            return;
        }

        const result = await Swal.fire({
            icon: 'info',
            title: 'จัดการวันหยุด',
            html: `วันที่ <b>${currentDateLabel}</b> ถูกตั้งเป็นวันหยุดอยู่แล้ว`,
            showDenyButton: true,
            showCancelButton: true,
            confirmButtonText: 'แก้ไขวันหยุด',
            denyButtonText: 'ยกเลิกวันหยุดนี้',
            cancelButtonText: 'ปิด',
            confirmButtonColor: '#2563eb',
            denyButtonColor: '#dc2626',
        });

        if (result.isDenied) {
            const confirmDelete = await Swal.fire({
                icon: 'warning',
                title: 'ยืนยันการยกเลิกวันหยุด',
                text: 'ต้องการเปิดรับจองวันนี้อีกครั้งใช่ไหม?',
                showCancelButton: true,
                confirmButtonText: 'ยืนยัน',
                cancelButtonText: 'ยกเลิก',
                confirmButtonColor: '#dc2626',
            });

            if (confirmDelete.isConfirmed) {
                const response = await fetch(`${API}/calendar/holidays/${currentDate}`, {
                    method: 'DELETE',
                    headers: authHeaders(),
                });
                const data = await response.json().catch(() => null);
                if (!response.ok) {
                    Swal.fire({ icon: 'error', title: 'ยกเลิกวันหยุดไม่สำเร็จ', text: data?.error });
                    return;
                }

                setCustomHolidays((prev) => prev.filter((date) => date !== currentDate));

                Swal.fire({
                    icon: 'success',
                    title: 'ยกเลิกวันหยุดแล้ว',
                    timer: 1200,
                    showConfirmButton: false,
                });
            }

            return;
        }

        if (result.isConfirmed) {
            const editResult = await Swal.fire({
                icon: 'info',
                title: 'แก้ไขวันหยุด',
                html: `
                <div style="display:flex; flex-direction:column; gap:10px; text-align:left;">
                    <label style="font-size:14px; font-weight:600;">
                        เลือกวันที่ใหม่สำหรับวันหยุด
                    </label>
                    ${buildThaiDateSelectHtml('holiday-edit-date', currentDate)}
                </div>
            `,
                showCancelButton: true,
                confirmButtonText: 'บันทึก',
                cancelButtonText: 'ยกเลิก',
                confirmButtonColor: '#2563eb',
                preConfirm: () => {
                    const newDate = readThaiDateSelect('holiday-edit-date');

                    if (!newDate) {
                        Swal.showValidationMessage('กรุณาเลือกวันที่');
                        return false;
                    }

                    return newDate;
                },
            });

            if (editResult.isConfirmed && editResult.value) {
                const newDate = editResult.value;

                const response = await fetch(`${API}/calendar/holidays/${currentDate}`, {
                    method: 'PUT',
                    headers: jsonHeaders(),
                    body: JSON.stringify({
                        holiday_date: newDate,
                        reason: 'วันหยุดของคลินิก',
                    }),
                });
                const data = await response.json().catch(() => null);
                if (!response.ok) {
                    Swal.fire({ icon: 'error', title: 'แก้ไขวันหยุดไม่สำเร็จ', text: data?.error });
                    return;
                }

                setCustomHolidays((prev) => {
                    const removedOldDate = prev.filter((date) => date !== currentDate);

                    if (removedOldDate.includes(newDate)) {
                        return removedOldDate;
                    }

                    return [...removedOldDate, newDate];
                });

                setSelectedCalendarDate(newDate);
                setCalendarMonth(dayjs(newDate).startOf('month'));

                Swal.fire({
                    icon: 'success',
                    title: 'แก้ไขวันหยุดแล้ว',
                    timer: 1200,
                    showConfirmButton: false,
                });
            }
        }
    };

    const morningQueues = useMemo(() => {
        return sortQueuesByType(queues.filter((q) => q.avaliable_date === 'morning' && (queueFilter === 'all' || q.prefix === queueFilter)));
    }, [queues, queueFilter]);

    const afternoonQueues = useMemo(() => {
        return sortQueuesByType(queues.filter((q) => q.avaliable_date === 'afternoon' && (queueFilter === 'all' || q.prefix === queueFilter)));
    }, [queues, queueFilter]);

    const calendarDays = useMemo(() => {
        const start = calendarMonth.startOf('month').startOf('week');
        return Array.from({ length: 42 }, (_, index) => start.add(index, 'day'));
    }, [calendarMonth]);

    const slotStatusByDate = useMemo(() => {
        const map = new Map<string, 'full' | 'available' | 'closed' | 'normal'>();

        calendarSlots.forEach((slot) => {
            const key = dayjs(slot.service_date).format('YYYY-MM-DD');
            const old = map.get(key);

            if (slot.status === 'closed' || slot.status === 'locked') {
                if (!old) map.set(key, 'closed');
                return;
            }

            if (slot.is_bookable || slot.status === 'open') {
                map.set(key, 'available');
            }
        });

        appointments.forEach((item) => {
            const key = dayjs(item.service_date).format('YYYY-MM-DD');
            if (!map.has(key)) map.set(key, 'full');
        });

        return map;
    }, [calendarSlots, appointments]);

    const fetchQueuesToday = async () => {
        try {
            const res = await fetch(`${API}/today`, {
                headers: authHeaders(),
            });

            if (!res.ok) {
                throw new Error('โหลดคิววันนี้ไม่สำเร็จ');
            }

            const data: QueueTicket[] = await res.json();
            setQueues(data);

            setSelectedQueue((prev) => {
                if (selectedAppointment) return null;
                if (prev && data.some((queue) => queue.queue_id === prev.queue_id)) return prev;
                return data[0] || null;
            });
        } catch (error) {
            console.error('fetchQueuesToday:', error);

            Swal.fire({
                icon: 'error',
                title: 'โหลดคิววันนี้ไม่สำเร็จ',
                text: 'ตรวจสอบ route /api/today และ token ของ admin',
            });
        }
    };

    const fetchPatientDetail = async (userId?: number | null) => {
        if (!userId) {
            setPatient(null);
            return;
        }

        try {
            const res = await fetch(`${API}/patients/${userId}`, {
                headers: authHeaders(),
            });

            if (!res.ok) {
                throw new Error('โหลดข้อมูลผู้ป่วยไม่สำเร็จ');
            }

            const data: PatientDetail = await res.json();
            setPatient(data);
        } catch (error) {
            console.error('fetchPatientDetail:', error);
            setPatient(null);
        }
    };

    const fetchLatestMeasurement = async (queueId?: number | null) => {
        if (!queueId) {
            setLatestMeasurement(null);
            return;
        }

        try {
            const res = await fetch(`${API}/measurements/queue/${queueId}`, {
                headers: authHeaders(),
            });

            if (!res.ok) {
                throw new Error('โหลดค่าน้ำหนัก/ส่วนสูงไม่สำเร็จ');
            }

            const data: Measurement[] = await res.json();

            if (data.length > 0) {
                setLatestMeasurement(data[0]);
            } else {
                setLatestMeasurement(null);
            }
        } catch (error) {
            console.error('fetchLatestMeasurement:', error);
            setLatestMeasurement(null);
        }
    };

    const fetchApprovedAppointments = async () => {
        try {
            const res = await fetch(`${API}/appointments`, {
                headers: authHeaders(),
                cache: 'no-store',
            });

            if (!res.ok) {
                throw new Error('โหลดตารางการจองไม่สำเร็จ');
            }

            const data: ApprovedAppointment[] = await res.json();
            setAppointments(data.filter((item) => item.status === 'approved'));
        } catch (error) {
            console.error('fetchApprovedAppointments:', error);
            setAppointments([]);
        }
    };

    const savePatientDraft = async (userId: number) => {
        if (!patientDraftDirty) return;

        const res = await fetch(`${API}/patients/${userId}`, {
            method: 'PUT',
            headers: jsonHeaders(),
            body: JSON.stringify({
                first_name: patientDraft.first_name.trim(),
                last_name: patientDraft.last_name.trim(),
                birth_date: patientDraft.birth_date || null,
                gender: patientDraft.gender.trim(),
                blood_type: patientDraft.blood_type.trim(),
                phone: patientDraft.phone.trim(),
            }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => null);
            throw new Error(err?.message || 'บันทึกข้อมูลผู้ป่วยไม่สำเร็จ');
        }

        setPatientDraftDirty(false);
        await fetchPatientDetail(userId);
    };

    const fetchCalendarMonth = async () => {
        try {
            const year = calendarMonth.year();
            const month = calendarMonth.month() + 1;

            const res = await fetch(`${API}/calendar/month?year=${year}&month=${month}`);

            if (!res.ok) {
                throw new Error('โหลดปฏิทินรายเดือนไม่สำเร็จ');
            }

            const data: CalendarSlot[] = await res.json();
            setCalendarSlots(data);

            const holidayRes = await fetch(`${API}/calendar/holidays?year=${year}&month=${month}`, {
                cache: 'no-store',
            });
            if (!holidayRes.ok) throw new Error('โหลดวันหยุดไม่สำเร็จ');
            const holidayData: Array<{ holiday_date: string }> = await holidayRes.json();
            setCustomHolidays(holidayData.map((item) => dayjs(item.holiday_date).format('YYYY-MM-DD')));
        } catch (error) {
            console.error('fetchCalendarMonth:', error);
            setCalendarSlots([]);
        }
    };

    const saveMedical = async () => {
        const selectedUserId = selectedQueue?.user_id ?? selectedAppointment?.user_id;
        const selectedVisitDate = selectedQueue?.service_date ?? selectedAppointment?.service_date ?? null;
        const measurementQueueId = selectedQueue?.queue_id ?? selectedAppointment?.queue_id ?? null;

        if (!selectedQueue && !selectedAppointment) {
            Swal.fire({
                icon: 'warning',
                title: 'กรุณาเลือกคิวก่อน',
            });
            return;
        }

        if (!selectedUserId) {
            Swal.fire({
                icon: 'warning',
                title: 'ไม่พบข้อมูลผู้ป่วย',
                text: 'คิวนี้อาจเป็น walk-in ที่ยังไม่ได้ผูกกับผู้ป่วย',
            });
            return;
        }

        try {
            await savePatientDraft(selectedUserId);

            let savedMeasurement = latestMeasurement;
            const hasVitalDraft = Object.values(vitalDraft).some((value) => value.trim());
            const parsedBp = parseBpValue(vitalDraft.bp);

            if (vitalDraft.bp.trim() && !parsedBp) {
                Swal.fire({
                    icon: 'warning',
                    title: 'รูปแบบ BP ไม่ถูกต้อง',
                    text: 'กรุณากรอกความดันเป็นรูปแบบ เช่น 120/80',
                    confirmButtonColor: '#0f766e',
                });
                return;
            }

            if (measurementQueueId && hasVitalDraft) {
                const measurementRes = await fetch(`${API}/measurements`, {
                    method: 'POST',
                    headers: jsonHeaders(),
                    body: JSON.stringify({
                        queue_id: measurementQueueId,
                        queue_number: selectedQueue?.queue_number ?? selectedAppointment?.queue_number ?? null,
                        service_date: selectedVisitDate,
                        weight: vitalDraft.bw || null,
                        height: vitalDraft.ht || null,
                        chief_complaint: vitalDraft.cc || null,
                        temperature: vitalDraft.tp || null,
                        heart_rate: vitalDraft.hr || null,
                        respiratory_rate: vitalDraft.rr || null,
                        systolic_bp: parsedBp?.systolic_bp ?? null,
                        diastolic_bp: parsedBp?.diastolic_bp ?? null,
                    }),
                });

                if (!measurementRes.ok) {
                    const err = await measurementRes.json().catch(() => null);
                    throw new Error(err?.message || 'บันทึกค่า CC/BW/HT/TP/HR/RR/BP ไม่สำเร็จ');
                }

                savedMeasurement = await measurementRes.json();
                setLatestMeasurement(savedMeasurement);
                setSyncedMeasurementId(savedMeasurement?.measurement_id ?? null);
            }

            Swal.fire({
                icon: 'success',
                title: 'บันทึกข้อมูลสำเร็จ',
                timer: 1300,
                showConfirmButton: false,
            });

            setSymptoms('');
            setVitalDraft(emptyVitalDraft);
            setVitalTouched(false);
            setSyncedMeasurementId(null);
            await Promise.all([fetchQueuesToday(), fetchApprovedAppointments()]);
        } catch (error: unknown) {
            Swal.fire({
                icon: 'error',
                title: 'บันทึกไม่สำเร็จ',
                text: getErrorMessage(error, 'เกิดข้อผิดพลาด'),
            });
        }
    };

    useEffect(() => {
        const init = async () => {
            setLoading(true);

            await Promise.all([
                fetchQueuesToday(),
                fetchApprovedAppointments(),
                fetchCalendarMonth(),
            ]);

            setLoading(false);
        };

        init();
    }, []);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setNow(dayjs());
        }, 60 * 1000);

        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!walkinOpen) return;

        const timer = window.setTimeout(() => {
            lookupWalkinPatientSilently();
        }, 650);

        return () => window.clearTimeout(timer);
    }, [walkinOpen, walkinDraft.national_id, walkinDraft.first_name, walkinDraft.last_name]);

    useEffect(() => {
        fetchApprovedAppointments();
        fetchCalendarMonth();
    }, [calendarMonth]);

    useEffect(() => {
        if (selectedQueue || selectedAppointment) {
            fetchPatientDetail(selectedQueue?.user_id ?? selectedAppointment?.user_id);

            const queueId = selectedQueue?.queue_id ?? selectedAppointment?.queue_id ?? null;
            if (queueId) {
                fetchLatestMeasurement(queueId);
            } else {
                setLatestMeasurement(null);
            }

            setSymptoms('');
            setVitalDraft(emptyVitalDraft);
            setVitalTouched(false);
            setSyncedMeasurementId(null);
        } else {
            setPatient(null);
            setLatestMeasurement(null);
            setSymptoms('');
            setVitalDraft(emptyVitalDraft);
            setVitalTouched(false);
            setPatientDraft(emptyPatientDraft);
            setPatientDraftDirty(false);
            setSyncedMeasurementId(null);
        }
    }, [selectedQueue, selectedAppointment]);

    useEffect(() => {
        if (!patient) {
            setPatientDraft(emptyPatientDraft);
            setPatientDraftDirty(false);
            return;
        }

        const birthDate = patient.dob || patient.birth_date || '';
        setPatientDraft({
            first_name: stringifyMeasurement(patient.first_name),
            last_name: stringifyMeasurement(patient.last_name),
            birth_date: birthDate && dayjs(birthDate).isValid() ? dayjs(birthDate).format('YYYY-MM-DD') : '',
            gender: stringifyMeasurement(patient.gender),
            blood_type: stringifyMeasurement(patient.blood_type),
            phone: stringifyMeasurement(patient.phone),
        });
        setPatientDraftDirty(false);
    }, [patient]);

    useEffect(() => {
        if (!latestMeasurement || latestMeasurement.measurement_id === syncedMeasurementId || vitalTouched) return;

        setVitalDraft({
            cc: stringifyMeasurement(latestMeasurement.chief_complaint),
            bw: stringifyMeasurement(latestMeasurement.weight),
            ht: stringifyMeasurement(latestMeasurement.height),
            tp: stringifyMeasurement(latestMeasurement.temperature),
            hr: stringifyMeasurement(latestMeasurement.heart_rate),
            rr: stringifyMeasurement(latestMeasurement.respiratory_rate),
            bp: formatBpValue(latestMeasurement.systolic_bp, latestMeasurement.diastolic_bp),
        });
        setSyncedMeasurementId(latestMeasurement.measurement_id);
    }, [latestMeasurement, syncedMeasurementId, vitalTouched]);

    useEffect(() => {
        if (!selectedQueue) return;

        const measurementTimer = window.setInterval(() => {
            fetchLatestMeasurement(selectedQueue.queue_id);
        }, 5000);

        return () => window.clearInterval(measurementTimer);
    }, [selectedQueue]);

    const selectedPatientName = `${patientDraft.first_name || ''} ${patientDraft.last_name || ''}`.trim();
    const liveBmiText = calcBmiText(vitalDraft.bw, vitalDraft.ht);
    const patientAgeText = calcAgeYearsText(patientDraft.birth_date);

    const selectedQueueMeta = selectedQueue
        ? selectedQueue.avaliable_date === 'morning'
            ? 'ช่วงเช้า'
            : 'ช่วงบ่าย'
        : '-';

    const selectedDisplayNumber = selectedQueue?.queue_number || selectedAppointment?.queue_number || (selectedAppointment ? getAppointmentTime(selectedAppointment) : '-');
    const selectedTimeText = selectedQueue ? getQueueTime(selectedQueue) : getAppointmentTime(selectedAppointment);
    const selectedSourceText = patient?.patient_code || selectedQueue?.source || selectedAppointment?.service_type || '-';
    const selectedSessionBadge = selectedAppointment && !selectedQueue
        ? selectedAppointment.hour_of_day < 12
            ? 'นัดหมายช่วงเช้า'
            : 'นัดหมายช่วงบ่าย'
        : selectedQueueMeta;

    const selectedCalendarAppointments = appointments.filter((item) =>
        dayjs(item.service_date).format('YYYY-MM-DD') === selectedCalendarDate
    );

    const selectedCalendarMorning = sortAppointmentsByRealQueue(
        selectedCalendarAppointments.filter((item) => item.hour_of_day < 12 && queueFilter !== 'B')
    );

    const selectedCalendarAfternoon = sortAppointmentsByRealQueue(
        selectedCalendarAppointments.filter((item) => item.hour_of_day >= 12 && queueFilter !== 'B')
    );

    const selectedDateIsToday = selectedCalendarDate === dayjs().format('YYYY-MM-DD');

    const visibleMorningQueues = selectedDateIsToday
        ? morningQueues
        : [];
    const visibleAfternoonQueues = selectedDateIsToday
        ? afternoonQueues
        : [];
    const visibleMorningAppointments = selectedCalendarMorning.filter(
        (item) => !visibleMorningQueues.some((queue) => queue.appointment_id === item.appointment_id)
    );
    const visibleAfternoonAppointments = selectedCalendarAfternoon.filter(
        (item) => !visibleAfternoonQueues.some((queue) => queue.appointment_id === item.appointment_id)
    );

    const visibleMorningCount = selectedDateIsToday
        ? visibleMorningQueues.length + visibleMorningAppointments.length
        : visibleMorningAppointments.length;

    const visibleAfternoonCount = selectedDateIsToday
        ? visibleAfternoonQueues.length + visibleAfternoonAppointments.length
        : visibleAfternoonAppointments.length;

    const todayQueueCount = visibleMorningCount + visibleAfternoonCount;
    let waitingQueues = 0;

    const statusText = (status?: string) => {
        if (!status) return 'รอดำเนินการ';

        if (status === 'waiting') return 'รอรับบริการ';
        if (status === 'called') return 'กำลังเข้ารับบริการ';
        if (status === 'served') return 'เข้ารับบริการเสร็จสิ้น';
        if (status === 'skipped') return 'ข้ามคิว';
        if (status === 'cancelled') return 'ยกเลิก';
        if (status === 'in_service') return 'กำลังเข้ารับบริการ';
        if (status === 'completed') return 'เข้ารับบริการเสร็จสิ้น';
        if (status === 'expired') return 'ยกเลิก';

        return status;
    };

    const getVisitStatus = (item: QueueTicket | ApprovedAppointment) => {
        if (item.has_medical_record) return 'completed';
        if (item.has_measurement) return 'in_service';

        const rawStatus = 'queue_status' in item ? item.queue_status || item.status : item.status;
        if (rawStatus === 'cancelled' || rawStatus === 'skipped') return rawStatus;
        if (rawStatus === 'served') return 'completed';
        if (rawStatus === 'called') return 'in_service';

        const serviceDate = dayjs(item.service_date).format('YYYY-MM-DD');
        const today = now.format('YYYY-MM-DD');
        const period = item.avaliable_date;
        const isPastPeriod =
            serviceDate < today ||
            (serviceDate === today &&
                ((period === 'morning' && now.hour() >= 11) ||
                    (period === 'afternoon' && now.hour() >= 20)));

        if (isPastPeriod) return 'expired';
        return 'waiting';
    };

    const statusBadgeClass = (status: string) => {
        if (status === 'completed') return `${styles.statusBadge} ${styles.statusCompleted}`;
        if (status === 'in_service') return `${styles.statusBadge} ${styles.statusInProgress}`;
        if (status === 'expired' || status === 'cancelled' || status === 'skipped') {
            return `${styles.statusBadge} ${styles.statusCancelled}`;
        }
        return `${styles.statusBadge} ${styles.statusWaiting}`;
    };

    waitingQueues =
        visibleMorningQueues.filter((queue) => getVisitStatus(queue) === 'waiting').length +
        visibleAfternoonQueues.filter((queue) => getVisitStatus(queue) === 'waiting').length +
        visibleMorningAppointments.filter((item) => getVisitStatus(item) === 'waiting').length +
        visibleAfternoonAppointments.filter((item) => getVisitStatus(item) === 'waiting').length;

    const appointmentName = (item: ApprovedAppointment) => {
        const name = `${item.first_name || ''} ${item.last_name || ''}`.trim();
        return name || 'ไม่ระบุชื่อผู้ป่วย';
    };

    const selectedDateLabel = `${dayjs(selectedCalendarDate).format('D MMMM')} ${dayjs(selectedCalendarDate).year() + 543}`;
    const selectedQueueDateTitle = selectedDateIsToday
        ? `คิววันนี้ — ${todayText}`
        : `คิววันที่เลือก — ${selectedDateLabel}`;

    // if (loading) {
    //     return <div className={styles.loaderWrapper}></div>;
    // }

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div className={styles.leftHeader}>
                    <div className={styles.pageTitleBox}>
                        <h1 className={styles.pageTitle}>หน้าหลัก</h1>
                        <p className={styles.pageDate}>
                            วันที่ {todayText} {buddhistYear}
                        </p>
                    </div>
                </div>

                <AdminHeaderActions />
            </header>

            {walkinOpen && (
                <div className={styles.walkinOverlay} onMouseDown={() => setWalkinOpen(false)}>
                    <div className={styles.walkinModal} onMouseDown={(event) => event.stopPropagation()}>
                        <div className={styles.walkinHeader}>
                            <div>
                                <p>Walk-in Queue</p>
                                <h2>บันทึกคิว B ผู้ป่วยมาถึงคลินิก</h2>
                            </div>
                            <button type="button" onClick={() => setWalkinOpen(false)}>×</button>
                        </div>

                        <div className={styles.walkinBody}>
                            <section className={styles.walkinSection}>
                            <div className={styles.walkinSectionTitle}>ข้อมูลคิว</div>
                            <div className={`${styles.walkinGrid} ${styles.walkinQueueGrid}`}>
                                <label>
                                    <span>วัน เดือน ปี</span>
                                    <ThaiDatePicker
                                        value={walkinDraft.service_date}
                                        onChange={(value) => setWalkinValue('service_date', value)}
                                        startYear={dayjs().year() - 1}
                                        endYear={dayjs().year() + 1}
                                    />
                                </label>
                                <label>
                                    <span>เวลาที่เข้ารับการรักษา</span>
                                    <div className={styles.walkinTimeSelects}>
                                        <select
                                            value={(walkinDraft.visit_time || '00:00').split(':')[0] || '00'}
                                            onChange={(event) => {
                                                const minute = (walkinDraft.visit_time || '00:00').split(':')[1] || '00';
                                                setWalkinValue('visit_time', `${event.target.value}:${minute}`);
                                            }}
                                            aria-label="ชั่วโมง"
                                        >
                                            {THAI_TIME_HOURS.map((hour) => (
                                                <option key={hour} value={hour}>{hour}</option>
                                            ))}
                                        </select>
                                        <span className={styles.walkinTimeSeparator}>:</span>
                                        <select
                                            value={(walkinDraft.visit_time || '00:00').split(':')[1] || '00'}
                                            onChange={(event) => {
                                                const hour = (walkinDraft.visit_time || '00:00').split(':')[0] || '00';
                                                setWalkinValue('visit_time', `${hour}:${event.target.value}`);
                                            }}
                                            aria-label="นาที"
                                        >
                                            {THAI_TIME_MINUTES.map((minute) => (
                                                <option key={minute} value={minute}>{minute}</option>
                                            ))}
                                        </select>
                                        <small>น.</small>
                                    </div>
                                </label>
                                <label>
                                    <span>คิวที่ใบเสร็จ</span>
                                    <input value={walkinDraft.receipt_queue} onChange={(event) => setWalkinValue('receipt_queue', event.target.value)} placeholder="เช่น R001" />
                                </label>
                                <button type="button" className={styles.walkinNowBtn} onClick={useCurrentWalkinDateTime}>
                                    ใช้วันเดือนปีและเวลาปัจจุบัน
                                </button>
                            </div>
                            </section>

                            <section className={styles.walkinSection}>
                            <div className={styles.walkinSectionTitle}>ข้อมูลผู้ป่วย</div>
                            <div className={styles.walkinGrid}>
                                <label>
                                    <span>เลขบัตรประชาชน</span>
                                    <input value={walkinDraft.national_id} onChange={(event) => setWalkinValue('national_id', event.target.value)} placeholder="13 หลัก" />
                                </label>
                                <label>
                                    <span>ชื่อ</span>
                                    <input value={walkinDraft.first_name} onChange={(event) => setWalkinValue('first_name', event.target.value)} />
                                </label>
                                <label>
                                    <span>นามสกุล</span>
                                    <input value={walkinDraft.last_name} onChange={(event) => setWalkinValue('last_name', event.target.value)} />
                                </label>
                                <div className={`${styles.walkinLookupHint} ${walkinLookupStatus === 'found'
                                    ? styles.walkinLookupFound
                                    : walkinLookupStatus === 'not_found'
                                        ? styles.walkinLookupMissing
                                        : ''
                                    }`}>
                                    {walkinLookupStatus === 'searching'
                                        ? 'กำลังค้นหาผู้ป่วยเดิม...'
                                        : walkinLookupStatus === 'found'
                                            ? 'พบข้อมูลผู้ป่วยเดิมและเติมข้อมูลให้อัตโนมัติ'
                                            : walkinLookupStatus === 'not_found'
                                                ? 'ยังไม่พบข้อมูลเดิม สามารถกรอกข้อมูลใหม่ต่อได้'
                                                : 'กรอกเลขบัตรประชาชน 13 หลัก หรือชื่อและนามสกุล ระบบจะค้นหาให้อัตโนมัติ'}
                                </div>
                                <label>
                                    <span>วันเดือนปีเกิด</span>
                                    <input type="date" value={walkinDraft.birth_date} onChange={(event) => setWalkinValue('birth_date', event.target.value)} />
                                </label>
                                <label>
                                    <span>อายุ</span>
                                    <input value={walkinDraft.age} readOnly placeholder="คำนวณอัตโนมัติ" />
                                </label>
                                <label>
                                    <span>เพศ</span>
                                    <select value={walkinDraft.gender} onChange={(event) => setWalkinValue('gender', event.target.value)}>
                                        <option value="">เลือก</option>
                                        <option value="ชาย">ชาย</option>
                                        <option value="หญิง">หญิง</option>
                                        <option value="อื่น ๆ">อื่น ๆ</option>
                                    </select>
                                </label>
                                <label>
                                    <span>กรุ๊ปเลือด</span>
                                    <select value={walkinDraft.blood_type} onChange={(event) => setWalkinValue('blood_type', event.target.value)}>
                                        <option value="">เลือก</option>
                                        {['A', 'B', 'AB', 'O'].map((blood) => <option key={blood} value={blood}>{blood}</option>)}
                                    </select>
                                </label>
                                <label>
                                    <span>เบอร์โทร</span>
                                    <input value={walkinDraft.phone} onChange={(event) => setWalkinValue('phone', event.target.value)} />
                                </label>
                                <label>
                                    <span>เบอร์โทรฉุกเฉิน</span>
                                    <input value={walkinDraft.emergency_phone} onChange={(event) => setWalkinValue('emergency_phone', event.target.value)} />
                                </label>
                                <label>
                                    <span>แพ้ยา</span>
                                    <input value={walkinDraft.drug_allergy} onChange={(event) => setWalkinValue('drug_allergy', event.target.value)} placeholder="ไม่มี" />
                                </label>
                                <label>
                                    <span>แพ้อาหาร</span>
                                    <input value={walkinDraft.food_allergy} onChange={(event) => setWalkinValue('food_allergy', event.target.value)} placeholder="ไม่มี" />
                                </label>
                            </div>
                            </section>

                            <section className={styles.walkinSection}>
                            <div className={styles.walkinSectionTitle}>Vital signs และ CC</div>
                            <div className={styles.walkinGrid}>
                                <label>
                                    <span>น้ำหนัก</span>
                                    <input value={walkinDraft.weight} onChange={(event) => setWalkinValue('weight', event.target.value)} placeholder="กก." />
                                </label>
                                <label>
                                    <span>ส่วนสูง</span>
                                    <input value={walkinDraft.height} onChange={(event) => setWalkinValue('height', event.target.value)} placeholder="ซม." />
                                </label>
                                <label>
                                    <span>BMI</span>
                                    <input value={walkinDraft.bmi} readOnly placeholder="คำนวณอัตโนมัติ" />
                                </label>
                                <label>
                                    <span>TP</span>
                                    <input value={walkinDraft.temperature} onChange={(event) => setWalkinValue('temperature', event.target.value)} placeholder="36.8" />
                                </label>
                                <label>
                                    <span>HR</span>
                                    <input value={walkinDraft.heart_rate} onChange={(event) => setWalkinValue('heart_rate', event.target.value)} placeholder="80" />
                                </label>
                                <label>
                                    <span>RR</span>
                                    <input value={walkinDraft.respiratory_rate} onChange={(event) => setWalkinValue('respiratory_rate', event.target.value)} placeholder="18" />
                                </label>
                                <label>
                                    <span>BP</span>
                                    <input value={walkinDraft.bp} onChange={(event) => setWalkinValue('bp', event.target.value)} placeholder="120/80" />
                                </label>
                                <label className={styles.walkinWideField}>
                                    <span>CC</span>
                                    <textarea value={walkinDraft.chief_complaint} onChange={(event) => setWalkinValue('chief_complaint', event.target.value)} placeholder="อาการสำคัญ" />
                                </label>
                            </div>
                            </section>
                        </div>

                        <div className={styles.walkinFooter}>
                            <button type="button" className={styles.walkinGhostBtn} onClick={() => setWalkinOpen(false)}>ยกเลิก</button>
                            <button type="button" className={styles.walkinSaveBtn} onClick={saveWalkinQueue} disabled={walkinSaving}>
                                {walkinSaving ? 'กำลังบันทึก...' : 'บันทึกคิว B'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className={styles.wrapper}>
                <Sidebar />

                <main className={styles.main}>
                    <div className={styles.dashboardShell}>
                        <section className={styles.summaryGrid}>
                            <article className={`${styles.summaryCard} ${styles.summaryBlue}`}>
                                <h1>ผู้ป่วยวันนี้</h1>
                                <strong>{todayQueueCount} คน</strong>
                            </article>

                            <article className={`${styles.summaryCard} ${styles.summaryAmber}`}>
                                <h1>คิวเช้า</h1>
                                <strong>{visibleMorningCount} คน</strong>
                            </article>

                            <article className={`${styles.summaryCard} ${styles.summaryOrange}`}>
                                <h1>คิวบ่าย</h1>
                                <strong>{visibleAfternoonCount} คน</strong>
                            </article>

                            <article className={`${styles.summaryCard} ${styles.summaryViolet}`}>
                                <h1>รอรับบริการ</h1>
                                <strong>{waitingQueues} คน</strong>
                            </article>
                        </section>

                        <section className={styles.todaySection}>
                            <div className={styles.sectionTitleRow}>
                                <span className={styles.sectionIcon}>📅</span>
                                <div>
                                    <p className={styles.sectionEyebrow}>Today Queue</p>
                                    <h2>{selectedQueueDateTitle}</h2>
                                </div>
                            </div>

                            <div className={styles.queueTypeLegend}>
                                <button
                                    type="button"
                                    className={queueFilter === 'all' ? styles.queueFilterActive : ''}
                                    onClick={() => setQueueFilter('all')}
                                >
                                    ทั้งหมด
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.onlineQueueLegend} ${queueFilter === 'A' ? styles.queueFilterActive : ''}`}
                                    onClick={() => setQueueFilter('A')}
                                >
                                    <b>A</b> จองออนไลน์
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.walkinQueueLegend} ${queueFilter === 'B' ? styles.queueFilterActive : ''}`}
                                    onClick={() => setQueueFilter('B')}
                                >
                                    <b>B</b> ผู้ป่วยมาถึงคลินิก
                                </button>
                                <button type="button" className={styles.addWalkinBtn} onClick={openWalkinForm}>
                                    เพิ่มคิว B
                                </button>
                            </div>

                            <div className={styles.queueCardsGrid}>
                                <article className={styles.queueCard}>
                                    <div className={`${styles.queueCardHeader} ${styles.morningHeader}`}>
                                        <h3>ช่วงเช้า (07:00 – 11:00)</h3>
                                        <strong>{visibleMorningCount} คน</strong>
                                    </div>

                                    <div className={styles.queueCardBody}>
                                        {selectedDateIsToday && visibleMorningQueues.length > 0 ? (
                                            visibleMorningQueues.map((queue, index) => (
                                                <button
                                                    key={queue.queue_id}
                                                    type="button"
                                                    className={`${styles.queueItem} ${selectedQueue?.queue_id === queue.queue_id ? styles.queueItemActive : ''}`}
                                                    onClick={() => selectQueue(queue)}
                                                >
                                                    <span className={styles.queueNo}>{index + 1}</span>

                                                    <span className={styles.queueText}>
                                                        <strong>{queue.queue_number}</strong>
                                                        <small>{getQueueTypeLabel(queue.prefix)} • {queue.service_type || 'ตรวจทั่วไป'} • {getQueueTime(queue)}</small>
                                                    </span>

                                                    <span className={statusBadgeClass(getVisitStatus(queue))}>{statusText(getVisitStatus(queue))}</span>
                                                    <span className={styles.eyeMark}>ดู</span>
                                                </button>
                                            ))
                                        ) : visibleMorningAppointments.length > 0 ? (
                                            visibleMorningAppointments.map((item, index) => (
                                                <button
                                                    key={item.appointment_id}
                                                    type="button"
                                                    className={`${styles.queueItem} ${selectedAppointment?.appointment_id === item.appointment_id ? styles.queueItemActive : ''}`}
                                                    onClick={() => selectAppointment(item)}
                                                >
                                                    <span className={styles.queueNo}>{getAppointmentOrderLabel(item, index)}</span>

                                                    <span className={styles.queueText}>
                                                        <strong>{getAppointmentQueueLabel(item)}</strong>
                                                        <small>{appointmentName(item)} • {getAppointmentTime(item)}</small>
                                                    </span>

                                                    <span className={statusBadgeClass(getVisitStatus(item))}>{statusText(getVisitStatus(item))}</span>
                                                    <span className={styles.eyeMark}>ดู</span>
                                                </button>
                                            ))
                                        ) : (
                                            <div className={styles.emptyQueue}>
                                                <span>📭</span>
                                                <p>ไม่มีคิวในช่วงเช้า</p>
                                            </div>
                                        )}
                                    </div>
                                </article>

                                <article className={styles.queueCard}>
                                    <div className={`${styles.queueCardHeader} ${styles.afternoonHeader}`}>
                                        <h3>ช่วงบ่าย (16:00 – 20:00)</h3>
                                        <strong>{visibleAfternoonCount} คน</strong>
                                    </div>

                                    <div className={styles.queueCardBody}>
                                        {selectedDateIsToday && visibleAfternoonQueues.length > 0 ? (
                                            visibleAfternoonQueues.map((queue, index) => (
                                                <button
                                                    key={queue.queue_id}
                                                    type="button"
                                                    className={`${styles.queueItem} ${selectedQueue?.queue_id === queue.queue_id ? styles.queueItemActive : ''}`}
                                                    onClick={() => selectQueue(queue)}
                                                >
                                                    <span className={styles.queueNo}>{index + 1}</span>

                                                    <span className={styles.queueText}>
                                                        <strong>{queue.queue_number}</strong>
                                                        <small>{getQueueTypeLabel(queue.prefix)} • {queue.service_type || 'ตรวจทั่วไป'} • {getQueueTime(queue)}</small>
                                                    </span>

                                                    <span className={statusBadgeClass(getVisitStatus(queue))}>{statusText(getVisitStatus(queue))}</span>
                                                    <span className={styles.eyeMark}>ดู</span>
                                                </button>
                                            ))
                                        ) : visibleAfternoonAppointments.length > 0 ? (
                                            visibleAfternoonAppointments.map((item, index) => (
                                                <button
                                                    key={item.appointment_id}
                                                    type="button"
                                                    className={`${styles.queueItem} ${selectedAppointment?.appointment_id === item.appointment_id ? styles.queueItemActive : ''}`}
                                                    onClick={() => selectAppointment(item)}
                                                >
                                                    <span className={styles.queueNo}>{getAppointmentOrderLabel(item, index)}</span>

                                                    <span className={styles.queueText}>
                                                        <strong>{getAppointmentQueueLabel(item)}</strong>
                                                        <small>{appointmentName(item)} • {getAppointmentTime(item)}</small>
                                                    </span>

                                                    <span className={statusBadgeClass(getVisitStatus(item))}>{statusText(getVisitStatus(item))}</span>
                                                    <span className={styles.eyeMark}>ดู</span>
                                                </button>
                                            ))
                                        ) : (
                                            <div className={styles.emptyQueue}>
                                                <span>📭</span>
                                                <p>ไม่มีคิวในช่วงบ่าย</p>
                                            </div>
                                        )}
                                    </div>
                                </article>
                            </div>
                        </section>

                        <section className={styles.contentGrid}>
                            {patientPanelOpen && (
                            <>
                            <button
                                type="button"
                                className={styles.patientModalBackdrop}
                                aria-label="ปิดข้อมูลคิวที่เลือก"
                                onClick={() => setPatientPanelOpen(false)}
                            />
                            <article className={styles.patientCard}>
                                <div className={styles.patientTop}>
                                    <div>
                                        <p className={styles.cardEyebrow}>Selected Patient</p>
                                        <h2>ข้อมูลคิวที่เลือก</h2>
                                    </div>
                                    <span className={styles.panelToggleRight}>
                                        <span className={styles.sessionBadge}>{selectedSessionBadge}</span>
                                        <button
                                            type="button"
                                            className={styles.closePatientBtn}
                                            aria-label="ปิดข้อมูลคิวที่เลือก"
                                            onClick={() => setPatientPanelOpen(false)}
                                        >
                                            ปิด
                                        </button>
                                    </span>
                                </div>

                                <div className={styles.panelBody}>
                                    <div className={styles.panelBodyInner}>
                                <div className={styles.bigQueue}>{selectedDisplayNumber}</div>
                                <p className={styles.timeText}>{selectedTimeText}</p>

                                <div className={styles.whiteLine}></div>

                                <div className={styles.patientProfile}>
                                    <div className={styles.patientAvatar}>
                                        {(patientDraft.first_name || selectedDisplayNumber || '-').charAt(0)}
                                    </div>

                                    <div className={styles.patientProfileText}>
                                        <h3>{selectedPatientName || 'ยังไม่ได้เลือกผู้ป่วย'}</h3>
                                        <p>รหัสผู้ป่วย {selectedSourceText}</p>
                                    </div>
                                </div>

                                <div className={styles.patientInfoGrid}>
                                    <div>
                                        <span>ชื่อ</span>
                                        <input
                                            className={styles.vitalInput}
                                            type="text"
                                            value={patientDraft.first_name}
                                            onChange={(event) => setPatientValue('first_name', event.target.value)}
                                        />
                                    </div>

                                    <div>
                                        <span>นามสกุล</span>
                                        <input
                                            className={styles.vitalInput}
                                            type="text"
                                            value={patientDraft.last_name}
                                            onChange={(event) => setPatientValue('last_name', event.target.value)}
                                        />
                                    </div>

                                    <div>
                                        <span>วันเดือนปีเกิด</span>
                                        <ThaiDatePicker
                                            value={patientDraft.birth_date}
                                            max={dayjs().format('YYYY-MM-DD')}
                                            endYear={dayjs().year()}
                                            onChange={(value) => setPatientValue('birth_date', value)}
                                        />
                                    </div>

                                    <div>
                                        <span>อายุ</span>
                                        <strong>{patientAgeText}</strong>
                                    </div>

                                    <div>
                                        <span>เพศ</span>
                                        <input
                                            className={styles.vitalInput}
                                            type="text"
                                            value={patientDraft.gender}
                                            onChange={(event) => setPatientValue('gender', event.target.value)}
                                        />
                                    </div>

                                    <div>
                                        <span>กรุ๊ปเลือด</span>
                                        <input
                                            className={styles.vitalInput}
                                            type="text"
                                            value={patientDraft.blood_type}
                                            onChange={(event) => setPatientValue('blood_type', event.target.value)}
                                        />
                                    </div>

                                    <div>
                                        <span>เบอร์ติดต่อ</span>
                                        <input
                                            className={styles.vitalInput}
                                            type="text"
                                            value={patientDraft.phone}
                                            onChange={(event) => setPatientValue('phone', event.target.value)}
                                        />
                                    </div>

                                    <div>
                                        <span>BW น้ำหนัก</span>
                                        <input
                                            className={styles.vitalInput}
                                            type="text"
                                            value={vitalDraft.bw}
                                            onChange={(event) => setVitalValue('bw', event.target.value)}
                                            placeholder="กก."
                                        />
                                    </div>

                                    <div>
                                        <span>HT ส่วนสูง</span>
                                        <input
                                            className={styles.vitalInput}
                                            type="text"
                                            value={vitalDraft.ht}
                                            onChange={(event) => setVitalValue('ht', event.target.value)}
                                            placeholder="ซม."
                                        />
                                    </div>

                                    <div>
                                        <span>BMI</span>
                                        <strong>{liveBmiText || formatMeasurement(latestMeasurement?.bmi)}</strong>
                                    </div>

                                    <div>
                                        <span>TP อุณหภูมิ</span>
                                        <input
                                            className={styles.vitalInput}
                                            type="text"
                                            value={vitalDraft.tp}
                                            onChange={(event) => setVitalValue('tp', event.target.value)}
                                            placeholder="°C"
                                        />
                                    </div>

                                    <div>
                                        <span>HR ชีพจร</span>
                                        <input
                                            className={styles.vitalInput}
                                            type="text"
                                            value={vitalDraft.hr}
                                            onChange={(event) => setVitalValue('hr', event.target.value)}
                                            placeholder="ครั้ง/นาที"
                                        />
                                    </div>

                                    <div>
                                        <span>RR หายใจ</span>
                                        <input
                                            className={styles.vitalInput}
                                            type="text"
                                            value={vitalDraft.rr}
                                            onChange={(event) => setVitalValue('rr', event.target.value)}
                                            placeholder="ครั้ง/นาที"
                                        />
                                    </div>

                                    <div>
                                        <span>BP ความดัน</span>
                                        <input
                                            className={styles.vitalInput}
                                            type="text"
                                            value={vitalDraft.bp}
                                            onChange={(event) => setVitalValue('bp', event.target.value)}
                                            placeholder="120/80"
                                        />
                                    </div>
                                </div>

                                <label className={styles.symptomLabel}>CC อาการสำคัญ</label>

                                <textarea
                                    className={styles.symptomBox}
                                    value={vitalDraft.cc}
                                    onChange={(event) => setVitalValue('cc', event.target.value)}
                                    placeholder="บันทึก CC หรืออาการสำคัญที่ผู้ป่วยมาพบแพทย์"
                                />

                                {selectedQueue?.prefix === 'A' && (
                                    <p className={`${styles.measurementSync} ${latestMeasurement ? styles.measurementSynced : ''}`}>
                                        {latestMeasurement
                                            ? `รับข้อมูลจากเครื่องชั่งอัตโนมัติแล้ว · ${dayjs(latestMeasurement.created_at).format('HH:mm น.')}`
                                            : 'กำลังรอผู้ป่วยยืนยันรหัสและชั่งน้ำหนัก ระบบจะอัปเดตข้อมูลอัตโนมัติ'}
                                    </p>
                                )}

                                <div className={styles.buttonRow}>
                                    <button
                                        type="button"
                                        className={styles.greenBtn}
                                        onClick={saveMedical}
                                        disabled={!selectedQueue && !selectedAppointment}
                                    >
                                        บันทึก
                                    </button>
                                </div>
                                    </div>
                                </div>
                            </article>
                            </>
                            )}

                            <article className={styles.calendarCard}>
                                <div className={styles.calendarHeader}>
                                    <div className={styles.sectionTitleRow}>
                                        <span className={styles.sectionIcon}>📆</span>
                                        <div>
                                            <p className={styles.sectionEyebrow}>Booking Calendar</p>
                                            <h2>ปฏิทินการจองประจำเดือน</h2>
                                        </div>
                                    </div>
                                </div>

                                <div className={styles.panelBody}>
                                    <div className={styles.panelBodyInner}>
                                <div className={styles.calendarControl}>
                                    <h3>
                                        {calendarMonth.locale('th').format('MMMM')} {calendarMonth.year() + 543}
                                    </h3>

                                    <div className={styles.calendarActions}>
                                        <button
                                            type="button"
                                            className={styles.holidayBtn}
                                            onClick={openHolidayManager}
                                        >
                                            + จัดการวันหยุด
                                        </button>

                                        <div className={styles.calendarButtons}>
                                            <button
                                                type="button"
                                                aria-label="เดือนก่อนหน้า"
                                                onClick={() => {
                                                    const nextMonth = calendarMonth.subtract(1, 'month');
                                                    setCalendarMonth(nextMonth);
                                                    setSelectedCalendarDate(nextMonth.startOf('month').format('YYYY-MM-DD'));
                                                }}
                                            >
                                                ‹
                                            </button>

                                            <button
                                                type="button"
                                                aria-label="เดือนถัดไป"
                                                onClick={() => {
                                                    const nextMonth = calendarMonth.add(1, 'month');
                                                    setCalendarMonth(nextMonth);
                                                    setSelectedCalendarDate(nextMonth.startOf('month').format('YYYY-MM-DD'));
                                                }}
                                            >
                                                ›
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className={styles.monthGrid}>
                                    {['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map((day) => (
                                        <span key={day} className={styles.weekdayLabel}>
                                            {day}
                                        </span>
                                    ))}

                                    {calendarDays.map((day) => {
                                        const key = day.format('YYYY-MM-DD');
                                        const status = getCalendarDateStatus(key);
                                        const isThisMonth = day.month() === calendarMonth.month();
                                        const isToday = day.isSame(dayjs(), 'day');
                                        const isSelected = key === selectedCalendarDate;
                                        const count = appointments.filter((item) =>
                                            dayjs(item.service_date).format('YYYY-MM-DD') === key
                                        ).length;

                                        return (
                                            <button
                                                type="button"
                                                key={key}
                                                onClick={() => {
                                                    setSelectedCalendarDate(key);

                                                    if (!day.isSame(calendarMonth, 'month')) {
                                                        setCalendarMonth(day.startOf('month'));
                                                    }
                                                }}
                                                className={`${styles.dayButton} ${!isThisMonth ? styles.dayMuted : ''} ${isSelected ? styles.daySelected : ''} ${isToday ? styles.dayToday : ''} ${status === 'available' ? styles.dayAvailable : ''} ${status === 'closed' ? styles.dayClosed : ''} ${status === 'full' ? styles.dayFull : ''}`}
                                            >
                                                <span className={styles.dayName}>{day.locale('th').format('dd')}</span>
                                                <strong>{day.date()}</strong>

                                                {status === 'closed' ? (
                                                    <small>ปิด</small>
                                                ) : count > 0 ? (
                                                    <small>{count} คิว</small>
                                                ) : status === 'available' ? (
                                                    <small>ว่าง</small>
                                                ) : (
                                                    <small>&nbsp;</small>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className={styles.calendarLegend}>
                                    <span><i className={styles.legendToday}></i>วันนี้</span>
                                    <span><i className={styles.legendAvailable}></i>ว่าง</span>
                                    <span><i className={styles.legendFull}></i>มีจอง</span>
                                    <span><i className={styles.legendClosed}></i>ปิด/ล็อก</span>
                                </div>
                                    </div>
                                </div>
                            </article>
                        </section>
                    </div>
                </main>
            </div>
        </div>
    );
}
