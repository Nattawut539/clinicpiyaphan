'use client';

import { useEffect, useMemo, useState } from 'react';
import Cookies from 'js-cookie';
import { useRouter } from 'next/navigation';
import styles from './logout.module.css';
import { API_BASE, USER_API } from '@/lib/api';
import { resolveBackendImage } from '@/lib/images';

type Profile = {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  email?: string | null;
  role?: string | null;
  profile_image?: string | null;
};

function getStoredProfile(): Profile | null {
  try {
    const value = localStorage.getItem('user');
    return value ? JSON.parse(value) as Profile : null;
  } catch {
    return null;
  }
}

export default function LogoutPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      const storedProfile = getStoredProfile();
      setProfile(storedProfile);

      const token = Cookies.get('adminToken') || Cookies.get('userToken');
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`${API_BASE}/me/profile`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
          cache: 'no-store',
        });
        if (response.ok) setProfile(await response.json());
      } catch (error) {
        console.error('โหลดโปรไฟล์สำหรับหน้าออกจากระบบไม่สำเร็จ:', error);
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, []);

  const fullName = useMemo(() => {
    const name = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim();
    return name || profile?.username || profile?.email?.split('@')[0] || 'ผู้ใช้งาน';
  }, [profile]);

  const resolvedAvatar = resolveBackendImage(profile?.profile_image);
  const avatarSrc = !avatarFailed && resolvedAvatar
    ? resolvedAvatar
    : '/img/default-avatar.png';

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch(`${USER_API}/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.error('เรียก API logout ไม่สำเร็จ:', error);
    } finally {
      Cookies.remove('adminToken', { path: '/' });
      Cookies.remove('userToken', { path: '/' });
      localStorage.removeItem('user');
      sessionStorage.removeItem('pwdResetToken');
      window.location.replace('/userlogin');
    }
  };

  if (loading) return <div className={styles.loading}>กำลังโหลดโปรไฟล์...</div>;

  return (
    <main className={styles.container}>
      <section className={styles.card}>
        <img
          src={avatarSrc}
          alt={`รูปโปรไฟล์ของ ${fullName}`}
          className={styles.avatar}
          onError={() => setAvatarFailed(true)}
        />
        <h1 className={styles.name}>{fullName}</h1>
        <p className={styles.question}>ต้องการออกจากระบบใช่หรือไม่?</p>

        <div className={styles.buttonRow}>
          <button type="button" className={styles.cancelBtn} onClick={() => router.back()} disabled={loggingOut}>
            ยกเลิก
          </button>
          <button type="button" className={styles.logoutBtn} onClick={handleLogout} disabled={loggingOut}>
            {loggingOut ? 'กำลังออกจากระบบ...' : 'ออกจากระบบ'}
          </button>
        </div>
      </section>
    </main>
  );
}
