'use client';

import { adminNavigationItems } from '@/config/navigation';
import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Cookies from 'js-cookie';
import { API_BASE } from '@/lib/api';
import styles from './AdminSidebar.module.css';

export default function AdminSidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [staffRole, setStaffRole] = useState('');

  const isSuperAdmin = staffRole === 'super_admin' || staffRole === 'superadmin';

  useEffect(() => {
    const token = Cookies.get('adminToken');
    if (!token) return;

    let active = true;
    fetch(`${API_BASE}/me/profile`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
      cache: 'no-store',
    })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((profile) => {
        if (!active) return;
        const role = String(profile?.role || '').toLowerCase();
        setStaffRole(role);
      })
      .catch(() => {
        if (active) setStaffRole('');
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--sidebar-current-width',
      isOpen ? '230px' : '72px'
    );

    return () => {
      document.documentElement.style.setProperty('--sidebar-current-width', '72px');
    };
  }, [isOpen]);

  return (
    <aside
      className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ''}`}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <div className={styles.logoArea}>
        <div className={styles.logoBox}>
          <img
            src="/img/profileclinic.png"
            alt="Clinic Logo"
            className={styles.logoImg}
          />
        </div>

        {isOpen && <span className={styles.logoText}>คลินิกหมอปิยะพันธ์</span>}
      </div>

      <nav className={styles.menuList}>
        {adminNavigationItems.map((item) => {
          if (item.superAdminOnly && !isSuperAdmin) return null;
          if (item.allowedRoles && !item.allowedRoles.includes(staffRole)) return null;
          const Icon = item.icon;
          const active = pathname === item.href || pathname?.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.menuItem} ${active ? styles.active : ''}`}
              title={item.label}
            >
              <span className={styles.iconWrap}>
                <Icon size={24} />
              </span>
              {isOpen && <span className={styles.menuText}>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className={styles.logoutArea}>
        <Link href="/logout" className={styles.logoutBtn} title="ออกจากระบบ">
          <span className={styles.iconWrap}>
            <LogOut size={24} />
          </span>
          {isOpen && <span className={styles.menuText}>ออกจากระบบ</span>}
        </Link>
      </div>
    </aside>
  );
}
