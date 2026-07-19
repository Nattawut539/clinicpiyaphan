'use client';

import { ChangeEvent, Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import styles from './information.module.css';
import Cookies from 'js-cookie';
import Link from 'next/link';
import Image from 'next/image';
import dayjs from 'dayjs';
import 'dayjs/locale/th';
import { API_BASE } from '@/lib/api';
import { resolveBackendImage } from '@/lib/images';
import AdminHeaderActions from '@/components/admin-shell/AdminHeaderActions';
import { AlertTriangle, CheckCircle2, Save, Trash2, X } from 'lucide-react';
import ThaiDatePicker from '@/components/date/ThaiDatePicker';
dayjs.locale('th');

function resolvePatientImage(path?: string | null) {
    return resolveBackendImage(path) || '/img/default-avatar.png';
}

export interface Patient {
    user_id: number;
    patient_code?: string;

    national_id: string;
    title?: string;

    first_name: string;
    last_name: string;

    phone?: string;
    emergency_phone?: string;

    address?: string;
    dob?: string;

    nationality?: string;
    ethnicity?: string;

    gender?: string;
    blood_type?: string;

    email?: string;

    profile_image?: string | null;

    position?: string;

    congenital_disease?: string;
    drug_allergy?: string;
    food_allergy?: string;

    created_at: string | null;
}

export interface Profile {
    first_name: string;
    last_name: string;
    profile_image?: string | null;
}

export type PatientFull = Patient & {
    admit_date?: string | null;
};

function PatientProfileContent() {
    const searchParams = useSearchParams();
    const userId = searchParams.get('user_id');
    const router = useRouter();
    const token = useMemo(() => Cookies.get('adminToken') || '', []);

    const [ageDetail, setAgeDetail] = useState('');
    const [loading, setLoading] = useState(true);
    const [showPopup, setShowPopup] = useState(false);
    const [popupMessage, setPopupMessage] = useState('');
    const [popupType, setPopupType] = useState<'success' | 'error'>('success');
    const [isBackLoading, setIsBackLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [preview, setPreview] = useState<string | null>(null);

    //เก็บค่าต้นฉบับไว้ใช้เทียบ
    const [originalPatient, setOriginalPatient] = useState<Patient | null>(null);
    const [isDirty, setIsDirty] = useState(false);

    const [confirmAction, setConfirmAction] = useState<'save' | 'delete' | null>(null);
    const [deleting, setDeleting] = useState(false);

    const [patient, setPatient] = useState<Patient>({
        user_id: 0,
        national_id: "",
        first_name: "",
        last_name: "",
        profile_image: null,
        created_at: "",
    });

    const calculateThaiAge = (dobStr: string) => {
        const birthDate = dayjs(dobStr);
        const today = dayjs();
        const years = today.diff(birthDate, 'year');
        const months = today.diff(birthDate.add(years, 'year'), 'month');
        const days = today.diff(birthDate.add(years, 'year').add(months, 'month'), 'day');
        return `${years} ปี ${months} เดือน ${days} วัน`;
    };

    // ฟังก์ชันเช็คว่ามีการแก้ไขข้อมูลหรือยัง
    const isPatientDirty = (next: Patient, original: Patient | null) => {
        if (!original) return false;
        const keys: (keyof Patient)[] = [
            'dob',
            'address',
            'nationality',
            'ethnicity',
            'gender',
            'blood_type',
            'phone',
            'emergency_phone',
            'email',
            'position',
            'congenital_disease',
            'drug_allergy',
            'food_allergy',
        ];
        return keys.some((k) => (next[k] || '') !== (original[k] || ''));
    };

    const handleChange = (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
    ) => {
        const { name, value } = e.target;
        setPatient(prev => {
            const next = { ...prev, [name]: value } as Patient;
            setIsDirty(isPatientDirty(next, originalPatient));
            return next;
        });
    };

    function handlePickFile(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 3 * 1024 * 1024) {
            setPopupMessage('ไฟล์ขนาดใหญ่เกิน 3MB');
            setPopupType('error');
            setShowPopup(true);
            setTimeout(() => setShowPopup(false), 1800);
            e.target.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = () => setPreview(String(reader.result));
        reader.readAsDataURL(file);
    }

    async function uploadSelectedImage() {
        const input = document.getElementById('profileFile') as HTMLInputElement | null;
        const file = input?.files?.[0];
        if (!file) return null;

        const fd = new FormData();
        fd.append('file', file);

        const res = await fetch(`${API_BASE}/patients/${patient.user_id}/profile`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
            credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'อัปโหลดรูปไม่สำเร็จ');

        if (input) input.value = '';
        setPreview(null);
        return data.profile_image as string | null;
    }

    function formatThaiDate(date?: string | null) {
        if (!date) return "-";
        return new Date(date).toLocaleDateString("th-TH", {
            day: "numeric",
            month: "long",
            year: "numeric",
        });
    }

    const requestSave = () => {
        if (!isDirty && !preview) {
            setPopupMessage('กรุณาแก้ไข หรือเพิ่มเติมข้อมูลก่อนบันทึก');
            setPopupType('error');
            setShowPopup(true);
            setTimeout(() => setShowPopup(false), 2000);
            return;
        }

        setConfirmAction('save');
    };

    const performUpdate = async () => {
        try {
            setUploading(true);
            const body = {
                birth_date: patient.dob,
                address: patient.address,
                nationality: patient.nationality,
                ethnicity: patient.ethnicity,
                gender: patient.gender,
                blood_type: patient.blood_type,
                phone: patient.phone,
                emergency_phone: patient.emergency_phone,
                email: patient.email,
                position: patient.position,
                congenital_disease: patient.congenital_disease,
                drug_allergy: patient.drug_allergy,
                food_allergy: patient.food_allergy,
            };

            if (isDirty) {
                const res = await fetch(`${API_BASE}/patients/${patient.user_id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    credentials: 'include',
                    body: JSON.stringify(body),
                });

                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.message || 'อัปเดตไม่สำเร็จ');
            }

            const profileImage = preview ? await uploadSelectedImage() : patient.profile_image;
            const savedPatient = { ...patient, profile_image: profileImage };
            setPatient(savedPatient);

            // อัปเดตค่าต้นฉบับ + รีเซ็ตสถานะ dirty
            setOriginalPatient(savedPatient);
            setIsDirty(false);

            setPopupMessage('บันทึกข้อมูลสำเร็จ');
            setPopupType('success');
        } catch (error) {
            setPopupMessage(error instanceof Error ? error.message : 'บันทึกข้อมูลไม่สำเร็จ');
            setPopupType('error');
        } finally {
            setUploading(false);
            setShowPopup(true);
            setTimeout(() => setShowPopup(false), 2000);
        }
    };

    // เดิม: ย้าย logic ลบมาอยู่ฟังก์ชันแยก แล้วค่อยเรียกตอนกด "ตกลง"
    async function doDelete() {
        try {
            setDeleting(true);
            const res = await fetch(`${API_BASE}/patients/${patient.user_id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
                credentials: 'include',
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || 'ลบไม่สำเร็จ');

            setPopupMessage('ลบบัญชีผู้ป่วยเรียบร้อยแล้ว');
            setPopupType('success');
            setShowPopup(true);
            setTimeout(() => router.push('/admin/admins'), 1200);
        } catch (error) {
            setPopupMessage(error instanceof Error ? error.message : 'ลบบัญชีผู้ป่วยไม่สำเร็จ');
            setPopupType('error');
            setShowPopup(true);
            setTimeout(() => setShowPopup(false), 2000);
        } finally {
            setDeleting(false);
        }
    }

    function handleDelete() {
        setConfirmAction('delete');
    }

    async function confirmSelectedAction() {
        const action = confirmAction;
        setConfirmAction(null);
        if (action === 'save') await performUpdate();
        if (action === 'delete') await doDelete();
    }

    const handleBack = () => {
        setIsBackLoading(true);
        setTimeout(() => router.back(), 800);
    };

    useEffect(() => {
        async function load() {
            try {
                const r = await fetch(`${API_BASE}/patients/${userId}`, {
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    cache: 'no-store',
                    credentials: 'include',
                });
                if (!r.ok) throw new Error('ไม่พบข้อมูลผู้ป่วย');
                const p = await r.json();
                setPatient(p);

                //เก็บค่า original ตอนโหลดครั้งแรก
                setOriginalPatient(p);
                setIsDirty(false);
            } catch (e) {
                console.error('โหลดข้อมูลล้มเหลว:', e);
            } finally {
                setTimeout(() => setLoading(false), 300);
            }
        }
        if (userId) load();
    }, [userId, token]);

    useEffect(() => {
        const dob = patient?.dob;
        if (dob) setAgeDetail(calculateThaiAge(dob));
    }, [patient?.dob]);

    if (loading || isBackLoading) return <div className={styles.loaderWrapper} />;

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div className={styles.leftHeader}>
                    <Link href="/dashboard">
                        <Image src="/img/profileclinic.png" alt="logo" className={styles.logoIcon} width={40} height={40} />
                    </Link>
                    <span className={styles.brand}>ข้อมูลผู้ป่วย</span>
                </div>
                <AdminHeaderActions />
            </header>

            <div className={styles.wrapper}>
                <button className={styles.button} onClick={handleBack}>
                    <div className={styles.buttonBox}>
                        <span className={styles.buttonElem}>
                            <svg viewBox="0 0 24 24" className={styles.arrowIcon}>
                                <path fill="black" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
                            </svg>
                        </span>
                        <span className={styles.buttonElem}>
                            <svg viewBox="0 0 24 24" className={styles.arrowIcon}>
                                <path fill="black" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
                            </svg>
                        </span>
                    </div>
                </button>
            </div>

            {showPopup && (
                <div className={`${styles.popupMessage} ${popupType === 'success' ? styles.popupSuccess : styles.popupError}`}>
                    {popupType === 'success' ? <CheckCircle2 size={21} /> : <AlertTriangle size={21} />}
                    <span>{popupMessage}</span>
                </div>
            )}

            {confirmAction && (
                <div className={styles.confirmOverlay} onMouseDown={() => setConfirmAction(null)}>
                    <div className={styles.confirmDialog} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
                        <button className={styles.confirmClose} type="button" onClick={() => setConfirmAction(null)} aria-label="ปิด">
                            <X size={20} />
                        </button>
                        <div className={confirmAction === 'delete' ? styles.confirmIconDanger : styles.confirmIconSave}>
                            {confirmAction === 'delete' ? <Trash2 size={29} /> : <Save size={29} />}
                        </div>
                        <h2>{confirmAction === 'delete' ? 'ยืนยันการลบบัญชีผู้ป่วย' : 'ยืนยันการบันทึกข้อมูล'}</h2>
                        <p>
                            {confirmAction === 'delete'
                                ? `ต้องการลบบัญชีของ ${patient.first_name} ${patient.last_name} ใช่หรือไม่?`
                                : `ต้องการบันทึกข้อมูลที่แก้ไขของ ${patient.first_name} ${patient.last_name} ใช่หรือไม่?`}
                        </p>
                        {confirmAction === 'delete' && (
                            <div className={styles.deleteWarning}>
                                <AlertTriangle size={18} />
                                การลบจะนำบัญชี คิว นัดหมาย และเวชระเบียนที่เกี่ยวข้องออกอย่างถาวร ไม่สามารถย้อนกลับได้
                            </div>
                        )}
                        <div className={styles.confirmActions}>
                            <button type="button" className={styles.confirmCancel} onClick={() => setConfirmAction(null)}>ยกเลิก</button>
                            <button
                                type="button"
                                className={confirmAction === 'delete' ? styles.confirmDelete : styles.confirmSave}
                                onClick={confirmSelectedAction}
                            >
                                {confirmAction === 'delete' ? <Trash2 size={17} /> : <Save size={17} />}
                                {confirmAction === 'delete' ? 'ยืนยันลบบัญชี' : 'ยืนยันบันทึก'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <section className={styles.contentArea}>
                {patient && (
                    <div className={styles.cardContainer}>
                        {/* การ์ดข้อมูลส่วนตัว */}
                        <div className={styles.card}>
                            <div className={styles.cardHeader}>ข้อมูลส่วนตัว</div>
                            <div className={styles.topSection}>
                                <div className={styles.photoColumn}>
                                    <div className={styles.photoContainer}>
                                        <Image
                                            src={preview || resolvePatientImage(patient?.profile_image)}
                                            width={128}
                                            height={128}
                                            unoptimized
                                            onError={(e) => { e.currentTarget.src = '/img/default-avatar.png'; }}
                                            alt="profile"
                                            className={styles.profileImage}
                                        />

                                        <div
                                            className={styles.cameraIconWrapper}
                                            onClick={() => document.getElementById('profileFile')?.click()}
                                        >
                                            <svg viewBox="0 0 24 24">
                                                <path fill="white" d="M19 11H13V5h-2v6H5v2h6v6h2v-6h6z" />
                                            </svg>
                                        </div>
                                    </div>

                                    <input
                                        id="profileFile"
                                        type="file"
                                        accept="image/*"
                                        className={styles.hiddenfile}
                                        onChange={handlePickFile}
                                    />
                                </div>

                                <div className={styles.nameSection}>
                                    <div className={styles.name}><strong>{patient.first_name} {patient.last_name}</strong></div>
                                    <div className={styles.subInfo}>รหัสผู้ป่วย : {String(patient.user_id).padStart(3, '0')}</div>
                                </div>
                            </div>

                            <hr className={styles.divider} />
                            <div className={styles.infoGroup}>
                                <div className={styles.inlineGroup}>
                                    <span>วันเดือนปีเกิด :</span>
                                    <ThaiDatePicker
                                        value={patient?.dob ? dayjs(patient.dob).format('YYYY-MM-DD') : ''}
                                        onChange={(newDob) => {
                                            setPatient(prev => {
                                                const next = { ...prev, dob: newDob } as Patient;
                                                setIsDirty(isPatientDirty(next, originalPatient));
                                                return next;
                                            });
                                            setAgeDetail(newDob ? calculateThaiAge(newDob) : '');
                                        }}
                                        endYear={new Date().getFullYear()}
                                    />
                                    <span>อายุ :</span>
                                    <input name="age" value={ageDetail} readOnly className={styles.inputage} />
                                </div>

                                <div className={styles.inlineGroup}>
                                    <span>เพศ :</span>
                                    <select name="gender" value={patient.gender || ''} onChange={handleChange} className={styles.input} >
                                        <option value="" > --- เพศกำเนิด ---</option>
                                        <option value="เพศชาย" >ชาย</option>
                                        <option value="เพศหญิง" >หญิง</option>
                                        <option value="ไม่ระบุ" >ไม่ระบุ</option>
                                    </select>
                                    <span>กรุ๊ปเลือด :</span>
                                    <select name="blood_type" value={patient.blood_type || ''} onChange={handleChange} className={styles.inputbloodtype} >
                                        <option value="" > --- เลือกกรุ๊ปเลือด ---</option>
                                        <option value="A" >A</option>
                                        <option value="B" >B</option>
                                        <option value="O" >O</option>
                                        <option value="AB" >AB</option>
                                    </select>
                                </div>

                                <div className={styles.inlineGroup}>
                                    <span>สัญชาติ :</span>
                                    <input name="nationality" value={patient.nationality || ''} onChange={handleChange} className={styles.inputmessage} />
                                    <span>เชื้อชาติ :</span>
                                    <input name="ethnicity" value={patient.ethnicity || ''} onChange={handleChange} className={styles.inputmessage} />
                                    <span>อาชีพ :</span>
                                    <input name="position" value={patient.position || ''} onChange={handleChange} className={styles.inputmessage} />
                                </div>

                                <div className={styles.inlineGroup} style={{ display: 'flex' }}>
                                    <span>ที่อยู่ :</span>
                                    <textarea
                                        name="address"
                                        value={patient.address || ''}
                                        onChange={handleChange}
                                        maxLength={270}
                                        rows={2}
                                        className={`${styles.textareaAddress} ${styles.addressInput}`}
                                    />
                                </div>

                                <div className={styles.inlineGroup}>
                                    <span>เบอร์ติดต่อ :</span>
                                    <input name="phone" value={patient.phone || ''} onChange={handleChange} maxLength={10} inputMode="numeric" className={styles.inputphone} />
                                    <span>เบอร์ติดต่อ (ฉุกเฉิน) :</span>
                                    <input name="emergency_phone" value={patient.emergency_phone || ''} onChange={handleChange} maxLength={10} inputMode="numeric" className={styles.inputemergencyphone} />
                                </div>

                                <div className={styles.inlineGroup}>
                                    <span>อีเมล :</span>
                                    <input name="email" value={patient.email || ''} onChange={handleChange} maxLength={50} className={styles.inputemail} />
                                </div>
                            </div>

                            <div className={styles.footerData}>
                                วันที่เข้ารับการรักษา : {formatThaiDate(patient.created_at)}
                            </div>
                        </div>

                        {/* การ์ดข้อมูลการแพทย์ */}
                        <div className={styles.card}>
                            <div className={styles.cardHeader}>ข้อมูลการแพทย์</div>

                            <div className={styles.infoGroup}>
                                <div className={styles.inlineGroup}>
                                    <span><b>โรคประจำตัว </b></span>
                                    <input
                                        name="congenital_disease"
                                        value={patient.congenital_disease || ''}
                                        onChange={handleChange}
                                        className={`${styles.inputdisease} ${styles.emergencyInput}`}
                                    />
                                </div>

                                <div className={styles.inlineGroup}>
                                    <span style={{ marginTop: '12px' }}><b>ประวัติแพ้ยา </b></span>
                                    <input
                                        name="drug_allergy"
                                        value={patient.drug_allergy || ''}
                                        onChange={handleChange}
                                        className={`${styles.inputdisease} ${styles.emergencyInput}`}
                                    />
                                </div>

                                <div className={styles.inlineGroup}>
                                    <span style={{ marginTop: '12px' }}><b>ประวัติแพ้อาหาร </b></span>
                                    <input
                                        name="food_allergy"
                                        value={patient.food_allergy || ''}
                                        onChange={handleChange}
                                        className={`${styles.inputdisease} ${styles.emergencyInput}`}
                                    />
                                </div>
                            </div>

                            <div className={styles.actionRow}>
                                <button
                                    className={`${styles.btn} ${styles.btnPrimary}`}
                                    onClick={requestSave}
                                    disabled={(!isDirty && !preview) || uploading}
                                >
                                    {uploading ? 'กำลังบันทึก…' : 'บันทึก'}
                                </button>

                                <button
                                    className={`${styles.btn} ${styles.btnDanger}`}
                                    onClick={handleDelete}
                                    disabled={deleting}
                                >
                                    {deleting ? 'กำลังลบ…' : 'ลบผู้ป่วย'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}

export default function PatientProfilePage() {
    return (
        <Suspense fallback={null}>
            <PatientProfileContent />
        </Suspense>
    );
}
