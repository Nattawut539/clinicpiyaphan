'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ShieldCheck, X } from 'lucide-react';
import styles from '../forgotpassword.module.css';
import { USER_API } from '@/lib/api';

function VerifyOtpContent() {
  const router = useRouter();
  const params = useSearchParams();
  const email = (params.get('email') || '').trim().toLowerCase();
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorModal, setErrorModal] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!email) router.replace('/forgotpassword');
  }, [email, router]);

  useEffect(() => {
    if (!errorModal) return;
    const timer = window.setTimeout(() => setErrorModal(''), 2500);
    return () => window.clearTimeout(timer);
  }, [errorModal]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setNotice('');
    if (!/^\d{6}$/.test(otp)) {
      setErrorModal('กรุณากรอกรหัส OTP ให้ครบ 6 หลัก');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${USER_API}/forgot-password/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOtp('');
        setErrorModal(data?.message || 'รหัส OTP ไม่ถูกต้อง');
        return;
      }
      sessionStorage.setItem('pwdResetToken', data.token);
      router.push(`/forgotpassword/reset?email=${encodeURIComponent(email)}`);
    } catch (error) {
      console.error('OTP verification failed:', error);
      setErrorModal('ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    setResending(true);
    setNotice('');
    try {
      const res = await fetch(`${USER_API}/forgot-password/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorModal(data?.message || 'ส่งรหัส OTP ใหม่ไม่สำเร็จ');
        return;
      }
      setOtp('');
      setNotice('ส่งรหัส OTP ใหม่ไปยังอีเมลแล้ว');
    } catch (error) {
      console.error('OTP resend failed:', error);
      setErrorModal('ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่');
    } finally {
      setResending(false);
    }
  }

  return (
    <main className={styles.container}>
      <form onSubmit={handleVerify} className={styles.form}>
        <div className={styles.iconWrap}><ShieldCheck size={34} /></div>
        <h1 className={styles.title}>ยืนยันรหัส OTP</h1>
        <p className={styles.message}>
          กรอกรหัสตัวเลข 6 หลักที่ส่งไปยัง
          <span className={styles.emailBadge}>{email}</span>
        </p>
        {notice && <div className={styles.hint}>{notice}</div>}
        <input
          type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
          placeholder="• • • • • •" value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
          className={styles.input} required
          style={{ textAlign: 'center', letterSpacing: '.55em', fontSize: '1.3rem' }}
        />
        <button type="submit" className={styles.button} disabled={loading || resending}>
          {loading ? 'กำลังตรวจสอบ...' : 'ยืนยันรหัส OTP'}
        </button>
        <button type="button" className={styles.secondaryButton} onClick={resend} disabled={loading || resending}>
          {resending ? 'กำลังส่ง...' : 'ส่ง OTP ใหม่'}
        </button>
      </form>

      {errorModal && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true"
          aria-live="assertive" onClick={() => setErrorModal('')}>
          <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalErrorIcon}><X size={58} strokeWidth={2.4} /></div>
            <h2 className={styles.modalTitle}>{errorModal}</h2>
            <p className={styles.modalSubtitle}>กรุณาตรวจสอบรหัสแล้วลองอีกครั้ง</p>
          </div>
        </div>
      )}
    </main>
  );
}

export default function VerifyOtpPage() {
  return <Suspense fallback={null}><VerifyOtpContent /></Suspense>;
}
