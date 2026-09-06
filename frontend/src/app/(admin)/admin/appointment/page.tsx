'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import styles from './Appointment.module.css';
import Cookies from 'js-cookie';
import Swal from 'sweetalert2';
import { API_BASE } from '@/lib/api';
import Sidebar from '@/components/admin-shell/AdminSidebar';
import AdminHeaderActions from '@/components/admin-shell/AdminHeaderActions';
import dayjs from "dayjs";
import "dayjs/locale/th";
import {
    Clock,
    CheckCircle,
    XCircle,
    List,
    Archive,
    CalendarDays,
    Pencil,
} from 'lucide-react';

const API = API_BASE.endsWith('/api') ? API_BASE : `${API_BASE}/api`;

interface Appointment {
    appointment_id: number;
    user_id: number;
    first_name?: string | null;
    last_name?: string | null;
    service_date: string;
    avaliable_date?: string | null;
    hour_of_day: number | string;
    service_type?: string | null;
    status: string;
    created_at: string;
    cancellation_reason?: string | null;
    queue_id?: number | null;
    queue_number?: string | null;
    numeric_no?: number | null;
    queue_status?: string | null;
}

function formatFullThaiDate(date: string) {
    const value = dayjs(date).locale('th');
    if (!value.isValid()) return 'ไม่ระบุวันที่';
    return `${value.format('D MMMM')} ${value.year() + 543}`;
}

export default function AppointmentPage() {
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [error, setError] = useState('');
    const fetchingAppointmentsRef = useRef(false);
    dayjs.locale("th");

    const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
    const currentMonthKey = dayjs().format('YYYY-MM');
    const [historyMonth, setHistoryMonth] = useState(currentMonthKey);
    const [showHistoryPicker, setShowHistoryPicker] = useState(false);

    const pendingAppointments = appointments.filter(
        (item) => item.status === 'pending' || item.status === 'waiting' || item.status === 'รอดำเนินการ'
    );

    const allHistoryAppointments = appointments.filter(
        (item) => item.status !== 'pending' && item.status !== 'waiting' && item.status !== 'รอดำเนินการ'
    );

    const historyAppointments = allHistoryAppointments.filter(
        (item) => dayjs(item.service_date).format('YYYY-MM') === historyMonth
    );

    const currentMonthAppointments = allHistoryAppointments.filter(
        (item) => dayjs(item.service_date).format('YYYY-MM') === currentMonthKey
    );

    const approvedCount = currentMonthAppointments.filter(
        (item) => item.status === 'approved'
    ).length;

    const cancelledCount = currentMonthAppointments.filter(
        (item) => item.status === 'cancelled' || item.status === 'rejected'
    ).length;

    const historyMonthDate = dayjs(`${historyMonth}-01`);
    const historyMonthLabel = `${historyMonthDate.locale('th').format('MMMM')} ${historyMonthDate.year() + 543}`;

    const tableData = activeTab === 'pending' ? pendingAppointments : historyAppointments;
    const tableDateGroups = Object.entries(
        tableData.reduce<Record<string, Appointment[]>>((groups, item) => {
            const dateKey = dayjs(item.service_date).format('YYYY-MM-DD');
            (groups[dateKey] ||= []).push(item);
            return groups;
        }, {})
    ).sort(([firstDate], [secondDate]) =>
        activeTab === 'pending'
            ? firstDate.localeCompare(secondDate)
            : secondDate.localeCompare(firstDate)
    );
    const todayText = dayjs().locale("th").format("D MMMM");
    const buddhistYear = dayjs().year() + 543;
    const [confirmAction, setConfirmAction] = useState<{
        appointmentId: number;
        action: 'approve' | 'reject';
    } | null>(null);
    const [rejectReason, setRejectReason] = useState('');

    const fetchAppointments = useCallback(async () => {
        if (fetchingAppointmentsRef.current) return;

        try {
            fetchingAppointmentsRef.current = true;
            const token = Cookies.get('adminToken');

            const res = await fetch(`${API}/appointments`, {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
                credentials: 'include',
            });

            if (!res.ok) {
                const text = await res.text();
                throw new Error(text);
            }

            const data = await res.json();
            setAppointments(data);
            setError('');
        } catch (err) {
            console.error('โหลดคิวล้มเหลว:', err);
            setError('ไม่สามารถโหลดข้อมูลได้');
        } finally {
            fetchingAppointmentsRef.current = false;
        }
    }, []);

    useEffect(() => {
        const syncVisibleAppointments = () => {
            if (document.visibilityState === 'visible') void fetchAppointments();
        };
        syncVisibleAppointments();
        const intervalId = window.setInterval(syncVisibleAppointments, 5000);

        window.addEventListener('focus', syncVisibleAppointments);
        document.addEventListener('visibilitychange', syncVisibleAppointments);

        return () => {
            window.clearInterval(intervalId);
            window.removeEventListener('focus', syncVisibleAppointments);
            document.removeEventListener('visibilitychange', syncVisibleAppointments);
        };
    }, [fetchAppointments]);

    const handleApprove = async (appointmentId: number) => {
        try {
            const token = Cookies.get('adminToken');

            const res = await fetch(`${API}/appointments/${appointmentId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ status: 'approved' }),
            });

            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error(data?.error || 'อนุมัติไม่สำเร็จ');

            Swal.fire({
                icon: data?.email_sent ? 'success' : 'warning',
                title: 'อนุมัติเรียบร้อย',
                text: data?.email_sent ? 'ส่งหมายเลขคิวและรหัสยืนยันทางอีเมลแล้ว' : 'สร้างคิวและรหัสแล้ว แต่ส่งอีเมลไม่สำเร็จ กรุณาตรวจสอบ SMTP',
            });
            await fetchAppointments();
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: err instanceof Error ? err.message : undefined });
        }
    };

    const handleReject = async (appointmentId: number, cancellationReason: string) => {
        try {
            const token = Cookies.get('adminToken');

            const res = await fetch(`${API}/appointments/${appointmentId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ status: 'cancelled', cancellation_reason: cancellationReason.trim() }),
            });

            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error(data?.error || 'ยกเลิกไม่สำเร็จ');

            Swal.fire({
                icon: data?.email_sent ? 'success' : 'warning',
                title: 'ยกเลิกแล้ว',
                text: data?.email_sent ? 'ส่งเหตุผลให้ผู้ใช้ทางอีเมลแล้ว' : 'บันทึกเหตุผลแล้ว แต่ส่งอีเมลไม่สำเร็จ กรุณาตรวจสอบ SMTP',
            });
            setRejectReason('');
            await fetchAppointments();
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: err instanceof Error ? err.message : undefined });
        }
    };

    const handleResendCode = async (appointmentId: number) => {
        try {
            const token = Cookies.get('adminToken');
            const res = await fetch(`${API}/appointments/${appointmentId}/resend-code`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json().catch(() => null);

            if (!res.ok) throw new Error(data?.error || data?.message || 'ส่งรหัสไม่สำเร็จ');

            Swal.fire({
                icon: data?.email_sent ? 'success' : 'warning',
                title: 'ออกรหัสใหม่แล้ว',
                html: `<p>${data?.email_sent ? 'ส่งรหัสใหม่ให้ผู้ใช้ทางอีเมลแล้ว' : data?.email_available === false ? 'ผู้ป่วยไม่มีอีเมล กรุณาแจ้งรหัสให้ผู้ป่วยโดยตรง' : 'ส่งอีเมลไม่สำเร็จ กรุณาแจ้งรหัสให้ผู้ป่วยโดยตรง'}</p>
                    <p style="font-size:28px;font-weight:800;letter-spacing:5px;margin:12px 0">${data?.access_code || '-'}</p>
                    <p>ใช้ได้ถึง ${data?.expires_at ? new Date(data.expires_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-'}</p>`,
            });
            await fetchAppointments();
        } catch (err) {
            Swal.fire({
                icon: 'error',
                title: 'ส่งรหัสไม่สำเร็จ',
                text: err instanceof Error ? err.message : undefined,
            });
        }
    };

    const handleEditCancellationReason = async (appointment: Appointment) => {
        const result = await Swal.fire({
            icon: 'info',
            title: 'แก้ไขหมายเหตุการยกเลิก',
            input: 'textarea',
            inputValue: appointment.cancellation_reason || '',
            inputPlaceholder: 'ระบุหมายเหตุการยกเลิก',
            inputAttributes: { maxlength: '500' },
            showCancelButton: true,
            confirmButtonText: 'บันทึกหมายเหตุ',
            cancelButtonText: 'ยกเลิก',
            confirmButtonColor: '#1f5ff2',
            preConfirm: (value) => {
                const reason = String(value || '').trim();
                if (!reason) {
                    Swal.showValidationMessage('กรุณาระบุหมายเหตุการยกเลิก');
                    return false;
                }
                return reason;
            },
        });

        if (!result.isConfirmed || !result.value) return;

        try {
            const token = Cookies.get('adminToken');
            const response = await fetch(
                `${API}/appointments/${appointment.appointment_id}/cancellation-reason`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ cancellation_reason: result.value }),
                }
            );
            const data = await response.json().catch(() => null);
            if (!response.ok) throw new Error(data?.error || 'แก้ไขหมายเหตุไม่สำเร็จ');

            await fetchAppointments();
            Swal.fire({
                icon: 'success',
                title: 'แก้ไขหมายเหตุแล้ว',
                timer: 1200,
                showConfirmButton: false,
            });
        } catch (error) {
            Swal.fire({
                icon: 'error',
                title: 'แก้ไขหมายเหตุไม่สำเร็จ',
                text: error instanceof Error ? error.message : undefined,
            });
        }
    };

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div className={styles.leftHeader}>
                    <div className={styles.pageTitleBox}>
                        <h1 className={styles.pageTitle}>จัดการการจองคิว</h1>
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
                    {error && <p className={styles.errorText}>{error}</p>}

                    <div className={styles.appointmentSummaryGrid}>
                        <div className={`${styles.summaryCard} ${styles.summaryPending}`}>
                            <Clock size={30} strokeWidth={1.8} />
                            <p>รอการอนุมัติ</p>
                            <strong>{pendingAppointments.length}</strong>
                        </div>

                        <div className={`${styles.summaryCard} ${styles.summaryApproved}`}>
                            <CheckCircle size={30} strokeWidth={1.8} />
                            <p>อนุมัติแล้ว (เดือนนี้)</p>
                            <strong>{approvedCount}</strong>
                        </div>

                        <div className={`${styles.summaryCard} ${styles.summaryCancelled}`}>
                            <XCircle size={30} strokeWidth={1.8} />
                            <p>ยกเลิก (เดือนนี้)</p>
                            <strong>{cancelledCount}</strong>
                        </div>
                    </div>

                    <div className={styles.appointmentPanel}>
                        <div className={styles.appointmentTabs}>
                            <button
                                type="button"
                                className={`${styles.tabButton} ${activeTab === 'pending' ? styles.tabActive : ''
                                    }`}
                                onClick={() => setActiveTab('pending')}
                            >
                                <Clock size={18} strokeWidth={2.2} />
                                <span>รอการอนุมัติ</span>
                                <b>{pendingAppointments.length}</b>
                            </button>

                            <button
                                type="button"
                                className={`${styles.tabButton} ${activeTab === 'history' ? styles.tabActive : ''
                                    }`}
                                onClick={() => setActiveTab('history')}
                            >
                                <List size={18} strokeWidth={2.2} />
                                <span>ประวัติการดำเนินการ</span>
                                <b>{historyAppointments.length}</b>
                            </button>

                            <button
                                type="button"
                                className={styles.archiveButton}
                                onClick={() => {
                                    setActiveTab('history');
                                    setShowHistoryPicker((current) => !current);
                                }}
                            >
                                <Archive size={18} strokeWidth={2.2} />
                                <span>ดูประวัติย้อนหลัง</span>
                            </button>
                        </div>

                        {activeTab === 'history' && showHistoryPicker && (
                            <div className={styles.archiveToolbar}>
                                <div>
                                    <strong>ประวัติรายเดือน</strong>
                                    <span>ข้อมูลถูกจัดเก็บไว้ครบถ้วนและไม่มีการลบ</span>
                                </div>

                                <label htmlFor="history-month">เลือกเดือน</label>
                                <input
                                    id="history-month"
                                    type="month"
                                    value={historyMonth}
                                    max={currentMonthKey}
                                    onChange={(event) => setHistoryMonth(event.target.value || currentMonthKey)}
                                />

                                {historyMonth !== currentMonthKey && (
                                    <button
                                        type="button"
                                        onClick={() => setHistoryMonth(currentMonthKey)}
                                    >
                                        กลับเดือนปัจจุบัน
                                    </button>
                                )}
                            </div>
                        )}

                        <div className={styles.appointmentTableHeader}>
                            <h2>
                                {activeTab === 'pending'
                                    ? 'รายการรอการอนุมัติการจองคิว'
                                    : `รายการที่ดำเนินการแล้ว — ${historyMonthLabel}`}
                            </h2>
                            <p>{tableData.length} รายการ</p>
                        </div>

                        <div className={styles.appointmentTableWrap}>
                            <table className={styles.modernAppointmentTable}>
                                <thead>
                                    <tr>
                                        <th>ดำเนินการ</th>
                                        <th>รหัสคนไข้</th>
                                        <th>ชื่อ–นามสกุล</th>
                                        <th>วันที่นัด</th>
                                        <th>เวลา</th>
                                        <th>สถานะ</th>
                                        <th>หมายเหตุ</th>
                                        <th>วันที่สร้าง</th>
                                    </tr>
                                </thead>

                                <tbody>
                                    {tableData.length > 0 ? (
                                        tableDateGroups.map(([dateKey, dateAppointments]) => (
                                            <Fragment key={dateKey}>
                                                <tr className={styles.dateGroupRow}>
                                                    <td colSpan={8}>
                                                        <div className={styles.dateGroupHeader}>
                                                            <CalendarDays size={20} strokeWidth={2.2} />
                                                            <strong>{formatFullThaiDate(dateKey)}</strong>
                                                            <span>{dateAppointments.length} รายการ</span>
                                                        </div>
                                                    </td>
                                                </tr>

                                                {dateAppointments.map((item) => (
                                                    <tr key={item.appointment_id}>
                                                        {activeTab === 'pending' ? (
                                                            <td>
                                                                <div className={styles.actionButtons}>
                                                                    <button
                                                                        type="button"
                                                                        className={styles.approveBtn}
                                                                        onClick={() =>
                                                                            setConfirmAction({
                                                                                appointmentId: item.appointment_id,
                                                                                action: 'approve',
                                                                            })
                                                                        }
                                                                    >
                                                                        <CheckCircle size={17} strokeWidth={2.2} />
                                                                        อนุมัติ
                                                                    </button>

                                                                    <button
                                                                        type="button"
                                                                        className={styles.rejectBtn}
                                                                        onClick={() => {
                                                                            setRejectReason('');
                                                                            setConfirmAction({
                                                                                appointmentId: item.appointment_id,
                                                                                action: 'reject',
                                                                            });
                                                                        }}
                                                                    >
                                                                        <XCircle size={17} strokeWidth={2.2} />
                                                                        ยกเลิก
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        ) : (
                                                            <td>
                                                                {item.status === 'approved' ? (
                                                                    <button
                                                                        type="button"
                                                                        className={styles.approveBtn}
                                                                        onClick={() => handleResendCode(item.appointment_id)}
                                                                    >
                                                                        ส่งรหัสอีกครั้ง
                                                                    </button>
                                                                ) : item.status === 'cancelled' || item.status === 'rejected' ? (
                                                                    <button
                                                                        type="button"
                                                                        className={styles.editNoteBtn}
                                                                        onClick={() => handleEditCancellationReason(item)}
                                                                    >
                                                                        <Pencil size={15} strokeWidth={2.2} />
                                                                        แก้หมายเหตุ
                                                                    </button>
                                                                ) : '-'}
                                                            </td>
                                                        )}

                                                        <td>
                                                            <span className={styles.patientCodeBadge}>
                                                                P{String(item.user_id).padStart(3, '0')}
                                                            </span>
                                                        </td>

                                                        <td>
                                                            <span className={styles.patientName}>
                                                                {`${item.first_name || ''} ${item.last_name || ''}`.trim() || '-'}
                                                            </span>
                                                        </td>

                                                        <td className={styles.dateCell}>
                                                            {item.service_date
                                                                ? dayjs(item.service_date).format('dd. D MMM. ') +
                                                                (dayjs(item.service_date).year() + 543)
                                                                : '-'}
                                                        </td>

                                                        <td className={styles.timeCell}>
                                                            <Clock size={16} strokeWidth={2} />
                                                            {item.hour_of_day ? `${String(item.hour_of_day).padStart(2, '0')}:00` : '-'} น.
                                                        </td>

                                                        <td>
                                                            <span
                                                                className={
                                                                    item.status === 'approved'
                                                                        ? styles.statusApproved
                                                                        : item.status === 'cancelled' || item.status === 'rejected'
                                                                            ? styles.statusCancelled
                                                                            : styles.statusPending
                                                                }
                                                            >
                                                                {item.status === 'approved'
                                                                    ? 'อนุมัติแล้ว'
                                                                    : item.status === 'cancelled' || item.status === 'rejected'
                                                                        ? item.status === 'rejected' ? 'ไม่อนุมัติ' : 'ยกเลิก'
                                                                        : 'รอดำเนินการ'}
                                                            </span>
                                                        </td>

                                                        <td>{item.cancellation_reason || '-'}</td>

                                                        <td className={styles.createdCell}>
                                                            {item.created_at
                                                                ? dayjs(item.created_at).format('dd. D MMM. ') +
                                                                (dayjs(item.created_at).year() + 543)
                                                                : '-'}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </Fragment>
                                        ))
                                    ) : (
                                        <tr>
                                            <td
                                                colSpan={8}
                                                className={styles.emptyTableCell}
                                            >
                                                {activeTab === 'pending'
                                                    ? 'ไม่มีรายการรอการอนุมัติ'
                                                    : 'ยังไม่มีประวัติการดำเนินการ'}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    {confirmAction && (
                        <div
                            className={styles.confirmOverlay}
                            onClick={() => setConfirmAction(null)}
                        >
                            <div
                                className={styles.confirmBox}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div
                                    className={
                                        confirmAction.action === 'approve'
                                            ? styles.confirmApproveIcon
                                            : styles.confirmRejectIcon
                                    }
                                >
                                    {confirmAction.action === 'approve' ? (
                                        <CheckCircle size={34} strokeWidth={2.2} />
                                    ) : (
                                        <XCircle size={34} strokeWidth={2.2} />
                                    )}
                                </div>

                                <h3>
                                    {confirmAction.action === 'approve'
                                        ? 'ยืนยันการอนุมัติ'
                                        : 'ยืนยันการยกเลิก'}
                                </h3>

                                <p>
                                    {confirmAction.action === 'approve'
                                        ? 'คุณต้องการอนุมัติการจองคิวนี้ใช่หรือไม่?'
                                        : 'คุณต้องการยกเลิกการจองคิวนี้ใช่หรือไม่?'}
                                </p>

                                {confirmAction.action === 'reject' && (
                                    <div className={styles.rejectReasonField}>
                                        <label htmlFor="reject-reason">เหตุผลที่ยกเลิก</label>
                                        <textarea
                                            id="reject-reason"
                                            value={rejectReason}
                                            onChange={(event) => setRejectReason(event.target.value)}
                                            placeholder="ระบุเหตุผลเพื่อส่งให้ผู้ใช้ทางอีเมล"
                                            autoFocus
                                        />
                                    </div>
                                )}

                                <div className={styles.confirmActions}>
                                    <button
                                        type="button"
                                        className={styles.confirmCancelBtn}
                                        onClick={() => setConfirmAction(null)}
                                    >
                                        กลับ
                                    </button>

                                    <button
                                        type="button"
                                        className={
                                            confirmAction.action === 'approve'
                                                ? styles.confirmApproveBtn
                                                : styles.confirmRejectBtn
                                        }
                                        onClick={() => {
                                            if (confirmAction.action === 'approve') {
                                                handleApprove(confirmAction.appointmentId);
                                            } else {
                                                handleReject(confirmAction.appointmentId, rejectReason);
                                            }

                                            setConfirmAction(null);
                                        }}
                                        disabled={confirmAction.action === 'reject' && !rejectReason.trim()}
                                    >
                                        {confirmAction.action === 'approve'
                                            ? 'ยืนยันอนุมัติ'
                                            : 'ยืนยันยกเลิก'}
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
