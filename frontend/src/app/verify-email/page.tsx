'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MailCheck } from 'lucide-react';
import { API_BASE } from '@/lib/api';
import styles from './verify-email.module.css';

function VerifyEmailContent() {
  const params = useSearchParams();
  const router = useRouter();
  const email = String(params.get('email') || '').trim().toLowerCase();
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!email) router.replace('/userlogin');
  }, [email, router]);

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(otp)) return setError('กรุณากรอก OTP 6 หลัก');
    try {
      setLoading(true);
      setError('');
      const response = await fetch(`${API_BASE}/users/email-verification/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || 'ยืนยันอีเมลไม่สำเร็จ');
      setMessage('ยืนยันอีเมลสำเร็จ กำลังกลับไปหน้าเข้าสู่ระบบ');
      window.setTimeout(() => router.replace('/userlogin'), 1000);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'ยืนยันอีเมลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    try {
      setResending(true);
      setError('');
      const response = await fetch(`${API_BASE}/users/email-verification/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || 'ส่ง OTP ใหม่ไม่สำเร็จ');
      setMessage(data?.message || 'ส่ง OTP ใหม่แล้ว');
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : 'ส่ง OTP ใหม่ไม่สำเร็จ');
    } finally {
      setResending(false);
    }
  };

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <MailCheck size={44} />
        <h1>ยืนยันอีเมล</h1>
        <p>กรอกรหัส 6 หลักที่ส่งไปยัง <strong>{email}</strong></p>
        <form onSubmit={verify}>
          <input
            value={otp}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            aria-label="รหัส OTP"
          />
          {error && <div className={styles.error}>{error}</div>}
          {message && <div className={styles.success}>{message}</div>}
          <button type="submit" disabled={loading}>{loading ? 'กำลังตรวจสอบ...' : 'ยืนยันอีเมล'}</button>
        </form>
        <button className={styles.resend} type="button" onClick={resend} disabled={resending}>
          {resending ? 'กำลังส่ง...' : 'ส่งรหัสใหม่'}
        </button>
      </section>
    </main>
  );
}

export default function VerifyEmailPage() {
  return <Suspense fallback={null}><VerifyEmailContent /></Suspense>;
}
