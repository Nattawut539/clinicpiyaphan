'use client';

import { API_BASE } from '@/lib/api';
import Cookies from '@/lib/cookies';
import { ArrowRight, CalendarDays, CreditCard, Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { FaLine } from 'react-icons/fa';
import styles from '../../google/complete-profile/complete-profile.module.css';

type LineProfile = {
  registration_source?: string;
  profile_completed?: boolean;
  email?: string;
  national_id?: string;
  first_name?: string;
  last_name?: string;
  birth_date?: string;
};

const EMPTY_FORM = {
  national_id: '',
  first_name: '',
  last_name: '',
  birth_date: '',
  email: '',
  password: '',
  confirm_password: '',
};

async function readResponse(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || 'ไม่สามารถดำเนินการได้');
  return data;
}

export default function CompleteLineProfilePage() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = Cookies.get('userToken');
    if (!token) {
      router.replace('/userlogin');
      return;
    }

    fetch(`${API_BASE}/me/profile`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
      cache: 'no-store',
    })
      .then(readResponse)
      .then((profile: LineProfile) => {
        if (profile.registration_source !== 'line') {
          router.replace(profile.profile_completed ? '/users/userHome' : '/users/userprofile?complete=1');
          return;
        }
        setForm((current) => ({
          ...current,
          national_id: profile.national_id || '',
          first_name: profile.first_name || '',
          last_name: profile.last_name || '',
          birth_date: profile.birth_date ? String(profile.birth_date).slice(0, 10) : '',
          email: profile.email || '',
        }));
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'โหลดข้อมูลบัญชี LINE ไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [router]);

  const updateField = (name: keyof typeof EMPTY_FORM, value: string) => {
    setForm((current) => ({
      ...current,
      [name]: name === 'national_id' ? value.replace(/\D/g, '') : value,
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const token = Cookies.get('userToken');
    if (!token) return router.replace('/userlogin');
    if (form.password !== form.confirm_password) {
      setError('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const result = await readResponse(await fetch(`${API_BASE}/me/line-profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify(form),
      }));
      sessionStorage.setItem('lineProfileCompleted', result.email_notification_sent ? 'email-sent' : 'completed');
      router.replace('/users/userHome');
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'บันทึกข้อมูลบัญชี LINE ไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <header className={styles.header}>
          <div className={styles.lineIcon}><FaLine size={34} /></div>
          <div>
            <span className={styles.lineText}>เข้าสู่ระบบด้วย LINE สำเร็จ</span>
            <h1>ยืนยันข้อมูลและเพิ่มอีเมลเข้าสู่ระบบ</h1>
            <p>กรอกข้อมูลครั้งแรกให้ครบ แล้วคุณสามารถใช้งานต่อได้ทันที รวมถึงเข้าได้ทั้ง LINE และอีเมลพร้อมรหัสผ่าน</p>
          </div>
        </header>

        <div className={styles.lineNotice}>
          <FaLine size={23} />
          <div><strong>บัญชี LINE เดิมจะยังคงเชื่อมต่ออยู่</strong><span>ระบบจะเพิ่มช่องทางอีเมลให้กับบัญชีเดียวกัน ไม่สร้างบัญชีใหม่</span></div>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {loading ? (
          <div className={styles.loading}>กำลังโหลดข้อมูลบัญชี LINE...</div>
        ) : (
          <form onSubmit={submit} className={styles.form}>
            <label className={styles.fullWidth}>
              <span><CreditCard size={16} /> เลขบัตรประชาชน</span>
              <input value={form.national_id} onChange={(event) => updateField('national_id', event.target.value)} inputMode="numeric" maxLength={13} pattern="[0-9]{13}" placeholder="ตัวเลข 13 หลัก" required />
            </label>

            <label>
              <span><UserRound size={16} /> ชื่อ</span>
              <input value={form.first_name} onChange={(event) => updateField('first_name', event.target.value)} maxLength={100} required />
            </label>
            <label>
              <span><UserRound size={16} /> นามสกุล</span>
              <input value={form.last_name} onChange={(event) => updateField('last_name', event.target.value)} maxLength={100} required />
            </label>

            <label className={styles.fullWidth}>
              <span><CalendarDays size={16} /> วันเดือนปีเกิด</span>
              <input value={form.birth_date} onChange={(event) => updateField('birth_date', event.target.value)} type="date" max={new Date().toISOString().slice(0, 10)} required />
            </label>

            <label className={styles.fullWidth}>
              <span><Mail size={16} /> อีเมลสำหรับเข้าสู่ระบบ</span>
              <input value={form.email} onChange={(event) => updateField('email', event.target.value)} type="email" autoComplete="email" placeholder="name@example.com" required />
              <small>ระบบจะส่งอีเมลแจ้งเตือนเมื่อเพิ่มอีเมลนี้เป็นช่องทางเข้าสู่ระบบสำเร็จ</small>
            </label>

            <label>
              <span><LockKeyhole size={16} /> รหัสผ่าน</span>
              <div className={styles.passwordField}>
                <input value={form.password} onChange={(event) => updateField('password', event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={6} pattern="(?=.*[A-Za-z])(?=.*[0-9]).{6,}" required />
                <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>{showPassword ? <Eye size={18} /> : <EyeOff size={18} />}</button>
              </div>
              <small>อย่างน้อย 6 ตัว และมีทั้งตัวอักษรกับตัวเลข</small>
            </label>
            <label>
              <span><LockKeyhole size={16} /> ยืนยันรหัสผ่าน</span>
              <input value={form.confirm_password} onChange={(event) => updateField('confirm_password', event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={6} required />
            </label>

            <button type="submit" disabled={saving}>
              {saving ? 'กำลังบันทึก...' : 'บันทึกและเริ่มใช้งาน'}
              {!saving && <ArrowRight size={18} />}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
