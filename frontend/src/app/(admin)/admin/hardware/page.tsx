'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  CircleCheck,
  Clock3,
  Cpu,
  KeyRound,
  Printer,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Wifi,
  WifiOff,
} from 'lucide-react';
import AdminSidebar from '@/components/admin-shell/AdminSidebar';
import AdminHeaderActions from '@/components/admin-shell/AdminHeaderActions';
import Cookies from '@/lib/cookies';
import { API_BASE } from '@/lib/api';
import styles from './Hardware.module.css';

type OtpStatus = 'available' | 'not_active_yet' | 'expired' | 'used' | 'not_issued';
type PrintStatus = 'pending' | 'printed' | 'failed';

type HardwareOtp = {
  appointment_id: number;
  queue_id: number | null;
  queue_number: string | null;
  service_date: string;
  hour_of_day: number;
  patient_name: string | null;
  issued_at: string | null;
  expires_at: string | null;
  used_at: string | null;
  has_measurement: boolean;
  status: OtpStatus;
};

type HardwareDevice = {
  device_id: string;
  last_seen_at: string;
  status: 'online' | 'offline';
  event_count: number;
};

type HardwareMeasurement = {
  message_id: string;
  device_id: string;
  mode: 'online' | 'walk_in';
  measurement_session_id: string | null;
  print_job_id: string | null;
  print_status: PrintStatus;
  raw_print_status: string;
  print_attempts: number;
  print_error_code: string | null;
  print_retryable: boolean;
  print_next_attempt_at: string | null;
  print_last_manual_reprint_at: string | null;
  print_manual_reprint_count: number;
  printed_at: string | null;
  created_at: string;
  queue_number: string;
  patient_name: string | null;
  measurement_id: number;
  weight: number | null;
  height: number | null;
  bmi: number | null;
  measured_at: string | null;
  source: string;
};

type HardwareTimelineEvent = {
  event_key: string;
  event_type: string;
  result: string;
  device_id: string | null;
  request_id: string | null;
  measurement_session_id: string | null;
  message_id: string | null;
  print_job_id: string | null;
  actor_user_id: number | null;
  error_code: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

type HardwareDashboard = {
  generated_at: string;
  health: {
    mqtt: {
      enabled: boolean;
      connected: boolean;
      subscribed: boolean;
      connected_at: string | null;
      disconnected_at: string | null;
      last_message_at: string | null;
    };
    outbox: { measurement_ack_backlog: number; print_backlog: number };
    latency: { measurement_ack_average_ms: number | null };
    failure_rate: { print_percent_last_hour: number | null };
  };
  otps: HardwareOtp[];
  devices: HardwareDevice[];
  measurements: HardwareMeasurement[];
  timeline: HardwareTimelineEvent[];
};

const OTP_LABEL: Record<OtpStatus, string> = {
  available: 'พร้อมใช้',
  not_active_yet: 'ยังไม่ถึงเวลา',
  expired: 'หมดอายุ',
  used: 'ใช้แล้ว',
  not_issued: 'ยังไม่ออกรหัส',
};

const PRINT_LABEL: Record<PrintStatus, string> = {
  pending: 'รอพิมพ์',
  printed: 'พิมพ์แล้ว',
  failed: 'พิมพ์ไม่สำเร็จ',
};

const EVENT_LABEL: Record<string, string> = {
  otp_issued: 'ออก OTP',
  otp_verify: 'ตรวจ OTP',
  otp_verify_rejected: 'OTP ถูกปฏิเสธ',
  measurement: 'รับผลวัด',
  measurements_rejected: 'ผลวัดถูกปฏิเสธ',
  print_publish: 'ส่งงานพิมพ์',
  print_ack: 'รับผลการพิมพ์',
  print_ack_rejected: 'Print ACK ถูกปฏิเสธ',
  manual_reprint: 'สั่งพิมพ์ซ้ำ',
};

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

function formatNumber(value: number | null, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
  return Number(value).toFixed(digits);
}

function timelineReference(event: HardwareTimelineEvent) {
  return event.print_job_id || event.message_id || event.measurement_session_id || event.request_id
    || String(event.details?.queue_number || '-');
}

export default function HardwareOperationsPage() {
  const [dashboard, setDashboard] = useState<HardwareDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const [browserOnline, setBrowserOnline] = useState(true);
  const [clock, setClock] = useState(Date.now());
  const [actionKey, setActionKey] = useState('');
  const [notice, setNotice] = useState('');
  const [newOtp, setNewOtp] = useState<{ code: string; expiresAt: string; queue: string } | null>(null);
  const requestInFlight = useRef(false);

  const loadDashboard = useCallback(async (manual = false) => {
    if (requestInFlight.current) return;
    const token = Cookies.get('adminToken');
    if (!token) {
      window.location.replace('/userlogin');
      return;
    }

    requestInFlight.current = true;
    if (manual) setRefreshing(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${API_BASE}/hardware/admin-dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (response.status === 401) {
        Cookies.remove('adminToken', { path: '/' });
        window.location.replace('/userlogin');
        return;
      }
      if (response.status === 403) {
        setForbidden(true);
        setDashboard(null);
        return;
      }
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw new Error(data?.message || 'โหลดข้อมูลระบบ Hardware ไม่สำเร็จ');
      setDashboard(data);
      setForbidden(false);
      setRequestError('');
      setLastSuccessAt(new Date().toISOString());
    } catch (error) {
      setRequestError(
        error instanceof DOMException && error.name === 'AbortError'
          ? 'Backend ไม่ตอบกลับภายใน 8 วินาที'
          : error instanceof Error ? error.message : 'ขาดการเชื่อมต่อกับ Backend',
      );
    } finally {
      window.clearTimeout(timeout);
      requestInFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setBrowserOnline(navigator.onLine);
    void loadDashboard();
    const poll = window.setInterval(() => void loadDashboard(), 10_000);
    const tick = window.setInterval(() => setClock(Date.now()), 5_000);
    const online = () => {
      setBrowserOnline(true);
      void loadDashboard(true);
    };
    const offline = () => setBrowserOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [loadDashboard]);

  const pollStale = !lastSuccessAt || clock - new Date(lastSuccessAt).getTime() > 30_000;
  const connectionLost = !browserOnline || Boolean(requestError) || pollStale;
  const onlineDevices = useMemo(
    () => dashboard?.devices.filter((device) => device.status === 'online').length || 0,
    [dashboard],
  );

  const reissueOtp = async (otp: HardwareOtp) => {
    if (!window.confirm(`ออกรหัส OTP ใหม่สำหรับคิว ${otp.queue_number || '-'} ใช่หรือไม่?`)) return;
    const token = Cookies.get('adminToken');
    setActionKey(`otp-${otp.appointment_id}`);
    setNotice('');
    setNewOtp(null);
    try {
      const response = await fetch(`${API_BASE}/appointments/${otp.appointment_id}/resend-code`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || data?.message || 'ออกรหัสใหม่ไม่สำเร็จ');
      setNewOtp({
        code: String(data.access_code || ''),
        expiresAt: String(data.expires_at || ''),
        queue: otp.queue_number || '-',
      });
      setNotice(data.message || 'ออกรหัสใหม่แล้ว');
      await loadDashboard(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'ออกรหัสใหม่ไม่สำเร็จ');
    } finally {
      setActionKey('');
    }
  };

  const reprint = async (measurement: HardwareMeasurement) => {
    if (!window.confirm(`สร้าง Print Job ใหม่สำหรับคิว ${measurement.queue_number} ใช่หรือไม่?`)) return;
    const token = Cookies.get('adminToken');
    setActionKey(`print-${measurement.message_id}`);
    setNotice('');
    try {
      const response = await fetch(`${API_BASE}/hardware/reprint`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message_id: measurement.message_id }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || data?.code || 'สร้าง Print Job ใหม่ไม่สำเร็จ');
      setNotice(`สร้าง Print Job ใหม่ ${data.print_job_id}`);
      await loadDashboard(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'สร้าง Print Job ใหม่ไม่สำเร็จ');
    } finally {
      setActionKey('');
    }
  };

  return (
    <div className={styles.shell}>
      <AdminSidebar />
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <span>HARDWARE OPERATIONS</span>
            <h1>เครื่องชั่ง, OTP และงานพิมพ์</h1>
            <p>ข้อมูลจาก Backend เป็นค่าหลัก · หน้านี้เปิดให้เฉพาะ Super Admin</p>
          </div>
          <div className={styles.headerActions}>
            <button type="button" onClick={() => void loadDashboard(true)} disabled={refreshing}>
              <RefreshCw size={17} className={refreshing ? styles.spin : ''} />
              {refreshing ? 'กำลังอัปเดต' : 'อัปเดตข้อมูล'}
            </button>
            <AdminHeaderActions />
          </div>
        </header>

        {forbidden ? (
          <section className={styles.forbidden}>
            <ShieldAlert size={50} />
            <h2>หน้านี้สำหรับ Super Admin เท่านั้น</h2>
            <p>Backend ปฏิเสธคำขอด้วยสถานะ 403</p>
          </section>
        ) : (
          <>
            <div className={`${styles.connectionBanner} ${connectionLost ? styles.connectionError : styles.connectionOk}`}>
              {connectionLost ? <WifiOff size={20} /> : <Wifi size={20} />}
              <div>
                <strong>{connectionLost ? 'การอัปเดตข้อมูลขาดการเชื่อมต่อ' : 'Polling ทำงานปกติ'}</strong>
                <small>
                  {!browserOnline ? 'เบราว์เซอร์ Offline' : requestError || `อัปเดตล่าสุด ${formatDateTime(lastSuccessAt)}`}
                </small>
              </div>
            </div>

            {notice && <div className={styles.notice}>{notice}</div>}
            {newOtp && (
              <div className={styles.otpReveal}>
                <KeyRound size={22} />
                <div><small>OTP ใหม่ · คิว {newOtp.queue}</small><strong>{newOtp.code}</strong><span>หมดอายุ {formatDateTime(newOtp.expiresAt)}</span></div>
                <button type="button" onClick={() => void navigator.clipboard.writeText(newOtp.code)}>คัดลอก</button>
              </div>
            )}

            <section className={styles.summaryGrid}>
              <article><Activity /><small>Backend MQTT</small><strong>{dashboard?.health.mqtt.connected && dashboard?.health.mqtt.subscribed ? 'Connected' : 'Disconnected'}</strong><span>Last message {formatDateTime(dashboard?.health.mqtt.last_message_at)}</span></article>
              <article><Cpu /><small>Device Online</small><strong>{onlineDevices}/{dashboard?.devices.length || 0}</strong><span>อิงกิจกรรมภายใน 2 นาที</span></article>
              <article><Clock3 /><small>ACK Backlog</small><strong>{dashboard?.health.outbox.measurement_ack_backlog ?? '-'}</strong><span>Latency {dashboard?.health.latency.measurement_ack_average_ms ?? '-'} ms</span></article>
              <article><Printer /><small>Print Backlog</small><strong>{dashboard?.health.outbox.print_backlog ?? '-'}</strong><span>Failure {dashboard?.health.failure_rate.print_percent_last_hour ?? '-'}%</span></article>
            </section>

            {loading && !dashboard ? <section className={styles.loading}>กำลังโหลดข้อมูล Hardware...</section> : dashboard && (
              <>
                <section className={styles.panel}>
                  <div className={styles.panelHeader}><div><span>ACCESS CODE</span><h2>สถานะ OTP</h2></div><small>แสดงนัดหมายที่อนุมัติแล้วตั้งแต่เมื่อวานถึง 7 วันข้างหน้า</small></div>
                  <div className={styles.tableWrap}>
                    <table><thead><tr><th>คิว/ผู้ป่วย</th><th>วันนัดหมาย</th><th>สถานะ</th><th>หมดอายุ</th><th>จัดการ</th></tr></thead>
                      <tbody>
                        {dashboard.otps.map((otp) => (
                          <tr key={otp.appointment_id}>
                            <td><strong>{otp.queue_number || '-'}</strong><small>{otp.patient_name || `Appointment #${otp.appointment_id}`}</small></td>
                            <td>{otp.service_date} · {String(otp.hour_of_day).padStart(2, '0')}:00 น.</td>
                            <td><span className={`${styles.badge} ${styles[`otp_${otp.status}`]}`}>{OTP_LABEL[otp.status]}</span></td>
                            <td>{formatDateTime(otp.expires_at)}</td>
                            <td><button className={styles.actionButton} type="button" disabled={!otp.queue_id || otp.has_measurement || actionKey === `otp-${otp.appointment_id}`} onClick={() => void reissueOtp(otp)}><KeyRound size={15} />{actionKey === `otp-${otp.appointment_id}` ? 'กำลังออก...' : 'ออกรหัสใหม่'}</button></td>
                          </tr>
                        ))}
                        {!dashboard.otps.length && <tr><td colSpan={5} className={styles.empty}>ไม่มี OTP ในช่วงเวลานี้</td></tr>}
                      </tbody></table>
                  </div>
                </section>

                <section className={styles.panel}>
                  <div className={styles.panelHeader}><div><span>DEVICE MONITOR</span><h2>สถานะอุปกรณ์</h2></div><small>Online เมื่อ Backend ได้รับกิจกรรมภายใน 2 นาที</small></div>
                  <div className={styles.deviceGrid}>
                    {dashboard.devices.map((device) => (
                      <article key={device.device_id} className={styles.deviceCard}>
                        <div className={device.status === 'online' ? styles.deviceOnline : styles.deviceOffline}>{device.status === 'online' ? <Wifi size={20} /> : <WifiOff size={20} />}</div>
                        <div><strong>{device.device_id}</strong><span>{device.status === 'online' ? 'Online' : 'Offline'}</span><small>Last seen {formatDateTime(device.last_seen_at)}</small></div>
                      </article>
                    ))}
                    {!dashboard.devices.length && <p className={styles.emptyCard}>ยังไม่พบกิจกรรมจากอุปกรณ์</p>}
                  </div>
                </section>

                <section className={styles.panel}>
                  <div className={styles.panelHeader}><div><span>MEASUREMENT &amp; PRINT</span><h2>ผลวัดและสถานะงานพิมพ์</h2></div><small>Weight / Height / BMI อ่านจาก Backend โดยตรง</small></div>
                  <div className={styles.tableWrap}>
                    <table className={styles.measurementTable}><thead><tr><th>คิว</th><th>ผลวัดจาก Backend</th><th>Device / Message</th><th>Print</th><th>อัปเดต</th><th>จัดการ</th></tr></thead>
                      <tbody>
                        {dashboard.measurements.map((item) => (
                          <tr key={item.message_id}>
                            <td><strong>{item.queue_number}</strong><small>{item.patient_name || item.mode}</small></td>
                            <td><div className={styles.vitals}><span><b>{formatNumber(item.weight)}</b> kg</span><span><b>{formatNumber(item.height)}</b> cm</span><span><b>{formatNumber(item.bmi)}</b> BMI</span></div></td>
                            <td><code>{item.device_id}</code><small title={item.message_id}>{item.message_id}</small></td>
                            <td><span className={`${styles.badge} ${styles[`print_${item.print_status}`]}`}>{PRINT_LABEL[item.print_status]}</span><small>{item.print_error_code ? `Error: ${item.print_error_code}` : item.print_job_id || 'ยังไม่มี Print Job'}</small></td>
                            <td>{formatDateTime(item.measured_at || item.created_at)}<small>Attempts {item.print_attempts}</small></td>
                            <td><button className={styles.actionButton} type="button" disabled={!['printed', 'failed'].includes(item.print_status) || actionKey === `print-${item.message_id}`} onClick={() => void reprint(item)}><RotateCcw size={15} />{actionKey === `print-${item.message_id}` ? 'กำลังสร้าง...' : 'Reprint'}</button></td>
                          </tr>
                        ))}
                        {!dashboard.measurements.length && <tr><td colSpan={6} className={styles.empty}>ยังไม่มี Measurement จาก Hardware</td></tr>}
                      </tbody></table>
                  </div>
                </section>

                <section className={styles.panel}>
                  <div className={styles.panelHeader}><div><span>TRACEABILITY</span><h2>Timeline: OTP → Measurement → Print</h2></div><small>Correlation ID และ Error Code จาก Backend Audit</small></div>
                  <div className={styles.timeline}>
                    {dashboard.timeline.map((event) => (
                      <article key={event.event_key}>
                        <div className={`${styles.timelineDot} ${event.result === 'failed' || event.result === 'rejected' ? styles.timelineFailed : ''}`}>{event.result === 'failed' || event.result === 'rejected' ? <ShieldAlert size={15} /> : <CircleCheck size={15} />}</div>
                        <div><div className={styles.timelineTitle}><strong>{EVENT_LABEL[event.event_type] || event.event_type}</strong><span className={`${styles.badge} ${styles[`result_${event.result}`]}`}>{event.result}</span></div><code>{timelineReference(event)}</code><small>{event.device_id || 'Backend'} · {formatDateTime(event.created_at)}{event.error_code ? ` · ${event.error_code}` : ''}</small></div>
                      </article>
                    ))}
                    {!dashboard.timeline.length && <p className={styles.emptyCard}>ยังไม่มี Hardware Audit Event</p>}
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
