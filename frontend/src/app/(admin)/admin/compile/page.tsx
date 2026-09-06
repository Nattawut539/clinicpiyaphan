'use client';
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */

import Link from 'next/link';
import Cookies from 'js-cookie';
import { useEffect, useMemo, useState } from 'react';
import styles from './compile.module.css';
import { API_BASE } from '@/lib/api';
import Sidebar from '@/components/admin-shell/AdminSidebar';
import AdminHeaderActions from '@/components/admin-shell/AdminHeaderActions';
import dayjs from "dayjs";
import "dayjs/locale/th";
dayjs.locale("th");
import {
    Activity,
    CalendarDays,
    RotateCcw,
    Star,
} from 'lucide-react';

import { Bar, Line, Doughnut } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    ArcElement,
    BarElement,
    Tooltip,
    Legend
} from 'chart.js';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    ArcElement,
    BarElement,
    Tooltip,
    Legend
);

/* ===================== Interfaces ===================== */
interface CategorySummary { category: string; total: number; }
interface WeeklyUsage { week_no?: number; day?: string; total: number; }
interface LikesSummary { likes: number; dislikes: number; }
interface ScoreSummary { avg_score: string | number | null; total: string | number; empty?: boolean; }
interface DailyScore {
    day: string;
    period?: string;
    avg_score: string;
    total: string;
    name: string;
    comment: string;
    comments?: FeedbackComment[];
}
interface AgeGroup { label: string; percent: number; }
interface FeedbackComment { name?: string | null; comment?: string | null; score?: string | number | null; }

/* ===================== Utils ===================== */
const thaiMonths = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน',
    'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
    'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

const getAgeColor = (index: number) => {
    const colors = ['#0B0B45', '#2F6BA2', '#74B9F7', '#B2D4F3'];
    return colors[index % colors.length];
};

const safeNumber = (v: any, fallback = 0) => {
    const n = typeof v === 'string' ? Number(v) : v;
    return Number.isFinite(n) ? n : fallback;
};

const patientCategoryBuckets = ['ตรวจสุขภาพ', 'ไข้หวัดใหญ่', 'ตรวจทั่วไป', 'โรคเรื้อรัง', 'อื่นๆ'];

function normalizePatientCategory(category: string) {
    const value = String(category || '').toLowerCase();
    if (value.includes('ตรวจสุขภาพ') || value.includes('checkup') || value.includes('health')) return 'ตรวจสุขภาพ';
    if (value.includes('ไข้หวัด') || value.includes('flu') || value.includes('influenza')) return 'ไข้หวัดใหญ่';
    if (value.includes('ทั่วไป') || value.includes('ตรวจโรค') || value.includes('general')) return 'ตรวจทั่วไป';
    if (value.includes('เรื้อรัง') || value.includes('เบาหวาน') || value.includes('ความดัน') || value.includes('chronic')) return 'โรคเรื้อรัง';
    return 'อื่นๆ';
}

/**
 * อ่าน response แบบปลอดภัย:
 * - เช็ค res.ok
 * - เช็ค content-type
 * - กันกรณี server ส่ง HTML กลับมา (เช่น 404 page)
 */
async function safeJson<T>(res: Response, errorLabel: string): Promise<T> {
    const contentType = res.headers.get('content-type') || '';

    if (!res.ok) {
        // พยายามอ่าน body เพื่อ debug แต่ไม่ทำให้พัง
        const text = await res.text().catch(() => '');
        throw new Error(`${errorLabel} (HTTP ${res.status}) ${text?.slice(0, 120) || ''}`);
    }

    if (!contentType.includes('application/json')) {
        const text = await res.text().catch(() => '');
        throw new Error(`${errorLabel}: response ไม่ใช่ JSON (${contentType}) ${text?.slice(0, 120) || ''}`);
    }

    return res.json() as Promise<T>;
}

function toArray<T>(v: any): T[] {
    return Array.isArray(v) ? v : [];
}

/* ===================== Component ===================== */
export default function PatientDashboard() {
    const today = useMemo(() => new Date(), []);

    /* ---------- Auth ---------- */
    const token = Cookies.get('adminToken');
    const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

    /* ---------- State ---------- */
    const [admin, setAdmin] = useState({ first_name: '', last_name: '', profile_image: '' });

    const [categoryData, setCategoryData] = useState<CategorySummary[]>([]);
    const [weeklyUsage, setWeeklyUsage] = useState<WeeklyUsage[]>([]);
    const [likesDislikes, setLikesDislikes] = useState<LikesSummary>({ likes: 0, dislikes: 0 });
    const [scoreSummary, setScoreSummary] = useState<ScoreSummary>({ avg_score: null, total: 0, empty: true });
    const [dailyScores, setDailyScores] = useState<DailyScore[]>([]);
    const [ageData, setAgeData] = useState<AgeGroup[]>([]);

    const [categoryViewMonth, setCategoryViewMonth] = useState(today.getMonth());
    const [weeklyViewMonth, setWeeklyViewMonth] = useState(today.getMonth());
    const [likesViewMonth, setLikesViewMonth] = useState(today.getMonth());
    const [scoreViewMonth, setScoreViewMonth] = useState(today.getMonth());
    const [currentYear, setCurrentYear] = useState(today.getFullYear());
    const [scoreViewYear, setScoreViewYear] = useState(today.getFullYear());

    const [selectedFeedback, setSelectedFeedback] = useState<DailyScore | null>(null);

    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string>('');

    const todayText = dayjs().locale("th").format("D MMMM");
    const buddhistYear = dayjs().year() + 543;
    const currentScoreMonthKey = dayjs(today).format('YYYY-MM');
    const selectedScoreMonthKey = `${scoreViewYear}-${String(scoreViewMonth + 1).padStart(2, '0')}`;
    const selectedScoreMonthLabel = `${thaiMonths[scoreViewMonth]} ${scoreViewYear + 543}`;

    const totalFeedback = safeNumber(scoreSummary.total);
    const avgScore = safeNumber(scoreSummary.avg_score);

    const totalLikes = safeNumber(likesDislikes.likes);
    const totalDislikes = safeNumber(likesDislikes.dislikes);
    const totalLikeDislike = totalLikes + totalDislikes;
    const hasSatisfactionData = totalLikeDislike > 0;

    const satisfactionPercent =
        totalLikeDislike > 0
            ? Math.round((totalLikes / totalLikeDislike) * 100)
            : 0;

    /* ===================== Month Controls ===================== */
    const prevMonth = (set: any) => set((m: number) => (m - 1 + 12) % 12);
    const nextMonth = (set: any) => set((m: number) => (m + 1) % 12);

    const handleScoreMonthChange = (value: string) => {
        const parsed = dayjs(`${value}-01`);
        if (!parsed.isValid()) return;
        setScoreViewYear(parsed.year());
        setScoreViewMonth(parsed.month());
    };

    const resetScoreMonth = () => {
        setScoreViewYear(today.getFullYear());
        setScoreViewMonth(today.getMonth());
    };

    /* ===================== Fetch Admin ===================== */
    useEffect(() => {
        if (!token) return;

        const run = async () => {
            try {
                setErrorMsg('');
                const res = await fetch(`${API_BASE}/users/me`, { headers, cache: 'no-store' });
                const data = await safeJson<any>(res, 'โหลดข้อมูลแอดมินล้มเหลว');
                setAdmin(data);
            } catch (err: any) {
                console.error(err);
                // ไม่ให้ล้มทั้งหน้า แค่เก็บ error
                setErrorMsg(err?.message || 'โหลดข้อมูลแอดมินล้มเหลว');
            }
        };

        run();
    }, [token, headers]);

    /* ===================== Fetch Dashboard ===================== */
    useEffect(() => {
        if (!token) return;

        const loadAll = async () => {
            try {
                const [
                    catRes,
                    dailyRes,
                    likeRes,
                    scoreRes,
                    scoreTrendRes,
                    ageRes
                ] = await Promise.all([
                    fetch(`${API_BASE}/feedbacks/summary/category?year=${currentYear}&month=${categoryViewMonth + 1}`, { headers }),
                    fetch(`${API_BASE}/feedbacks/summary/daily?year=${currentYear}&month=${weeklyViewMonth + 1}`, { headers }),
                    fetch(`${API_BASE}/feedbacks/summary/like-dislike?year=${currentYear}&month=${likesViewMonth + 1}`, { headers }),
                    fetch(`${API_BASE}/feedbacks/summary/score?year=${scoreViewYear}&month=${scoreViewMonth + 1}`, { headers }),
                    fetch(`${API_BASE}/feedbacks/summary/period/daily?year=${scoreViewYear}&month=${scoreViewMonth + 1}`, { headers }),
                    fetch(`${API_BASE}/feedbacks/summary/age-groups?year=${currentYear}&month=${weeklyViewMonth + 1}`, { headers })
                ]);

                const catJson = await safeJson<any>(catRes, 'โหลดประเภทผู้ป่วยล้มเหลว');
                const dailyJson = await safeJson<any>(dailyRes, 'โหลดแนวโน้มผู้ใช้บริการล้มเหลว');
                const likeJson = await safeJson<any>(likeRes, 'โหลดความพึงพอใจล้มเหลว');
                const scoreJson = await safeJson<any>(scoreRes, 'โหลดคะแนนล้มเหลว');
                const scoreTrendJson = await safeJson<any>(scoreTrendRes, 'โหลดคะแนนรายวันล้มเหลว');
                const ageJson = await safeJson<any>(ageRes, 'โหลดช่วงอายุล้มเหลว');

                setCategoryData(catJson.data ?? []);
                setWeeklyUsage(dailyJson.data ?? []);
                setLikesDislikes(likeJson);
                setScoreSummary(scoreJson);
                setDailyScores(scoreTrendJson.data ?? []);
                setAgeData(ageJson.data ?? []);

            } catch (err) {
                console.error("โหลด dashboard ล้มเหลว", err);
            }
        };

        loadAll();
    }, [
        categoryViewMonth,
        weeklyViewMonth,
        likesViewMonth,
        scoreViewMonth,
        scoreViewYear,
        currentYear,
        headers,
        token
    ]);


    /* ===================== Charts ===================== */
    const normalizedCategoryData = useMemo(() => {
        const totals = new Map(patientCategoryBuckets.map((label) => [label, 0]));
        categoryData.forEach((item) => {
            const bucket = normalizePatientCategory(item.category);
            totals.set(bucket, (totals.get(bucket) || 0) + safeNumber(item.total));
        });
        return patientCategoryBuckets.map((category) => ({
            category,
            total: totals.get(category) || 0,
        }));
    }, [categoryData]);

    const categoryChartData = useMemo(() => ({
        labels: normalizedCategoryData.map(i => i.category),
        datasets: [{
            label: 'จำนวน',
            data: normalizedCategoryData.map(i => safeNumber(i.total)),
            backgroundColor: '#7BAAF7',
            borderRadius: 10,
            barThickness: 40
        }]
    }), [normalizedCategoryData]);

    const weeklyLineData = useMemo(() => ({
        labels: weeklyUsage.map(w => w.day ? dayjs(w.day).format('D MMM') : `สัปดาห์ ${w.week_no}`),
        datasets: [{
            label: 'ผู้ใช้',
            data: weeklyUsage.map(w => safeNumber(w.total)),
            borderColor: '#2f86a5',
            fill: false
        }]
    }), [weeklyUsage]);

    const likeDonutData = useMemo(() => ({
        labels: hasSatisfactionData ? ['พอใจ', 'ไม่พอใจ'] : ['ยังไม่มีข้อมูล'],
        datasets: [{
            // Chart.js does not draw an arc when every value is zero. A neutral
            // placeholder keeps the chart visible while clearly showing no data.
            data: hasSatisfactionData ? [totalLikes, totalDislikes] : [1],
            backgroundColor: hasSatisfactionData
                ? ['#2563eb', '#fca5a5']
                : ['#e2e8f0'],
            borderWidth: 0,
            hoverOffset: hasSatisfactionData ? 5 : 0,
        }]
    }), [hasSatisfactionData, totalDislikes, totalLikes]);

    /* ===================== UI ===================== */
    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div className={styles.leftHeader}>
                    <div className={styles.pageTitleBox}>
                        <h1 className={styles.pageTitle}>คะแนนการให้บริการ</h1>
                        <p className={styles.pageDate}>
                            วันที่ {todayText} {buddhistYear}
                        </p>
                    </div>
                </div>

                <AdminHeaderActions />
            </header>

            <div className={styles.wrapper}>
                <Sidebar />

                <main className={styles.dashboard}>
                    {errorMsg && (
                        <div className={styles.errorBanner}>
                            {errorMsg}
                        </div>
                    )}

                    <div className={styles.serviceStatsGrid}>
                        <div className={`${styles.serviceStatCard} ${styles.statYellow}`}>
                            <p>คะแนนเฉลี่ย</p>
                            <strong>{avgScore > 0 ? avgScore.toFixed(1) : '0.0'}</strong>
                            <span>จาก 5.0 ดาว</span>
                        </div>

                        <div className={`${styles.serviceStatCard} ${styles.statBlue}`}>
                            <p>ผู้ใช้บริการเดือนนี้</p>
                            <strong>
                                {weeklyUsage.reduce((sum, item) => sum + safeNumber(item.total), 0)}
                            </strong>
                            <span>+29.4% จากเดือนก่อน</span>
                        </div>

                        <div className={`${styles.serviceStatCard} ${styles.statGreen}`}>
                            <p>ความพึงพอใจ</p>
                            <strong>{satisfactionPercent}%</strong>
                            <span>พอใจและพอใจมาก</span>
                        </div>

                        <div className={`${styles.serviceStatCard} ${styles.statPurple}`}>
                            <p>รีวิวทั้งหมด</p>
                            <strong>{totalFeedback}</strong>
                            <span>ตั้งแต่เปิดให้บริการ</span>
                        </div>
                    </div>

                    <div className={styles.serviceChartsGrid}>
                        <div className={styles.serviceChartCard}>
                            <h3>ประเภทผู้ป่วย</h3>

                            <div className={styles.chartBox}>
                                <Bar
                                    data={categoryChartData}
                                    options={{
                                        responsive: true,
                                        maintainAspectRatio: false,
                                        plugins: {
                                            legend: {
                                                display: false,
                                            },
                                            tooltip: {
                                                backgroundColor: '#ffffff',
                                                titleColor: '#172033',
                                                bodyColor: '#3b82f6',
                                                borderColor: '#e2e8f0',
                                                borderWidth: 1,
                                                padding: 12,
                                            },
                                        },
                                        scales: {
                                            x: {
                                                grid: {
                                                    display: false,
                                                },
                                                ticks: {
                                                    color: '#64748b',
                                                    font: {
                                                        size: 13,
                                                    },
                                                },
                                            },
                                            y: {
                                                beginAtZero: true,
                                                grid: {
                                                    color: '#eef3f8',
                                                },
                                                ticks: {
                                                    color: '#8a9bb8',
                                                    font: {
                                                        size: 13,
                                                    },
                                                },
                                            },
                                        },
                                    }}
                                />
                            </div>

                            <div className={styles.legendRow}>
                                {normalizedCategoryData.map((item, index) => (
                                    <span key={item.category}>
                                        <i style={{ backgroundColor: getAgeColor(index) }} />
                                        {item.category}: {item.total}
                                    </span>
                                ))}
                            </div>
                        </div>

                        <div className={styles.serviceChartCard}>
                            <h3>แนวโน้มการใช้บริการ</h3>

                            <div className={styles.chartBox}>
                                <Line
                                    data={{
                                        ...weeklyLineData,
                                        datasets: weeklyLineData.datasets.map((ds) => ({
                                            ...ds,
                                            borderColor: '#3b82f6',
                                            backgroundColor: '#3b82f6',
                                            pointBackgroundColor: '#2563eb',
                                            pointBorderColor: '#ffffff',
                                            pointBorderWidth: 2,
                                            pointRadius: 6,
                                            pointHoverRadius: 8,
                                            borderWidth: 4,
                                            tension: 0.38,
                                        })),
                                    }}
                                    options={{
                                        responsive: true,
                                        maintainAspectRatio: false,
                                        plugins: {
                                            legend: {
                                                display: false,
                                            },
                                            tooltip: {
                                                backgroundColor: '#ffffff',
                                                titleColor: '#172033',
                                                bodyColor: '#3b82f6',
                                                borderColor: '#e2e8f0',
                                                borderWidth: 1,
                                                padding: 12,
                                            },
                                        },
                                        scales: {
                                            x: {
                                                grid: {
                                                    display: false,
                                                },
                                                ticks: {
                                                    color: '#64748b',
                                                    font: {
                                                        size: 13,
                                                    },
                                                },
                                            },
                                            y: {
                                                beginAtZero: true,
                                                grid: {
                                                    color: '#eef3f8',
                                                },
                                                ticks: {
                                                    color: '#8a9bb8',
                                                    font: {
                                                        size: 13,
                                                    },
                                                },
                                            },
                                        },
                                    }}
                                />
                            </div>
                        </div>

                        <div className={styles.serviceChartCard}>
                            <h3>ข้อมูลประชากรผู้ใช้บริการ (ช่วงอายุ)</h3>

                            <div className={styles.ageBarBox}>
                                {ageData.length === 0 ? (
                                    <div className={styles.noDataBox}>
                                        ไม่มีข้อมูลช่วงอายุจากฐานข้อมูล
                                    </div>
                                ) : (
                                    ageData.map((item, index) => (
                                        <div key={item.label} className={styles.ageBarItem}>
                                            <div
                                                className={styles.ageBar}
                                                style={{
                                                    height: `${Math.max(item.percent, 10) * 2.5}px`,
                                                    backgroundColor: getAgeColor(index),
                                                }}
                                            />
                                            <span>{item.label}</span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                    </div>

                    <div className={styles.monthlyScoreCard}>
                        <div className={styles.monthlyScoreHeader}>
                            <div>
                                <h3>ความพึงพอใจและคะแนนรายเดือน</h3>
                                <p className={styles.monthlyScoreSubhead}>{selectedScoreMonthLabel}</p>
                            </div>

                            <div className={styles.monthlyScoreTools}>
                                <label className={styles.monthPicker}>
                                    <CalendarDays size={17} />
                                    <input
                                        type="month"
                                        value={selectedScoreMonthKey}
                                        onChange={(event) => handleScoreMonthChange(event.target.value)}
                                    />
                                </label>

                                {selectedScoreMonthKey !== currentScoreMonthKey && (
                                    <button
                                        type="button"
                                        className={styles.currentMonthButton}
                                        onClick={resetScoreMonth}
                                    >
                                        <RotateCcw size={16} />
                                        เดือนปัจจุบัน
                                    </button>
                                )}

                                <div className={styles.averageBadge}>
                                    <Star size={18} fill="currentColor" />
                                    เฉลี่ย {avgScore > 0 ? avgScore.toFixed(1) : '0.0'}
                                </div>
                            </div>
                        </div>

                        <div className={styles.satisfactionScoreOverview}>
                            <div className={styles.satisfactionDonutPanel}>
                                <div className={styles.donutBox}>
                                    <Doughnut
                                        data={likeDonutData}
                                        options={{
                                            responsive: true,
                                            maintainAspectRatio: false,
                                            cutout: '62%',
                                            plugins: {
                                                legend: {
                                                    display: false,
                                                },
                                                tooltip: {
                                                    backgroundColor: '#ffffff',
                                                    titleColor: '#172033',
                                                    bodyColor: '#3b82f6',
                                                    borderColor: '#e2e8f0',
                                                    borderWidth: 1,
                                                    padding: 12,
                                                },
                                            },
                                        }}
                                    />
                                    {hasSatisfactionData && (
                                        <div className={styles.donutCenterLabel}>
                                            <strong>{satisfactionPercent}%</strong>
                                            <span>พึงพอใจ</span>
                                        </div>
                                    )}
                                    {!hasSatisfactionData && (
                                        <div className={styles.donutEmptyLabel}>
                                            <strong>0</strong>
                                            <span>ยังไม่มีข้อมูล</span>
                                        </div>
                                    )}
                                </div>

                                <div className={styles.satisfactionList}>
                                    {[
                                        {
                                            label: 'พอใจ',
                                            value: totalLikeDislike > 0 ? Math.round((totalLikes / totalLikeDislike) * 100) : 0,
                                            color: '#2563eb',
                                        },
                                        {
                                            label: 'ไม่พอใจ',
                                            value: totalLikeDislike > 0 ? Math.round((totalDislikes / totalLikeDislike) * 100) : 0,
                                            color: '#fca5a5',
                                        },
                                    ].map((item) => (
                                        <div key={item.label} className={styles.satisfactionItem}>
                                            <div className={styles.satisfactionTop}>
                                                <span>
                                                    <i style={{ backgroundColor: item.color }} />
                                                    {item.label}
                                                </span>
                                                <b>{item.value}%</b>
                                            </div>

                                            <div className={styles.progressTrack}>
                                                <div
                                                    className={styles.progressFill}
                                                    style={{
                                                        width: `${item.value}%`,
                                                        backgroundColor: item.color,
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className={styles.satisfactionSummaryPanel}>
                                <div className={styles.summaryMetric}>
                                    <span>คะแนนเฉลี่ย</span>
                                    <strong>{avgScore > 0 ? avgScore.toFixed(1) : '0.0'}</strong>
                                    <small>/ 5.0</small>
                                </div>
                                <div className={styles.summaryMetric}>
                                    <span>รีวิวทั้งหมด</span>
                                    <strong>{totalFeedback}</strong>
                                    <small>รายการ</small>
                                </div>
                                <div className={styles.summaryMetric}>
                                    <span>ผลตอบรับ</span>
                                    <strong>{totalLikeDislike}</strong>
                                    <small>ครั้ง</small>
                                </div>
                            </div>
                        </div>

                        <div className={styles.monthlyScoreGrid}>
                            {dailyScores.length === 0 ? (
                                <div className={styles.noDataBox}>
                                    ไม่มีคะแนนความพึงพอใจจากฐานข้อมูล
                                </div>
                            ) : (
                                dailyScores.map((item, index) => {
                                    const score = safeNumber(item.avg_score, 0);
                                    const percent = Math.round((score / 5) * 100);
                                    const comments = (item.comments || [])
                                        .filter((comment) => String(comment.comment || '').trim())
                                        .slice(0, 3);

                                    return (
                                        <div key={`${item.day || item.period}-${index}`} className={styles.monthlyScoreItem}>
                                            <p>{dayjs(item.day || item.period).isValid() ? dayjs(item.day || item.period).format('D MMM') : item.day} {scoreViewYear + 543}</p>

                                            <div className={styles.starRow}>
                                                {[1, 2, 3, 4, 5].map((star) => (
                                                    <Star
                                                        key={star}
                                                        size={25}
                                                        className={
                                                            star <= Math.round(score)
                                                                ? styles.starActive
                                                                : styles.starInactive
                                                        }
                                                        fill="currentColor"
                                                    />
                                                ))}

                                                <strong>{score.toFixed(1)}</strong>
                                                <span>/5.0</span>
                                            </div>

                                            <div className={styles.scoreTrack}>
                                                <div
                                                    className={styles.scoreFill}
                                                    style={{
                                                        width: `${percent}%`,
                                                    }}
                                                />
                                            </div>

                                            <small>{percent}% จากคะแนนเต็ม</small>

                                            <div className={styles.feedbackComments}>
                                                {comments.length > 0 ? (
                                                    comments.map((comment, commentIndex) => (
                                                        <div key={`${comment.comment}-${commentIndex}`} className={styles.feedbackComment}>
                                                            <strong>{comment.name || 'ผู้ใช้บริการ'}</strong>
                                                            <span>{comment.comment}</span>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <div className={styles.feedbackCommentEmpty}>ยังไม่มีความคิดเห็นในวันนี้</div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {selectedFeedback && (
                        <div
                            className={styles.blurOverlay}
                            onClick={() => setSelectedFeedback(null)}
                        >
                            <div
                                className={styles.popupCard}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <button
                                    type="button"
                                    className={styles.closeButton}
                                    onClick={() => setSelectedFeedback(null)}
                                >
                                    ×
                                </button>

                                <h3 className={styles.popupTitle}>รายละเอียดความคิดเห็น</h3>
                                <p>ชื่อ: {selectedFeedback.name || '-'}</p>
                                <p>คะแนน: {selectedFeedback.avg_score || '-'}</p>
                                <p>ความคิดเห็น: {selectedFeedback.comment || '-'}</p>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
