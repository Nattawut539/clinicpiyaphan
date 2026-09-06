'use client';

import React, { useEffect, useMemo, useState } from 'react';
import styles from './help.module.css';
import {
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Mail,
  MessageCircleQuestion,
  Phone,
  Search,
  Send,
  ShieldOff,
} from 'lucide-react';
import { API_BASE } from '@/lib/api';
import Cookies from 'js-cookie';

type FaqItem = {
  help_id: number;
  title: string;
  description: string | null;
  category: string | null;
  tags: string[] | null;
  view_count: number | null;
  updated_at: string | null;
};

type AccountRequest = {
  help_id: number;
  title: string;
  description: string | null;
  request_status: 'pending' | 'approved' | 'rejected' | 'cancelled' | string;
  review_note?: string | null;
  created_at?: string;
};

const API = API_BASE.endsWith('/api') ? API_BASE : `${API_BASE}/api`;

const contactCards = [
  {
    icon: Phone,
    label: 'โทรหาเรา',
    value: '02-123-4567',
    tone: 'green',
  },
  {
    icon: Mail,
    label: 'อีเมล',
    value: 'clinic.piyaphan@gmail.com',
    tone: 'blue',
  },
];

export default function UserHelpPage() {
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [openIds, setOpenIds] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accountRequests, setAccountRequests] = useState<AccountRequest[]>([]);
  const [requestReason, setRequestReason] = useState('');
  const [requestSaving, setRequestSaving] = useState(false);

  useEffect(() => {
    const loadFaq = async () => {
      try {
        setLoading(true);
        setError('');

        const res = await fetch(`${API}/help`);
        const data = await res.json().catch(() => []);

        if (!res.ok) {
          throw new Error(data?.message || 'โหลด FAQ ไม่สำเร็จ');
        }

        const items = Array.isArray(data) ? data : [];
        setFaqs(items);
        if (items[0]?.help_id) {
          setOpenIds([items[0].help_id]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'โหลด FAQ ไม่สำเร็จ');
      } finally {
        setLoading(false);
      }
    };

    loadFaq();
  }, []);

  const loadAccountRequests = async () => {
    const token = Cookies.get('userToken');
    if (!token) return;
    const response = await fetch(`${API}/help/me`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) return;
    const data = await response.json();
    setAccountRequests(
      (Array.isArray(data) ? data : []).filter((item) => item.category === 'account_deactivation'),
    );
  };

  useEffect(() => {
    void loadAccountRequests();
  }, []);

  const submitDeactivationRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    const reason = requestReason.trim();
    if (reason.length < 10) {
      setError('กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร');
      return;
    }
    if (accountRequests.some((item) => item.request_status === 'pending')) {
      setError('คุณมีคำร้องที่กำลังรอตรวจสอบอยู่แล้ว');
      return;
    }
    const token = Cookies.get('userToken');
    if (!token) return;
    try {
      setRequestSaving(true);
      setError('');
      const response = await fetch(`${API}/help`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify({
          title: 'ขอหยุดใช้งานบัญชี',
          description: reason,
          category: 'account_deactivation',
          visibility: 'private',
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || 'ส่งคำร้องไม่สำเร็จ');
      setRequestReason('');
      await loadAccountRequests();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'ส่งคำร้องไม่สำเร็จ');
    } finally {
      setRequestSaving(false);
    }
  };

  const filteredFaqs = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return faqs;

    return faqs.filter((faq) => {
      const title = String(faq.title || '').toLowerCase();
      const description = String(faq.description || '').toLowerCase();
      const category = String(faq.category || '').toLowerCase();
      const tags = (faq.tags || []).join(' ').toLowerCase();

      return (
        title.includes(keyword) ||
        description.includes(keyword) ||
        category.includes(keyword) ||
        tags.includes(keyword)
      );
    });
  }, [faqs, search]);

  const toggleFaq = async (id: number) => {
    const willOpen = !openIds.includes(id);
    setOpenIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));

    if (!willOpen) return;

    try {
      await fetch(`${API}/help/${id}/view`);
      setFaqs((prev) =>
        prev.map((faq) =>
          faq.help_id === id
            ? { ...faq, view_count: Number(faq.view_count || 0) + 1 }
            : faq
        )
      );
    } catch {
      // View count is useful but should not block reading the FAQ.
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroIcon}>
          <HelpCircle size={28} />
        </div>
        <div>
          <h1>ศูนย์ช่วยเหลือ</h1>
          <p>รวมคำถามที่พบบ่อย เพื่อให้คุณได้รับคำตอบอย่างรวดเร็ว</p>
        </div>
      </section>

      <div className={styles.searchBox}>
        <Search size={19} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="ค้นหาคำถามที่ต้องการ..."
        />
      </div>

      <section className={styles.faqCard}>
        <div className={styles.faqHeader}>
          <div>
            <h2>คำถามที่พบบ่อย (FAQ)</h2>
            <p>{filteredFaqs.length} คำถาม</p>
          </div>
        </div>

        <div className={styles.faqList}>
          {loading && <div className={styles.emptyState}>กำลังโหลดคำถาม...</div>}

          {!loading && error && (
            <div className={styles.errorState}>
              <MessageCircleQuestion size={36} />
              <strong>{error}</strong>
              <span>กรุณาลองใหม่อีกครั้ง หรือติดต่อคลินิกโดยตรง</span>
            </div>
          )}

          {!loading && !error && filteredFaqs.length === 0 && (
            <div className={styles.emptyState}>
              <MessageCircleQuestion size={40} />
              <strong>ไม่พบคำถามที่ค้นหา</strong>
              <span>ลองใช้คำค้นอื่น หรือติดต่อคลินิกจากช่องทางด้านล่าง</span>
            </div>
          )}

          {!loading &&
            !error &&
            filteredFaqs.map((faq, index) => {
              const isOpen = openIds.includes(faq.help_id);

              return (
                <article
                  key={faq.help_id}
                  className={`${styles.faqItem} ${isOpen ? styles.faqItemOpen : ''}`}
                >
                  <button type="button" onClick={() => toggleFaq(faq.help_id)}>
                    <span className={styles.numberBadge}>{index + 1}</span>
                    <span className={styles.questionText}>
                      <strong>{faq.title}</strong>
                      <small>
                        {faq.category || 'ทั่วไป'}
                        {Number(faq.view_count || 0) > 0 ? ` · เข้าชม ${faq.view_count} ครั้ง` : ''}
                      </small>
                    </span>
                    {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                  </button>

                  {isOpen && (
                    <div className={styles.answerBox}>
                      <span>A</span>
                      <p>{faq.description || 'ยังไม่มีคำตอบสำหรับคำถามนี้'}</p>
                    </div>
                  )}
                </article>
              );
            })}
        </div>
      </section>

      <section className={styles.contactCard}>
        <h2>ยังไม่พบคำตอบ? ติดต่อเราได้เลย</h2>
        <div className={styles.contactGrid}>
          {contactCards.map((contact) => {
            const Icon = contact.icon;

            return (
              <article key={contact.label} className={`${styles.contactItem} ${styles[contact.tone]}`}>
                <div>
                  <Icon size={22} />
                </div>
                <span>{contact.label}</span>
                <strong>{contact.value}</strong>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.accountRequestCard}>
        <div className={styles.accountRequestHeading}>
          <ShieldOff size={24} />
          <div>
            <h2>ขอหยุดใช้งานบัญชี</h2>
            <p>ระบบจะเก็บประวัติการรักษาไว้ และเจ้าหน้าที่จะตรวจสอบคำร้องก่อนดำเนินการ</p>
          </div>
        </div>
        <form onSubmit={submitDeactivationRequest}>
          <textarea
            value={requestReason}
            onChange={(event) => setRequestReason(event.target.value)}
            placeholder="ระบุเหตุผลที่ต้องการหยุดใช้งานบัญชี"
            rows={4}
            maxLength={500}
          />
          <button type="submit" disabled={requestSaving || accountRequests.some((item) => item.request_status === 'pending')}>
            <Send size={17} />
            {requestSaving ? 'กำลังส่ง...' : 'ส่งคำร้องให้เจ้าหน้าที่'}
          </button>
        </form>
        {accountRequests.length > 0 && (
          <div className={styles.accountRequestHistory}>
            {accountRequests.map((item) => (
              <article key={item.help_id}>
                <strong>{item.title}</strong>
                <span>สถานะ: {item.request_status}</span>
                {item.review_note && <p>ผลการตรวจสอบ: {item.review_note}</p>}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
