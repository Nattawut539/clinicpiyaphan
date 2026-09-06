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
import { CalendarCheck, Eye, EyeOff, ListFilter, Search, UserPlus, Users } from 'lucide-react';


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
    hour_of_day?: number | null;
    has_measurement?: boolean;
    has_medical_record?: boolean;
    access_code?: string | null;
    access_code_expires_at?: string | null;
    access_code_used_at?: string | null;
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
    queue_id?: number | null;
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

type PendingHardwarePrint = {
    message_id: string;
    device_id: string;
    mode: 'online' | 'walk_in';
    measurement_id: number;
    queue_number: string;
    weight: number;
    height: number;
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
    drug_allergy: string;
    food_allergy: string;
    congenital_disease: string;
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
    drug_allergy: '',
    food_allergy: '',
    congenital_disease: '',
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
    access_code?: string | null;
    access_code_expires_at?: string | null;
    access_code_used_at?: string | null;
};

type CalendarSlot = {
    service_date: string;
    avaliable_date: 'morning' | 'afternoon';
    hour_of_day: number;
    status: 'open' | 'locked' | 'closed';
    is_empty?: boolean;
    is_bookable?: boolean;
};

type AdvanceBookingWeek = {
    week_start: string;
    week_end: string;
    created_at?: string;
};

type CheckinAppointment = {
    appointment_id: number;
    status: string;
    service_type: string;
    service_date: string;
    hour_of_day: number;
    first_name: string;
    last_name: string;
    masked_email?: string | null;
    queue_number?: string | null;
    has_measurement?: boolean;
    checked_in_at?: string | null;
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

    if (
        queue.prefix === 'A' &&
        queue.hour_of_day !== null &&
        queue.hour_of_day !== undefined &&
        Number.isFinite(Number(queue.hour_of_day))
    ) {
        return `${String(queue.hour_of_day).padStart(2, '0')}:00 น.`;
    }

    if (queue.prefix === 'B' && queue.created_at && dayjs(queue.created_at).isValid()) {
        return `${dayjs(queue.created_at).format('HH:mm')} น.`;
    }

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
    const [checkinOpen, setCheckinOpen] = useState(false);
    const [checkinSearching, setCheckinSearching] = useState(false);
    const [checkinSavingId, setCheckinSavingId] = useState<number | null>(null);
    const [checkinIdentity, setCheckinIdentity] = useState({ national_id: '', phone: '' });
    const [checkinResults, setCheckinResults] = useState<CheckinAppointment[]>([]);
    const lastWalkinLookupKey = useRef('');
    const patientSelectionVersion = useRef(0);
    const selectedUserIdRef = useRef<number | null>(null);
    const selectedQueueIdRef = useRef<number | null>(null);
    const hardwarePrintsInFlight = useRef<Set<string>>(new Set());

    const [, setSymptoms] = useState('');
    const [vitalDraft, setVitalDraft] = useState<VitalDraft>(emptyVitalDraft);
    const [vitalTouched, setVitalTouched] = useState(false);
    const [patientDraft, setPatientDraft] = useState<PatientDraft>(emptyPatientDraft);
    const [patientDraftDirty, setPatientDraftDirty] = useState(false);
    const [medicalSaving, setMedicalSaving] = useState(false);
    const [visibleAccessCodeKeys, setVisibleAccessCodeKeys] = useState<Set<string>>(() => new Set());
    const [customHolidays, setCustomHolidays] = useState<string[]>([]);
    const [calendarMenuOpen, setCalendarMenuOpen] = useState(false);
    const [queueMenuOpen, setQueueMenuOpen] = useState(false);
    const [advanceBookingOpen, setAdvanceBookingOpen] = useState(false);
    const [advanceBookingLoading, setAdvanceBookingLoading] = useState(false);
    const [advanceBookingSaving, setAdvanceBookingSaving] = useState(false);
    const [advanceBookingWeeks, setAdvanceBookingWeeks] = useState<AdvanceBookingWeek[]>([]);
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

    const searchAppointmentCheckin = async () => {
        const nationalId = checkinIdentity.national_id.replace(/\D/g, '');
        const phone = checkinIdentity.phone.replace(/\D/g, '');
        if (nationalId.length !== 13 || phone.length < 9 || phone.length > 10) {
            await Swal.fire({ icon: 'warning', title: 'ข้อมูลไม่ครบ', text: 'กรอกเลขบัตรประชาชน 13 หลัก และเบอร์โทรศัพท์ 9-10 หลัก' });
            return;
        }
        try {
            setCheckinSearching(true);
            const params = new URLSearchParams({
                national_id: nationalId,
                phone,
            });
            const response = await fetch(`${API}/appointments/check-in/search?${params}`, { headers: authHeaders(), cache: 'no-store' });
            const data = await response.json().catch(() => null);
            if (!response.ok) throw new Error(data?.message || 'ค้นหานัดหมายไม่สำเร็จ');
            setCheckinResults(Array.isArray(data) ? data : []);
        } catch (searchError) {
            await Swal.fire({ icon: 'error', title: 'ค้นหาไม่สำเร็จ', text: searchError instanceof Error ? searchError.message : 'กรุณาลองใหม่' });
        } finally {
            setCheckinSearching(false);
        }
    };

    const confirmAppointmentCheckin = async (appointment: CheckinAppointment) => {
        const confirmed = await Swal.fire({
            icon: 'question',
                title: 'ยืนยันเลขบัตรประชาชนและเบอร์โทรแล้ว?',
            text: `${appointment.first_name} ${appointment.last_name} · ${appointment.service_type}`,
            showCancelButton: true,
            confirmButtonText: 'ยืนยันและออกรหัส',
            cancelButtonText: 'ยกเลิก',
        });
        if (!confirmed.isConfirmed) return;
        try {
            setCheckinSavingId(appointment.appointment_id);
            const response = await fetch(`${API}/appointments/${appointment.appointment_id}/check-in`, {
                method: 'POST',
                headers: jsonHeaders(),
                body: JSON.stringify({ ...checkinIdentity, verification_note: 'ตรวจเลขบัตรประชาชนและเบอร์โทรศัพท์ที่จุดบริการ' }),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) throw new Error(data?.message || 'Check-in ไม่สำเร็จ');
            await Swal.fire({
                icon: 'success',
                title: 'Check-in สำเร็จ',
                html: `<p>หมายเลขคิว <b>${data.queue_number}</b></p><p>รหัสเครื่องชั่ง</p><div style="font-size:32px;font-weight:800;letter-spacing:6px">${data.access_code}</div><p>หมดอายุ ${dayjs(data.expires_at).format('HH:mm น.')}</p>`,
                confirmButtonText: 'ปิด',
            });
            await searchAppointmentCheckin();
            await fetchQueuesToday();
        } catch (checkinError) {
            await Swal.fire({ icon: 'error', title: 'Check-in ไม่สำเร็จ', text: checkinError instanceof Error ? checkinError.message : 'กรุณาลองใหม่' });
        } finally {
            setCheckinSavingId(null);
        }
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
                    service_type: 'Walk-in',
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

            if (!res.ok) throw new Error(data?.message || data?.error || 'บันทึกคิว B ไม่สำเร็จ');

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

    const advanceWeekRange = useMemo(() => {
        const today = now.startOf('day');
        const isoDay = today.day() === 0 ? 7 : today.day();
        const weekStart = today.add(8 - isoDay, 'day');
        const monthEnd = today.endOf('month').startOf('day');

        if (!weekStart.isSame(today, 'month')) return null;

        const fullWeekEnd = weekStart.add(6, 'day');
        const weekEnd = fullWeekEnd.isAfter(monthEnd) ? monthEnd : fullWeekEnd;
        return {
            start: weekStart.format('YYYY-MM-DD'),
            end: weekEnd.format('YYYY-MM-DD'),
        };
    }, [now]);

    const isAdvanceWeekOpen = Boolean(
        advanceWeekRange && advanceBookingWeeks.some((week) => week.week_start === advanceWeekRange.start)
    );

    const openAdvanceBookingManager = async () => {
        setCalendarMenuOpen(false);
        setAdvanceBookingOpen(true);
        setAdvanceBookingLoading(true);
        try {
            const response = await fetch(`${API}/calendar/advance-booking-weeks`, {
                headers: authHeaders(),
                cache: 'no-store',
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) throw new Error(data?.error || 'โหลดข้อมูลการเปิดจองล่วงหน้าไม่สำเร็จ');
            setAdvanceBookingWeeks(Array.isArray(data) ? data : []);
        } catch (error) {
            setAdvanceBookingOpen(false);
            Swal.fire({
                icon: 'error',
                title: 'โหลดข้อมูลไม่สำเร็จ',
                text: getErrorMessage(error, 'เกิดข้อผิดพลาด'),
                confirmButtonColor: '#167d8d',
            });
        } finally {
            setAdvanceBookingLoading(false);
        }
    };

    const confirmAdvanceBooking = async () => {
        if (!advanceWeekRange || isAdvanceWeekOpen) return;

        setAdvanceBookingSaving(true);
        try {
            const response = await fetch(`${API}/calendar/advance-booking-weeks`, {
                method: 'POST',
                headers: jsonHeaders(),
                body: JSON.stringify({ week_start: advanceWeekRange.start }),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) throw new Error(data?.error || 'เปิดจองล่วงหน้าไม่สำเร็จ');

            setAdvanceBookingWeeks((current) => [...current, data]);
            await fetchCalendarMonth();
            setAdvanceBookingOpen(false);
            Swal.fire({
                icon: 'success',
                title: 'เปิดจองล่วงหน้าแล้ว',
                text: `ผู้ใช้สามารถจองวันที่ ${dayjs(data.week_start).locale('th').format('D MMMM')} - ${dayjs(data.week_end).locale('th').format('D MMMM')} ได้แล้ว`,
                timer: 1800,
                showConfirmButton: false,
            });
        } catch (error) {
            Swal.fire({
                icon: 'error',
                title: 'เปิดจองล่วงหน้าไม่สำเร็จ',
                text: getErrorMessage(error, 'เกิดข้อผิดพลาด'),
                confirmButtonColor: '#167d8d',
            });
        } finally {
            setAdvanceBookingSaving(false);
        }
    };

    const cancelAdvanceBooking = async () => {
        if (!advanceWeekRange || !isAdvanceWeekOpen) return;

        const confirmation = await Swal.fire({
            icon: 'warning',
            title: 'ยกเลิกการเปิดจองล่วงหน้า?',
            text: 'หลังยืนยัน ผู้ใช้จะไม่สามารถเลือกจองสัปดาห์นี้ได้',
            showCancelButton: true,
            confirmButtonText: 'ยืนยันการยกเลิก',
            cancelButtonText: 'กลับไปตรวจสอบ',
            confirmButtonColor: '#dc5a64',
            cancelButtonColor: '#78939b',
            reverseButtons: true,
            customClass: {
                container: styles.advanceBookingConfirmLayer,
            },
        });
        if (!confirmation.isConfirmed) return;

        setAdvanceBookingSaving(true);
        try {
            const response = await fetch(
                `${API}/calendar/advance-booking-weeks/${advanceWeekRange.start}`,
                { method: 'DELETE', headers: authHeaders() },
            );
            const data = await response.json().catch(() => null);
            if (!response.ok) throw new Error(data?.error || 'ยกเลิกการเปิดจองล่วงหน้าไม่สำเร็จ');

            setAdvanceBookingWeeks((current) =>
                current.filter((week) => week.week_start !== advanceWeekRange.start)
            );
            setAdvanceBookingOpen(false);
            Swal.fire({
                icon: 'success',
                title: 'ยกเลิกการเปิดจองแล้ว',
                text: 'ช่วงวันที่ดังกล่าวกลับสู่สถานะยังไม่เปิดจองล่วงหน้า',
                timer: 1700,
                showConfirmButton: false,
            });
        } catch (error) {
            Swal.fire({
                icon: 'error',
                title: 'ไม่สามารถยกเลิกได้',
                text: getErrorMessage(error, 'เกิดข้อผิดพลาด'),
                confirmButtonColor: '#167d8d',
                customClass: {
                    container: styles.advanceBookingConfirmLayer,
                },
            });
        } finally {
            setAdvanceBookingSaving(false);
        }
    };

    const selectQueue = (queue: QueueTicket) => {
        patientSelectionVersion.current += 1;
        selectedUserIdRef.current = queue.user_id;
        selectedQueueIdRef.current = queue.queue_id;
        setPatient(null);
        setLatestMeasurement(null);
        setVitalDraft(emptyVitalDraft);
        setVitalTouched(false);
        setSyncedMeasurementId(null);
        setSelectedAppointment(null);
        setSelectedQueue(queue);
        setPatientPanelOpen(true);
    };

    const selectAppointment = (appointment: ApprovedAppointment) => {
        patientSelectionVersion.current += 1;
        selectedUserIdRef.current = appointment.user_id;
        selectedQueueIdRef.current = appointment.queue_id ?? null;
        setPatient(null);
        setLatestMeasurement(null);
        setVitalDraft(emptyVitalDraft);
        setVitalTouched(false);
        setSyncedMeasurementId(null);
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

    const fetchPatientDetail = async (
        userId?: number | null,
        selectionVersion = patientSelectionVersion.current,
    ) => {
        if (!userId) {
            if (selectionVersion === patientSelectionVersion.current) setPatient(null);
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
            if (
                selectionVersion !== patientSelectionVersion.current ||
                selectedUserIdRef.current !== userId ||
                Number(data.user_id) !== Number(userId)
            ) return;
            setPatient(data);
        } catch (error) {
            console.error('fetchPatientDetail:', error);
            if (
                selectionVersion === patientSelectionVersion.current &&
                selectedUserIdRef.current === userId
            ) setPatient(null);
        }
    };

    const fetchLatestMeasurement = async (
        queueId?: number | null,
        selectionVersion = patientSelectionVersion.current,
    ) => {
        if (!queueId) {
            if (selectionVersion === patientSelectionVersion.current) setLatestMeasurement(null);
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

            if (
                selectionVersion !== patientSelectionVersion.current ||
                selectedQueueIdRef.current !== queueId
            ) return;

            if (data.length > 0) {
                const measurement = data[0];
                if (measurement.queue_id != null && Number(measurement.queue_id) !== Number(queueId)) {
                    setLatestMeasurement(null);
                    return;
                }
                setLatestMeasurement(measurement);
            } else {
                setLatestMeasurement(null);
            }
        } catch (error) {
            console.error('fetchLatestMeasurement:', error);
            if (
                selectionVersion === patientSelectionVersion.current &&
                selectedQueueIdRef.current === queueId
            ) setLatestMeasurement(null);
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
                drug_allergy: patientDraft.drug_allergy.trim(),
                food_allergy: patientDraft.food_allergy.trim(),
                congenital_disease: patientDraft.congenital_disease.trim(),
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

            const advanceRes = await fetch(`${API}/calendar/advance-booking-weeks`, {
                headers: authHeaders(),
                cache: 'no-store',
            });
            if (advanceRes.ok) {
                const advanceData: AdvanceBookingWeek[] = await advanceRes.json();
                setAdvanceBookingWeeks(Array.isArray(advanceData) ? advanceData : []);
            }
        } catch (error) {
            console.error('fetchCalendarMonth:', error);
            setCalendarSlots([]);
        }
    };

    const saveMedical = async () => {
        const selectedUserId = selectedQueue?.user_id ?? selectedAppointment?.user_id;
        const selectedVisitDate = selectedQueue?.service_date ?? selectedAppointment?.service_date ?? null;
        const measurementQueueId = selectedQueue?.queue_id ?? selectedAppointment?.queue_id ?? null;
        const medicalPopupClass = { container: styles.medicalSaveConfirmLayer };

        if (!selectedQueue && !selectedAppointment) {
            Swal.fire({
                icon: 'warning',
                title: 'กรุณาเลือกคิวก่อน',
                customClass: medicalPopupClass,
            });
            return;
        }

        if (!selectedUserId) {
            Swal.fire({
                icon: 'warning',
                title: 'ไม่พบข้อมูลผู้ป่วย',
                text: 'คิวนี้อาจเป็น walk-in ที่ยังไม่ได้ผูกกับผู้ป่วย',
                customClass: medicalPopupClass,
            });
            return;
        }

        if (!selectedVisitDate || dayjs(selectedVisitDate).format('YYYY-MM-DD') !== now.format('YYYY-MM-DD')) {
            await Swal.fire({
                icon: 'warning',
                title: 'ยังไม่สามารถบันทึกได้',
                text: 'บันทึกข้อมูลได้เฉพาะวันที่ผู้ป่วยมีนัดหรือมีคิวเข้ารับบริการเท่านั้น',
                customClass: medicalPopupClass,
            });
            return;
        }

        const hasVitalDraft = Object.values(vitalDraft).some((value) => value.trim());
        const parsedBp = parseBpValue(vitalDraft.bp);

        if (vitalDraft.bp.trim() && !parsedBp) {
            await Swal.fire({
                icon: 'warning',
                title: 'รูปแบบ BP ไม่ถูกต้อง',
                text: 'กรุณากรอกความดันเป็นรูปแบบ เช่น 120/80',
                confirmButtonColor: '#0f766e',
                customClass: medicalPopupClass,
            });
            return;
        }

        const confirmation = await Swal.fire({
            icon: 'question',
            title: 'ยืนยันการบันทึกข้อมูล?',
            text: `ต้องการบันทึกข้อมูลของ ${selectedPatientName || selectedDisplayNumber} คิว ${selectedDisplayNumber} วันที่ ${dayjs(selectedVisitDate).locale('th').format('D MMMM')} ${dayjs(selectedVisitDate).year() + 543} ใช่หรือไม่`,
            showCancelButton: true,
            confirmButtonText: 'ยืนยันบันทึก',
            cancelButtonText: 'ตรวจสอบอีกครั้ง',
            confirmButtonColor: '#0f766e',
            cancelButtonColor: '#64748b',
            reverseButtons: true,
            customClass: medicalPopupClass,
        });

        if (!confirmation.isConfirmed) return;

        setMedicalSaving(true);
        try {
            await savePatientDraft(selectedUserId);

            let savedMeasurement = latestMeasurement;

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

            await Promise.all([fetchQueuesToday(), fetchApprovedAppointments()]);

            await Swal.fire({
                icon: 'success',
                title: 'บันทึกข้อมูลสำเร็จ',
                text: 'ระบบบันทึกข้อมูลผู้ป่วยเรียบร้อยแล้ว',
                confirmButtonText: 'กลับสู่ Dashboard',
                confirmButtonColor: '#0f766e',
                customClass: medicalPopupClass,
            });

            setSymptoms('');
            setVitalDraft(emptyVitalDraft);
            setVitalTouched(false);
            setSyncedMeasurementId(null);
            setPatientPanelOpen(false);
            setSelectedQueue(null);
            setSelectedAppointment(null);
        } catch (error: unknown) {
            await Swal.fire({
                icon: 'error',
                title: 'บันทึกไม่สำเร็จ',
                text: getErrorMessage(error, 'เกิดข้อผิดพลาด'),
                customClass: medicalPopupClass,
            });
        } finally {
            setMedicalSaving(false);
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
    // Initial dashboard hydration only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setNow(dayjs());
        }, 60 * 1000);

        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        let active = true;

        const refreshHardwareQueues = async () => {
            try {
                const response = await fetch(`${API}/today`, { headers: authHeaders() });
                if (!response.ok || !active) return;
                const data: QueueTicket[] = await response.json();
                if (!active) return;
                setQueues(data);
                setSelectedQueue((current) => {
                    if (!current) return current;
                    return data.find((queue) => queue.queue_id === current.queue_id) || null;
                });
            } catch (error) {
                console.error('refreshHardwareQueues:', error);
            }
        };

        const processHardwarePrints = async () => {
            try {
                const response = await fetch(`${API}/hardware/pending-print`, {
                    headers: authHeaders(),
                });
                if (!response.ok || !active) return;
                const jobs: PendingHardwarePrint[] = await response.json();

                await Promise.all(jobs.map(async (job) => {
                    if (hardwarePrintsInFlight.current.has(job.message_id)) return;
                    const bmi = calcBmiText(String(job.weight), String(job.height));
                    if (!bmi) return;

                    hardwarePrintsInFlight.current.add(job.message_id);
                    try {
                        await fetch(`${API}/hardware/print`, {
                            method: 'POST',
                            headers: jsonHeaders(),
                            body: JSON.stringify({ message_id: job.message_id, bmi: Number(bmi) }),
                        });
                    } finally {
                        hardwarePrintsInFlight.current.delete(job.message_id);
                    }
                }));
            } catch (error) {
                console.error('processHardwarePrints:', error);
            }
        };

        const queueTimer = window.setInterval(refreshHardwareQueues, 5000);
        const printTimer = window.setInterval(processHardwarePrints, 2000);
        processHardwarePrints();

        return () => {
            active = false;
            window.clearInterval(queueTimer);
            window.clearInterval(printTimer);
        };
    }, []);

    useEffect(() => {
        if (!walkinOpen) return;

        const timer = window.setTimeout(() => {
            lookupWalkinPatientSilently();
        }, 650);

        return () => window.clearTimeout(timer);
    // The draft fields are the debounce triggers; the lookup function reads their latest values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [walkinOpen, walkinDraft.national_id, walkinDraft.first_name, walkinDraft.last_name]);

    useEffect(() => {
        fetchApprovedAppointments();
        fetchCalendarMonth();
    // Calendar month is the only intended refresh trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [calendarMonth]);

    useEffect(() => {
        const selectionVersion = ++patientSelectionVersion.current;
        const selectedUserId = selectedQueue?.user_id ?? selectedAppointment?.user_id ?? null;
        const selectedQueueId = selectedQueue?.queue_id ?? selectedAppointment?.queue_id ?? null;
        selectedUserIdRef.current = selectedUserId;
        selectedQueueIdRef.current = selectedQueueId;

        setPatient(null);
        setLatestMeasurement(null);
        setSymptoms('');
        setVitalDraft(emptyVitalDraft);
        setVitalTouched(false);
        setPatientDraft(emptyPatientDraft);
        setPatientDraftDirty(false);
        setSyncedMeasurementId(null);

        if (selectedQueue || selectedAppointment) {
            fetchPatientDetail(selectedUserId, selectionVersion);

            if (selectedQueueId) fetchLatestMeasurement(selectedQueueId, selectionVersion);
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
            drug_allergy: stringifyMeasurement(patient.drug_allergy),
            food_allergy: stringifyMeasurement(patient.food_allergy),
            congenital_disease: stringifyMeasurement(patient.congenital_disease),
        });
        setPatientDraftDirty(false);
    }, [patient]);

    useEffect(() => {
        if (!latestMeasurement || latestMeasurement.measurement_id === syncedMeasurementId || vitalTouched) return;
        const activeQueueId = selectedQueue?.queue_id ?? selectedAppointment?.queue_id ?? null;
        if (
            !activeQueueId ||
            (latestMeasurement.queue_id != null && Number(latestMeasurement.queue_id) !== Number(activeQueueId))
        ) return;

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
    }, [latestMeasurement, selectedAppointment?.queue_id, selectedQueue?.queue_id, syncedMeasurementId, vitalTouched]);

    useEffect(() => {
        const activeQueueId = selectedQueue?.queue_id ?? selectedAppointment?.queue_id ?? null;
        if (!activeQueueId) return;

        const measurementTimer = window.setInterval(() => {
            fetchLatestMeasurement(activeQueueId, patientSelectionVersion.current);
        }, 5000);

        return () => window.clearInterval(measurementTimer);
    }, [selectedAppointment?.queue_id, selectedQueue?.queue_id]);

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
    const selectedSessionBadge = selectedQueue?.prefix === 'B'
        ? 'Walk-in'
        : selectedAppointment && !selectedQueue
            ? selectedAppointment.hour_of_day < 12
                ? 'นัดหมายช่วงเช้า'
                : 'นัดหมายช่วงบ่าย'
            : selectedQueueMeta;
    const selectedVisitDate = selectedQueue?.service_date ?? selectedAppointment?.service_date ?? null;
    const selectedVisitIsToday = Boolean(
        selectedVisitDate && dayjs(selectedVisitDate).format('YYYY-MM-DD') === now.format('YYYY-MM-DD'),
    );

    const visibleAccessCode = (item: QueueTicket | ApprovedAppointment) => {
        if (!item.access_code || item.access_code_used_at || !item.access_code_expires_at) return null;
        return dayjs(item.access_code_expires_at).valueOf() > now.valueOf() ? item.access_code : null;
    };

    const renderAccessCode = (item: QueueTicket | ApprovedAppointment, key: string) => {
        const code = visibleAccessCode(item);
        if (!code) return null;

        const isHidden = !visibleAccessCodeKeys.has(key);
        return (
            <span className={styles.accessCodeBadge}>
                <span>รหัสชั่ง {isHidden ? '••••••' : code}</span>
                <button
                    type="button"
                    className={styles.accessCodeEyeButton}
                    aria-label={isHidden ? 'แสดงรหัสเครื่องชั่ง' : 'ซ่อนรหัสเครื่องชั่ง'}
                    title={isHidden ? 'แสดงรหัสเครื่องชั่ง' : 'ซ่อนรหัสเครื่องชั่ง'}
                    onClick={(event) => {
                        event.stopPropagation();
                        setVisibleAccessCodeKeys((current) => {
                            const next = new Set(current);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                        });
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                >
                    {isHidden ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
            </span>
        );
    };

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

            {checkinOpen && (
                <div className={styles.walkinOverlay} onMouseDown={() => setCheckinOpen(false)}>
                    <div className={styles.checkinModal} onMouseDown={(event) => event.stopPropagation()}>
                        <div className={styles.walkinHeader}>
                            <div><p>Appointment Check-in</p><h2>ค้นหานัดหมายและออกรหัสเครื่องชั่ง</h2></div>
                            <button type="button" onClick={() => setCheckinOpen(false)}>×</button>
                        </div>
                        <div className={styles.checkinBody}>
                            <div className={styles.checkinSearchGrid}>
                                <label>เลขบัตรประชาชน<input value={checkinIdentity.national_id} maxLength={13} onChange={(event) => setCheckinIdentity((current) => ({ ...current, national_id: event.target.value.replace(/\D/g, '') }))} /></label>
                                <label>เบอร์โทรศัพท์<input value={checkinIdentity.phone} maxLength={10} inputMode="tel" onChange={(event) => setCheckinIdentity((current) => ({ ...current, phone: event.target.value.replace(/\D/g, '') }))} /></label>
                                <button type="button" onClick={searchAppointmentCheckin} disabled={checkinSearching}>{checkinSearching ? 'กำลังค้นหา...' : 'ค้นหานัดหมายวันนี้'}</button>
                            </div>
                            <div className={styles.checkinResults}>
                                {checkinResults.length === 0 ? <p>ยังไม่พบรายการนัดหมาย</p> : checkinResults.map((item) => (
                                    <article key={item.appointment_id}>
                                        <div>
                                            <strong>{item.first_name} {item.last_name}</strong>
                                            <p>{item.service_type} · {String(item.hour_of_day).padStart(2, '0')}:00 น. · {item.masked_email || 'ไม่มีอีเมล'}</p>
                                            <small>สถานะ {item.status} · คิว {item.queue_number || '-'}</small>
                                        </div>
                                        <button type="button" disabled={checkinSavingId === item.appointment_id || item.has_measurement} onClick={() => confirmAppointmentCheckin(item)}>
                                            {item.has_measurement ? 'ชั่งแล้ว' : checkinSavingId === item.appointment_id ? 'กำลังออก...' : 'ยืนยันและ Check-in'}
                                        </button>
                                    </article>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

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
                                    <span>หมายเลขคิว Walk-in</span>
                                    <input
                                        value={walkinDraft.receipt_queue}
                                        onChange={(event) => {
                                            const value = event.target.value.toUpperCase();
                                            const digits = value.replace(/\D/g, '').slice(0, 3);
                                            setWalkinValue('receipt_queue', value ? `B${digits}` : '');
                                        }}
                                        placeholder="เช่น B001"
                                    />
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
                                    className={styles.calendarMenuButton}
                                    aria-label="เปิดเมนูจัดการคิว"
                                    aria-haspopup="menu"
                                    aria-expanded={queueMenuOpen}
                                    onClick={() => setQueueMenuOpen((open) => !open)}
                                >
                                    <span />
                                    <span />
                                    <span />
                                </button>
                                {queueMenuOpen && (
                                <div className={styles.queueMenuContent} role="menu">
                                <p className={styles.queueMenuLabel}>ตัวกรองคิว</p>
                                <button
                                    type="button"
                                    className={`${styles.queueMenuItem} ${queueFilter === 'all' ? styles.queueFilterActive : ''}`}
                                    aria-current={queueFilter === 'all' ? 'true' : undefined}
                                    onClick={() => { setQueueFilter('all'); setQueueMenuOpen(false); }}
                                >
                                    <span className={`${styles.queueMenuIcon} ${styles.queueMenuIconAll}`}><ListFilter size={20} /></span>
                                    <span className={styles.queueMenuText}>
                                        <strong>คิวทั้งหมด</strong>
                                        <small>แสดงคิวออนไลน์และคิวหน้าคลินิก</small>
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.queueMenuItem} ${queueFilter === 'A' ? styles.queueFilterActive : ''}`}
                                    aria-current={queueFilter === 'A' ? 'true' : undefined}
                                    onClick={() => { setQueueFilter('A'); setQueueMenuOpen(false); }}
                                >
                                    <span className={`${styles.queueMenuIcon} ${styles.queueMenuIconOnline}`}><CalendarCheck size={20} /></span>
                                    <span className={styles.queueMenuText}>
                                        <strong>คิวจองออนไลน์</strong>
                                        <small>แสดงเฉพาะผู้ป่วยคิว A</small>
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.queueMenuItem} ${queueFilter === 'B' ? styles.queueFilterActive : ''}`}
                                    aria-current={queueFilter === 'B' ? 'true' : undefined}
                                    onClick={() => { setQueueFilter('B'); setQueueMenuOpen(false); }}
                                >
                                    <span className={`${styles.queueMenuIcon} ${styles.queueMenuIconWalkin}`}><Users size={20} /></span>
                                    <span className={styles.queueMenuText}>
                                        <strong>คิวผู้ป่วย Walk-in</strong>
                                        <small>แสดงเฉพาะผู้ป่วยคิว B</small>
                                    </span>
                                </button>

                                <div className={styles.queueMenuDivider} />
                                <p className={styles.queueMenuLabel}>จัดการคิว</p>
                                <button type="button" className={styles.queueMenuItem} onClick={() => { setQueueMenuOpen(false); openWalkinForm(); }}>
                                    <span className={`${styles.queueMenuIcon} ${styles.queueMenuIconAdd}`}><UserPlus size={20} /></span>
                                    <span className={styles.queueMenuText}>
                                        <strong>เพิ่มผู้ป่วย Walk-in</strong>
                                        <small>สร้างคิว B สำหรับผู้ป่วยหน้าคลินิก</small>
                                    </span>
                                </button>
                                <button type="button" className={styles.queueMenuItem} onClick={() => { setQueueMenuOpen(false); setCheckinResults([]); setCheckinOpen(true); }}>
                                    <span className={`${styles.queueMenuIcon} ${styles.queueMenuIconCheckin}`}><Search size={20} /></span>
                                    <span className={styles.queueMenuText}>
                                        <strong>ตรวจสอบนัดและ Check-in</strong>
                                        <small>ค้นด้วยเลขบัตรประชาชนและเบอร์โทร</small>
                                    </span>
                                </button>
                                </div>
                                )}
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
                                                <div
                                                    key={queue.queue_id}
                                                    role="button"
                                                    tabIndex={0}
                                                    className={`${styles.queueItem} ${selectedQueue?.queue_id === queue.queue_id ? styles.queueItemActive : ''}`}
                                                    onClick={() => selectQueue(queue)}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                            event.preventDefault();
                                                            selectQueue(queue);
                                                        }
                                                    }}
                                                >
                                                    <span className={styles.queueNo}>{index + 1}</span>

                                                    <span className={styles.queueText}>
                                                        <strong>{queue.queue_number}</strong>
                                                        <small>{getQueueTypeLabel(queue.prefix)} • {queue.service_type || 'ตรวจทั่วไป'} • {getQueueTime(queue)}</small>
                                                    </span>

                                                    {renderAccessCode(queue, `queue:${queue.queue_id}`)}

                                                    <span className={statusBadgeClass(getVisitStatus(queue))}>{statusText(getVisitStatus(queue))}</span>
                                                    <span className={styles.eyeMark}>ดู</span>
                                                </div>
                                            ))
                                        ) : visibleMorningAppointments.length > 0 ? (
                                            visibleMorningAppointments.map((item, index) => (
                                                <div
                                                    key={item.appointment_id}
                                                    role="button"
                                                    tabIndex={0}
                                                    className={`${styles.queueItem} ${selectedAppointment?.appointment_id === item.appointment_id ? styles.queueItemActive : ''}`}
                                                    onClick={() => selectAppointment(item)}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                            event.preventDefault();
                                                            selectAppointment(item);
                                                        }
                                                    }}
                                                >
                                                    <span className={styles.queueNo}>{getAppointmentOrderLabel(item, index)}</span>

                                                    <span className={styles.queueText}>
                                                        <strong>{getAppointmentQueueLabel(item)}</strong>
                                                        <small>{appointmentName(item)} • {getAppointmentTime(item)}</small>
                                                    </span>

                                                    {renderAccessCode(item, `appointment:${item.appointment_id}`)}

                                                    <span className={statusBadgeClass(getVisitStatus(item))}>{statusText(getVisitStatus(item))}</span>
                                                    <span className={styles.eyeMark}>ดู</span>
                                                </div>
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
                                                <div
                                                    key={queue.queue_id}
                                                    role="button"
                                                    tabIndex={0}
                                                    className={`${styles.queueItem} ${selectedQueue?.queue_id === queue.queue_id ? styles.queueItemActive : ''}`}
                                                    onClick={() => selectQueue(queue)}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                            event.preventDefault();
                                                            selectQueue(queue);
                                                        }
                                                    }}
                                                >
                                                    <span className={styles.queueNo}>{index + 1}</span>

                                                    <span className={styles.queueText}>
                                                        <strong>{queue.queue_number}</strong>
                                                        <small>{getQueueTypeLabel(queue.prefix)} • {queue.service_type || 'ตรวจทั่วไป'} • {getQueueTime(queue)}</small>
                                                    </span>

                                                    {renderAccessCode(queue, `queue:${queue.queue_id}`)}

                                                    <span className={statusBadgeClass(getVisitStatus(queue))}>{statusText(getVisitStatus(queue))}</span>
                                                    <span className={styles.eyeMark}>ดู</span>
                                                </div>
                                            ))
                                        ) : visibleAfternoonAppointments.length > 0 ? (
                                            visibleAfternoonAppointments.map((item, index) => (
                                                <div
                                                    key={item.appointment_id}
                                                    role="button"
                                                    tabIndex={0}
                                                    className={`${styles.queueItem} ${selectedAppointment?.appointment_id === item.appointment_id ? styles.queueItemActive : ''}`}
                                                    onClick={() => selectAppointment(item)}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                            event.preventDefault();
                                                            selectAppointment(item);
                                                        }
                                                    }}
                                                >
                                                    <span className={styles.queueNo}>{getAppointmentOrderLabel(item, index)}</span>

                                                    <span className={styles.queueText}>
                                                        <strong>{getAppointmentQueueLabel(item)}</strong>
                                                        <small>{appointmentName(item)} • {getAppointmentTime(item)}</small>
                                                    </span>

                                                    {renderAccessCode(item, `appointment:${item.appointment_id}`)}

                                                    <span className={statusBadgeClass(getVisitStatus(item))}>{statusText(getVisitStatus(item))}</span>
                                                    <span className={styles.eyeMark}>ดู</span>
                                                </div>
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
                                        <span>แพ้ยา</span>
                                        <input
                                            className={styles.vitalInput}
                                            type="text"
                                            value={patientDraft.drug_allergy}
                                            onChange={(event) => setPatientValue('drug_allergy', event.target.value)}
                                            placeholder="ไม่มี"
                                        />
                                    </div>

                                    <div>
                                        <span>แพ้อาหาร</span>
                                        <input
                                            className={styles.vitalInput}
                                            type="text"
                                            value={patientDraft.food_allergy}
                                            onChange={(event) => setPatientValue('food_allergy', event.target.value)}
                                            placeholder="ไม่มี"
                                        />
                                    </div>

                                    <div>
                                        <span>โรคประจำตัว</span>
                                        <input
                                            className={styles.vitalInput}
                                            type="text"
                                            value={patientDraft.congenital_disease}
                                            onChange={(event) => setPatientValue('congenital_disease', event.target.value)}
                                            placeholder="ไม่มี"
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
                                    {!selectedVisitIsToday && (selectedQueue || selectedAppointment) && (
                                        <p className={styles.saveDateNotice}>บันทึกได้เมื่อถึงวันที่ผู้ป่วยเข้ารับบริการเท่านั้น</p>
                                    )}
                                    <button
                                        type="button"
                                        className={styles.greenBtn}
                                        onClick={saveMedical}
                                        disabled={medicalSaving || (!selectedQueue && !selectedAppointment) || !selectedVisitIsToday}
                                    >
                                        {medicalSaving ? 'กำลังบันทึก...' : 'บันทึก'}
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

                                    <div className={styles.calendarMenuWrap}>
                                        <button
                                            type="button"
                                            className={styles.calendarMenuButton}
                                            aria-label="เปิดเมนูจัดการปฏิทิน"
                                            aria-haspopup="menu"
                                            aria-expanded={calendarMenuOpen}
                                            onClick={() => setCalendarMenuOpen((open) => !open)}
                                        >
                                            <span />
                                            <span />
                                            <span />
                                        </button>

                                        {calendarMenuOpen && (
                                            <div className={styles.calendarMenu} role="menu">
                                                <button
                                                    type="button"
                                                    role="menuitem"
                                                    onClick={() => {
                                                        setCalendarMenuOpen(false);
                                                        void openHolidayManager();
                                                    }}
                                                >
                                                    <span className={styles.menuHolidayIcon}>✦</span>
                                                    <span>
                                                        <strong>จัดการวันหยุด</strong>
                                                        <small>เพิ่ม แก้ไข หรือยกเลิกวันหยุด</small>
                                                    </span>
                                                </button>
                                                <button
                                                    type="button"
                                                    role="menuitem"
                                                    onClick={() => void openAdvanceBookingManager()}
                                                >
                                                    <span className={styles.menuBookingIcon}>＋</span>
                                                    <span>
                                                        <strong>เปิดสัปดาห์จอง</strong>
                                                        <small>เปิดรับจองสัปดาห์ถัดไปล่วงหน้า</small>
                                                    </span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className={styles.panelBody}>
                                    <div className={styles.panelBodyInner}>
                                <div className={styles.calendarControl}>
                                    <div className={styles.calendarMonthTitle}>
                                        <h3>
                                            {calendarMonth.locale('th').format('MMMM')} {calendarMonth.year() + 543}
                                        </h3>
                                    </div>

                                    <div className={styles.calendarActions}>
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
                                        const isAdvanceBookingDay = advanceBookingWeeks.some(
                                            (week) => key >= week.week_start && key <= week.week_end
                                        );
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
                                                className={`${styles.dayButton} ${!isThisMonth ? styles.dayMuted : ''} ${isSelected ? styles.daySelected : ''} ${isToday ? styles.dayToday : ''} ${isAdvanceBookingDay ? styles.dayAdvance : ''} ${status === 'available' ? styles.dayAvailable : ''} ${status === 'closed' ? styles.dayClosed : ''} ${status === 'full' ? styles.dayFull : ''}`}
                                            >
                                                <span className={styles.dayCellTop}>
                                                    <span className={styles.dayName}>{day.locale('th').format('dd')}</span>
                                                    {isToday && <span className={styles.todayBadge}>วันนี้</span>}
                                                    {!isToday && isAdvanceBookingDay && (
                                                        <span className={styles.advanceBadge}>ล่วงหน้า</span>
                                                    )}
                                                </span>
                                                <strong className={styles.dayNumber}>{day.date()}</strong>

                                                <span className={styles.dayStatus}>
                                                    <i />
                                                    {status === 'closed' ? (
                                                        <small>ปิดรับจอง</small>
                                                    ) : count > 0 ? (
                                                        <small>{count} คิว</small>
                                                    ) : status === 'available' ? (
                                                        <small>คิวว่าง</small>
                                                    ) : (
                                                        <small>ยังไม่มีคิว</small>
                                                    )}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className={styles.calendarLegend}>
                                    <span><i className={styles.legendToday}></i>วันนี้</span>
                                    <span><i className={styles.legendAvailable}></i>ว่าง</span>
                                    <span><i className={styles.legendFull}></i>มีจอง</span>
                                    <span><i className={styles.legendClosed}></i>ปิด/ล็อก</span>
                                    <span><i className={styles.legendAdvance}></i>เปิดล่วงหน้า</span>
                                </div>
                                    </div>
                                </div>
                            </article>

                            {advanceBookingOpen && (
                                <div
                                    className={styles.advanceBookingOverlay}
                                    role="presentation"
                                    onMouseDown={(event) => {
                                        if (event.target === event.currentTarget && !advanceBookingSaving) {
                                            setAdvanceBookingOpen(false);
                                        }
                                    }}
                                >
                                    <section
                                        className={styles.advanceBookingModal}
                                        role="dialog"
                                        aria-modal="true"
                                        aria-labelledby="advance-booking-title"
                                    >
                                        <div className={styles.advanceBookingHeader}>
                                            <div className={styles.advanceBookingTitleIcon}>📅</div>
                                            <div>
                                                <p>Advance booking</p>
                                                <h3 id="advance-booking-title">เปิดจองสัปดาห์ล่วงหน้า</h3>
                                            </div>
                                            <button
                                                type="button"
                                                aria-label="ปิด"
                                                onClick={() => setAdvanceBookingOpen(false)}
                                                disabled={advanceBookingSaving}
                                            >
                                                ×
                                            </button>
                                        </div>

                                        <div className={styles.advanceBookingBody}>
                                            <p className={styles.advanceBookingIntro}>
                                                กรุณาตรวจสอบช่วงวันที่ก่อนเปิดให้ผู้ใช้จองล่วงหน้า
                                            </p>

                                            {advanceBookingLoading ? (
                                                <div className={styles.advanceBookingLoading}>
                                                    <span />
                                                    <span />
                                                </div>
                                            ) : advanceWeekRange ? (
                                                <div className={styles.advanceWeekRow}>
                                                    <div>
                                                        <small>สัปดาห์ถัดไป</small>
                                                        <strong>
                                                            {dayjs(advanceWeekRange.start).locale('th').format('D MMMM')} -{' '}
                                                            {dayjs(advanceWeekRange.end).locale('th').format('D MMMM')} {' '}
                                                            {dayjs(advanceWeekRange.end).year() + 543}
                                                        </strong>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => void (
                                                            isAdvanceWeekOpen
                                                                ? cancelAdvanceBooking()
                                                                : confirmAdvanceBooking()
                                                        )}
                                                        disabled={advanceBookingSaving}
                                                        className={isAdvanceWeekOpen ? styles.advanceWeekCancel : ''}
                                                    >
                                                        {advanceBookingSaving
                                                            ? 'กำลังดำเนินการ...'
                                                            : isAdvanceWeekOpen
                                                                ? 'ยกเลิกการเปิดจอง'
                                                                : 'เปิดการจองล่วงหน้า'}
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className={styles.noAdvanceWeek}>
                                                    ไม่มีสัปดาห์ถัดไปที่อยู่ภายในเดือนปัจจุบัน
                                                </div>
                                            )}
                                        </div>

                                        <div className={styles.advanceBookingNote}>
                                            <span>i</span>
                                            เปิดจองล่วงหน้าได้เฉพาะวันที่ภายในเดือนปัจจุบันเท่านั้น
                                        </div>
                                    </section>
                                </div>
                            )}
                        </section>
                    </div>
                </main>
            </div>
        </div>
    );
}
