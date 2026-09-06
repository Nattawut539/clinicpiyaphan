"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Sidebar from "@/components/admin-shell/AdminSidebar";
import AdminHeaderActions from "@/components/admin-shell/AdminHeaderActions";
import styles from "./Medicalrecords.module.css";
import Cookies from "js-cookie";
import dayjs from "dayjs";
import "dayjs/locale/th";
import { API_BASE } from "@/lib/api";
import { resolveBackendImage } from "@/lib/images";
import ThaiDatePicker from "@/components/date/ThaiDatePicker";
dayjs.locale("th");

import {
    FileText,
    CheckCircle,
    Circle,
    ArrowLeft,
    Save,
    XCircle,
    Calendar,
    Pill,
    Clipboard,
    Stethoscope,
    ActivitySquare,
    StickyNote,
    Utensils,
    User,
    Phone,
    IdCard,
    CalendarDays,
    Archive,
    Droplets,
    HeartPulse,
    Brush,
    Eraser,
    Image as ImageIcon,
    Trash2,
    Printer,
} from "lucide-react";

const API = API_BASE.endsWith("/api") ? API_BASE : `${API_BASE}/api`;

type JwtPayload = Record<string, unknown>;

type MedicalRecordPayload = {
    appointment_id?: string | number;
    queue_id?: string | number;
    user_id?: string | number;
    patient_code?: string;
    national_id?: string;
    visit_date?: string;
    symptoms: string;
    diagnosis: string;
    treatment: string;
    medications: string;
    notes: string;
    follow_up_date: string | null;
    body_drawing_data?: string | null;
};

type SaveMedicalRecordResult = {
    ok?: boolean;
    id?: string | number;
    medical_record_id?: string | number;
};

type MedicalHistoryRecord = {
    record_id?: string | number;
    visit_date?: string;
    symptoms?: string | null;
    diagnosis?: string | null;
    treatment?: string | null;
    medications?: string[] | string | null;
    notes?: string | null;
    follow_up_date?: string | null;
    body_drawing_data?: string | null;
    created_at?: string;
};

function decodeJwtPayload(token: string): JwtPayload | null {
    try {
        const parts = token.split(".");
        if (parts.length !== 3) return null;

        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);

        const json = decodeURIComponent(
            atob(padded)
                .split("")
                .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
                .join("")
        );

        return JSON.parse(json) as JwtPayload;
    } catch {
        return null;
    }
}

const ALLOWED_ROLES = new Set(["doctor", "superadmin", "super_admin"]);

type VisitRow = {
    appointment_id: string | number;
    user_id?: string | number;
    queue_id?: string | number;

    patient_code?: string;
    national_id?: string;
    full_name?: string;

    visit_date: string;
    time_label?: string;
    queue_no?: string;
    numeric_no?: number | string;
    avaliable_date?: "morning" | "afternoon" | string;
    hour_of_day?: number | string;
    status?: string;

    birth_date?: string;
    phone?: string;
    emergency_phone?: string;
    gender?: string;
    blood_type?: string;
    profile_image?: string | null;
    weight?: string | number;
    height?: string | number;
    bmi?: string | number | null;
    chief_complaint?: string | null;
    temperature?: string | number | null;
    heart_rate?: string | number | null;
    respiratory_rate?: string | number | null;
    systolic_bp?: string | number | null;
    diastolic_bp?: string | number | null;
    congenital_disease?: string;
    drug_allergy?: string;
    food_allergy?: string;

    medical_record_id?: string | number;
    record_id?: string | number;
    diagnosis_id?: string | number;
    has_medical_record?: boolean;
};

type MedicalRecordForm = {
    symptoms: string;
    bw: string;
    ht: string;
    tp: string;
    hr: string;
    rr: string;
    bp: string;
    diagnosis: string;
    treatment: string;
    medications: string;
    notes: string;
    follow_up_date: string;
    body_drawing_data: string;
};

function getAuthToken() {
    return Cookies.get("adminToken") || Cookies.get("staffToken") || Cookies.get("token") || "";
}

function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

function formatBpValue(systolic?: string | number | null, diastolic?: string | number | null) {
    if (!systolic || !diastolic) return "";
    return `${systolic}/${diastolic}`;
}

function parseBpValue(value: string) {
    const text = value.trim();
    if (!text) return { systolic_bp: null, diastolic_bp: null };

    const match = text.match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
    if (!match) return null;

    return {
        systolic_bp: Number(match[1]),
        diastolic_bp: Number(match[2]),
    };
}

function getRoleFromJwt(jwt: string) {
    const payload = decodeJwtPayload(jwt);
    return String(
        payload?.role ||
        payload?.user_role ||
        payload?.userRole ||
        payload?.app_role ||
        ""
    ).toLowerCase();
}

function toDateKey(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
}

function getWeekRangeMonday(today = new Date()) {
    const d = new Date(today);
    d.setHours(0, 0, 0, 0);

    const day = d.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;

    const start = new Date(d);
    start.setDate(d.getDate() + diffToMonday);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    return { start, end };
}

function formatThaiDate(dateKey?: string) {
    if (!dateKey) return "-";
    const d = dayjs(dateKey);
    if (!d.isValid()) return "-";
    return `${d.format("D MMMM")} ${d.year() + 543}`;
}

function formatThaiDateWithWeekday(dateKey?: string) {
    if (!dateKey) return "-";
    const d = dayjs(dateKey).locale("th");
    if (!d.isValid()) return "-";
    return `วัน${d.format("dddd")}ที่ ${d.format("D MMMM")} ${d.year() + 543}`;
}

function escapeHtml(value: unknown) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatMultiline(value?: string | null) {
    const text = String(value || "").trim();
    return text ? escapeHtml(text).replace(/\n/g, "<br />") : "-";
}

function formatMedicationText(value?: string[] | string | null) {
    if (Array.isArray(value)) return value.filter(Boolean).join(", ") || "-";
    if (!value) return "-";

    const text = String(value).trim();
    if (!text) return "-";

    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed.filter(Boolean).join(", ") || "-";
    } catch {
        // Keep plain text medications as entered.
    }

    return text;
}

function calcAge(birthDate?: string) {
    if (!birthDate) return "-";
    const birth = dayjs(birthDate);
    if (!birth.isValid()) return "-";

    const today = dayjs();
    let age = today.year() - birth.year();

    if (
        today.month() < birth.month() ||
        (today.month() === birth.month() && today.date() < birth.date())
    ) {
        age -= 1;
    }

    return `${age}`;
}

function getSessionText(timeLabel?: string) {
    const t = String(timeLabel || "");
    const isAfternoon =
        t.includes("16") || t.includes("17") || t.includes("18") || t.includes("19");

    return {
        isAfternoon,
        text: isAfternoon ? "🌅 บ่าย" : "☀️ เช้า",
    };
}

function getQueueOrder(row: VisitRow) {
    const queueCode = String(row.queue_no || "").toUpperCase();
    if (queueCode.startsWith("B")) {
        const timeMatch = String(row.time_label || "").match(/^(\d{1,2}):(\d{2})/);
        if (timeMatch) return Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
    }

    if (row.numeric_no !== undefined && row.numeric_no !== null) {
        const numeric = Number(row.numeric_no);
        if (Number.isFinite(numeric)) return numeric;
    }

    const match = String(row.queue_no || "").match(/\d+/);
    if (match) return Number(match[0]);

    return Number.MAX_SAFE_INTEGER;
}

function getSessionOrder(row: VisitRow) {
    if (row.avaliable_date === "morning") return 1;
    if (row.avaliable_date === "afternoon") return 2;

    const hour = Number(row.hour_of_day ?? String(row.time_label || "").slice(0, 2));
    if (Number.isFinite(hour)) return hour < 12 ? 1 : 2;

    return 3;
}

async function fetchJsonWithFallback(urls: string[], token: string) {
    for (const url of urls) {
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
        });

        if (res.ok) return await res.json();

        // ถ้า endpoint ไม่มี ให้ลองตัวถัดไป
        if (res.status === 404) continue;

        throw new Error("request_failed");
    }

    return null;
}

async function saveMedicalRecordWithFallback(
    token: string,
    payload: MedicalRecordPayload
): Promise<SaveMedicalRecordResult> {
    const urls = [
        `${API}/medical-records`,
        `${API}/medicalrecords`,
        `${API}/medical/records`,
    ];

    for (const url of urls) {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        });

        if (res.ok) {
            try {
                return (await res.json()) as SaveMedicalRecordResult;
            } catch {
                return { ok: true };
            }
        }

        if (res.status === 404) continue;

        let message = "บันทึกเวชระเบียนไม่สำเร็จ";
        try {
            const data = await res.json();
            message = data?.error || data?.message || message;
        } catch {
            // ignore
        }

        throw new Error(message);
    }

    throw new Error(
        "ยังไม่พบ API สำหรับบันทึกเวชระเบียน กรุณาตรวจสอบ route ฝั่ง backend"
    );
}

interface RecordFormPageProps {
    patient: VisitRow;
    existingRecord?: Partial<MedicalRecordForm> | null;
    saving: boolean;
    saved: boolean;
    canSave: boolean;
    saveBlockedReason?: string;
    onBack: () => void;
    onSave: (data: MedicalRecordForm) => Promise<void>;
    onPrint: (patient: VisitRow, currentForm: MedicalRecordForm) => Promise<void>;
}

function RecordFormPage({
    patient,
    existingRecord,
    saving,
    saved,
    canSave,
    saveBlockedReason,
    onBack,
    onSave,
    onPrint,
}: RecordFormPageProps) {
    const [form, setForm] = useState<MedicalRecordForm>({
        symptoms: existingRecord?.symptoms || patient.chief_complaint || "",
        bw: existingRecord?.bw || String(patient.weight || ""),
        ht: existingRecord?.ht || String(patient.height || ""),
        tp: existingRecord?.tp || String(patient.temperature || ""),
        hr: existingRecord?.hr || String(patient.heart_rate || ""),
        rr: existingRecord?.rr || String(patient.respiratory_rate || ""),
        bp: existingRecord?.bp || formatBpValue(patient.systolic_bp, patient.diastolic_bp),
        diagnosis: existingRecord?.diagnosis || "",
        treatment: existingRecord?.treatment || "",
        medications: existingRecord?.medications || "",
        notes: existingRecord?.notes || "",
        follow_up_date: existingRecord?.follow_up_date || "",
        body_drawing_data: existingRecord?.body_drawing_data || "",
    });
    const [showSaveConfirm, setShowSaveConfirm] = useState(false);
    const [showDrawingModal, setShowDrawingModal] = useState(false);
    const [drawingTool, setDrawingTool] = useState<"pen" | "eraser">("pen");
    const [drawingColor, setDrawingColor] = useState<"black" | "red">("black");
    const [draftDrawingData, setDraftDrawingData] = useState("");
    const [drawingConfirm, setDrawingConfirm] = useState<null | {
        type: "save" | "cancel" | "delete";
        imageData?: string;
    }>(null);
    const [profileImageFailed, setProfileImageFailed] = useState(false);
    const profileImage = resolveBackendImage(patient.profile_image);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const drawingRef = useRef(false);

    useEffect(() => {
        setProfileImageFailed(false);
    }, [profileImage]);

    useEffect(() => {
        setForm({
            symptoms: existingRecord?.symptoms || patient.chief_complaint || "",
            bw: existingRecord?.bw || String(patient.weight || ""),
            ht: existingRecord?.ht || String(patient.height || ""),
            tp: existingRecord?.tp || String(patient.temperature || ""),
            hr: existingRecord?.hr || String(patient.heart_rate || ""),
            rr: existingRecord?.rr || String(patient.respiratory_rate || ""),
            bp: existingRecord?.bp || formatBpValue(patient.systolic_bp, patient.diastolic_bp),
            diagnosis: existingRecord?.diagnosis || "",
            treatment: existingRecord?.treatment || "",
            medications: existingRecord?.medications || "",
            notes: existingRecord?.notes || "",
            follow_up_date: existingRecord?.follow_up_date || "",
            body_drawing_data: existingRecord?.body_drawing_data || "",
        });
    }, [existingRecord, patient]);

    const setValue = (key: keyof MedicalRecordForm, value: string) => {
        setForm((prev) => ({ ...prev, [key]: value }));
    };

    const formFields = [
        {
            key: "symptoms" as const,
            label: "CC อาการสำคัญ",
            icon: ActivitySquare,
            placeholder: "บันทึก CC หรืออาการสำคัญที่ผู้ป่วยมาพบแพทย์...",
            rows: 3,
        },
        {
            key: "diagnosis" as const,
            label: "การวินิจฉัยโรค",
            icon: Stethoscope,
            placeholder: "ระบุการวินิจฉัย เช่น โรคหวัด, ไข้หวัดใหญ่...",
            rows: 2,
        },
        {
            key: "treatment" as const,
            label: "แผนการรักษา",
            icon: Clipboard,
            placeholder: "บันทึกแผนการรักษาและคำแนะนำ...",
            rows: 3,
        },
        {
            key: "medications" as const,
            label: "ยาที่จ่าย",
            icon: Pill,
            placeholder: "รายการยา ขนาด และวิธีรับประทาน...",
            rows: 3,
        },
        {
            key: "notes" as const,
            label: "บันทึกเพิ่มเติม",
            icon: StickyNote,
            placeholder: "หมายเหตุหรือข้อสังเกตอื่น ๆ...",
            rows: 2,
        },
    ];

    const vitalFields = [
        { key: "bw" as const, label: "BW น้ำหนัก", placeholder: "เช่น 65" },
        { key: "ht" as const, label: "HT ส่วนสูง", placeholder: "เช่น 170" },
        { key: "tp" as const, label: "TP อุณหภูมิ", placeholder: "เช่น 36.8" },
        { key: "hr" as const, label: "HR ชีพจร", placeholder: "เช่น 80" },
        { key: "rr" as const, label: "RR หายใจ", placeholder: "เช่น 18" },
        { key: "bp" as const, label: "BP ความดัน", placeholder: "เช่น 120/80" },
    ];

    const clearDrawingCanvas = (canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !showDrawingModal) return;

        const image = new Image();
        image.onload = () => {
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        };

        if (draftDrawingData) {
            image.src = draftDrawingData;
        } else {
            clearDrawingCanvas(canvas);
        }
    }, [draftDrawingData, showDrawingModal]);

    const openDrawingModal = () => {
        setDraftDrawingData(form.body_drawing_data || "");
        setDrawingTool("pen");
        setDrawingColor("black");
        setDrawingConfirm(null);
        setShowDrawingModal(true);
    };

    const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = event.currentTarget;
        const rect = canvas.getBoundingClientRect();
        return {
            x: ((event.clientX - rect.left) / rect.width) * canvas.width,
            y: ((event.clientY - rect.top) / rect.height) * canvas.height,
        };
    };

    const startDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = event.currentTarget;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const point = pointerPosition(event);

        drawingRef.current = true;
        canvas.setPointerCapture(event.pointerId);
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = drawingTool === "pen" ? (drawingColor === "red" ? "#dc2626" : "#111827") : "#ffffff";
        ctx.lineWidth = drawingTool === "pen" ? 4 : 18;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
    };

    const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!drawingRef.current) return;
        const ctx = event.currentTarget.getContext("2d");
        if (!ctx) return;
        const point = pointerPosition(event);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
    };

    const stopDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!drawingRef.current) return;
        drawingRef.current = false;
        const canvas = event.currentTarget;
        canvas.releasePointerCapture(event.pointerId);
        setDraftDrawingData(canvas.toDataURL("image/png"));
    };

    const clearDrawing = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        clearDrawingCanvas(canvas);
        setDraftDrawingData("");
    };

    const saveDrawing = () => {
        const canvas = canvasRef.current;
        const nextData = canvas ? canvas.toDataURL("image/png") : draftDrawingData;
        setDrawingConfirm({ type: "save", imageData: nextData });
    };

    const cancelDrawing = () => {
        if (drawingConfirm) return;
        if (draftDrawingData !== (form.body_drawing_data || "")) {
            setDrawingConfirm({ type: "cancel" });
            return;
        }
        setDraftDrawingData(form.body_drawing_data || "");
        setShowDrawingModal(false);
    };

    const deleteDrawing = () => {
        setDrawingConfirm({ type: "delete" });
    };

    const closeDrawingConfirm = () => {
        setDrawingConfirm(null);
    };

    const confirmDrawingAction = () => {
        if (!drawingConfirm) return;

        if (drawingConfirm.type === "save") {
            const nextData = drawingConfirm.imageData || draftDrawingData;
            setValue("body_drawing_data", nextData);
            setDraftDrawingData(nextData);
        } else if (drawingConfirm.type === "delete") {
            setValue("body_drawing_data", "");
            setDraftDrawingData("");
        } else {
            setDraftDrawingData(form.body_drawing_data || "");
        }

        setDrawingConfirm(null);
        setShowDrawingModal(false);
    };

    return (
        <div className={styles.recordPage}>
            <div className={styles.recordSubHeader}>
                <div className={styles.recordSubHeaderLeft}>
                    <button type="button" onClick={onBack} className={styles.backBtn}>
                        <ArrowLeft size={18} />
                        กลับรายชื่อ
                    </button>

                    <div className={styles.recordDivider} />

                    <div className={styles.recordHeaderTitle}>
                        <FileText size={19} />
                        <span>บันทึกเวชระเบียน</span>
                    </div>
                </div>

                <div className={styles.recordSubHeaderRight}>
                    <button
                        type="button"
                        className={styles.printRecordBtn}
                        onClick={() => onPrint(patient, form)}
                    >
                        <Printer size={18} />
                        พิมพ์ / PDF
                    </button>

                    {saved && (
                        <div className={styles.saveSuccessBadge}>
                            <CheckCircle size={16} />
                            บันทึกสำเร็จ!
                        </div>
                    )}
                </div>
            </div>

            <div className={styles.recordContent}>
                <div className={styles.patientInfoCard}>
                    <div className={styles.patientInfoHeader}>
                        <p>ข้อมูลผู้ป่วย (อ่านอย่างเดียว)</p>
                    </div>

                    <div className={styles.patientInfoBody}>
                        <div className={styles.profileRow}>
                            <div className={styles.profileAvatar}>
                                {profileImage && !profileImageFailed ? (
                                    <img src={profileImage} alt="" onError={() => setProfileImageFailed(true)} />
                                ) : (
                                    String(patient.full_name || "ผู้").charAt(0)
                                )}
                            </div>

                            <div className={styles.profileText}>
                                <h2>{patient.full_name || "-"}</h2>

                                <div className={styles.profileMeta}>
                                    <span>{patient.patient_code || "-"}</span>
                                    <small>•</small>
                                    <p>อายุ {calcAge(patient.birth_date)} ปี</p>
                                    <small>•</small>
                                    <p>เกิด {formatThaiDate(patient.birth_date)}</p>
                                </div>

                                <p className={styles.idText}>
                                    <IdCard size={15} />
                                    {patient.national_id || "-"}
                                </p>
                            </div>

                            <div className={styles.visitDateBox}>
                                <small>วันที่บันทึก</small>
                                <p>{formatThaiDate(toDateKey(new Date()))}</p>
                            </div>
                        </div>

                        <div className={styles.infoGrid}>
                            {[
                                {
                                    icon: User,
                                    label: "เพศ",
                                    value: patient.gender || "-",
                                    tone: "blue",
                                },
                                {
                                    icon: Droplets,
                                    label: "กรุ๊ปเลือด",
                                    value: patient.blood_type || "-",
                                    tone: "green",
                                },
                                {
                                    icon: HeartPulse,
                                    label: "BMI",
                                    value: patient.bmi ? String(patient.bmi) : "-",
                                    tone: "cyan",
                                },
                                {
                                    icon: Phone,
                                    label: "เบอร์โทร",
                                    value: patient.phone || "-",
                                    tone: "teal",
                                },
                                {
                                    icon: Pill,
                                    label: "แพ้ยา",
                                    value: patient.drug_allergy || "ไม่มี",
                                    tone: "danger",
                                },
                                {
                                    icon: Utensils,
                                    label: "แพ้อาหาร",
                                    value: patient.food_allergy || "ไม่มี",
                                    tone: "warning",
                                },
                                {
                                    icon: ActivitySquare,
                                    label: "โรคประจำตัว",
                                    value: patient.congenital_disease || "ไม่มี",
                                    tone: "condition",
                                },
                                {
                                    icon: Phone,
                                    label: "เบอร์ฉุกเฉิน",
                                    value: patient.emergency_phone || "-",
                                    tone: "rose",
                                },
                            ].map(({ icon: Icon, label, value, tone }) => (
                                <div
                                    key={label}
                                    className={`${styles.infoMiniCard} ${tone === "danger"
                                            ? styles.infoDanger
                                            : tone === "warning"
                                                ? styles.infoWarning
                                                : tone === "condition"
                                                    ? styles.infoCondition
                                                    : tone === "blue"
                                                        ? styles.infoBlue
                                                        : tone === "green"
                                                            ? styles.infoGreen
                                                            : tone === "cyan"
                                                                ? styles.infoCyan
                                                                : tone === "teal"
                                                                    ? styles.infoTeal
                                                                    : tone === "rose"
                                                                        ? styles.infoRose
                                                    : ""
                                        }`}
                                >
                                    <div>
                                        <Icon size={15} />
                                        <span>{label}</span>
                                    </div>
                                    <p>{value}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className={styles.doctorFormCard}>
                    <div className={styles.doctorFormHeader}>
                        <p>บันทึกแพทย์ — กรอกข้อมูลการตรวจวันนี้</p>
                    </div>

                    <div className={styles.doctorFormBody}>
                        <div className={styles.vitalInputGrid}>
                            {vitalFields.map(({ key, label, placeholder }) => (
                                <div
                                    key={key}
                                    className={styles.formGroup}
                                >
                                    <label>{label}</label>
                                    <input
                                        type="text"
                                        value={form[key]}
                                        onChange={(e) => setValue(key, e.target.value)}
                                        placeholder={placeholder}
                                    />
                                </div>
                            ))}
                            {[
                                { label: "แพ้ยา", value: patient.drug_allergy },
                                { label: "แพ้อาหาร", value: patient.food_allergy },
                                { label: "โรคประจำตัว", value: patient.congenital_disease },
                            ].map(({ label, value }) => (
                                <div key={label} className={styles.formGroup}>
                                    <label>{label}</label>
                                    <input
                                        className={styles.patientMedicalReadonly}
                                        type="text"
                                        value={String(value || "ไม่มี")}
                                        readOnly
                                        aria-label={`${label}ของผู้ป่วย`}
                                    />
                                </div>
                            ))}
                        </div>

                        <div className={styles.drawingSummary}>
                            <button type="button" className={styles.drawingOpenButton} onClick={openDrawingModal}>
                                <span>
                                    <ImageIcon size={20} />
                                </span>
                                <div>
                                    <strong>วาดตำแหน่งอาการบนร่างกาย</strong>
                                    <small>{form.body_drawing_data ? "มีภาพวาดแล้ว คลิกเพื่อแก้ไข" : "คลิกเพื่อเปิดหน้าวาดรูป"}</small>
                                </div>
                            </button>

                            {form.body_drawing_data ? (
                                <div className={styles.drawingPreviewBox}>
                                    <img src={form.body_drawing_data} alt="ภาพวาดตำแหน่งอาการ" />
                                    <div className={styles.drawingPreviewActions}>
                                        <button type="button" className={styles.drawingPreviewEditBtn} onClick={openDrawingModal}>
                                            แก้ไขภาพวาด
                                        </button>
                                        <button type="button" className={styles.drawingPreviewDeleteBtn} onClick={deleteDrawing}>
                                            <Trash2 size={17} />
                                            ลบภาพ
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className={styles.drawingEmptyPreview}>ยังไม่มีภาพวาดตำแหน่งอาการ</div>
                            )}
                        </div>

                        {showDrawingModal && (
                            <div className={styles.drawingModalOverlay} onClick={cancelDrawing}>
                                <div className={styles.drawingModal} onClick={(event) => event.stopPropagation()}>
                                    <div className={styles.drawingModalHeader}>
                                        <div>
                                            <strong>วาดตำแหน่งอาการบนร่างกาย</strong>
                                            <span>ข้อมูลนี้เก็บเฉพาะฝั่งบุคลากร ผู้ป่วยจะไม่เห็น</span>
                                        </div>
                                        <button type="button" className={styles.drawingModalClose} onClick={cancelDrawing}>
                                            ปิด
                                        </button>
                                    </div>

                                    <div className={styles.drawingToolbar}>
                                        <button
                                            type="button"
                                            className={drawingTool === "pen" ? styles.drawingToolActive : ""}
                                            onClick={() => setDrawingTool("pen")}
                                        >
                                            <Brush size={18} />
                                            ปากกา
                                        </button>
                                        <button
                                            type="button"
                                            className={`${styles.drawingColorButton} ${styles.drawingColorBlack} ${drawingTool === "pen" && drawingColor === "black" ? styles.drawingColorActive : ""}`}
                                            onClick={() => {
                                                setDrawingTool("pen");
                                                setDrawingColor("black");
                                            }}
                                            aria-label="เลือกปากกาสีดำ"
                                            title="ปากกาสีดำ"
                                        />
                                        <button
                                            type="button"
                                            className={`${styles.drawingColorButton} ${styles.drawingColorRed} ${drawingTool === "pen" && drawingColor === "red" ? styles.drawingColorActive : ""}`}
                                            onClick={() => {
                                                setDrawingTool("pen");
                                                setDrawingColor("red");
                                            }}
                                            aria-label="เลือกปากกาสีแดง"
                                            title="ปากกาสีแดง"
                                        />
                                        <button
                                            type="button"
                                            className={drawingTool === "eraser" ? styles.drawingToolActive : ""}
                                            onClick={() => setDrawingTool("eraser")}
                                        >
                                            <Eraser size={18} />
                                            ยางลบ
                                        </button>
                                        <button type="button" onClick={clearDrawing}>
                                            ล้างภาพ
                                        </button>
                                    </div>

                                    <canvas
                                        ref={canvasRef}
                                        className={styles.bodyCanvas}
                                        width={600}
                                        height={390}
                                        onPointerDown={startDrawing}
                                        onPointerMove={draw}
                                        onPointerUp={stopDrawing}
                                        onPointerLeave={stopDrawing}
                                    />

                                    <div className={styles.drawingModalActions}>
                                        <button type="button" className={styles.drawingCancelButton} onClick={cancelDrawing}>
                                            ยกเลิก
                                        </button>
                                        <button type="button" className={styles.drawingSaveButton} onClick={saveDrawing}>
                                            บันทึกภาพ
                                        </button>
                                    </div>
                                </div>

                                {drawingConfirm && (
                                    <div className={styles.drawingConfirmOverlay} onClick={closeDrawingConfirm}>
                                        <div className={styles.drawingConfirmDialog} onClick={(event) => event.stopPropagation()}>
                                            <div className={drawingConfirm.type === "save" ? styles.drawingConfirmIconSave : styles.drawingConfirmIconCancel}>
                                                {drawingConfirm.type === "save" ? <Save size={25} /> : drawingConfirm.type === "delete" ? <Trash2 size={25} /> : <XCircle size={25} />}
                                            </div>
                                            <h3>
                                                {drawingConfirm.type === "save"
                                                    ? "บันทึกภาพวาดนี้หรือไม่?"
                                                    : drawingConfirm.type === "delete"
                                                        ? "ลบภาพวาดนี้หรือไม่?"
                                                        : "ยกเลิกการแก้ไขภาพวาดหรือไม่?"}
                                            </h3>
                                            <p>
                                                {drawingConfirm.type === "save"
                                                    ? "ระบบจะเก็บภาพตำแหน่งอาการนี้ไว้ในเวชระเบียนฝั่งบุคลากร"
                                                    : drawingConfirm.type === "delete"
                                                        ? "ภาพวาดที่แสดงอยู่จะถูกลบออกจากแบบฟอร์มนี้"
                                                        : "การแก้ไขล่าสุดจะไม่ถูกบันทึก และรูปจะกลับไปเป็นภาพก่อนหน้า"}
                                            </p>
                                            <div className={styles.drawingConfirmActions}>
                                                <button type="button" className={styles.drawingConfirmGhostBtn} onClick={closeDrawingConfirm}>
                                                    {drawingConfirm.type === "delete" ? "เก็บไว้ก่อน" : "กลับไปแก้ไข"}
                                                </button>
                                                <button
                                                    type="button"
                                                    className={drawingConfirm.type === "save" ? styles.drawingConfirmSaveBtn : styles.drawingConfirmDangerBtn}
                                                    onClick={confirmDrawingAction}
                                                >
                                                    {drawingConfirm.type === "save" ? "ยืนยันบันทึก" : drawingConfirm.type === "delete" ? "ยืนยันลบ" : "ยืนยันยกเลิก"}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {!showDrawingModal && drawingConfirm && (
                            <div className={styles.drawingConfirmOverlay} onClick={closeDrawingConfirm}>
                                <div className={styles.drawingConfirmDialog} onClick={(event) => event.stopPropagation()}>
                                    <div className={styles.drawingConfirmIconCancel}>
                                        <Trash2 size={25} />
                                    </div>
                                    <h3>ลบภาพวาดนี้หรือไม่?</h3>
                                    <p>ภาพวาดที่แสดงอยู่จะถูกลบออกจากแบบฟอร์มนี้</p>
                                    <div className={styles.drawingConfirmActions}>
                                        <button type="button" className={styles.drawingConfirmGhostBtn} onClick={closeDrawingConfirm}>
                                            เก็บไว้ก่อน
                                        </button>
                                        <button type="button" className={styles.drawingConfirmDangerBtn} onClick={confirmDrawingAction}>
                                            ยืนยันลบ
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {formFields.map(({ key, label, icon: Icon, placeholder, rows }) => (
                            <div key={key} className={styles.formGroup}>
                                <label>
                                    <span>
                                        <Icon size={15} />
                                    </span>
                                    {label}
                                </label>

                                <textarea
                                    value={form[key]}
                                    onChange={(e) => setValue(key, e.target.value)}
                                    placeholder={placeholder}
                                    rows={rows}
                                />
                            </div>
                        ))}

                        <div className={styles.formGroup}>
                            <label>
                                <span>
                                    <Calendar size={15} />
                                </span>
                                วันที่นัดติดตามผล
                            </label>

                            <ThaiDatePicker
                                value={form.follow_up_date}
                                min={toDateKey(new Date())}
                                startYear={new Date().getFullYear()}
                                endYear={new Date().getFullYear() + 5}
                                onChange={(value) => setValue("follow_up_date", value)}
                            />
                        </div>
                    </div>
                </div>

                <div className={styles.bottomActionBar}>
                    {!canSave && <p className={styles.saveDateNotice}>{saveBlockedReason}</p>}
                    <button type="button" onClick={onBack} className={styles.cancelBottomBtn}>
                        <XCircle size={18} />
                        ยกเลิก
                    </button>

                    <button
                        type="button"
                        onClick={() => setShowSaveConfirm(true)}
                        disabled={saving || !canSave}
                        className={styles.saveBottomBtn}
                    >
                        <Save size={18} />
                        {saving ? "กำลังบันทึก..." : "บันทึกข้อมูลทั้งหมด"}
                    </button>
                </div>
            </div>

            {showSaveConfirm && (
                <div className={styles.confirmOverlay} onClick={() => setShowSaveConfirm(false)}>
                    <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.confirmIcon}>
                            <Save size={26} />
                        </div>
                        <h3>ยืนยันการบันทึกเวชระเบียน</h3>
                        <p>ต้องการบันทึกข้อมูลเวชระเบียนนี้หรือไม่?</p>
                        <div className={styles.confirmActions}>
                            <button
                                type="button"
                                className={styles.confirmCancelBtn}
                                onClick={() => setShowSaveConfirm(false)}
                            >
                                ยกเลิก
                            </button>
                            <button
                                type="button"
                                className={styles.confirmSaveBtn}
                                disabled={saving}
                                onClick={async () => {
                                    setShowSaveConfirm(false);
                                    await onSave(form);
                                }}
                            >
                                {saving ? "กำลังบันทึก..." : "ยืนยันบันทึก"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function MedicalRecordsListPage() {
    const [loading, setLoading] = useState<boolean>(true);
    const [rows, setRows] = useState<VisitRow[]>([]);
    const [errorMsg, setErrorMsg] = useState<string>("");
    const [searchText, setSearchText] = useState<string>("");

    const [selectedPatient, setSelectedPatient] = useState<VisitRow | null>(null);
    const [existingRecord, setExistingRecord] =
        useState<Partial<MedicalRecordForm> | null>(null);
    const [recordLoading, setRecordLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const todayKey = useMemo(() => toDateKey(new Date()), []);
    const todayText = dayjs().locale("th").format("D MMMM");
    const buddhistYear = dayjs().year() + 543;

    useEffect(() => {
        const run = async () => {
            try {
                setLoading(true);
                setErrorMsg("");

                const token = getAuthToken();

                if (!token) {
                    setErrorMsg("กรุณาเข้าสู่ระบบก่อน");
                    setLoading(false);
                    return;
                }

                const role = getRoleFromJwt(token);

                if (!role) {
                    setErrorMsg("ไม่สามารถตรวจสอบสิทธิ์ผู้ใช้งานได้");
                    setLoading(false);
                    return;
                }

                if (!ALLOWED_ROLES.has(role)) {
                    setErrorMsg("หน้านี้เข้าดูได้เฉพาะแพทย์ และผู้ดูแลระบบสูงสุดเท่านั้น");
                    setLoading(false);
                    return;
                }

                const currentWeek = getWeekRangeMonday(new Date());
                const listParams = new URLSearchParams({
                    start_date: toDateKey(currentWeek.start),
                    end_date: toDateKey(currentWeek.end),
                });
                const listRes = await fetch(`${API}/medical-records?${listParams}`, {
                    headers: { Authorization: `Bearer ${token}` },
                    cache: "no-store",
                });

                if (!listRes.ok) {
                    setErrorMsg("ดึงรายการผู้เข้ารับบริการไม่สำเร็จ");
                    setLoading(false);
                    return;
                }

                const listData = await listRes.json();
                const filtered: VisitRow[] = (Array.isArray(listData) ? listData : []).map((row: VisitRow) => ({
                    ...row,
                    visit_date: dayjs(row.visit_date).format("YYYY-MM-DD"),
                }));

                setRows(filtered);
                setLoading(false);
            } catch {
                setErrorMsg("เกิดข้อผิดพลาดในการโหลดข้อมูล");
                setLoading(false);
            }
        };

        run();
    }, []);

    const groupedByDay = useMemo(() => {
        const map = new Map<string, VisitRow[]>();

        for (const r of rows) {
            const key = r.visit_date;
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(r);
        }

        // Operational order: today first, upcoming dates next, then recent past dates.
        const entries = Array.from(map.entries()).sort(([a], [b]) => {
            if (a === todayKey) return -1;
            if (b === todayKey) return 1;

            const aIsUpcoming = a > todayKey;
            const bIsUpcoming = b > todayKey;

            if (aIsUpcoming !== bIsUpcoming) return aIsUpcoming ? -1 : 1;
            return aIsUpcoming ? a.localeCompare(b) : b.localeCompare(a);
        });

        for (const [, arr] of entries) {
            arr.sort((x, y) => {
                const sessionDiff = getSessionOrder(x) - getSessionOrder(y);
                if (sessionDiff !== 0) return sessionDiff;

                const queueDiff = getQueueOrder(x) - getQueueOrder(y);
                if (queueDiff !== 0) return queueDiff;

                return String(x.time_label || "").localeCompare(String(y.time_label || ""));
            });
        }

        return entries;
    }, [rows, todayKey]);

    const filteredGrouped = useMemo(() => {
        const q = searchText.trim();
        if (!q) return groupedByDay;

        const qq = q.toLowerCase();

        return groupedByDay
            .map(([dayKey, arr]) => {
                const a = arr.filter((r) => {
                    const queueCode = String(r.queue_no || "").toLowerCase();
                    const patientCode = String(r.patient_code || "").toLowerCase();
                    const name = String(r.full_name || "").toLowerCase();

                    return (
                        name.includes(qq) ||
                        queueCode.includes(qq) ||
                        patientCode.includes(qq)
                    );
                });
                return [dayKey, a] as [string, VisitRow[]];
            })
            .filter(([, arr]) => arr.length > 0);
    }, [groupedByDay, searchText]);

    const isToday = (dayKey: string) => dayKey === todayKey;

    const openRecord = async (patient: VisitRow) => {
        if (dayjs(patient.visit_date).format("YYYY-MM-DD") !== todayKey) return;

        const token = getAuthToken();

        setSelectedPatient(patient);
        setExistingRecord(null);
        setSaved(false);
        setRecordLoading(true);

        try {
            const appointmentId = encodeURIComponent(String(patient.appointment_id));

            const data = await fetchJsonWithFallback(
                [
                    `${API}/medical-records?appointment_id=${appointmentId}`,
                    `${API}/medicalrecords?appointment_id=${appointmentId}`,
                    `${API}/medical/records?appointment_id=${appointmentId}`,
                ],
                token
            );

            const record = Array.isArray(data) ? data[0] : data?.record || data;

            if (record) {
                setExistingRecord({
                    symptoms: record.symptoms || "",
                    diagnosis: record.diagnosis || "",
                    treatment: record.treatment || "",
                    medications: record.medications || record.medicine || "",
                    notes: record.notes || "",
                    follow_up_date: record.follow_up_date || record.followUpDate || "",
                    body_drawing_data: record.body_drawing_data || "",
                });
            }
        } catch {
            // ถ้าไม่มีข้อมูลเดิม ยังสามารถกรอกใหม่ได้
            setExistingRecord(null);
        } finally {
            setRecordLoading(false);
        }
    };

    const handlePrintPatientHistory = async (patient: VisitRow, currentForm: MedicalRecordForm) => {
        const currentHasData = [
            currentForm.symptoms,
            currentForm.diagnosis,
            currentForm.treatment,
            currentForm.medications,
            currentForm.notes,
            currentForm.follow_up_date,
            currentForm.body_drawing_data,
        ].some((value) => String(value || "").trim());

        const currentSection = `
            <section class="record current">
                <h2>รายการรักษาครั้งปัจจุบัน</h2>
                <div class="grid">
                    <div><b>วันที่รับบริการ</b><span>${escapeHtml(formatThaiDate(patient.visit_date))}</span></div>
                    <div><b>วันนัดติดตาม</b><span>${escapeHtml(formatThaiDate(currentForm.follow_up_date))}</span></div>
                    <div><b>คิว</b><span>${escapeHtml(patient.queue_no || "-")}</span></div>
                    <div><b>BMI</b><span>${escapeHtml(patient.bmi || "-")}</span></div>
                </div>
                <dl>
                    <dt>อาการสำคัญ</dt><dd>${formatMultiline(currentForm.symptoms)}</dd>
                    <dt>การวินิจฉัย</dt><dd>${formatMultiline(currentForm.diagnosis)}</dd>
                    <dt>แผนการรักษา</dt><dd>${formatMultiline(currentForm.treatment)}</dd>
                    <dt>ยาที่จ่าย</dt><dd>${formatMultiline(formatMedicationText(currentForm.medications))}</dd>
                    <dt>บันทึกเพิ่มเติม</dt><dd>${formatMultiline(currentForm.notes)}</dd>
                </dl>
                ${currentForm.body_drawing_data ? `<img class="bodyDrawing" src="${escapeHtml(currentForm.body_drawing_data)}" alt="body drawing" />` : ""}
                ${currentHasData ? "" : `<p class="emptyInline">ยังไม่มีข้อมูลการรักษาที่กรอกในครั้งนี้</p>`}
            </section>
        `;

        const printWindow = window.open("", "_blank", "width=960,height=720");
        if (!printWindow) {
            setErrorMsg("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต pop-up สำหรับเว็บไซต์นี้");
            return;
        }

        printWindow.document.write(`
            <!doctype html>
            <html lang="th">
            <head>
                <meta charset="utf-8" />
                <title>รายการรักษาปัจจุบัน ${escapeHtml(patient.full_name || patient.patient_code || "")}</title>
                <style>
                    @page { size: A4; margin: 14mm; }
                    * { box-sizing: border-box; }
                    body { margin: 0; color: #111827; font-family: "Sarabun", "Tahoma", sans-serif; font-size: 13px; line-height: 1.55; }
                    header { border-bottom: 2px solid #0f766e; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; gap: 18px; }
                    h1 { margin: 0 0 6px; font-size: 22px; color: #0f172a; }
                    h2 { margin: 0 0 10px; font-size: 16px; color: #0f766e; }
                    .meta { color: #475569; }
                    .patient { min-width: 260px; border: 1px solid #dbeafe; border-radius: 8px; padding: 10px 12px; background: #f8fafc; }
                    .patient b { display: inline-block; min-width: 88px; color: #334155; }
                    .record { break-inside: avoid; border: 1px solid #0f766e; border-radius: 8px; padding: 12px; margin: 0 0 12px; background: #f0fdfa; }
                    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; }
                    .grid div { border: 1px solid #e2e8f0; border-radius: 6px; padding: 7px 9px; background: #fff; }
                    .grid b { display: block; color: #64748b; font-size: 11px; }
                    dl { margin: 0; display: grid; grid-template-columns: 130px 1fr; gap: 7px 10px; }
                    dt { color: #475569; font-weight: 700; }
                    dd { margin: 0; min-height: 22px; }
                    .bodyDrawing { display: block; max-width: 100%; max-height: 260px; margin-top: 12px; border: 1px solid #e2e8f0; border-radius: 8px; object-fit: contain; }
                    .emptyInline { margin: 12px 0 0; color: #64748b; }
                    footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; color: #64748b; display: flex; justify-content: space-between; }
                    @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
                </style>
            </head>
            <body>
                <header>
                    <div>
                        <h1>เอกสารรายการรักษาครั้งปัจจุบัน</h1>
                        <div class="meta">พิมพ์เมื่อ ${escapeHtml(formatThaiDate(toDateKey(new Date())))} เวลา ${escapeHtml(dayjs().format("HH:mm"))} น.</div>
                    </div>
                    <div class="patient">
                        <div><b>รหัสผู้ป่วย</b>${escapeHtml(patient.patient_code || "-")}</div>
                        <div><b>ชื่อ-นามสกุล</b>${escapeHtml(patient.full_name || "-")}</div>
                        <div><b>อายุ</b>${escapeHtml(calcAge(patient.birth_date))} ปี</div>
                        <div><b>วันเกิด</b>${escapeHtml(formatThaiDate(patient.birth_date))}</div>
                        <div><b>เบอร์โทร</b>${escapeHtml(patient.phone || "-")}</div>
                        <div><b>กรุ๊ปเลือด</b>${escapeHtml(patient.blood_type || "-")}</div>
                    </div>
                </header>
                ${currentSection}
                <footer>
                    <span>เอกสารนี้สร้างจากระบบเวชระเบียน</span>
                    <span>ลงชื่อผู้ตรวจ __________________________</span>
                </footer>
                <script>
                    window.addEventListener('load', () => {
                        window.focus();
                        window.print();
                    });
                </script>
            </body>
            </html>
        `);
        printWindow.document.close();
        return;

        const token = getAuthToken();
        if (!token || !patient.user_id) {
            setErrorMsg("ไม่พบข้อมูลผู้ป่วยสำหรับพิมพ์เอกสาร");
            return;
        }

        try {
            const res = await fetch(`${API}/medical/by-user/${patient.user_id}`, {
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
            });

            if (!res.ok) {
                throw new Error("โหลดประวัติการรักษาไม่สำเร็จ");
            }

            const data = await res.json();
            const history: MedicalHistoryRecord[] = Array.isArray(data) ? data : [];
            const currentHasData = [
                currentForm.symptoms,
                currentForm.diagnosis,
                currentForm.treatment,
                currentForm.medications,
                currentForm.notes,
                currentForm.follow_up_date,
                currentForm.body_drawing_data,
            ].some((value) => String(value || "").trim());

            const currentSection = currentHasData
                ? `
                    <section class="record current">
                        <h2>ข้อมูลบนหน้าจอปัจจุบัน</h2>
                        <div class="grid">
                            <div><b>วันที่รับบริการ</b><span>${escapeHtml(formatThaiDate(patient.visit_date))}</span></div>
                            <div><b>วันนัดติดตาม</b><span>${escapeHtml(formatThaiDate(currentForm.follow_up_date))}</span></div>
                        </div>
                        <dl>
                            <dt>อาการสำคัญ</dt><dd>${formatMultiline(currentForm.symptoms)}</dd>
                            <dt>การวินิจฉัย</dt><dd>${formatMultiline(currentForm.diagnosis)}</dd>
                            <dt>แผนการรักษา</dt><dd>${formatMultiline(currentForm.treatment)}</dd>
                            <dt>ยาที่จ่าย</dt><dd>${formatMultiline(formatMedicationText(currentForm.medications))}</dd>
                            <dt>บันทึกเพิ่มเติม</dt><dd>${formatMultiline(currentForm.notes)}</dd>
                        </dl>
                        ${currentForm.body_drawing_data ? `<img class="bodyDrawing" src="${escapeHtml(currentForm.body_drawing_data)}" alt="body drawing" />` : ""}
                    </section>
                `
                : "";

            const historySections = history.length
                ? history
                    .map((record, index) => `
                        <section class="record">
                            <h2>ประวัติการรักษาครั้งที่ ${history.length - index}</h2>
                            <div class="grid">
                                <div><b>วันที่รับบริการ</b><span>${escapeHtml(formatThaiDate(record.visit_date))}</span></div>
                                <div><b>วันนัดติดตาม</b><span>${escapeHtml(formatThaiDate(record.follow_up_date || ""))}</span></div>
                            </div>
                            <dl>
                                <dt>อาการสำคัญ</dt><dd>${formatMultiline(record.symptoms)}</dd>
                                <dt>การวินิจฉัย</dt><dd>${formatMultiline(record.diagnosis)}</dd>
                                <dt>แผนการรักษา</dt><dd>${formatMultiline(record.treatment)}</dd>
                                <dt>ยาที่จ่าย</dt><dd>${formatMultiline(formatMedicationText(record.medications))}</dd>
                                <dt>บันทึกเพิ่มเติม</dt><dd>${formatMultiline(record.notes)}</dd>
                            </dl>
                            ${record.body_drawing_data ? `<img class="bodyDrawing" src="${escapeHtml(record.body_drawing_data)}" alt="body drawing" />` : ""}
                        </section>
                    `)
                    .join("")
                : `<section class="empty">ยังไม่มีประวัติการรักษาที่บันทึกไว้</section>`;

            const printWindow = window.open("", "_blank", "width=960,height=720");
            if (!printWindow) {
                setErrorMsg("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต pop-up สำหรับเว็บไซต์นี้");
                return;
            }

            printWindow!.document.write(`
                <!doctype html>
                <html lang="th">
                <head>
                    <meta charset="utf-8" />
                    <title>ประวัติการรักษา ${escapeHtml(patient.full_name || patient.patient_code || "")}</title>
                    <style>
                        @page { size: A4; margin: 14mm; }
                        * { box-sizing: border-box; }
                        body { margin: 0; color: #111827; font-family: "Sarabun", "Tahoma", sans-serif; font-size: 13px; line-height: 1.55; }
                        header { border-bottom: 2px solid #0f766e; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; gap: 18px; }
                        h1 { margin: 0 0 6px; font-size: 22px; color: #0f172a; }
                        h2 { margin: 0 0 10px; font-size: 16px; color: #0f766e; }
                        .meta { color: #475569; }
                        .patient { min-width: 260px; border: 1px solid #dbeafe; border-radius: 8px; padding: 10px 12px; background: #f8fafc; }
                        .patient b { display: inline-block; min-width: 88px; color: #334155; }
                        .record { break-inside: avoid; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin: 0 0 12px; }
                        .record.current { border-color: #0f766e; background: #f0fdfa; }
                        .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; }
                        .grid div { border: 1px solid #e2e8f0; border-radius: 6px; padding: 7px 9px; background: #fff; }
                        .grid b { display: block; color: #64748b; font-size: 11px; }
                        dl { margin: 0; display: grid; grid-template-columns: 130px 1fr; gap: 7px 10px; }
                        dt { color: #475569; font-weight: 700; }
                        dd { margin: 0; min-height: 22px; }
                        .bodyDrawing { display: block; max-width: 100%; max-height: 260px; margin-top: 12px; border: 1px solid #e2e8f0; border-radius: 8px; object-fit: contain; }
                        .empty { padding: 18px; border: 1px dashed #cbd5e1; border-radius: 8px; color: #64748b; text-align: center; }
                        footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; color: #64748b; display: flex; justify-content: space-between; }
                        @media print { .noPrint { display: none; } body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
                    </style>
                </head>
                <body>
                    <header>
                        <div>
                            <h1>เอกสารประวัติการรักษา</h1>
                            <div class="meta">พิมพ์เมื่อ ${escapeHtml(formatThaiDate(toDateKey(new Date())))} เวลา ${escapeHtml(dayjs().format("HH:mm"))} น.</div>
                        </div>
                        <div class="patient">
                            <div><b>รหัสผู้ป่วย</b>${escapeHtml(patient.patient_code || "-")}</div>
                            <div><b>ชื่อ-นามสกุล</b>${escapeHtml(patient.full_name || "-")}</div>
                            <div><b>อายุ</b>${escapeHtml(calcAge(patient.birth_date))} ปี</div>
                            <div><b>วันเกิด</b>${escapeHtml(formatThaiDate(patient.birth_date))}</div>
                            <div><b>เบอร์โทร</b>${escapeHtml(patient.phone || "-")}</div>
                            <div><b>กรุ๊ปเลือด</b>${escapeHtml(patient.blood_type || "-")}</div>
                        </div>
                    </header>
                    ${currentSection}
                    ${historySections}
                    <footer>
                        <span>เอกสารนี้สร้างจากระบบเวชระเบียน</span>
                        <span>ลงชื่อผู้ตรวจ __________________________</span>
                    </footer>
                    <script>
                        window.addEventListener('load', () => {
                            window.focus();
                            window.print();
                        });
                    </script>
                </body>
                </html>
            `);
            printWindow!.document.close();
        } catch (error: unknown) {
            setErrorMsg(getErrorMessage(error, "พิมพ์ประวัติการรักษาไม่สำเร็จ"));
        }
    };

    const handleSave = async (data: MedicalRecordForm) => {
        if (!selectedPatient) return;

        if (dayjs(selectedPatient.visit_date).format("YYYY-MM-DD") !== todayKey) {
            setErrorMsg("บันทึกเวชระเบียนได้เฉพาะวันเข้าตรวจเท่านั้น ไม่สามารถบันทึกย้อนหลังหรือก่อนวันนัดได้");
            return;
        }

        const token = getAuthToken();

        if (!token) {
            setErrorMsg("กรุณาเข้าสู่ระบบก่อน");
            return;
        }

        try {
            setSaving(true);
            setSaved(false);

            const parsedBp = parseBpValue(data.bp);

            if (data.bp.trim() && !parsedBp) {
                throw new Error("กรุณากรอก BP เป็นรูปแบบ เช่น 120/80");
            }

            const hasVitalInput = [data.symptoms, data.bw, data.ht, data.tp, data.hr, data.rr, data.bp].some((value) =>
                String(value || "").trim()
            );

            if (hasVitalInput && (selectedPatient.queue_id || selectedPatient.queue_no)) {
                const measurementRes = await fetch(`${API}/measurements`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        queue_id: selectedPatient.queue_id || null,
                        queue_number: selectedPatient.queue_no || null,
                        service_date: selectedPatient.visit_date,
                        weight: data.bw || null,
                        height: data.ht || null,
                        chief_complaint: data.symptoms || null,
                        temperature: data.tp || null,
                        heart_rate: data.hr || null,
                        respiratory_rate: data.rr || null,
                        systolic_bp: parsedBp?.systolic_bp ?? null,
                        diastolic_bp: parsedBp?.diastolic_bp ?? null,
                    }),
                });

                if (!measurementRes.ok) {
                    const err = await measurementRes.json().catch(() => null);
                    throw new Error(err?.message || "บันทึกค่า CC/BW/HT/TP/HR/RR/BP ไม่สำเร็จ");
                }
            }

            const payload = {
                appointment_id: selectedPatient.appointment_id,
                queue_id: selectedPatient.queue_id,
                user_id: selectedPatient.user_id,
                patient_code: selectedPatient.patient_code,
                national_id: selectedPatient.national_id,
                visit_date: selectedPatient.visit_date,
                symptoms: data.symptoms,
                diagnosis: data.diagnosis,
                treatment: data.treatment,
                medications: data.medications,
                notes: data.notes,
                follow_up_date: data.follow_up_date || null,
                body_drawing_data: data.body_drawing_data || null,
            };

            const result = await saveMedicalRecordWithFallback(token, payload);

            setRows((prev) =>
                prev.map((row) =>
                    String(row.appointment_id) === String(selectedPatient.appointment_id)
                        ? {
                            ...row,
                            has_medical_record: true,
                            medical_record_id:
                                result?.id || result?.medical_record_id || row.medical_record_id,
                        }
                        : row
                )
            );

            setExistingRecord(data);
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch (err: unknown) {
            setErrorMsg(getErrorMessage(err, "บันทึกเวชระเบียนไม่สำเร็จ"));
        } finally {
            setSaving(false);
        }
    };

    const totalPatients = filteredGrouped.reduce((sum, [, arr]) => sum + arr.length, 0);
    const savedCount = rows.filter(
        (r) =>
            Boolean(r.medical_record_id) ||
            Boolean(r.record_id) ||
            Boolean(r.diagnosis_id) ||
            Boolean(r.has_medical_record)
    ).length;

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div className={styles.leftHeader}>

                    <div className={styles.pageTitleBox}>
                        <h1 className={styles.pageTitle}>เวชระเบียน</h1>
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
                    {selectedPatient ? (
                        recordLoading ? (
                            <div className={styles.hintText}>กำลังโหลดเวชระเบียน...</div>
                        ) : (
                            <RecordFormPage
                                patient={selectedPatient}
                                existingRecord={existingRecord}
                                saving={saving}
                                saved={saved}
                                canSave={dayjs(selectedPatient.visit_date).format("YYYY-MM-DD") === todayKey}
                                saveBlockedReason={
                                    dayjs(selectedPatient.visit_date).format("YYYY-MM-DD") < todayKey
                                        ? "เลยวันเข้าตรวจแล้ว จึงเปิดดูได้แต่ไม่สามารถบันทึกย้อนหลังได้"
                                        : "ยังไม่ถึงวันนัด จึงยังไม่สามารถบันทึกเวชระเบียนได้"
                                }
                                onBack={() => {
                                    setSelectedPatient(null);
                                    setExistingRecord(null);
                                    setSaved(false);
                                }}
                                onSave={handleSave}
                                onPrint={handlePrintPatientHistory}
                            />
                        )
                    ) : (
                        <div className={styles.medicalPanel}>
                            <div className={styles.medicalPanelHeader}>
                                <div className={styles.medicalTitleGroup}>
                                    <FileText size={24} strokeWidth={2.2} />
                                    <div>
                                        <h2>รายชื่อผู้เข้ารับบริการสัปดาห์ปัจจุบัน</h2>
                                        <p>
                                            {dayjs(getWeekRangeMonday(new Date()).start).locale("th").format("D")} –{" "}
                                            {dayjs(getWeekRangeMonday(new Date()).end).locale("th").format("D MMM. ")}
                                            {dayjs(getWeekRangeMonday(new Date()).end).year() + 543} •{" "}
                                            {totalPatients} ราย
                                        </p>
                                    </div>
                                </div>

                                <div className={styles.medicalHeaderActions}>
                                    <Link
                                        href="/admin/medicalrecords/history"
                                        className={styles.historyLink}
                                    >
                                        <Archive size={18} strokeWidth={2.2} />
                                        ดูประวัติย้อนหลัง
                                    </Link>
                                    <input
                                        className={styles.searchInput}
                                        type="text"
                                        placeholder="ค้นหาชื่อ / รหัสคิว / รหัสผู้ป่วย"
                                        value={searchText}
                                        onChange={(e) => setSearchText(e.target.value)}
                                    />
                                </div>
                            </div>

                            {loading && <div className={styles.hintText}>กำลังโหลดข้อมูล...</div>}

                            {!loading && !errorMsg && filteredGrouped.length === 0 && (
                                <div className={styles.emptyBox}>
                                    ไม่มีรายการที่ถูกอนุมัติในสัปดาห์นี้
                                </div>
                            )}

                            {!loading && !errorMsg && filteredGrouped.length > 0 && (
                                <>
                                    <div className={styles.medicalTableWrap}>
                                        <table className={styles.modernMedicalTable}>
                                            <thead>
                                                <tr>
                                                    <th>คิว</th>
                                                    <th>รหัสผู้ป่วย</th>
                                                    <th>ชื่อ-นามสกุล</th>
                                                    <th>วันที่นัด</th>
                                                    <th>ช่วงเวลา</th>
                                                    <th>สถานะบันทึก</th>
                                                    <th>เวชระเบียน</th>
                                                </tr>
                                            </thead>

                                            <tbody>
                                                {filteredGrouped.map(([dayKey, dayRows]) => (
                                                    <Fragment key={dayKey}>
                                                        <tr className={`${styles.dateGroupRow} ${isToday(dayKey) ? styles.todayGroupRow : ""}`}>
                                                            <td colSpan={7}>
                                                                <div className={styles.dateGroupHeader}>
                                                                    <CalendarDays size={20} strokeWidth={2.2} />
                                                                    <strong>{formatThaiDateWithWeekday(dayKey)}</strong>
                                                                    {isToday(dayKey) && <em className={styles.todayGroupBadge}>วันนี้</em>}
                                                                    <span>{dayRows.length} รายการ</span>
                                                                </div>
                                                            </td>
                                                        </tr>

                                                        {dayRows.map((r, idx) => {
                                                            const hasRecord =
                                                                Boolean(r.medical_record_id) ||
                                                                Boolean(r.record_id) ||
                                                                Boolean(r.diagnosis_id) ||
                                                                Boolean(r.has_medical_record);

                                                            const session = getSessionText(r.time_label);
                                                            const isPast = dayKey < todayKey;
                                                            const isFuture = dayKey > todayKey;
                                                            const isLocked = isPast || isFuture;

                                                            return (
                                                            <tr key={String(r.appointment_id ?? `${dayKey}-${idx}`)}>
                                                                <td>
                                                                    <span className={styles.queueBadge}>{r.queue_no || idx + 1}</span>
                                                                </td>

                                                                <td>
                                                                    <span className={styles.patientCodeBadge}>
                                                                        {r.patient_code || "-"}
                                                                    </span>
                                                                </td>

                                                                <td className={styles.patientNameCell}>
                                                                    {r.full_name || "-"}
                                                                </td>

                                                                <td className={styles.visitDateCell}>
                                                                    {isToday(dayKey) ? (
                                                                        <span className={styles.todayDateBadge}>วันนี้</span>
                                                                    ) : (
                                                                        dayjs(dayKey).format("D/M/") +
                                                                        (dayjs(dayKey).year() + 543)
                                                                    )}
                                                                </td>

                                                                <td>
                                                                    <span
                                                                        className={
                                                                            session.isAfternoon
                                                                                ? styles.afternoonBadgeModern
                                                                                : styles.morningBadgeModern
                                                                        }
                                                                    >
                                                                        {session.text}
                                                                    </span>
                                                                </td>

                                                                <td>
                                                                    {hasRecord ? (
                                                                        <span className={styles.recordedStatus}>
                                                                            <CheckCircle size={13} strokeWidth={2.5} />
                                                                            บันทึกแล้ว
                                                                        </span>
                                                                    ) : isPast ? (
                                                                        <span className={styles.expiredRecordStatus}>
                                                                            <Circle size={9} fill="currentColor" />
                                                                            หมดเวลาบันทึก
                                                                        </span>
                                                                    ) : (
                                                                        <span className={styles.notRecordedStatus}>
                                                                            <Circle size={9} fill="currentColor" />
                                                                            ยังไม่บันทึก
                                                                        </span>
                                                                    )}
                                                                </td>

                                                                <td>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            if (!isLocked) openRecord(r);
                                                                        }}
                                                                        disabled={isLocked}
                                                                        className={
                                                                            isPast
                                                                                ? styles.recordIconExpired
                                                                                : isFuture
                                                                                ? styles.recordIconLocked
                                                                                : hasRecord
                                                                                    ? styles.recordIconDone
                                                                                    : styles.recordIconBtn
                                                                        }
                                                                        title={
                                                                            isPast
                                                                                ? "เลยวันเข้าตรวจแล้ว ไม่สามารถเปิดหรือแก้ไขเวชระเบียนได้"
                                                                                : isFuture
                                                                                    ? "ยังไม่ถึงวันเข้าตรวจ"
                                                                                    : "เปิดเวชระเบียน"
                                                                        }
                                                                    >
                                                                        <FileText size={23} strokeWidth={2.2} />
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                            );
                                                        })}
                                                    </Fragment>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className={styles.medicalFooterText}>
                                        บันทึกแล้ว {savedCount} จาก {rows.length} ราย
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </section>
            </div>

            {!loading && errorMsg && (
                <div
                    className={styles.popupOverlay}
                    onClick={() => setErrorMsg("")}
                    role="button"
                    tabIndex={0}
                >
                    <div className={styles.popupBoxerror} onClick={(e) => e.stopPropagation()}>
                        <span className={styles.popupIcon}>⚠️</span>
                        {errorMsg}
                    </div>
                </div>
            )}
        </div>
    );
}
