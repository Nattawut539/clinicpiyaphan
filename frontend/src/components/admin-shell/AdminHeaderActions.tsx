'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from '@/lib/cookies';
import dayjs from 'dayjs';
import { Bell, CalendarClock, X } from 'lucide-react';
import { API_BASE } from '@/lib/api';
import { resolveBackendImage } from '@/lib/images';
import { PROFILE_UPDATED_EVENT, ProfileUpdateDetail, withImageVersion } from '@/lib/profileUpdates';
import styles from './AdminHeaderActions.module.css';

const API = API_BASE.endsWith('/api') ? API_BASE : `${API_BASE}/api`;

type AdminProfile = {
    user_id?: number;
    first_name: string;
    last_name: string;
    profile_image?: string | null;
    role?: string | null;
    email?: string | null;
};

type AppointmentNotice = {
    service_date: string;
    status: string;
};

type ImportantEvent = {
    kind: 'pending_appointment';
    due: 'today' | 'tomorrow';
};

function getRoleLabel(role?: string | null) {
    const labels: Record<string, string> = {
        admin: 'ผู้ดูแลระบบ',
        super_admin: 'ผู้ดูแลระบบสูงสุด',
        superadmin: 'ผู้ดูแลระบบสูงสุด',
        doctor: 'แพทย์',
        assistant: 'ผู้ช่วย',
    };
    return labels[String(role || '').toLowerCase()] || role || 'ผู้ดูแลระบบ';
}

export default function AdminHeaderActions() {
    const router = useRouter();
    const [profile, setProfile] = useState<AdminProfile>({
        first_name: '',
        last_name: '',
        profile_image: null,
        role: '',
    });
    const [importantEvents, setImportantEvents] = useState<ImportantEvent[]>([]);
    const [avatarFailed, setAvatarFailed] = useState(false);
    const [imageVersion, setImageVersion] = useState<string>();
    const [notificationOpen, setNotificationOpen] = useState(false);

    useEffect(() => {
        const token = Cookies.get('adminToken') || '';
        if (!token) return;

        const headers = { Authorization: `Bearer ${token}` };
        const todayKey = dayjs().format('YYYY-MM-DD');
        const tomorrowKey = dayjs().add(1, 'day').format('YYYY-MM-DD');

        Promise.all([
            fetch(`${API}/me/profile`, { headers, credentials: 'include', cache: 'no-store' }),
            fetch(`${API}/appointments`, { headers, credentials: 'include', cache: 'no-store' }),
        ])
            .then(async ([profileResponse, appointmentResponse]) => {
                if (profileResponse.ok) setProfile(await profileResponse.json());

                if (appointmentResponse.ok) {
                    const data: unknown = await appointmentResponse.json();
                    const events: ImportantEvent[] = Array.isArray(data)
                        ? (data as AppointmentNotice[]).flatMap((item): ImportantEvent[] => {
                            const appointmentDate = dayjs(item.service_date).format('YYYY-MM-DD');
                            const isPending =
                                item.status === 'pending' ||
                                item.status === 'waiting' ||
                                item.status === 'รอดำเนินการ';

                            if (!isPending) return [];
                            if (appointmentDate === todayKey) {
                                return [{ kind: 'pending_appointment', due: 'today' }];
                            }
                            if (appointmentDate === tomorrowKey) {
                                return [{ kind: 'pending_appointment', due: 'tomorrow' }];
                            }
                            return [];
                        })
                        : [];
                    setImportantEvents(events);
                }
            })
            .catch((error) => console.error('โหลดข้อมูลส่วนหัว Admin ไม่สำเร็จ:', error));
    }, []);

    useEffect(() => {
        const updateProfile = (event: Event) => {
            const detail = (event as CustomEvent<ProfileUpdateDetail>).detail;
            if (!detail?.profile) return;
            setProfile((current) => ({
                ...current,
                ...detail.profile,
                first_name: detail.profile.first_name ?? current.first_name,
                last_name: detail.profile.last_name ?? current.last_name,
            }));
            if (detail.imageVersion) setImageVersion(detail.imageVersion);
            setAvatarFailed(false);
        };

        window.addEventListener(PROFILE_UPDATED_EVENT, updateProfile);
        return () => window.removeEventListener(PROFILE_UPDATED_EVENT, updateProfile);
    }, []);

    const todayPendingCount = importantEvents.filter((event) => event.due === 'today').length;
    const tomorrowPendingCount = importantEvents.filter((event) => event.due === 'tomorrow').length;
    const notificationCount = importantEvents.length;
    const fullName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Admin';
    const imageSrc = withImageVersion(resolveBackendImage(profile.profile_image), imageVersion);

    return (
        <div className={styles.actions}>
            <button
                className={styles.notificationButton}
                type="button"
                title={`เหตุการณ์สำคัญ ${notificationCount} รายการ`}
                onClick={() => setNotificationOpen(true)}
            >
                <Bell size={22} strokeWidth={2} />
                {notificationCount > 0 && (
                    <span className={styles.notificationCount}>
                        {notificationCount > 99 ? '99+' : notificationCount}
                    </span>
                )}
            </button>

            {notificationOpen && (
                <div
                    className={styles.notificationOverlay}
                    onClick={() => setNotificationOpen(false)}
                >
                    <section
                        className={styles.notificationPopup}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="admin-notification-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <header className={styles.notificationHeader}>
                            <div className={styles.notificationIcon}>
                                <Bell size={24} strokeWidth={2.2} />
                            </div>
                            <div>
                                <h3 id="admin-notification-title">การแจ้งเตือนสำคัญ</h3>
                                <p>{notificationCount} เหตุการณ์ที่ต้องตรวจสอบ</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setNotificationOpen(false)}
                                aria-label="ปิดการแจ้งเตือน"
                            >
                                <X size={20} />
                            </button>
                        </header>

                        <div className={styles.notificationBody}>
                            {notificationCount === 0 ? (
                                <div className={styles.notificationEmpty}>
                                    <CalendarClock size={34} strokeWidth={1.8} />
                                    <strong>ไม่มีเหตุการณ์สำคัญ</strong>
                                    <span>ขณะนี้ไม่มีคำขอใกล้ถึงวันนัดที่รออนุมัติ</span>
                                </div>
                            ) : (
                                <>
                                    {todayPendingCount > 0 && (
                                        <article className={`${styles.notificationMessage} ${styles.urgentMessage}`}>
                                            <CalendarClock size={22} />
                                            <div>
                                                <strong>คำขอนัดหมายของวันนี้</strong>
                                                <p>มีคำขอที่ยังรออนุมัติ {todayPendingCount} รายการ กรุณาตรวจสอบโดยเร็ว</p>
                                            </div>
                                            <b>{todayPendingCount}</b>
                                        </article>
                                    )}

                                    {tomorrowPendingCount > 0 && (
                                        <article className={styles.notificationMessage}>
                                            <CalendarClock size={22} />
                                            <div>
                                                <strong>คำขอนัดหมายของวันพรุ่งนี้</strong>
                                                <p>มีคำขอที่ยังรออนุมัติ {tomorrowPendingCount} รายการ ก่อนถึงวันนัด 1 วัน</p>
                                            </div>
                                            <b>{tomorrowPendingCount}</b>
                                        </article>
                                    )}
                                </>
                            )}
                        </div>

                        <footer className={styles.notificationFooter}>
                            <button type="button" onClick={() => setNotificationOpen(false)}>
                                ปิด
                            </button>
                            {notificationCount > 0 && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setNotificationOpen(false);
                                        router.push('/admin/appointment');
                                    }}
                                >
                                    ไปหน้าจัดการคิว
                                </button>
                            )}
                        </footer>
                    </section>
                </div>
            )}

            <button
                type="button"
                className={styles.profileButton}
                onClick={() => router.push('/admin/profile')}
                title="เปิดโปรไฟล์ Admin"
            >
                <div className={styles.avatar}>
                    {imageSrc && !avatarFailed ? (
                        <img src={imageSrc} alt={fullName} onError={() => setAvatarFailed(true)} />
                    ) : (
                        (profile.first_name || 'A').charAt(0).toUpperCase()
                    )}
                </div>
                <div className={styles.profileText}>
                    <span>{fullName}</span>
                    <small>{getRoleLabel(profile.role)}</small>
                </div>
            </button>
        </div>
    );
}
