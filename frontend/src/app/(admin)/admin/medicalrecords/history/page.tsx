"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Cookies from "@/lib/cookies";
import dayjs, { Dayjs } from "dayjs";
import "dayjs/locale/th";
import {
    ArrowLeft,
    CalendarDays,
    ChevronLeft,
    ChevronRight,
    Eye,
    FileClock,
    Search,
    X,
} from "lucide-react";
import { API_BASE } from "@/lib/api";
import Sidebar from "@/components/admin-shell/AdminSidebar";
import AdminHeaderActions from "@/components/admin-shell/AdminHeaderActions";
import styles from "./History.module.css";

dayjs.locale("th");

const API = API_BASE.endsWith("/api") ? API_BASE : `${API_BASE}/api`;

type HistoryRecord = {
    appointment_id: string | number;
    patient_code?: string;
    full_name?: string;
    queue_no?: string;
    visit_date: string;
    symptoms?: string;
    diagnosis?: string;
    treatment?: string;
    medications?: unknown;
    notes?: string;
    follow_up_date?: string | null;
    body_drawing_data?: string | null;
};

function mondayOf(date: Dayjs) {
    const day = date.day();
    return date.startOf("day").subtract(day === 0 ? 6 : day - 1, "day");
}

function thaiDate(date: string | Dayjs) {
    const value = dayjs(date).locale("th");
    return value.isValid() ? `${value.format("D MMMM")} ${value.year() + 543}` : "-";
}

function medicinesText(value: unknown) {
    if (Array.isArray(value)) return value.filter(Boolean).join(", ") || "-";
    if (typeof value === "string") {
        try {
            const parsed: unknown = JSON.parse(value);
            if (Array.isArray(parsed)) return parsed.filter(Boolean).join(", ") || "-";
        } catch {
            return value || "-";
        }
        return value || "-";
    }
    return "-";
}

export default function MedicalRecordsHistoryPage() {
    const lastWeekStart = useMemo(() => mondayOf(dayjs()).subtract(1, "week"), []);
    const [weekStart, setWeekStart] = useState(lastWeekStart);
    const [records, setRecords] = useState<HistoryRecord[]>([]);
    const [searchText, setSearchText] = useState("");
    const [selected, setSelected] = useState<HistoryRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const weekEnd = weekStart.add(6, "day");
    const weekStartKey = weekStart.format("YYYY-MM-DD");
    const weekEndKey = weekEnd.format("YYYY-MM-DD");
    const canGoForward = weekStart.isBefore(lastWeekStart, "day");

    useEffect(() => {
        const controller = new AbortController();

        const load = async () => {
            const token =
                Cookies.get("adminToken") ||
                Cookies.get("staffToken") ||
                Cookies.get("token") ||
                "";

            if (!token) {
                setError("กรุณาเข้าสู่ระบบก่อนดูประวัติเวชระเบียน");
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                setError("");
                const params = new URLSearchParams({
                    start_date: weekStartKey,
                    end_date: weekEndKey,
                    recorded_only: "true",
                });
                const response = await fetch(`${API}/medical-records?${params}`, {
                    headers: { Authorization: `Bearer ${token}` },
                    cache: "no-store",
                    signal: controller.signal,
                });

                if (!response.ok) throw new Error("โหลดประวัติเวชระเบียนไม่สำเร็จ");
                const data: unknown = await response.json();
                setRecords(Array.isArray(data) ? (data as HistoryRecord[]) : []);
            } catch (requestError) {
                if (requestError instanceof DOMException && requestError.name === "AbortError") return;
                setError(requestError instanceof Error ? requestError.message : "เกิดข้อผิดพลาดในการโหลดข้อมูล");
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        };

        load();
        return () => controller.abort();
    }, [weekEndKey, weekStartKey]);

    const filteredGroups = useMemo(() => {
        const query = searchText.trim().toLocaleLowerCase("th");
        const filtered = records.filter((record) => {
            if (!query) return true;
            return [record.full_name, record.queue_no, record.patient_code].some((value) =>
                String(value || "").toLocaleLowerCase("th").includes(query)
            );
        });

        const groups = new Map<string, HistoryRecord[]>();
        for (const record of filtered) {
            const key = dayjs(record.visit_date).format("YYYY-MM-DD");
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(record);
        }

        return Array.from(groups.entries()).sort(([first], [second]) =>
            second.localeCompare(first)
        );
    }, [records, searchText]);

    const visibleCount = filteredGroups.reduce((total, [, rows]) => total + rows.length, 0);

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div>
                    <h1>ประวัติเวชระเบียน</h1>
                    <p>ข้อมูลย้อนหลังที่บันทึกแล้ว แยกตามสัปดาห์</p>
                </div>
                <AdminHeaderActions />
            </header>

            <div className={styles.wrapper}>
                <Sidebar />
                <main className={styles.content}>
                    <div className={styles.topbar}>
                        <Link href="/admin/medicalrecords" className={styles.backLink}>
                            <ArrowLeft size={18} /> กลับหน้าเวชระเบียน
                        </Link>

                        <div className={styles.weekPicker}>
                            <button type="button" onClick={() => setWeekStart((date) => date.subtract(1, "week"))}>
                                <ChevronLeft size={20} />
                            </button>
                            <div>
                                <small>สัปดาห์ที่เลือก</small>
                                <strong>{thaiDate(weekStart)} – {thaiDate(weekEnd)}</strong>
                            </div>
                            <button
                                type="button"
                                disabled={!canGoForward}
                                onClick={() => setWeekStart((date) => date.add(1, "week"))}
                            >
                                <ChevronRight size={20} />
                            </button>
                        </div>
                    </div>

                    <section className={styles.panel}>
                        <div className={styles.panelHeader}>
                            <div className={styles.titleGroup}>
                                <FileClock size={25} />
                                <div>
                                    <h2>เวชระเบียนที่บันทึกแล้ว</h2>
                                    <p>{visibleCount} รายการ</p>
                                </div>
                            </div>
                            <label className={styles.searchBox}>
                                <Search size={18} />
                                <input
                                    value={searchText}
                                    onChange={(event) => setSearchText(event.target.value)}
                                    placeholder="ค้นหาชื่อ / รหัสคิว / รหัสผู้ป่วย"
                                />
                            </label>
                        </div>

                        {loading && <div className={styles.message}>กำลังโหลดประวัติเวชระเบียน...</div>}
                        {!loading && error && <div className={`${styles.message} ${styles.error}`}>{error}</div>}
                        {!loading && !error && filteredGroups.length === 0 && (
                            <div className={styles.message}>ไม่พบเวชระเบียนในสัปดาห์นี้</div>
                        )}

                        {!loading && !error && filteredGroups.length > 0 && (
                            <div className={styles.tableWrap}>
                                <table>
                                    <thead>
                                        <tr>
                                            <th>รหัสคิว</th>
                                            <th>รหัสผู้ป่วย</th>
                                            <th>ชื่อ–นามสกุล</th>
                                            <th>อาการ</th>
                                            <th>ผลวินิจฉัย</th>
                                            <th>รายละเอียด</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredGroups.map(([dateKey, rows]) => (
                                            <Fragment key={dateKey}>
                                                <tr className={styles.dateRow}>
                                                    <td colSpan={6}>
                                                        <div>
                                                            <CalendarDays size={19} />
                                                            <strong>{thaiDate(dateKey)}</strong>
                                                            <span>{rows.length} รายการ</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {rows.map((record) => (
                                                    <tr key={String(record.appointment_id)}>
                                                        <td><b className={styles.queue}>{record.queue_no || "-"}</b></td>
                                                        <td><b className={styles.patientCode}>{record.patient_code || "-"}</b></td>
                                                        <td className={styles.name}>{record.full_name || "-"}</td>
                                                        <td className={styles.clamp}>{record.symptoms || "-"}</td>
                                                        <td className={styles.clamp}>{record.diagnosis || "-"}</td>
                                                        <td>
                                                            <button className={styles.viewButton} type="button" onClick={() => setSelected(record)}>
                                                                <Eye size={17} /> ดูข้อมูล
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>
                </main>
            </div>

            {selected && (
                <div className={styles.overlay} onMouseDown={() => setSelected(null)}>
                    <article className={styles.detailModal} onMouseDown={(event) => event.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <div>
                                <small>{selected.patient_code || "-"} · {selected.queue_no || "-"}</small>
                                <h2>{selected.full_name || "ไม่ระบุชื่อ"}</h2>
                                <p>วันที่รับบริการ {thaiDate(selected.visit_date)}</p>
                            </div>
                            <button type="button" onClick={() => setSelected(null)} aria-label="ปิด">
                                <X size={21} />
                            </button>
                        </div>
                        <div className={styles.detailGrid}>
                            <div><span>อาการ</span><p>{selected.symptoms || "-"}</p></div>
                            <div><span>ผลวินิจฉัย</span><p>{selected.diagnosis || "-"}</p></div>
                            <div><span>การรักษา</span><p>{selected.treatment || "-"}</p></div>
                            <div><span>ยาที่จ่าย</span><p>{medicinesText(selected.medications)}</p></div>
                            <div className={`${styles.fullWidth} ${styles.notesBox}`}><span>บันทึกเพิ่มเติม</span><p>{selected.notes || "-"}</p></div>
                            <div className={styles.fullWidth}><span>วันนัดติดตาม</span><p>{selected.follow_up_date ? thaiDate(selected.follow_up_date) : "-"}</p></div>
                            <div className={styles.fullWidth}>
                                <span>ภาพวาดตำแหน่งอาการ</span>
                                {selected.body_drawing_data ? (
                                    <img className={styles.bodyDrawingImage} src={selected.body_drawing_data} alt="ภาพวาดตำแหน่งอาการ" />
                                ) : (
                                    <p>-</p>
                                )}
                            </div>
                        </div>
                    </article>
                </div>
            )}
        </div>
    );
}
