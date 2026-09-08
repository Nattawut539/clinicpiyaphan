'use client';

import styles from './UserShell.module.css';
import { appBrand, userNavigationItems } from '@/config/navigation';
import { API_BASE } from '@/lib/api';
import { resolveBackendImage } from '@/lib/images';
import { PROFILE_UPDATED_EVENT, ProfileUpdateDetail, withImageVersion } from '@/lib/profileUpdates';
import dayjs from 'dayjs';
import 'dayjs/locale/th';
import Cookies from '@/lib/cookies';
import { Bell, CalendarClock, Check, History, Inbox, UserRound, X } from 'lucide-react';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

const API = API_BASE.endsWith('/api') ? API_BASE : `${API_BASE}/api`;
dayjs.locale('th');

type UserProfile = {
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
  profile_image?: string | null;
  account_status?: 'active' | 'pending_verification' | 'deactivated' | 'suspended' | 'unclaimed' | string;
};

type UserNotification = {
  notification_id: number;
  title: string;
  message: string;
  severity: 'info' | 'success' | 'warning' | 'danger' | string;
  target_url?: string | null;
  source_type?: string;
  is_read?: boolean;
  email_sent_at?: string | null;
  created_at?: string;
  event_at?: string | null;
};

type UserNotificationResponse = {
  active: UserNotification[];
  history: UserNotification[];
  unread_count: number;
};

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageVersion, setImageVersion] = useState<string>();
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationTab, setNotificationTab] = useState<'active' | 'history'>('active');
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notifications, setNotifications] = useState<UserNotificationResponse>({
    active: [],
    history: [],
    unread_count: 0,
  });

  useEffect(() => {
    const token = Cookies.get('userToken');
    if (!token) return;

    fetch(`${API}/me/profile`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
      cache: 'no-store',
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: UserProfile | null) => setProfile(data))
      .catch(() => setProfile(null));
  }, []);

  useEffect(() => {
    const updateProfile = (event: Event) => {
      const detail = (event as CustomEvent<ProfileUpdateDetail>).detail;
      if (!detail?.profile) return;
      setProfile((current) => ({ ...current, ...detail.profile }));
      if (detail.imageVersion) setImageVersion(detail.imageVersion);
      setImageFailed(false);
    };

    window.addEventListener(PROFILE_UPDATED_EVENT, updateProfile);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, updateProfile);
  }, []);

  const loadNotifications = async () => {
    const token = Cookies.get('userToken');
    if (!token) return;

    try {
      setNotificationLoading(true);
      const response = await fetch(`${API}/notifications/me`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('load_failed');
      const data = await response.json();
      setNotifications({
        active: Array.isArray(data?.active) ? data.active : [],
        history: Array.isArray(data?.history) ? data.history : [],
        unread_count: Number(data?.unread_count || 0),
      });
    } catch {
      setNotifications({ active: [], history: [], unread_count: 0 });
    } finally {
      setNotificationLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, []);

  const openNotifications = () => {
    setNotificationOpen(true);
    loadNotifications();
  };

  const markNotificationRead = async (item: UserNotification) => {
    const token = Cookies.get('userToken');
    if (!token) return;

    await fetch(`${API}/notifications/${item.notification_id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    }).catch(() => null);
    await loadNotifications();
  };

  const markAllRead = async () => {
    const token = Cookies.get('userToken');
    if (!token) return;

    await fetch(`${API}/notifications/read-all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    }).catch(() => null);
    await loadNotifications();
    setNotificationTab('history');
  };

  const openNotificationTarget = async (item: UserNotification) => {
    if (!item.is_read) await markNotificationRead(item);
    if (item.target_url) {
      setNotificationOpen(false);
      router.push(item.target_url);
    }
  };

  const fullName = useMemo(() => {
    const name = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim();
    return name || 'ผู้ใช้งาน';
  }, [profile]);
  const initial = fullName.charAt(0).toUpperCase();
  const imageSrc = withImageVersion(resolveBackendImage(profile?.profile_image), imageVersion);
  const currentPage = useMemo(() => {
    return userNavigationItems.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  }, [pathname]);
  const todayText = dayjs().locale('th').format('D MMMM');
  const buddhistYear = dayjs().year() + 543;
  const visibleNotifications = notificationTab === 'active' ? notifications.active : notifications.history;

  return (
    <header className={styles.header}>
      <div className={styles.headerTitle}>
        <strong>{currentPage?.label || appBrand.name}</strong>
        <span>วันที่ {todayText} {buddhistYear}</span>
      </div>

      <div className={styles.headerActions}>
        <button className={styles.notificationButton} type="button" title="การแจ้งเตือน" onClick={openNotifications}>
          <Bell size={20} />
          {notifications.unread_count > 0 && (
            <span>{notifications.unread_count > 99 ? '99+' : notifications.unread_count}</span>
          )}
        </button>

        {notificationOpen && (
          <div className={styles.notificationOverlay} onMouseDown={() => setNotificationOpen(false)}>
            <section className={styles.notificationPopup} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
              <header className={styles.notificationHeader}>
                <div className={styles.notificationHeaderIcon}>
                  <Bell size={22} />
                </div>
                <div>
                  <h3>การแจ้งเตือนของคุณ</h3>
                  <p>{notifications.unread_count} รายการใหม่</p>
                </div>
                <button type="button" onClick={() => setNotificationOpen(false)} aria-label="ปิดการแจ้งเตือน">
                  <X size={20} />
                </button>
              </header>

              <div className={styles.notificationTabs}>
                <button
                  type="button"
                  className={notificationTab === 'active' ? styles.notificationTabActive : ''}
                  onClick={() => setNotificationTab('active')}
                >
                  <Inbox size={16} />
                  การแจ้งเตือน
                </button>
                <button
                  type="button"
                  className={notificationTab === 'history' ? styles.notificationTabActive : ''}
                  onClick={() => setNotificationTab('history')}
                >
                  <History size={16} />
                  ประวัติ
                </button>
              </div>

              <div className={styles.notificationBody}>
                {notificationLoading ? (
                  <div className={styles.notificationEmpty}>
                    <CalendarClock size={30} />
                    <strong>กำลังโหลดการแจ้งเตือน...</strong>
                  </div>
                ) : visibleNotifications.length === 0 ? (
                  <div className={styles.notificationEmpty}>
                    <CalendarClock size={34} />
                    <strong>{notificationTab === 'active' ? 'ไม่มีการแจ้งเตือนใหม่' : 'ยังไม่มีประวัติการแจ้งเตือน'}</strong>
                    <span>รายการประวัติจะถูกลบอัตโนมัติเมื่อครบ 1 เดือน</span>
                  </div>
                ) : (
                  visibleNotifications.map((item) => (
                    <article key={item.notification_id} className={`${styles.notificationItem} ${styles[`notice${item.severity}`] || ''}`}>
                      <button type="button" className={styles.notificationItemMain} onClick={() => openNotificationTarget(item)}>
                        <strong>{item.title}</strong>
                        <p>{item.message}</p>
                        <small>
                          {item.event_at
                            ? dayjs(item.event_at).locale('th').format('D MMMM ') + (dayjs(item.event_at).year() + 543)
                            : dayjs(item.created_at).locale('th').format('D MMMM ') + (dayjs(item.created_at).year() + 543)}
                          {item.email_sent_at ? ' - ส่งอีเมลแล้ว' : ''}
                        </small>
                      </button>
                      {!item.is_read && (
                        <button type="button" className={styles.notificationReadBtn} onClick={() => markNotificationRead(item)}>
                          <Check size={16} />
                        </button>
                      )}
                    </article>
                  ))
                )}
              </div>

              <footer className={styles.notificationFooter}>
                <span>ประวัติจะถูกลบอัตโนมัติใน 1 เดือน</span>
                {notifications.unread_count > 0 && (
                  <button type="button" onClick={markAllRead}>
                    ทำเครื่องหมายว่าอ่านแล้วทั้งหมด
                  </button>
                )}
              </footer>
            </section>
          </div>
        )}

        <button className={styles.profileButton} type="button" onClick={() => router.push('/users/userprofile')}>
          <span className={styles.avatarWrap}>
            <span className={styles.avatar}>
              {imageSrc && !imageFailed ? (
                <Image
                  src={imageSrc}
                  alt={fullName}
                  width={36}
                  height={36}
                  unoptimized
                  onError={() => setImageFailed(true)}
                />
              ) : (
                initial || <UserRound size={18} />
              )}
            </span>
            <span
              className={`${styles.accountStatusDot} ${styles[`accountStatus_${profile?.account_status || 'active'}`] || ''}`}
              title={`สถานะบัญชี: ${profile?.account_status || 'active'}`}
              aria-label={`สถานะบัญชี ${profile?.account_status || 'active'}`}
            />
          </span>
          <span className={styles.profileText}>
            <strong>{fullName}</strong>
          </span>
        </button>
      </div>
    </header>
  );
}
