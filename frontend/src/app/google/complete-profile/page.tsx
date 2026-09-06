'use client';

import { API_BASE } from '@/lib/api';
import Cookies from 'js-cookie';
import { ArrowRight, CalendarDays, CreditCard, Mail, Phone, ShieldCheck, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { FcGoogle } from 'react-icons/fc';
import styles from './complete-profile.module.css';

type GoogleProfile = {
  registration_source?: string;
  profile_completed?: boolean;
  email?: string;
  national_id?: string;
  first_name?: string;
  last_name?: string;
  birth_date?: string;
  phone?: string;
};

const EMPTY_FORM = {
  national_id: '',
  first_name: '',
  last_name: '',
  birth_date: '',
  phone: '',
};

async function readResponse(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || 'ไม่สามารถดำเนินการได้');
  return data;
}

export default function CompleteGoogleProfilePage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
      .then((profile: GoogleProfile) => {
        if (profile.registration_source !== 'google') {
          router.replace(profile.profile_completed ? '/users/userHome' : '/users/userprofile?complete=1');
          return;
        }
        if (profile.profile_completed) {
          router.replace('/users/userHome');
          return;
        }
        setEmail(profile.email || '');
        setForm({
          national_id: profile.national_id || '',
          first_name: profile.first_name || '',
          last_name: profile.last_name || '',
          birth_date: profile.birth_date ? String(profile.birth_date).slice(0, 10) : '',
          phone: profile.phone || '',
        });
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'โหลดข้อมูลบัญชี Google ไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [router]);

  const updateField = (name: keyof typeof EMPTY_FORM, value: string) => {
    const digitsOnly = name === 'national_id' || name === 'phone';
    setForm((current) => ({
      ...current,
      [name]: digitsOnly ? value.replace(/\D/g, '') : value,
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const token = Cookies.get('userToken');
    if (!token) return router.replace('/userlogin');

    try {
      setSaving(true);
      setError('');
      await readResponse(await fetch(`${API_BASE}/me/google-profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify(form),
      }));
      router.replace('/users/userHome');
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'บันทึกข้อมูลผู้ป่วยไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <header className={styles.header}>
          <div className={styles.googleIcon}><FcGoogle size={32} /></div>
          <div>
            <span>เข้าสู่ระบบด้วย Google สำเร็จ</span>
            <h1>กรอกข้อมูลผู้ป่วยที่จำเป็น</h1>
            <p>กรอกเพียงครั้งเดียวก่อนเริ่มจองคิว ข้อมูลอื่นสามารถเพิ่มภายหลังในหน้าโปรไฟล์</p>
          </div>
        </header>

        <div className={styles.verifiedEmail}>
          <ShieldCheck size={21} />
          <div>
            <strong>อีเมลได้รับการยืนยันโดย Google แล้ว</strong>
            <span>{email || 'กำลังตรวจสอบอีเมล...'}</span>
          </div>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {loading ? (
          <div className={styles.loading}>กำลังโหลดข้อมูลบัญชี Google...</div>
        ) : (
          <form onSubmit={submit} className={styles.form}>
            <label className={styles.fullWidth}>
              <span><Mail size={16} /> อีเมล Google</span>
              <input value={email} type="email" readOnly aria-readonly="true" />
              <small>อีเมลนี้มาจากบัญชี Google และไม่ต้องยืนยันด้วย OTP</small>
            </label>

            <label className={styles.fullWidth}>
              <span><CreditCard size={16} /> เลขบัตรประชาชน</span>
              <input
                value={form.national_id}
                onChange={(event) => updateField('national_id', event.target.value)}
                inputMode="numeric"
                maxLength={13}
                pattern="[0-9]{13}"
                placeholder="ตัวเลข 13 หลัก"
                required
              />
            </label>

            <label>
              <span><UserRound size={16} /> ชื่อ</span>
              <input value={form.first_name} onChange={(event) => updateField('first_name', event.target.value)} maxLength={100} required />
            </label>

            <label>
              <span><UserRound size={16} /> นามสกุล</span>
              <input value={form.last_name} onChange={(event) => updateField('last_name', event.target.value)} maxLength={100} required />
            </label>

            <label>
              <span><CalendarDays size={16} /> วันเกิด</span>
              <input value={form.birth_date} onChange={(event) => updateField('birth_date', event.target.value)} type="date" max={new Date().toISOString().slice(0, 10)} required />
            </label>

            <label>
              <span><Phone size={16} /> เบอร์โทรศัพท์</span>
              <input
                value={form.phone}
                onChange={(event) => updateField('phone', event.target.value)}
                inputMode="tel"
                minLength={9}
                maxLength={10}
                pattern="[0-9]{9,10}"
                placeholder="ตัวเลข 9-10 หลัก"
                required
              />
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
