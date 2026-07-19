'use client';

import { API_BASE } from '@/lib/api';
import { resolveBackendImage } from '@/lib/images';
import Cookies from 'js-cookie';
import { Camera, Pencil, Save, UserRound, X } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import ThaiDatePicker from '@/components/date/ThaiDatePicker';
import styles from './userprofile.module.css';

const API = API_BASE.endsWith('/api') ? API_BASE : `${API_BASE}/api`;

type Profile = {
  user_id?: number;
  patient_code?: string;
  title: string;
  national_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  address: string;
  province_code: string;
  birth_date: string;
  gender: string;
  blood_type: string;
  ethnicity: string;
  nationality: string;
  emergency_phone: string;
  email: string;
  congenital_disease: string;
  drug_allergy: string;
  food_allergy: string;
  position: string;
  role?: string | null;
  profile_image?: string | null;
};

const EMPTY_PROFILE: Profile = {
  title: '',
  national_id: '',
  first_name: '',
  last_name: '',
  phone: '',
  address: '',
  province_code: '',
  birth_date: '',
  gender: '',
  blood_type: '',
  ethnicity: '',
  nationality: '',
  emergency_phone: '',
  email: '',
  congenital_disease: '',
  drug_allergy: '',
  food_allergy: '',
  position: '',
};

const fields: Array<{
  name: keyof Profile;
  label: string;
  type?: string;
  full?: boolean;
  multiline?: boolean;
  required?: boolean;
}> = [
  { name: 'title', label: 'คำนำหน้า' },
  { name: 'national_id', label: 'เลขบัตรประชาชน' },
  { name: 'first_name', label: 'ชื่อ', required: true },
  { name: 'last_name', label: 'นามสกุล', required: true },
  { name: 'birth_date', label: 'วันเกิด', type: 'date' },
  { name: 'gender', label: 'เพศ' },
  { name: 'blood_type', label: 'กรุ๊ปเลือด' },
  { name: 'nationality', label: 'สัญชาติ' },
  { name: 'ethnicity', label: 'เชื้อชาติ' },
  { name: 'position', label: 'อาชีพ' },
  { name: 'phone', label: 'เบอร์โทรศัพท์' },
  { name: 'emergency_phone', label: 'เบอร์ฉุกเฉิน' },
  { name: 'email', label: 'อีเมล', type: 'email', required: true },
  { name: 'province_code', label: 'รหัสจังหวัด' },
  { name: 'address', label: 'ที่อยู่', full: true, multiline: true },
  { name: 'congenital_disease', label: 'โรคประจำตัว', full: true, multiline: true },
  { name: 'drug_allergy', label: 'ประวัติแพ้ยา', full: true, multiline: true },
  { name: 'food_allergy', label: 'ประวัติแพ้อาหาร', full: true, multiline: true },
];

function normalizeProfile(data: Partial<Profile>): Profile {
  return {
    ...EMPTY_PROFILE,
    ...data,
    patient_code: data.patient_code || (data.user_id ? String(data.user_id).padStart(3, '0') : ''),
    birth_date: data.birth_date ? String(data.birth_date).slice(0, 10) : '',
    province_code: data.province_code == null ? '' : String(data.province_code),
  };
}

async function readResponse(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || 'ดำเนินการไม่สำเร็จ');
  return data;
}

export default function UserprofilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<Profile>(EMPTY_PROFILE);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [imageFailed, setImageFailed] = useState(false);

  const token = Cookies.get('userToken') || '';
  const previewUrl = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : null), [imageFile]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (!token) {
      router.replace('/userlogin');
      return;
    }

    fetch(`${API}/me/profile`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
      cache: 'no-store',
    })
      .then(readResponse)
      .then((data: Profile) => {
        const nextProfile = normalizeProfile(data);
        setProfile(nextProfile);
        setForm(nextProfile);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'โหลดโปรไฟล์ไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [router, token]);

  const fullName = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'ผู้ใช้งาน';
  const imageSrc = previewUrl || resolveBackendImage(profile?.profile_image);

  const updateField = (field: keyof Profile, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const chooseImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (file && file.size > 3 * 1024 * 1024) {
      setError('รูปภาพต้องมีขนาดไม่เกิน 3 MB');
      event.target.value = '';
      return;
    }
    setImageFile(file);
    setImageFailed(false);
    setError('');
  };

  const cancelEditing = () => {
    if (profile) setForm(profile);
    setImageFile(null);
    setEditing(false);
    setError('');
    setNotice('');
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');

    try {
      const body = new FormData();
      fields.forEach((field) => {
        body.append(field.name, String(form[field.name] || '').trim());
      });
      if (imageFile) body.append('file', imageFile);

      const data: Profile = await readResponse(await fetch(`${API}/me/profile`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
        body,
      }));

      const nextProfile = normalizeProfile(data);
      setProfile(nextProfile);
      setForm(nextProfile);
      setImageFile(null);
      setEditing(false);
      setNotice('บันทึกข้อมูลผู้ป่วยเรียบร้อยแล้ว');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'บันทึกข้อมูลผู้ป่วยไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerBlock}>
        <div>
          <span>บัญชีผู้ป่วย</span>
          <h1>ข้อมูลส่วนตัว</h1>
          <p>ดึงข้อมูลจากตาราง user_details และแก้ไขได้ทุกช่องยกเว้นรหัสผู้ป่วย</p>
        </div>
        {profile && !editing && (
          <button type="button" className={styles.editButton} onClick={() => setEditing(true)}>
            <Pencil size={17} />
            แก้ไขข้อมูล
          </button>
        )}
      </div>

      {notice && <div className={styles.successMessage}>{notice}</div>}
      {error && !loading && <div className={styles.errorMessage}>{error}</div>}

      {loading ? (
        <div className={styles.stateCard}>กำลังโหลดข้อมูลผู้ป่วย...</div>
      ) : profile ? (
        <form className={styles.profileGrid} onSubmit={saveProfile}>
          <section className={styles.profileCard}>
            <div className={styles.avatarWrap}>
              <div className={styles.avatar}>
                {imageSrc && !imageFailed ? (
                  <Image src={imageSrc} alt={fullName} fill sizes="132px" unoptimized onError={() => setImageFailed(true)} />
                ) : (
                  <UserRound size={54} />
                )}
                {editing && (
                  <label className={styles.cameraButton} title="เลือกรูปโปรไฟล์">
                    <Camera size={18} />
                    <input type="file" accept="image/*" onChange={chooseImage} />
                  </label>
                )}
              </div>
              <div className={styles.patientBadge}>รหัสผู้ป่วย: {profile.patient_code || '-'}</div>
            </div>

            <div className={styles.identity}>
              <strong>{fullName}</strong>
              <span>บัญชีผู้ป่วย</span>
            </div>
          </section>

          <section className={styles.detailsCard}>
            <div className={styles.cardHeader}>
              {editing && (
                <div className={styles.actionGroup}>
                  <button type="button" className={styles.cancelButton} onClick={cancelEditing} disabled={saving}>
                    <X size={17} />
                    ยกเลิก
                  </button>
                  <button type="submit" className={styles.saveButton} disabled={saving}>
                    <Save size={17} />
                    {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                  </button>
                </div>
              )}
            </div>

            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span>รหัสผู้ป่วย</span>
                <p>{profile.patient_code || '-'}</p>
              </label>

              {fields.map((field) => (
                <label key={field.name} className={`${styles.field} ${field.full ? styles.fullWidth : ''}`}>
                  <span>{field.label}</span>
                  {editing ? (
                    field.multiline ? (
                      <textarea
                        value={String(form[field.name] || '')}
                        onChange={(event) => updateField(field.name, event.target.value)}
                        required={field.required}
                      />
                    ) : field.type === 'date' ? (
                      <ThaiDatePicker
                        value={String(form[field.name] || '')}
                        onChange={(value) => updateField(field.name, value)}
                        endYear={new Date().getFullYear()}
                        required={field.required}
                      />
                    ) : (
                      <input
                        type={field.type || 'text'}
                        value={String(form[field.name] || '')}
                        onChange={(event) => updateField(field.name, event.target.value)}
                        required={field.required}
                      />
                    )
                  ) : (
                    <p>{String(profile[field.name] || '') || '-'}</p>
                  )}
                </label>
              ))}
            </div>
          </section>
        </form>
      ) : (
        <div className={styles.stateCard}>ไม่พบข้อมูลผู้ป่วย</div>
      )}
    </div>
  );
}
