'use client';

import React, { useEffect, useMemo, useState } from 'react';
import styles from './help.module.css';
import {
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Mail,
  MessageCircle,
  MessageCircleQuestion,
  Phone,
  Search,
} from 'lucide-react';
import { API_BASE } from '@/lib/api';

type FaqItem = {
  help_id: number;
  title: string;
  description: string | null;
  category: string | null;
  tags: string[] | null;
  view_count: number | null;
  updated_at: string | null;
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
    icon: MessageCircle,
    label: 'LINE Official',
    value: '@cliniccare',
    tone: 'lime',
  },
  {
    icon: Mail,
    label: 'อีเมล',
    value: 'contact@cliniccare.th',
    tone: 'blue',
  },
];

export default function UserHelpPage() {
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [openIds, setOpenIds] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
        <p>เปิดให้บริการ จันทร์-เสาร์ 08:00-17:00 น.</p>
      </section>
    </div>
  );
}
