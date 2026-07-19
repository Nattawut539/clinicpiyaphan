'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styles from './forgotpassword.module.css';
import { USER_API } from '@/lib/api';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return alert('กรุณากรอกอีเมล');

    setLoading(true);
    try {
      const res = await fetch(`${USER_API}/forgot-password/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.message || 'ไม่สามารถส่งรหัสยืนยันได้ กรุณาลองใหม่');
        return;
      }
      router.push(`/forgotpassword/verify?email=${encodeURIComponent(normalizedEmail)}`);
    } catch (error) {
      console.error('Forgot-password request failed:', error);
      alert('ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบว่าเซิร์ฟเวอร์ทำงานอยู่ แล้วลองใหม่');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <form onSubmit={handleRequest} className={styles.form}>
        <h1 className={styles.title}>ลืมรหัสผ่าน</h1>
        <input
          type="email"
          placeholder="อีเมลของคุณ"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={styles.input}
          autoComplete="email"
          required
        />
        <button type="submit" className={styles.button} disabled={loading}>
          {loading ? 'กำลังส่งรหัสยืนยัน...' : 'ส่งรหัสยืนยัน'}
        </button>
        <Link href="/userlogin" className={styles.backButton}>กลับไปหน้าเข้าสู่ระบบ</Link>
      </form>
    </div>
  );
}
