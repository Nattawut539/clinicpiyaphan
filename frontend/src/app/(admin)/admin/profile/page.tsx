'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import Cookies from 'js-cookie';
import {
    ArrowLeft,
    Camera,
    Mail,
    Pencil,
    Save,
    ShieldCheck,
    LockKeyhole,
    UserPlus,
    UserRound,
    X,
} from 'lucide-react';
import { API_BASE } from '@/lib/api';
import { resolveBackendImage } from '@/lib/images';
import Sidebar from '@/components/admin-shell/AdminSidebar';
import AdminHeaderActions from '@/components/admin-shell/AdminHeaderActions';
import styles from './Profile.module.css';

const API = API_BASE.endsWith('/api') ? API_BASE : `${API_BASE}/api`;

type Profile = {
    user_id?: number;
    first_name: string;
    last_name: string;
    profile_image?: string | null;
    role?: string | null;
    email?: string | null;
};

type ProfileForm = { first_name: string; last_name: string; email: string };
type StaffForm = {
    first_name: string;
    last_name: string;
    username: string;
    email: string;
    password: string;
    confirmPassword: string;
    superAdminPassword: string;
    role: 'admin' | 'doctor';
};

const EMPTY_STAFF_FORM: StaffForm = {
    first_name: '', last_name: '', username: '', email: '',
    password: '', confirmPassword: '', superAdminPassword: '', role: 'admin',
};

function getRoleLabel(role?: string | null) {
    const labels: Record<string, string> = {
        admin: 'ผู้ดูแลระบบ',
        super_admin: 'ผู้ดูแลระบบสูงสุด',
        superadmin: 'ผู้ดูแลระบบสูงสุด',
        doctor: 'แพทย์',
        assistant: 'ผู้ช่วย',
    };
    return labels[String(role || '').toLowerCase()] || role || '-';
}

async function readResponse(response: Response) {
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || data?.error || 'ดำเนินการไม่สำเร็จ');
    return data;
}

export default function AdminProfilePage() {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [profileForm, setProfileForm] = useState<ProfileForm>({ first_name: '', last_name: '', email: '' });
    const [staffForm, setStaffForm] = useState<StaffForm>(EMPTY_STAFF_FORM);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [editing, setEditing] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [imageFailed, setImageFailed] = useState(false);

    const token = Cookies.get('adminToken') || '';
    const isSuperAdmin = ['super_admin', 'superadmin'].includes(String(profile?.role || '').toLowerCase());
    const previewUrl = useMemo(() => imageFile ? URL.createObjectURL(imageFile) : null, [imageFile]);

    useEffect(() => () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    }, [previewUrl]);

    useEffect(() => {
        fetch(`${API}/me/profile`, {
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include',
            cache: 'no-store',
        })
            .then(readResponse)
            .then((data: Profile) => {
                setProfile(data);
                setProfileForm({
                    first_name: data.first_name || '',
                    last_name: data.last_name || '',
                    email: data.email || '',
                });
            })
            .catch((reason) => setError(reason instanceof Error ? reason.message : 'โหลดโปรไฟล์ไม่สำเร็จ'))
            .finally(() => setLoading(false));
    }, [token]);

    const updateProfileField = (field: keyof ProfileForm, value: string) => {
        setProfileForm((current) => ({ ...current, [field]: value }));
    };

    const updateStaffField = <K extends keyof StaffForm>(field: K, value: StaffForm[K]) => {
        setStaffForm((current) => ({ ...current, [field]: value }));
    };

    const chooseImage = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0] || null;
        if (file && file.size > 3 * 1024 * 1024) {
            setError('รูปภาพต้องมีขนาดไม่เกิน 3 MB');
            event.target.value = '';
            return;
        }
        setError('');
        setImageFile(file);
        setImageFailed(false);
    };

    const cancelEditing = () => {
        if (profile) {
            setProfileForm({
                first_name: profile.first_name || '',
                last_name: profile.last_name || '',
                email: profile.email || '',
            });
        }
        setImageFile(null);
        setEditing(false);
        setError('');
    };

    const saveProfile = async (event: FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        setNotice('');

        try {
            const body = new FormData();
            body.append('first_name', profileForm.first_name.trim());
            body.append('last_name', profileForm.last_name.trim());
            body.append('email', profileForm.email.trim());
            if (imageFile) body.append('file', imageFile);

            const data: Profile = await readResponse(await fetch(`${API}/me/profile`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}` },
                credentials: 'include',
                body,
            }));

            setProfile(data);
            setProfileForm({ first_name: data.first_name, last_name: data.last_name, email: data.email || '' });
            setImageFile(null);
            setEditing(false);
            setNotice('บันทึกโปรไฟล์เรียบร้อยแล้ว');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'บันทึกโปรไฟล์ไม่สำเร็จ');
        } finally {
            setSaving(false);
        }
    };

    const createStaff = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        setNotice('');
        if (staffForm.password !== staffForm.confirmPassword) {
            setError('รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน');
            return;
        }

        setCreating(true);
        try {
            await readResponse(await fetch(`${API}/staff/accounts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                credentials: 'include',
                body: JSON.stringify({
                    first_name: staffForm.first_name.trim(),
                    last_name: staffForm.last_name.trim(),
                    username: staffForm.username.trim(),
                    email: staffForm.email.trim(),
                    password: staffForm.password,
                    role: staffForm.role,
                    super_admin_password: staffForm.superAdminPassword,
                }),
            }));
            setStaffForm(EMPTY_STAFF_FORM);
            setShowCreate(false);
            setNotice(`สร้างบัญชี ${getRoleLabel(staffForm.role)} สำเร็จ`);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'สร้างบัญชีไม่สำเร็จ');
        } finally {
            setCreating(false);
        }
    };

    const fullName = profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Admin' : 'Admin';
    const imageSrc = previewUrl || resolveBackendImage(profile?.profile_image);

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div><h1>โปรไฟล์ Admin</h1><p>ข้อมูลบัญชีและสิทธิ์การใช้งานระบบ</p></div>
                <AdminHeaderActions />
            </header>

            <div className={styles.wrapper}>
                <Sidebar />
                <main className={styles.main}>
                    <div className={styles.pageActions}>
                        <Link href="/admin/dashboard" className={styles.backLink}><ArrowLeft size={18} /> กลับหน้าหลัก</Link>
                        {profile && !editing && (
                            <button type="button" className={styles.editButton} onClick={() => setEditing(true)}>
                                <Pencil size={17} /> แก้ไขโปรไฟล์
                            </button>
                        )}
                    </div>

                    {notice && <div className={styles.successMessage}>{notice}</div>}
                    {error && !loading && <div className={styles.errorMessage}>{error}</div>}

                    {loading ? (
                        <div className={styles.stateCard}>กำลังโหลดโปรไฟล์...</div>
                    ) : profile ? (
                        <>
                            <section className={styles.profileCard}>
                                <div className={styles.profileHero}>
                                    <div className={styles.avatar}>
                                        {imageSrc && !imageFailed ? <Image src={imageSrc} alt={fullName} fill sizes="104px" unoptimized onError={() => setImageFailed(true)} /> : (profile.first_name || 'A').charAt(0).toUpperCase()}
                                        {editing && (
                                            <label className={styles.cameraButton} title="เลือกรูปโปรไฟล์">
                                                <Camera size={18} /><input type="file" accept="image/*" onChange={chooseImage} />
                                            </label>
                                        )}
                                    </div>
                                    <div><span>บัญชีผู้ดูแล</span><h2>{fullName}</h2><p>{getRoleLabel(profile.role)}</p></div>
                                </div>

                                {editing ? (
                                    <form className={styles.profileForm} onSubmit={saveProfile}>
                                        <label><span>ชื่อ</span><input required value={profileForm.first_name} onChange={(e) => updateProfileField('first_name', e.target.value)} /></label>
                                        <label><span>นามสกุล</span><input required value={profileForm.last_name} onChange={(e) => updateProfileField('last_name', e.target.value)} /></label>
                                        <label className={styles.fullField}><span>อีเมล</span><input required type="email" value={profileForm.email} onChange={(e) => updateProfileField('email', e.target.value)} /></label>
                                        <div className={styles.roleLocked}><ShieldCheck size={19} /><div><span>Role (แก้ไขไม่ได้)</span><strong>{getRoleLabel(profile.role)}</strong></div></div>
                                        <div className={styles.formActions}><button type="button" onClick={cancelEditing}><X size={17} /> ยกเลิก</button><button type="submit" disabled={saving}><Save size={17} /> {saving ? 'กำลังบันทึก...' : 'บันทึก'}</button></div>
                                    </form>
                                ) : (
                                    <div className={styles.detailGrid}>
                                        <article><UserRound size={22} /><div><span>รหัสผู้ใช้งาน</span><strong>{profile.user_id ?? '-'}</strong></div></article>
                                        <article><ShieldCheck size={22} /><div><span>Role</span><strong>{getRoleLabel(profile.role)}</strong></div></article>
                                        <article><Mail size={22} /><div><span>อีเมล</span><strong>{profile.email || '-'}</strong></div></article>
                                    </div>
                                )}
                            </section>

                            {isSuperAdmin && (
                                <section className={styles.staffCard}>
                                    <div className={styles.staffHeader}>
                                        <div><UserPlus size={24} /><div><h2>จัดการบัญชีบุคลากร</h2><p>เฉพาะ Super Admin เท่านั้นที่สร้างบัญชี Admin และ Doctor ได้</p></div></div>
                                        {!showCreate && <button type="button" onClick={() => setShowCreate(true)}><UserPlus size={17} /> เพิ่มบัญชี</button>}
                                    </div>
                                    {showCreate && (
                                        <form className={styles.staffForm} onSubmit={createStaff}>
                                            <label><span>ชื่อ</span><input required value={staffForm.first_name} onChange={(e) => updateStaffField('first_name', e.target.value)} /></label>
                                            <label><span>นามสกุล</span><input required value={staffForm.last_name} onChange={(e) => updateStaffField('last_name', e.target.value)} /></label>
                                            <label><span>Username</span><input required value={staffForm.username} onChange={(e) => updateStaffField('username', e.target.value)} /></label>
                                            <label><span>อีเมล</span><input required type="email" value={staffForm.email} onChange={(e) => updateStaffField('email', e.target.value)} /></label>
                                            <label><span>รหัสผ่าน (อย่างน้อย 8 ตัว)</span><input required minLength={8} type="password" value={staffForm.password} onChange={(e) => updateStaffField('password', e.target.value)} /></label>
                                            <label><span>ยืนยันรหัสผ่าน</span><input required minLength={8} type="password" value={staffForm.confirmPassword} onChange={(e) => updateStaffField('confirmPassword', e.target.value)} /></label>
                                            <label className={styles.fullField}><span>Role</span><select value={staffForm.role} onChange={(e) => updateStaffField('role', e.target.value as StaffForm['role'])}><option value="admin">Admin — ผู้ดูแลระบบ</option><option value="doctor">Doctor — แพทย์</option></select><small>Role จะถูกกำหนดตอนสร้างและแก้ผ่านหน้าโปรไฟล์ไม่ได้</small></label>
                                            <div className={styles.securitySection}>
                                                <div className={styles.securityTitle}><LockKeyhole size={19} /><div><strong>ยืนยันตัวตน Super Admin</strong><span>กรอกรหัสผ่านของคุณก่อนอนุญาตให้สร้างบัญชีใหม่</span></div></div>
                                                <label><span>รหัสผ่านปัจจุบันของ Super Admin</span><input required type="password" autoComplete="current-password" value={staffForm.superAdminPassword} onChange={(e) => updateStaffField('superAdminPassword', e.target.value)} placeholder="กรอกรหัสผ่านของคุณ" /></label>
                                            </div>
                                            <div className={styles.formActions}><button type="button" onClick={() => { setShowCreate(false); setStaffForm(EMPTY_STAFF_FORM); }}><X size={17} /> ยกเลิก</button><button type="submit" disabled={creating}><UserPlus size={17} /> {creating ? 'กำลังสร้าง...' : 'สร้างบัญชี'}</button></div>
                                        </form>
                                    )}
                                </section>
                            )}
                        </>
                    ) : null}
                </main>
            </div>
        </div>
    );
}
