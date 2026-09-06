'use client';
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Cookies from 'js-cookie';
import { useRouter } from 'next/navigation';
import styles from './admin.module.css';
import { API_BASE } from '@/lib/api';
import { resolveBackendImage } from '@/lib/images';
import Sidebar from '@/components/admin-shell/AdminSidebar';
import AdminHeaderActions from '@/components/admin-shell/AdminHeaderActions';
import dayjs from "dayjs";
import "dayjs/locale/th";
import {
    Eye,
    User,
    Phone,
    CalendarDays,
    MapPin,
    Weight,
    Ruler,
    Pill,
    Utensils,
} from 'lucide-react';

function resolvePatientImage(src?: string | null) {
    return resolveBackendImage(src) || '/img/default-avatar.png';
}

interface Patient {
    user_id: number;
    profile_image: string | null;
    patient_code?: string;
    national_id: string;
    first_name: string;
    last_name: string;
    phone?: string;
    address?: string;
    dob?: string;
    nationality?: string;
    position: string;
    ethnicity?: string;
    occupation?: string;
    email?: string;
    admit_date?: string;
    gender?: string;
    blood_type?: string;
    emergency_phone?: string;
    congenital_disease?: string;
    drug_allergy?: string;
    food_allergy?: string;
    created_at?: string;
    weight?: string | number | null;
    height?: string | number | null;
    bmi?: string | number | null;
    account_status?: string;
    status_reason?: string | null;
}

type Profile = {
    first_name: string;
    last_name: string;
    profile_image?: string | null;
    role?: string | null;
};

type PatientFull = Patient & {
    nationality?: string;
    ethnicity?: string;
    occupation?: string;
    email?: string;
    admit_date?: string;
    allergy?: string;
    appointments?: AppointmentHistory[];
    weight?: string | number | null;
    height?: string | number | null;
    bmi?: string | number | null;
};

type AppointmentHistory = {
    appointment_id: number;
    id?: number;
    status: string;
    service_type?: string | null;
    service_date?: string;
    appointment_date?: string;
    avaliable_date?: 'morning' | 'afternoon' | string;
    hour_of_day?: number;
    appointment_time?: string;
    time?: string;
};

const EMPTY_CLAIM_FORM = { email: '', password: '', confirmPassword: '' };

function getAppointmentDate(appointment: AppointmentHistory) {
    const value = appointment.service_date || appointment.appointment_date;
    if (!value) return '-';

    return dayjs(value).locale('th').format('D MMM YYYY');
}

function getAppointmentTimeLabel(appointment: AppointmentHistory) {
    if (Number.isInteger(appointment.hour_of_day)) {
        return `${String(appointment.hour_of_day).padStart(2, '0')}:00 น.`;
    }

    const value = appointment.appointment_time || appointment.time;
    return value ? `${value} น.` : '-';
}

function getAppointmentPeriod(appointment: AppointmentHistory) {
    if (appointment.avaliable_date === 'morning') return 'ช่วงเช้า';
    if (appointment.avaliable_date === 'afternoon') return 'ช่วงเย็น';
    return appointment.service_type || '-';
}

function calcThaiAge(dobStr: string) {
    const birth = new Date(dobStr);
    if (isNaN(+birth)) return '-';

    const today = new Date();
    let y = today.getFullYear() - birth.getFullYear();
    let m = today.getMonth() - birth.getMonth();
    let d = today.getDate() - birth.getDate();

    if (d < 0) {
        m--;
        d += new Date(today.getFullYear(), today.getMonth(), 0).getDate();
    }
    if (m < 0) {
        y--;
        m += 12;
    }

    return `${y} ปี ${m} เดือน ${d} วัน`;
}

export default function PatientListPage() {
    const [nationalId, setNationalId] = useState('');
    const [allPatients, setAllPatients] = useState<Patient[]>([]);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [showPopup, setShowPopup] = useState(false);
    const [viewOpen, setViewOpen] = useState(false);
    const [selectedPatient, setSelectedPatient] = useState<PatientFull | null>(null);
    const [viewLoading, setViewLoading] = useState(false);
    const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
    const [claimFormOpen, setClaimFormOpen] = useState(false);
    const [claimForm, setClaimForm] = useState(EMPTY_CLAIM_FORM);
    const [claimSaving, setClaimSaving] = useState(false);
    const [claimError, setClaimError] = useState('');
    const [claimNotice, setClaimNotice] = useState('');

    const router = useRouter();
    dayjs.locale("th");

    const todayText = dayjs().locale("th").format("D MMMM");
    const buddhistYear = dayjs().year() + 543;

    function getAuthHeaders(): Headers {
        const token = Cookies.get('adminToken') || Cookies.get('userToken') || '';
        const headers = new Headers();
        headers.append('Content-Type', 'application/json');
        if (token) headers.append('Authorization', `Bearer ${token}`);
        return headers;
    }

    function normalizePatient(p: any): PatientFull {
        return {
            ...p,
            nationality: p.nationality ?? p.nationalit ?? '',
            ethnicity: p.ethnicity ?? p.ethnicit ?? '',
            occupation: p.occupation ?? p.position ?? '',
            email: p.email ?? p.emergency_email ?? '',
            admit_date: p.admit_date ?? p.created_at ?? '',
            allergy: p.allergy ?? p.drug_allergy ?? '',
        };
    }

    async function fetchAllPatients() {
        const res = await fetch(`${API_BASE}/patients`, {
            headers: getAuthHeaders(),
            cache: 'no-store',
            credentials: 'include',
        });

        if (!res.ok) {
            const msg = await res.text().catch(() => '');
            throw new Error(msg || 'ไม่สามารถดึงข้อมูลผู้ป่วยได้');
        }

        const data = await res.json();
        setAllPatients(Array.isArray(data) ? data : []);
    }

    async function reactivatePatientAccount(patient: PatientFull) {
        const reason = window.prompt('ระบุเหตุผลที่เปิดใช้งานบัญชีกลับคืน');
        if (!reason?.trim()) return;
        const res = await fetch(`${API_BASE}/users/${patient.user_id}/account-status`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            credentials: 'include',
            body: JSON.stringify({ account_status: 'active', reason: reason.trim() }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            setError(data?.message || 'เปิดใช้งานบัญชีไม่สำเร็จ');
            return;
        }
        setSuccess(data?.email_sent
            ? 'เปิดขั้นตอนยืนยันบัญชีแล้ว และส่ง OTP ไปยังอีเมลผู้ป่วยแล้ว'
            : 'เปิดขั้นตอนยืนยันบัญชีแล้ว แต่ยังส่ง OTP ไม่สำเร็จ');
        setSelectedPatient((current) => current ? { ...current, account_status: data.account_status } : current);
        await fetchAllPatients();
    }

    async function fetchPatientFull(userId: number): Promise<PatientFull | null> {
        let fullPatient: PatientFull | null = null;

        try {
            const r1 = await fetch(`${API_BASE}/patients/${userId}`, {
                headers: getAuthHeaders(),
                credentials: 'include',
                cache: 'no-store',
            });
            if (r1.ok) fullPatient = normalizePatient(await r1.json());
        } catch { }

        if (!fullPatient) try {
            const r2 = await fetch(`${API_BASE}/information?user_id=${userId}`, {
                headers: getAuthHeaders(),
                credentials: 'include',
                cache: 'no-store',
            });
            if (r2.ok) fullPatient = normalizePatient(await r2.json());
        } catch { }

        if (!fullPatient) return null;

        try {
            const measurementResponse = await fetch(`${API_BASE}/measurements/user/${userId}/latest`, {
                headers: getAuthHeaders(),
                credentials: 'include',
                cache: 'no-store',
            });

            if (measurementResponse.ok) {
                const measurement = await measurementResponse.json();
                if (measurement) {
                    fullPatient = {
                        ...fullPatient,
                        weight: measurement.weight ?? fullPatient.weight ?? null,
                        height: measurement.height ?? fullPatient.height ?? null,
                        bmi: measurement.bmi ?? fullPatient.bmi ?? null,
                    };
                }
            }
        } catch { }

        try {
            const appointmentResponse = await fetch(`${API_BASE}/appointments/user/${userId}`, {
                headers: getAuthHeaders(),
                credentials: 'include',
                cache: 'no-store',
            });

            if (appointmentResponse.ok) {
                const appointmentData: unknown = await appointmentResponse.json();
                fullPatient.appointments = Array.isArray(appointmentData)
                    ? appointmentData as AppointmentHistory[]
                    : [];
            }
        } catch {
            fullPatient.appointments = [];
        }

        return fullPatient;
    }

    const openView = async (p: Patient) => {
        setViewOpen(true);
        setViewLoading(true);
        setAvatarLoadFailed(false);
        setClaimFormOpen(false);
        setClaimForm(EMPTY_CLAIM_FORM);
        setClaimError('');
        setClaimNotice('');
        setSelectedPatient(normalizePatient(p));

        const full = await fetchPatientFull(p.user_id);
        if (full) setSelectedPatient({ ...normalizePatient(p), ...full, account_status: p.account_status, status_reason: p.status_reason });

        setViewLoading(false);
    };

    const closeView = () => {
        setViewOpen(false);
        setSelectedPatient(null);
        setClaimFormOpen(false);
        setClaimForm(EMPTY_CLAIM_FORM);
        setClaimError('');
        setClaimNotice('');
    };

    async function createWalkinOnlineAccount() {
        if (!selectedPatient) return;
        const email = claimForm.email.trim().toLowerCase();
        if (!email || !claimForm.password) {
            setClaimError('กรุณากรอกอีเมลและรหัสผ่านให้ครบ');
            return;
        }
        if (claimForm.password !== claimForm.confirmPassword) {
            setClaimError('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน');
            return;
        }

        try {
            setClaimSaving(true);
            setClaimError('');
            setClaimNotice('');
            const response = await fetch(`${API_BASE}/patients/${selectedPatient.user_id}/claim-account`, {
                method: 'POST',
                headers: getAuthHeaders(),
                credentials: 'include',
                body: JSON.stringify({ email, password: claimForm.password }),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) throw new Error(data?.message || 'สร้างบัญชีออนไลน์ไม่สำเร็จ');

            setSelectedPatient((current) => current ? {
                ...current,
                email,
                account_status: data.account_status || 'pending_verification',
            } : current);
            setClaimFormOpen(false);
            setClaimForm(EMPTY_CLAIM_FORM);
            setClaimNotice(data?.message || 'สร้างบัญชีออนไลน์แล้ว');
            await fetchAllPatients();
        } catch (claimAccountError) {
            setClaimError(claimAccountError instanceof Error ? claimAccountError.message : 'สร้างบัญชีออนไลน์ไม่สำเร็จ');
        } finally {
            setClaimSaving(false);
        }
    }

    async function handleSmartSearch() {
        try {
            const raw = nationalId.trim();
            if (!raw) throw new Error('empty');

            if (/^\d{1,3}$/.test(raw)) {
                const code = raw.padStart(3, '0');
                const res = await fetch(`${API_BASE}/patients/code/${encodeURIComponent(code)}`, {
                    headers: getAuthHeaders(),
                    cache: 'no-store',
                    credentials: 'include',
                });

                if (!res.ok) throw new Error('notfound');
                const data = await res.json();
                router.push(`/admin/information?user_id=${data.user_id}`);
                return;
            }

            const res = await fetch(`${API_BASE}/patients/national/${encodeURIComponent(raw)}`, {
                headers: getAuthHeaders(),
                cache: 'no-store',
                credentials: 'include',
            });

            if (!res.ok) throw new Error('notfound');
            const data = await res.json();
            router.push(`/admin/information?user_id=${data.user_id}`);
        } catch {
            setShowPopup(true);
            setTimeout(() => setShowPopup(false), 2000);
        }
    }

    useEffect(() => {
        (async () => {
            try {
                setError('');

                const res = await fetch(`${API_BASE}/me/profile`, {
                    headers: getAuthHeaders(),
                    credentials: 'include',
                    cache: 'no-store',
                });

                if (res.ok) {
                    const data = await res.json();
                    setProfile({
                        first_name: data?.first_name || '',
                        last_name: data?.last_name || '',
                        profile_image: data?.profile_image || null,
                        role: data?.role || null,
                    });
                } else {
                    setProfile(null);
                }

                await fetchAllPatients();
            } catch (err) {
                console.error('โหลดข้อมูลล้มเหลว:', err);
                setProfile(null);
                setAllPatients([]);
                setError('โหลดข้อมูลผู้ป่วยไม่สำเร็จ');
            }
        })();
    // Initial page load; fetchAllPatients is intentionally not a reactive trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div className={styles.leftHeader}>
                    <div className={styles.pageTitleBox}>
                        <h1 className={styles.pageTitle}>จัดการผู้ป่วย</h1>
                        <p className={styles.pageDate}>
                            วันที่ {todayText} {buddhistYear}
                        </p>
                    </div>
                </div>

                <AdminHeaderActions />
            </header>

            <div className={styles.Wrapper}>
                <Sidebar />

                <main className={styles.contentArea}>
                    {showPopup && (
                        <div className={styles.popupOverlay}>
                            <div className={styles.popupBoxerror}>
                                <span className={styles.popupIcon}>!</span>
                                ไม่พบข้อมูลผู้ป่วย
                            </div>
                        </div>
                    )}

                    {error && <p className={styles.errorText}>{error}</p>}
                    {success && <p className={styles.successText}>{success}</p>}

                    <section className={styles.patientPanel}>
                        <div className={styles.patientPanelHeader}>
                            <div>
                                <h2 className={styles.patientPanelTitle}>
                                    รายการผู้ป่วยทั้งหมด
                                </h2>
                                <p className={styles.patientPanelCount}>
                                    {allPatients.length} รายการ
                                </p>
                            </div>

                            <div className={styles.patientSearchBox}>
                                <span className={styles.patientSearchIcon}>⌕</span>

                                <input
                                    className={styles.patientSearchInput}
                                    type="text"
                                    value={nationalId}
                                    onChange={(e) => setNationalId(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSmartSearch();
                                    }}
                                    placeholder="ค้นหา รหัสผู้ป่วย, เลขบัตร, ชื่อ..."
                                />

                                <button
                                    type="button"
                                    className={styles.hiddenSearchButton}
                                    onClick={handleSmartSearch}
                                >
                                    ค้นหา
                                </button>
                            </div>
                        </div>

                        <div className={styles.patientTableWrap}>
                            <table className={styles.modernPatientTable}>
                                <thead>
                                    <tr>
                                        <th>รหัสผู้ป่วย</th>
                                        <th>เลขบัตรประชาชน</th>
                                        <th>ชื่อ-นามสกุล</th>
                                        <th>เบอร์โทร</th>
                                        <th>ที่อยู่</th>
                                        <th>วันเกิด</th>
                                        <th>ดู</th>
                                    </tr>
                                </thead>

                                <tbody>
                                    {allPatients.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className={styles.emptyBox}>
                                                ไม่มีข้อมูลผู้ป่วย
                                            </td>
                                        </tr>
                                    ) : (
                                        allPatients.map((p) => (
                                            <tr key={p.user_id}>
                                                <td>
                                                    <span className={styles.patientCodeBadge}>
                                                        P{String(p.user_id).padStart(3, '0')}
                                                    </span>
                                                </td>

                                                <td className={styles.nationalIdCell}>
                                                    {p.national_id || '-'}
                                                </td>

                                                <td className={styles.patientNameCell}>
                                                    {p.first_name} {p.last_name}
                                                </td>

                                                <td>{p.phone || '-'}</td>

                                                <td className={styles.modernAddressCell}>
                                                    <span>{p.address || '-'}</span>
                                                </td>

                                                <td className={styles.birthDateCell}>
                                                    {p.dob
                                                        ? new Date(p.dob).toLocaleDateString('th-TH', {
                                                            day: 'numeric',
                                                            month: 'short',
                                                            year: 'numeric',
                                                        })
                                                        : '-'}
                                                </td>

                                                <td className={styles.actionCell}>
                                                    <button
                                                        type="button"
                                                        className={styles.modernEyeBtn}
                                                        onClick={() => openView(p)}
                                                        title="ดูข้อมูลผู้ป่วย"
                                                        aria-label="ดูข้อมูลผู้ป่วย"
                                                    >
                                                        <Eye size={18} strokeWidth={2.4} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>


                    {viewOpen && selectedPatient && (
                        <div className={styles.modernModalOverlay} onClick={closeView}>
                            <div
                                className={styles.modernPatientModal}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className={styles.modernModalHeader}>
                                    <h3>ข้อมูลผู้ป่วย</h3>

                                    <button
                                        type="button"
                                        className={styles.modernCloseBtn}
                                        onClick={closeView}
                                    >
                                        ×
                                    </button>
                                </div>

                                {viewLoading ? (
                                    <div className={styles.loadingBox}>
                                        กำลังโหลดข้อมูล...
                                    </div>
                                ) : (
                                    <div className={styles.modernModalBody}>
                                        <div className={styles.modernProfileCard}>
                                            <div className={styles.modernAvatar}>
                                                {selectedPatient.profile_image && !avatarLoadFailed ? (
                                                    <img
                                                        src={resolvePatientImage(selectedPatient.profile_image)}
                                                        alt={`รูปโปรไฟล์ของ ${selectedPatient.first_name || 'ผู้ป่วย'}`}
                                                        className={styles.modernAvatarImage}
                                                        onError={() => setAvatarLoadFailed(true)}
                                                    />
                                                ) : (
                                                    (selectedPatient.first_name || 'ผ').charAt(0)
                                                )}
                                            </div>

                                            <div>
                                                <h4>
                                                    {selectedPatient.first_name} {selectedPatient.last_name}
                                                </h4>
                                                <p className={styles.modernPatientCode}>
                                                    P{String(selectedPatient.user_id).padStart(3, '0')}
                                                </p>
                                                <p className={styles.modernPatientAge}>
                                                    อายุ{' '}
                                                    {selectedPatient.dob
                                                        ? new Date().getFullYear() -
                                                        new Date(selectedPatient.dob).getFullYear()
                                                        : '-'}{' '}
                                                    ปี
                                                </p>
                                            </div>
                                        </div>

                                        <div className={styles.accountStatusPanel}>
                                            <span>สถานะบัญชี: <strong>{selectedPatient.account_status || 'active'}</strong></span>
                                            {selectedPatient.status_reason && <small>เหตุผลล่าสุด: {selectedPatient.status_reason}</small>}
                                            {['super_admin', 'superadmin'].includes(String(profile?.role || '').toLowerCase()) && selectedPatient.account_status === 'deactivated' && (
                                                <button type="button" onClick={() => reactivatePatientAccount(selectedPatient)}>
                                                    เปิดใช้งานบัญชีกลับคืนและส่ง OTP
                                                </button>
                                            )}
                                            {['admin', 'super_admin', 'superadmin'].includes(String(profile?.role || '').toLowerCase()) && selectedPatient.account_status === 'unclaimed' && !claimFormOpen && (
                                                <button type="button" onClick={() => {
                                                    setClaimForm({ ...EMPTY_CLAIM_FORM, email: selectedPatient.email || '' });
                                                    setClaimError('');
                                                    setClaimNotice('');
                                                    setClaimFormOpen(true);
                                                }}>
                                                    สร้างบัญชีออนไลน์
                                                </button>
                                            )}
                                            {claimNotice && <p className={styles.claimSuccess}>{claimNotice}</p>}
                                            {claimFormOpen && selectedPatient.account_status === 'unclaimed' && (
                                                <div className={styles.claimAccountForm}>
                                                    <div>
                                                        <strong>สร้างบัญชีออนไลน์จากผู้ป่วย Walk-in</strong>
                                                        <small>บัญชีใหม่จะใช้รหัสผู้ป่วยและประวัติการรักษาเดิม</small>
                                                    </div>
                                                    <label>
                                                        <span>Gmail / อีเมลผู้ป่วย</span>
                                                        <input
                                                            type="email"
                                                            value={claimForm.email}
                                                            onChange={(event) => setClaimForm((current) => ({ ...current, email: event.target.value }))}
                                                            placeholder="name@gmail.com"
                                                            autoComplete="off"
                                                        />
                                                    </label>
                                                    <label>
                                                        <span>รหัสผ่านชั่วคราว</span>
                                                        <input
                                                            type="password"
                                                            value={claimForm.password}
                                                            onChange={(event) => setClaimForm((current) => ({ ...current, password: event.target.value }))}
                                                            placeholder="อย่างน้อย 8 ตัว มีตัวอักษรและตัวเลข"
                                                            autoComplete="new-password"
                                                        />
                                                    </label>
                                                    <label>
                                                        <span>ยืนยันรหัสผ่าน</span>
                                                        <input
                                                            type="password"
                                                            value={claimForm.confirmPassword}
                                                            onChange={(event) => setClaimForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                                                            autoComplete="new-password"
                                                        />
                                                    </label>
                                                    <small>ระบบจะส่ง OTP ไปยังอีเมล ส่วนรหัสผ่านให้แจ้งผู้ป่วยโดยตรงและไม่ส่งผ่านอีเมล</small>
                                                    {claimError && <p className={styles.claimError}>{claimError}</p>}
                                                    <div className={styles.claimActions}>
                                                        <button type="button" className={styles.claimCancelButton} onClick={() => {
                                                            setClaimFormOpen(false);
                                                            setClaimForm(EMPTY_CLAIM_FORM);
                                                            setClaimError('');
                                                        }} disabled={claimSaving}>ยกเลิก</button>
                                                        <button type="button" onClick={createWalkinOnlineAccount} disabled={claimSaving}>
                                                            {claimSaving ? 'กำลังสร้าง...' : 'สร้างบัญชีและส่ง OTP'}
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className={styles.modernInfoGrid}>
                                            <div className={styles.modernInfoItem}>
                                                <div className={styles.modernInfoIcon}>
                                                    <User size={20} strokeWidth={2.2} />
                                                </div>
                                                <div>
                                                    <p>เลขบัตรประชาชน</p>
                                                    <strong>{selectedPatient.national_id || '-'}</strong>
                                                </div>
                                            </div>

                                            <div className={styles.modernInfoItem}>
                                                <div className={styles.modernInfoIcon}>
                                                    <Phone size={20} strokeWidth={2.2} />
                                                </div>
                                                <div>
                                                    <p>เบอร์โทรศัพท์</p>
                                                    <strong>{selectedPatient.phone || '-'}</strong>
                                                </div>
                                            </div>

                                            <div className={styles.modernInfoItem}>
                                                <div className={styles.modernInfoIcon}>
                                                    <CalendarDays size={20} strokeWidth={2.2} />
                                                </div>
                                                <div>
                                                    <p>วันเกิด</p>
                                                    <strong>
                                                        {selectedPatient.dob
                                                            ? new Date(selectedPatient.dob).toLocaleDateString('th-TH', {
                                                                day: 'numeric',
                                                                month: 'short',
                                                                year: 'numeric',
                                                            })
                                                            : '-'}
                                                    </strong>
                                                </div>
                                            </div>

                                            <div className={styles.modernInfoItem}>
                                                <div className={styles.modernInfoIcon}>
                                                    <MapPin size={20} strokeWidth={2.2} />
                                                </div>
                                                <div>
                                                    <p>ที่อยู่</p>
                                                    <strong>{selectedPatient.address || '-'}</strong>
                                                </div>
                                            </div>
                                        </div>

                                        <div className={styles.modernHealthGrid}>
                                            <div className={styles.modernHealthCard}>
                                                <Weight size={26} strokeWidth={2.1} />
                                                <div>
                                                    <p>BW น้ำหนัก</p>
                                                    <strong>
                                                        {(selectedPatient as any).weight || '-'} <small>กก.</small>
                                                    </strong>
                                                </div>
                                            </div>

                                            <div className={styles.modernHealthCard}>
                                                <Ruler size={26} strokeWidth={2.1} />
                                                <div>
                                                    <p>HT ส่วนสูง</p>
                                                    <strong>
                                                        {(selectedPatient as any).height || '-'} <small>ซม.</small>
                                                    </strong>
                                                </div>
                                            </div>
                                        </div>

                                        <div className={styles.modernAllergyGrid}>
                                            <div className={styles.modernDrugCard}>
                                                <p>
                                                    <Pill size={18} strokeWidth={2.2} />
                                                    แพ้ยา
                                                </p>
                                                <strong>{selectedPatient.drug_allergy || '-'}</strong>
                                            </div>

                                            <div className={styles.modernFoodCard}>
                                                <p>
                                                    <Utensils size={18} strokeWidth={2.2} />
                                                    แพ้อาหาร
                                                </p>
                                                <strong>{selectedPatient.food_allergy || '-'}</strong>
                                            </div>
                                        </div>

                                        <div className={styles.modernHistorySection}>
                                            <h4>ประวัติการนัดหมาย</h4>

                                            {(selectedPatient.appointments || []).length === 0 ? (
                                                <div className={styles.noHistoryBox}>
                                                    ไม่มีประวัติการนัดหมาย
                                                </div>
                                            ) : (
                                                (selectedPatient.appointments || []).map((appointment) => (
                                                    <div
                                                        key={appointment.appointment_id || appointment.id}
                                                        className={styles.modernHistoryCard}
                                                    >
                                                        <div>
                                                            <strong>
                                                                {getAppointmentDate(appointment)} •{' '}
                                                                {getAppointmentTimeLabel(appointment)}
                                                            </strong>

                                                            <p>
                                                                {getAppointmentPeriod(appointment)}
                                                            </p>
                                                        </div>

                                                        <span
                                                            className={
                                                                appointment.status === 'approved'
                                                                    ? styles.historyApproved
                                                                    : appointment.status === 'cancelled'
                                                                        ? styles.historyCancelled
                                                                        : styles.historyPending
                                                            }
                                                        >
                                                            {appointment.status === 'approved'
                                                                ? 'อนุมัติ'
                                                                : appointment.status === 'cancelled'
                                                                    ? 'ยกเลิก'
                                                                    : 'รอดำเนินการ'}
                                                        </span>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
