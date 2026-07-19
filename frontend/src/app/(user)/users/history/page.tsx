'use client';

import { API_BASE } from '@/lib/api';
import Cookies from 'js-cookie';
import dayjs from 'dayjs';
import 'dayjs/locale/th';
import {
  CalendarDays,
  ChevronDown,
  FileClock,
  MessageSquare,
  Pill,
  Star,
  Stethoscope,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import styles from './history.module.css';

dayjs.locale('th');

const API = API_BASE.endsWith('/api') ? API_BASE : `${API_BASE}/api`;

type MedicalRecord = {
  record_id: number | string;
  feedback_record_id?: number | string;
  record_count?: number;
  visit_date?: string | null;
  symptoms?: string | null;
  diagnosis?: string | null;
  treatment?: string | null;
  medications?: string[] | string | null;
  notes?: string | null;
  follow_up_date?: string | null;
};

type Feedback = {
  feedback_id?: number | string;
  record_id?: number | string | null;
  visit_date?: string | null;
  score?: number | string | null;
  liked?: boolean | null;
  category?: string | null;
  service_type?: string | null;
  comment?: string | null;
};

type FeedbackDraft = {
  score: number;
  liked: boolean | null;
  comment: string;
};

function dateKey(date?: string | null) {
  const parsed = dayjs(date);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : 'unknown';
}

function mergeText(values: Array<string | null | undefined>) {
  const unique = Array.from(
    new Set(values.map((value) => String(value || '').trim()).filter(Boolean))
  );
  return unique.length ? unique.join('\n') : null;
}

function mergeMedications(values: MedicalRecord['medications'][]) {
  const meds = values.flatMap((value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Keep plain text values below.
    }
    return String(value).split(',');
  });

  const unique = Array.from(new Set(meds.map((item) => String(item).trim()).filter(Boolean)));
  return unique.length ? unique : null;
}

function groupRecordsByVisitDate(records: MedicalRecord[]): MedicalRecord[] {
  const map = new Map<string, MedicalRecord[]>();

  for (const record of records) {
    const key = dateKey(record.visit_date);
    map.set(key, [...(map.get(key) || []), record]);
  }

  return Array.from(map.values())
    .map((items) => ({
      record_id: items.map((item) => item.record_id).join('-'),
      feedback_record_id: items[0]?.record_id,
      record_count: items.length,
      visit_date: items[0]?.visit_date || null,
      symptoms: mergeText(items.map((item) => item.symptoms)),
      diagnosis: mergeText(items.map((item) => item.diagnosis)),
      treatment: mergeText(items.map((item) => item.treatment)),
      medications: mergeMedications(items.map((item) => item.medications)),
      notes: mergeText(items.map((item) => item.notes)),
      follow_up_date: items.find((item) => item.follow_up_date)?.follow_up_date || null,
    }))
    .sort((a, b) => dateKey(b.visit_date).localeCompare(dateKey(a.visit_date)));
}

function formatThaiDate(date?: string | null) {
  if (!date) return '-';
  const parsed = dayjs(date);
  return parsed.isValid() ? `${parsed.format('D MMMM')} ${parsed.year() + 543}` : '-';
}

function formatMedications(value: MedicalRecord['medications']) {
  if (!value) return '-';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '-';
  return String(value).trim() || '-';
}

function isDashboardNote(note: string) {
  return note.includes('บันทึกจากหน้า Dashboard') || note.toLowerCase().includes('dashboard');
}

function splitNotes(value?: string | null) {
  const notes = String(value || '')
    .split(/\r?\n|,|;/)
    .map((item) => item.trim())
    .filter(Boolean);

  return notes.sort((a, b) => Number(isDashboardNote(b)) - Number(isDashboardNote(a)));
}

async function readResponse(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || data?.error || 'โหลดข้อมูลไม่สำเร็จ');
  }
  return data;
}

export default function UserHistoryPage() {
  const router = useRouter();
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [drafts, setDrafts] = useState<Record<string, FeedbackDraft>>({});
  const [savingKey, setSavingKey] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openFeedbackKeys, setOpenFeedbackKeys] = useState<Record<string, boolean>>({});

  const groupedRecords = useMemo(() => groupRecordsByVisitDate(records), [records]);
  const latestRecord = groupedRecords[0];

  const feedbackByRecord = useMemo(() => {
    const map = new Map<string, Feedback>();
    for (const feedback of feedbacks) {
      if (feedback.record_id) map.set(String(feedback.record_id), feedback);
    }
    return map;
  }, [feedbacks]);

  const summary = useMemo(() => {
    const followUps = groupedRecords.filter((item) => item.follow_up_date).length;
    return [
      { label: 'รายการทั้งหมด', value: groupedRecords.length },
      { label: 'นัดติดตาม', value: followUps },
      { label: 'ล่าสุด', value: latestRecord ? formatThaiDate(latestRecord.visit_date) : '-' },
    ];
  }, [groupedRecords, latestRecord]);

  useEffect(() => {
    const token = Cookies.get('userToken');
    if (!token) {
      router.replace('/userlogin');
      return;
    }

    Promise.all([
      fetch(`${API}/medical/my`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
        cache: 'no-store',
      }).then(readResponse),
      fetch(`${API}/feedbacks/me`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
        cache: 'no-store',
      }).then(readResponse),
    ])
      .then(([medicalData, feedbackData]) => {
        setRecords(Array.isArray(medicalData) ? medicalData : []);
        setFeedbacks(Array.isArray(feedbackData) ? feedbackData : []);
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : 'โหลดประวัติการรักษาไม่สำเร็จ')
      )
      .finally(() => setLoading(false));
  }, [router]);

  const getFeedbackKey = (record: MedicalRecord) =>
    String(record.feedback_record_id || record.record_id);

  function getDraft(record: MedicalRecord): FeedbackDraft {
    const key = getFeedbackKey(record);
    const existing = feedbackByRecord.get(key);

    return (
      drafts[key] || {
        score: Number(existing?.score || 0),
        liked: typeof existing?.liked === 'boolean' ? existing.liked : null,
        comment: String(existing?.comment || ''),
      }
    );
  }

  function updateDraft(record: MedicalRecord, patch: Partial<FeedbackDraft>) {
    const key = getFeedbackKey(record);
    setDrafts((current) => ({
      ...current,
      [key]: {
        ...getDraft(record),
        ...patch,
      },
    }));
  }

  function isFeedbackOpen(key: string) {
    return openFeedbackKeys[key] ?? false;
  }

  function toggleFeedback(key: string) {
    setOpenFeedbackKeys((current) => ({
      ...current,
      [key]: !(current[key] ?? false),
    }));
  }

  async function saveFeedback(record: MedicalRecord) {
    const token = Cookies.get('userToken');
    if (!token) {
      router.replace('/userlogin');
      return;
    }

    const key = getFeedbackKey(record);
    const draft = getDraft(record);

    if (!draft.score && draft.liked === null && !draft.comment.trim()) {
      setError('กรุณาให้คะแนน เลือกชอบ/ไม่ชอบ หรือเขียนความคิดเห็นก่อนบันทึก');
      return;
    }

    setSavingKey(key);
    setNotice('');
    setError('');

    try {
      const saved = await fetch(`${API}/feedbacks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          record_id: record.feedback_record_id,
          visit_date: record.visit_date,
          score: draft.score || null,
          liked: draft.liked,
          category: record.diagnosis || 'ไม่ระบุ',
          service_type: record.diagnosis || null,
          comment: draft.comment.trim() || null,
        }),
      }).then(readResponse);

      setFeedbacks((current) => {
        const withoutCurrent = current.filter((item) => String(item.record_id || '') !== key);
        return [saved, ...withoutCurrent];
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setNotice('บันทึกความคิดเห็นเรียบร้อยแล้ว');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'บันทึกความคิดเห็นไม่สำเร็จ');
    } finally {
      setSavingKey('');
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <span>Medical History</span>
          <h1>ประวัติการรักษา</h1>
          <p>ดูข้อมูลอาการ การวินิจฉัย แผนการรักษา และยาที่แพทย์บันทึกไว้</p>
        </div>
      </header>

      <section className={styles.summaryGrid}>
        {summary.map((item) => (
          <div key={item.label} className={styles.summaryCard}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div className={styles.iconBox}>
            <FileClock size={26} />
          </div>
          <div>
            <h2>รายการรักษาของฉัน</h2>
            <p>{loading ? 'กำลังโหลดข้อมูล...' : `${groupedRecords.length} รายการ`}</p>
          </div>
        </div>

        {loading && <div className={styles.state}>กำลังโหลดประวัติการรักษา...</div>}
        {notice && !loading && <div className={styles.successState}>{notice}</div>}
        {error && !loading && <div className={styles.errorState}>{error}</div>}

        {!loading && !error && groupedRecords.length === 0 && (
          <div className={styles.emptyState}>
            <FileClock size={44} />
            <strong>ยังไม่มีประวัติการรักษา</strong>
            <span>เมื่อแพทย์บันทึกเวชระเบียน รายการจะแสดงที่หน้านี้</span>
          </div>
        )}

        <div className={styles.recordList}>
          {groupedRecords.map((record) => {
            const key = getFeedbackKey(record);
            const draft = getDraft(record);
            const hasSavedFeedback = feedbackByRecord.has(key);
            const feedbackOpen = isFeedbackOpen(key);

            return (
              <article key={record.record_id} className={styles.recordCard}>
                <div className={styles.dateBadge}>
                  <CalendarDays size={20} />
                  <span>{formatThaiDate(record.visit_date)}</span>
                </div>

                <div className={styles.recordBody}>
                  <div className={styles.recordTop}>
                    <h3>{record.diagnosis || 'บันทึกการรักษา'}</h3>
                    {Number(record.record_count || 0) > 1 && (
                      <span className={styles.mergeBadge}>รวม {record.record_count} บันทึก</span>
                    )}
                    {record.follow_up_date && (
                      <span className={styles.followBadge}>
                        ติดตามผล {formatThaiDate(record.follow_up_date)}
                      </span>
                    )}
                  </div>

                  <div className={styles.detailGrid}>
                    <div>
                      <span>
                        <Stethoscope size={16} />
                        อาการ
                      </span>
                      <p>{record.symptoms || '-'}</p>
                    </div>
                    <div>
                      <span>
                        <Pill size={16} />
                        ยา
                      </span>
                      <p>{formatMedications(record.medications)}</p>
                    </div>
                    <div className={styles.fullWidth}>
                      <span>แผนการรักษา</span>
                      <p>{record.treatment || '-'}</p>
                    </div>
                    {record.notes && (
                      <div className={styles.fullWidth}>
                        <span>หมายเหตุ</span>
                        <div className={styles.notesGrid}>
                          {splitNotes(record.notes).map((note, index) => (
                            <p
                              key={`${record.record_id}-note-${index}`}
                              className={isDashboardNote(note) ? styles.noteMainRow : undefined}
                            >
                              {note}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className={`${styles.feedbackBox} ${feedbackOpen ? styles.feedbackBoxOpen : ''}`}>
                    <button
                      type="button"
                      className={styles.feedbackHeader}
                      onClick={() => toggleFeedback(key)}
                      aria-expanded={feedbackOpen}
                    >
                      <div>
                        <span className={styles.feedbackEyebrow}>
                          <MessageSquare size={16} />
                          ความพึงพอใจในการรับบริการครั้งนี้
                        </span>
                        <strong>{hasSavedFeedback ? 'แก้ไขความคิดเห็นของคุณ' : 'แสดงความคิดเห็น'}</strong>
                      </div>
                      <span className={styles.feedbackHeaderActions}>
                        {hasSavedFeedback && <span className={styles.savedBadge}>บันทึกแล้ว</span>}
                        <ChevronDown size={20} className={styles.feedbackChevron} />
                      </span>
                    </button>

                    <div className={styles.feedbackContent}>
                      <div className={styles.ratingRow} aria-label="ให้คะแนนคลินิก">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            className={star <= draft.score ? styles.starButtonActive : styles.starButton}
                            onClick={() => updateDraft(record, { score: star })}
                            aria-label={`ให้ ${star} ดาว`}
                          >
                            <Star size={22} fill="currentColor" />
                          </button>
                        ))}
                      </div>

                      <div className={styles.likeRow}>
                        <button
                          type="button"
                          className={draft.liked === true ? styles.likeActive : styles.likeButton}
                          onClick={() => updateDraft(record, { liked: true })}
                        >
                          <ThumbsUp size={17} />
                          ชอบ
                        </button>
                        <button
                          type="button"
                          className={draft.liked === false ? styles.dislikeActive : styles.likeButton}
                          onClick={() => updateDraft(record, { liked: false })}
                        >
                          <ThumbsDown size={17} />
                          ไม่ชอบ
                        </button>
                      </div>

                      <label className={styles.commentField}>
                        <span>ความคิดเห็น (ไม่บังคับ)</span>
                        <textarea
                          value={draft.comment}
                          onChange={(event) => updateDraft(record, { comment: event.target.value })}
                          rows={3}
                          maxLength={500}
                          placeholder="บอกเราว่าคุณรู้สึกอย่างไรกับการรับบริการครั้งนี้..."
                        />
                      </label>

                      <div className={styles.feedbackActions}>
                        <button
                          type="button"
                          className={styles.saveFeedbackButton}
                          disabled={savingKey === key}
                          onClick={() => saveFeedback(record)}
                        >
                          {savingKey === key
                            ? 'กำลังบันทึก...'
                            : hasSavedFeedback
                              ? 'บันทึกการแก้ไข'
                              : 'บันทึกรีวิว'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
