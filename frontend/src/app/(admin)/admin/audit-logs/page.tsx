'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Cookies from '@/lib/cookies';
import { RefreshCw, Search, ShieldAlert } from 'lucide-react';
import AdminSidebar from '@/components/admin-shell/AdminSidebar';
import AdminHeaderActions from '@/components/admin-shell/AdminHeaderActions';
import { API_BASE } from '@/lib/api';
import styles from './AuditLogs.module.css';

type AuditLog = {
  audit_id: number;
  request_id: string;
  actor_user_id?: number | null;
  actor_role?: string | null;
  http_method: string;
  route: string;
  result: 'success' | 'denied' | 'error' | string;
  status_code: number;
  error_code?: string | null;
  duration_ms?: number | null;
  created_at: string;
};

const RESULT_LABEL: Record<string, string> = {
  success: 'สำเร็จ',
  denied: 'ถูกปฏิเสธ',
  error: 'ผิดพลาด',
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(value));
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [resultFilter, setResultFilter] = useState('all');

  const loadLogs = useCallback(async () => {
    const token = Cookies.get('adminToken');
    if (!token) {
      window.location.replace('/userlogin');
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/audit-logs?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
        cache: 'no-store',
      });
      if (response.status === 401) {
        Cookies.remove('adminToken', { path: '/' });
        window.location.replace('/userlogin');
        return;
      }
      if (response.status === 403) {
        setForbidden(true);
        setLogs([]);
        return;
      }
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data?.error || 'โหลด Audit Log ไม่สำเร็จ');
      setLogs(Array.isArray(data) ? data : []);
      setForbidden(false);
      setError('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'โหลด Audit Log ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const filteredLogs = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return logs.filter((log) => {
      if (resultFilter !== 'all' && log.result !== resultFilter) return false;
      if (!keyword) return true;
      return [log.request_id, log.actor_user_id, log.actor_role, log.route, log.status_code, log.error_code]
        .some((value) => String(value ?? '').toLowerCase().includes(keyword));
    });
  }, [logs, resultFilter, search]);

  return (
    <div className={styles.shell}>
      <AdminSidebar />
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <span>SECURITY &amp; COMPLIANCE</span>
            <h1>บันทึกการใช้งานระบบ</h1>
            <p>หน้านี้และ API เปิดให้เฉพาะ Super Admin เท่านั้น</p>
          </div>
          <AdminHeaderActions />
        </header>

        {forbidden ? (
          <section className={styles.forbidden}>
            <ShieldAlert size={48} />
            <h2>ไม่มีสิทธิ์เปิด Audit Log</h2>
            <p>Backend ปฏิเสธคำขอด้วยสถานะ 403</p>
          </section>
        ) : (
          <section className={styles.panel}>
            <div className={styles.toolbar}>
              <label>
                <Search size={18} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหา API, Role, User ID หรือ Request ID" />
              </label>
              <select value={resultFilter} onChange={(event) => setResultFilter(event.target.value)}>
                <option value="all">ผลลัพธ์ทั้งหมด</option>
                <option value="success">สำเร็จ</option>
                <option value="denied">ถูกปฏิเสธ</option>
                <option value="error">ผิดพลาด</option>
              </select>
              <button type="button" onClick={() => void loadLogs()} disabled={loading}>
                <RefreshCw size={17} /> อัปเดต
              </button>
            </div>

            {error && <p className={styles.errorNotice}>{error}</p>}
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>วันและเวลา</th><th>ผู้ดำเนินการ</th><th>API</th><th>ผลลัพธ์</th><th>HTTP</th><th>Request ID</th></tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={6} className={styles.empty}>กำลังโหลด...</td></tr>}
                  {!loading && filteredLogs.map((log) => (
                    <tr key={log.audit_id}>
                      <td>{formatDateTime(log.created_at)}</td>
                      <td><strong>{log.actor_user_id ? `User #${log.actor_user_id}` : 'ไม่ระบุตัวตน'}</strong><small>{log.actor_role || '-'}</small></td>
                      <td><code>{log.http_method} {log.route}</code><small>{log.duration_ms ?? 0} ms</small></td>
                      <td><span className={`${styles.badge} ${styles[log.result] || ''}`}>{RESULT_LABEL[log.result] || log.result}</span></td>
                      <td><strong>{log.status_code}</strong></td>
                      <td><code className={styles.requestId}>{log.request_id}</code></td>
                    </tr>
                  ))}
                  {!loading && !filteredLogs.length && <tr><td colSpan={6} className={styles.empty}>ไม่พบรายการ</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
