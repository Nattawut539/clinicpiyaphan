'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Check, KeyRound } from 'lucide-react';
import styles from '../forgotpassword.module.css';
import { USER_API } from '@/lib/api';

function ResetContent() {
  const params = useSearchParams();
  const router = useRouter();
  const email = (params.get('email') || '').trim().toLowerCase();
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    const token = sessionStorage.getItem('pwdResetToken');
    if (!token || !email) router.replace('/forgotpassword');
  }, [email, router]);

  useEffect(() => {
    if (!success) return;
    if (countdown === 0) {
      router.replace('/userlogin');
      return;
    }
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [success, countdown, router]);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (pwd.length < 8) return setError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
    if (pwd !== pwd2) return setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน กรุณาตรวจสอบอีกครั้ง');

    const token = sessionStorage.getItem('pwdResetToken');
    if (!token) return setError('สิทธิ์เปลี่ยนรหัสผ่านหมดอายุ กรุณาเริ่มขั้นตอนใหม่');

    setLoading(true);
    try {
      const res = await fetch(`${USER_API}/forgot-password/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: pwd }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาลองใหม่');
        return;
      }
      sessionStorage.removeItem('pwdResetToken');
      setSuccess(true);
    } catch (requestError) {
      console.error('Password reset failed:', requestError);
      setError('ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.container}>
      <form onSubmit={handleReset} className={styles.form}>
        <div className={styles.iconWrap}><KeyRound size={33} /></div>
        <h1 className={styles.title}>ตั้งรหัสผ่านใหม่</h1>
        <p className={styles.message}>
          สร้างรหัสผ่านใหม่สำหรับบัญชี
          <span className={styles.emailBadge}>{email}</span>
        </p>

        {error && <div className={styles.error} role="alert">{error}</div>}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="new-password">รหัสผ่านใหม่</label>
          <input id="new-password" type="password" placeholder="อย่างน้อย 8 ตัวอักษร"
            value={pwd} onChange={(e) => setPwd(e.target.value)} className={styles.input}
            autoComplete="new-password" minLength={8} required />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="confirm-password">ยืนยันรหัสผ่านใหม่</label>
          <input id="confirm-password" type="password" placeholder="กรอกรหัสผ่านใหม่อีกครั้ง"
            value={pwd2} onChange={(e) => setPwd2(e.target.value)} className={styles.input}
            autoComplete="new-password" minLength={8} required />
        </div>
        <p className={styles.hint}>เพื่อความปลอดภัย ควรใช้ตัวอักษร ตัวเลข และสัญลักษณ์ร่วมกัน</p>
        <button type="submit" className={styles.button} disabled={loading}>
          {loading ? 'กำลังบันทึก...' : 'ยืนยันรหัสผ่านใหม่'}
        </button>
      </form>
      {success && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-live="assertive">
          <div className={styles.modal}>
            <div className={styles.modalSuccessIcon}><Check size={58} strokeWidth={2.4} /></div>
            <h2 className={styles.modalTitle}>เปลี่ยนรหัสผ่านสำเร็จ</h2>
            <p className={styles.modalSubtitle}>กำลังไปหน้าเข้าสู่ระบบใน {countdown} วินาที</p>
          </div>
        </div>
      )}
    </main>
  );
}

export default function ResetPage() {
  return <Suspense fallback={null}><ResetContent /></Suspense>;
}
