'use client'
/* eslint-disable @typescript-eslint/no-unused-vars */

import React, { useEffect, useRef, useState } from 'react'
import Cookies from 'js-cookie'
import Link from 'next/link';
import styles from './Help.module.css'
import { API_BASE } from '@/lib/api'
import Sidebar from '@/components/admin-shell/AdminSidebar'
import AdminHeaderActions from '@/components/admin-shell/AdminHeaderActions';
import Swal from 'sweetalert2';
import dayjs from "dayjs";
import "dayjs/locale/th";
dayjs.locale("th");
import {
    Activity,
    HelpCircle,
    Search,
    Plus,
    Pencil,
    Trash2,
    ChevronDown,
    ChevronUp,
    X,
    Save,
    MessageCircleQuestion,
} from 'lucide-react';


/* ===================== Types ===================== */
interface HelpItem {
    help_id: number
    title: string
    description: string | null
    visibility: 'private' | 'shared'
    updated_at: string
    category?: string | null
    request_status?: string
    review_note?: string | null
    verification_method?: string | null
    email?: string | null
}

interface UserProfile {
    first_name: string
    last_name: string
    profile_image: string | null
}

export default function HelpDashboard() {
    const token = Cookies.get('adminToken')
    const [admin, setAdmin] = useState<UserProfile>({
        first_name: '',
        last_name: '',
        profile_image: null,
    })

    const [helps, setHelps] = useState<HelpItem[]>([]);
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [error, setError] = useState('');
    const [showPopup, setShowPopup] = useState(false);
    const [title, setTitle] = useState('');
    const [response, setResponse] = useState('');

    const [editingId, setEditingId] = useState<number | null>(null);
    const [editingTitle, setEditingTitle] = useState('')
    const [editingResponse, setEditingResponse] = useState('');

    const latestItemRef = useRef<HTMLDivElement | null>(null);

    const [search, setSearch] = useState('');

    const accountRequests = helps.filter((item) => item.category === 'account_deactivation');
    const faqItems = helps.filter((item) => item.category !== 'account_deactivation');
    const filteredHelps = faqItems.filter((item) => {
        const keyword = search.trim().toLowerCase();

        if (!keyword) return true;

        return (
            item.title.toLowerCase().includes(keyword) ||
            (item.description || '').toLowerCase().includes(keyword)
        );
    });

    const todayText = dayjs().locale("th").format("D MMMM");
    const buddhistYear = dayjs().year() + 543;

    const confirmAction = async (message: string) => {
        const result = await Swal.fire({
            title: 'ยืนยันการดำเนินการ',
            text: message,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'ยืนยัน',
            cancelButtonText: 'ยกเลิก',
            confirmButtonColor: '#2ecc71',
            cancelButtonColor: '#e74c3c',
            reverseButtons: true,
            focusCancel: true,
        });

        return result.isConfirmed;
    };


    useEffect(() => {
        if (!token) return

        fetch(`${API_BASE}/users/me`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(res => res.json())
            .then(data => setAdmin(data))
            .catch(err => console.error('โหลดข้อมูลผู้ใช้ล้มเหลว:', err))
    }, [token])
    const fetchHelps = async () => {
        const res = await fetch(`${API_BASE}/help/all`, {
            headers: { Authorization: `Bearer ${token}` },
        })
        const json = await res.json()
        setHelps(json.data)
    }

    useEffect(() => {
        if (token) fetchHelps()
    // fetchHelps is intentionally invoked only when the authenticated token is established.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token])
    const handleToggle = (id: number) => {
        setExpandedId(expandedId === id ? null : id)
    }

    const handleAdd = async () => {
        if (!title || !response) return;

        setShowPopup(false);

        const ok = await confirmAction('คุณต้องการบันทึกหัวข้อช่วยเหลือนี้หรือไม่ ?');

        if (!ok) {
            setShowPopup(true);
            return;
        }

        const res = await fetch(`${API_BASE}/help`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${Cookies.get('adminToken')}`,
            },
            body: JSON.stringify({
                title,
                description: response,
                visibility: 'shared',
            }),
        });

        if (res.ok) {
            Swal.fire({
                icon: 'success',
                title: 'บันทึกสำเร็จ',
                timer: 1500,
                showConfirmButton: false,
            });

            fetchHelps();
            setTitle('');
            setResponse('');
            setShowPopup(false);
        } else {
            setShowPopup(true);
        }
    };


    const handleDelete = async (id: number) => {
        const ok = await confirmAction('คุณแน่ใจหรือไม่ว่าต้องการลบ FAQ นี้ ?');
        if (!ok) return;

        const res = await fetch(`${API_BASE}/help/${id}`, {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${Cookies.get('adminToken')}`,
            },
        });

        if (res.ok) {
            Swal.fire({
                icon: 'success',
                title: 'ลบเรียบร้อย',
                timer: 1500,
                showConfirmButton: false,
            });

            fetchHelps();
        }
    };


    const handleEdit = (item: HelpItem) => {
        setEditingId(item.help_id)
        setEditingTitle(item.title)
        setEditingResponse(item.description || '')
    }

    const handleSaveEdit = async (id: number) => {
        const ok = await confirmAction('คุณต้องการบันทึกการแก้ไขนี้หรือไม่ ?');
        if (!ok) return;

        const res = await fetch(`${API_BASE}/help/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${Cookies.get('adminToken')}`,
            },
            body: JSON.stringify({
                title: editingTitle,
                description: editingResponse,
            }),
        });

        if (res.ok) {
            Swal.fire({
                icon: 'success',
                title: 'แก้ไขเรียบร้อย',
                timer: 1500,
                showConfirmButton: false,
            });

            setEditingId(null);
            fetchHelps();
        }
    };

    const handleAccountRequest = async (item: HelpItem, requestStatus: 'approved' | 'rejected') => {
        const reviewNote = window.prompt(requestStatus === 'approved' ? 'ระบุผลการตรวจสอบและเหตุผลที่อนุมัติ' : 'ระบุเหตุผลที่ปฏิเสธ');
        if (!reviewNote?.trim()) return;
        const verificationMethod = requestStatus === 'approved'
            ? window.prompt('ระบุวิธีตรวจตัวตน เช่น ตรวจบัตรประชาชนและวันเกิด')
            : '';
        if (requestStatus === 'approved' && !verificationMethod?.trim()) return;
        const ok = await confirmAction(requestStatus === 'approved'
            ? 'เมื่ออนุมัติ บัญชีผู้ใช้จะถูกปิดใช้งานและ session เดิมจะถูกยกเลิก ยืนยันหรือไม่?'
            : 'ยืนยันการปฏิเสธคำร้องนี้หรือไม่?');
        if (!ok) return;
        const res = await fetch(`${API_BASE}/help/${item.help_id}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${Cookies.get('adminToken')}`,
            },
            body: JSON.stringify({
                request_status: requestStatus,
                review_note: reviewNote.trim(),
                verification_method: verificationMethod?.trim() || '',
            }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            await Swal.fire({ icon: 'error', title: 'ดำเนินการไม่สำเร็จ', text: data?.message || 'กรุณาลองใหม่' });
            return;
        }
        await Swal.fire({ icon: 'success', title: 'บันทึกผลคำร้องแล้ว', timer: 1400, showConfirmButton: false });
        await fetchHelps();
    };

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div className={styles.leftHeader}>
                    <div className={styles.pageTitleBox}>
                        <h1 className={styles.pageTitle}>จัดการความช่วยเหลือ</h1>
                        <p className={styles.pageDate}>
                            วันที่ {todayText} {buddhistYear}
                        </p>
                    </div>
                </div>

                <AdminHeaderActions />
            </header>

            <div className={styles.wrapper}>
                <Sidebar />

                <section className={styles.contentArea}>
                    <div className={styles.requestCard}>
                        <div className={styles.faqTitleGroup}>
                            <Activity size={24} />
                            <div>
                                <h2>คำร้องหยุดใช้งานบัญชี</h2>
                                <p>{accountRequests.filter((item) => item.request_status === 'pending').length} รายการรอตรวจสอบ</p>
                            </div>
                        </div>
                        <div className={styles.requestList}>
                            {accountRequests.length === 0 ? (
                                <p className={styles.requestEmpty}>ยังไม่มีคำร้อง</p>
                            ) : accountRequests.map((item) => (
                                <article key={item.help_id}>
                                    <div>
                                        <strong>{item.email || 'ไม่พบอีเมล'}</strong>
                                        <p>{item.description || '-'}</p>
                                        <small>สถานะ: {item.request_status || 'pending'}{item.review_note ? ` · ${item.review_note}` : ''}</small>
                                    </div>
                                    {item.request_status === 'pending' && (
                                        <div className={styles.requestActions}>
                                            <button type="button" onClick={() => handleAccountRequest(item, 'rejected')}>ปฏิเสธ</button>
                                            <button type="button" onClick={() => handleAccountRequest(item, 'approved')}>ตรวจสอบแล้วและอนุมัติ</button>
                                        </div>
                                    )}
                                </article>
                            ))}
                        </div>
                    </div>
                    <div className={styles.faqCard}>
                        <div className={styles.faqHeader}>
                            <div className={styles.faqTitleGroup}>
                                <HelpCircle size={24} strokeWidth={2.2} />
                                <div>
                                    <h2>คำถามที่พบบ่อย (FAQ)</h2>
                                    <p>{faqItems.length} คำถาม</p>
                                </div>
                            </div>

                            <div className={styles.faqHeaderActions}>
                                <div className={styles.faqSearchBox}>
                                    <Search size={18} className={styles.faqSearchIcon} />
                                    <input
                                        type="text"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        placeholder="ค้นหาคำถาม..."
                                        className={styles.faqSearchInput}
                                    />
                                </div>

                                <button
                                    type="button"
                                    className={styles.faqAddBtn}
                                    onClick={() => setShowPopup(true)}
                                >
                                    <Plus size={18} strokeWidth={2.4} />
                                    เพิ่มคำถาม
                                </button>
                            </div>
                        </div>

                        {error && (
                            <div className={styles.faqErrorBox}>
                                {error}
                            </div>
                        )}

                        <div className={styles.faqListModern}>
                            {filteredHelps.length === 0 ? (
                                <div className={styles.faqEmptyBox}>
                                    <MessageCircleQuestion size={48} strokeWidth={1.8} />
                                    <p>ไม่พบคำถามที่ค้นหา</p>
                                </div>
                            ) : (
                                filteredHelps.map((item, index) => {
                                    const isOpen = expandedId === item.help_id;
                                    const isEditing = editingId === item.help_id;

                                    return (
                                        <div
                                            key={item.help_id}
                                            ref={index === 0 ? latestItemRef : null}
                                            className={`${styles.faqItemModern} ${isOpen ? styles.faqItemOpen : ''
                                                }`}
                                        >
                                            <div
                                                className={`${styles.faqQuestionRow} ${isOpen ? styles.faqQuestionOpen : ''
                                                    }`}
                                                onClick={() => handleToggle(item.help_id)}
                                            >
                                                <div
                                                    className={`${styles.faqQBadge} ${isOpen ? styles.faqQBadgeOpen : ''
                                                        }`}
                                                >
                                                    Q
                                                </div>

                                                <div className={styles.faqQuestionText}>
                                                    {isEditing ? (
                                                        <input
                                                            className={styles.faqEditInput}
                                                            value={editingTitle}
                                                            onClick={(e) => e.stopPropagation()}
                                                            onChange={(e) => setEditingTitle(e.target.value)}
                                                            placeholder="กรอกคำถาม..."
                                                        />
                                                    ) : (
                                                        <p>{item.title}</p>
                                                    )}
                                                </div>

                                                <div className={styles.faqRowActions}>
                                                    <button
                                                        type="button"
                                                        className={styles.faqIconBtn}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleEdit(item);
                                                            setExpandedId(item.help_id);
                                                        }}
                                                        title="แก้ไข"
                                                    >
                                                        <Pencil size={16} />
                                                    </button>

                                                    <button
                                                        type="button"
                                                        className={styles.faqDeleteIconBtn}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDelete(item.help_id);
                                                        }}
                                                        title="ลบ"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>

                                                    {isOpen ? (
                                                        <ChevronUp size={20} className={styles.faqChevronOpen} />
                                                    ) : (
                                                        <ChevronDown size={20} className={styles.faqChevron} />
                                                    )}
                                                </div>
                                            </div>

                                            {isOpen && (
                                                <div className={styles.faqAnswerBox}>
                                                    <div className={styles.faqAnswerContent}>
                                                        <div className={styles.faqABadge}>A</div>

                                                        {isEditing ? (
                                                            <textarea
                                                                className={styles.faqEditTextarea}
                                                                value={editingResponse}
                                                                onChange={(e) => setEditingResponse(e.target.value)}
                                                                placeholder="กรอกคำตอบ..."
                                                                rows={4}
                                                            />
                                                        ) : (
                                                            <p>{item.description || '-'}</p>
                                                        )}
                                                    </div>

                                                    <div className={styles.faqAnswerActions}>
                                                        {isEditing ? (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    className={styles.faqCancelEditBtn}
                                                                    onClick={() => {
                                                                        setEditingId(null);
                                                                        setEditingTitle('');
                                                                        setEditingResponse('');
                                                                    }}
                                                                >
                                                                    <X size={16} />
                                                                    ยกเลิก
                                                                </button>

                                                                <button
                                                                    type="button"
                                                                    className={styles.faqSaveEditBtn}
                                                                    onClick={() => handleSaveEdit(item.help_id)}
                                                                >
                                                                    <Save size={16} />
                                                                    บันทึกการแก้ไข
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    className={styles.faqEditSmallBtn}
                                                                    onClick={() => {
                                                                        handleEdit(item);
                                                                        setExpandedId(item.help_id);
                                                                    }}
                                                                >
                                                                    <Pencil size={16} />
                                                                    แก้ไข
                                                                </button>

                                                                <button
                                                                    type="button"
                                                                    className={styles.faqDeleteSmallBtn}
                                                                    onClick={() => handleDelete(item.help_id)}
                                                                >
                                                                    <Trash2 size={16} />
                                                                    ลบ
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        <div className={styles.faqFooter}>
                            <p>
                                แสดง {filteredHelps.length} จาก {faqItems.length} คำถาม
                            </p>
                        </div>
                    </div>

                    {showPopup && (
                        <div
                            className={styles.faqModalOverlay}
                            onClick={() => setShowPopup(false)}
                        >
                            <div
                                className={styles.faqModal}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className={styles.faqModalHeader}>
                                    <h3>เพิ่มคำถามใหม่</h3>

                                    <button
                                        type="button"
                                        className={styles.faqModalCloseBtn}
                                        onClick={() => setShowPopup(false)}
                                    >
                                        <X size={17} />
                                    </button>
                                </div>

                                <div className={styles.faqModalBody}>
                                    <div className={styles.faqFormGroup}>
                                        <label>คำถาม</label>
                                        <textarea
                                            value={title}
                                            onChange={(e) => setTitle(e.target.value)}
                                            placeholder="กรอกคำถามที่พบบ่อย..."
                                            rows={2}
                                            className={styles.faqFormTextarea}
                                        />
                                    </div>

                                    <div className={styles.faqFormGroup}>
                                        <label>คำตอบ</label>
                                        <textarea
                                            value={response}
                                            onChange={(e) => setResponse(e.target.value)}
                                            placeholder="กรอกคำตอบ..."
                                            rows={4}
                                            className={styles.faqFormTextarea}
                                        />
                                    </div>
                                </div>

                                <div className={styles.faqModalFooter}>
                                    <button
                                        type="button"
                                        className={styles.faqModalCancelBtn}
                                        onClick={() => setShowPopup(false)}
                                    >
                                        ยกเลิก
                                    </button>

                                    <button
                                        type="button"
                                        className={styles.faqModalSaveBtn}
                                        onClick={handleAdd}
                                        disabled={!title || !response}
                                    >
                                        <Save size={16} />
                                        บันทึก
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
