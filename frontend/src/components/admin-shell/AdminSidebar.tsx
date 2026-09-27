'use client';

import { adminNavigationItems } from '@/config/navigation';
import { LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Cookies from '@/lib/cookies';
import { API_BASE } from '@/lib/api';
import styles from './AdminSidebar.module.css';

export default function AdminSidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
    const viewport = window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)');
    const updateSidebarWidth = () => {
      document.documentElement.style.setProperty(
        '--sidebar-current-width',
        viewport.matches ? '64px' : isOpen ? '230px' : '72px'
      );
    };

    updateSidebarWidth();
    viewport.addEventListener('change', updateSidebarWidth);

    return () => {
      viewport.removeEventListener('change', updateSidebarWidth);
      document.documentElement.style.setProperty('--sidebar-current-width', '72px');
    };
  }, [isOpen]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobileMenuOpen]);

  const renderNavigationItems = (mobile = false) => (
    <>
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
            aria-current={active ? 'page' : undefined}
            onClick={mobile ? () => setMobileMenuOpen(false) : undefined}
          >
            <span className={styles.iconWrap}>
              <Icon size={24} />
            </span>
            {(mobile || isOpen) && <span className={styles.menuText}>{item.label}</span>}
          </Link>
        );
      })}
    </>
  );

  return (
    <>
      <aside
        className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ''}`}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        aria-label="เมนูเจ้าหน้าที่"
      >
        <div className={styles.logoArea}>
          <div className={styles.logoBox}>
            <img src="/img/profileclinic.png" alt="Clinic Logo" className={styles.logoImg} />
          </div>
          {isOpen && <span className={styles.logoText}>คลินิกหมอปิยะพันธ์</span>}
        </div>

        <nav className={styles.menuList} aria-label="เมนูหลัก">
          {renderNavigationItems()}
        </nav>

        <div className={styles.logoutArea}>
          <Link href="/logout" className={styles.logoutBtn} title="ออกจากระบบ">
            <span className={styles.iconWrap}><LogOut size={24} /></span>
            {isOpen && <span className={styles.menuText}>ออกจากระบบ</span>}
          </Link>
        </div>
      </aside>

      <button
        type="button"
        className={styles.mobileMenuButton}
        aria-label={mobileMenuOpen ? 'ปิดเมนูเจ้าหน้าที่' : 'เปิดเมนูเจ้าหน้าที่'}
        aria-expanded={mobileMenuOpen}
        aria-controls="staff-mobile-navigation"
        onClick={() => setMobileMenuOpen((open) => !open)}
      >
        {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
      </button>

      {mobileMenuOpen && (
        <div className={styles.mobileMenuBackdrop} onClick={() => setMobileMenuOpen(false)}>
          <nav
            id="staff-mobile-navigation"
            className={styles.mobileMenuPanel}
            aria-label="เมนูเจ้าหน้าที่"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.mobileMenuHeader}>
              <div className={styles.mobileLogoBox}>
                <img src="/img/profileclinic.png" alt="" />
              </div>
              <strong>คลินิกหมอปิยะพันธ์</strong>
              <button type="button" onClick={() => setMobileMenuOpen(false)} aria-label="ปิดเมนู">
                <X size={20} />
              </button>
            </div>
            <div className={styles.mobileMenuList}>{renderNavigationItems(true)}</div>
            <Link href="/logout" className={styles.mobileLogout} onClick={() => setMobileMenuOpen(false)}>
              <LogOut size={20} />
              <span>ออกจากระบบ</span>
            </Link>
          </nav>
        </div>
      )}
    </>
  );
}
