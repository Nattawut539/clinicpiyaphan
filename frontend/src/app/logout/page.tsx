'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState } from 'react';
import Cookies from 'js-cookie';
import { useRouter } from 'next/navigation';
import styles from './logout.module.css';
import { API_BASE } from '@/lib/api';

export default function LogoutPage() {
    const router = useRouter();
    const [profile, setProfile] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    // ดึงโปรไฟล์ผู้ใช้มาแสดง (ดึงก่อน logout)
    useEffect(() => {
        async function load() {
            try {
                const token = Cookies.get('adminToken');
                if (!token) {
                    setLoading(false);
                    return;
                }

                const res = await fetch(`${API_BASE}/me/profile`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (res.ok) {
                    setProfile(await res.json());
                } else {
                    setProfile(null);
                }
            } catch {
                setProfile(null);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, []);

    // ปุ่มยืนยันออกจากระบบ
    const handleLogout = () => {
        Cookies.remove('adminToken');       // ลบ token
        Cookies.remove('userToken');        // เผื่อมี user token
        localStorage.clear();               // เคลียร์ cache เพิ่มเติม

        // ใช้ replace() ป้องกัน user กด Back แล้วกลับเข้าไป dashboard ได้
        router.replace('userlogin');
    };

    // ปุ่มยกเลิก → กลับหน้าก่อนหน้า
    const handleCancel = () => {
        router.back();
    };

    if (loading) return <div className={styles.loading}>กำลังโหลด...</div>;

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <img
                    src={profile?.profile_image ? `${API_BASE}/${profile.profile_image}` : '/img/default-avatar.png'}
                    alt="profile"
                    className={styles.avatar}
                />
                <h2 className={styles.name}>
                    {profile?.first_name} {profile?.last_name}
                </h2>
                <p className={styles.question}>ต้องการออกจากระบบใช่หรือไม่?</p>

                <div className={styles.buttonRow}>
                    <button className={styles.cancelBtn} onClick={handleCancel}>
                        ยกเลิก
                    </button>
                    <button className={styles.logoutBtn} onClick={handleLogout}>
                        ออกจากระบบ
                    </button>
                </div>
            </div>
        </div>
    );
}
