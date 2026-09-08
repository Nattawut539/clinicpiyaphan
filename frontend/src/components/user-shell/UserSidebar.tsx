'use client';

import { appBrand, userNavigationItems, type NavigationItem } from '@/config/navigation';
import { LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import styles from './UserShell.module.css';

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function UserSidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-current-width', isOpen ? '230px' : '72px');
    return () => document.documentElement.style.setProperty('--sidebar-current-width', '72px');
  }, [isOpen]);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const renderNavLink = (item: NavigationItem, compact = false) => {
    const Icon = item.icon;
    const active = isActivePath(pathname, item.href);

    return (
      <Link
        key={item.href}
        href={item.href}
        className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
        title={item.label}
        onClick={closeMobileMenu}
      >
        <Icon size={22} strokeWidth={active ? 2.4 : 1.9} />
        <span>{compact ? item.shortLabel || item.label : item.label}</span>
      </Link>
    );
  };

  return (
    <>
      <aside
        className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ''}`}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
      >
        <div className={styles.sidebarBrand}>
          <div className={styles.logoBox}>
            <img src="/img/profileclinic.png" alt="Clinic Logo" className={styles.logoImg} />
          </div>
          {isOpen && (
            <div className={styles.brandText}>
              <strong>{appBrand.name}</strong>
            </div>
          )}
        </div>

        <nav className={styles.navLinks}>
          {userNavigationItems.map((item) => renderNavLink(item))}
        </nav>

        <div className={styles.sidebarBottom}>
          <Link href="/logout" className={`${styles.navItem} ${styles.logoutItem}`} title="ออกจากระบบ">
            <LogOut size={22} />
            <span>ออกจากระบบ</span>
          </Link>
        </div>
      </aside>

      <button className={styles.menuButton} type="button" onClick={() => setMobileMenuOpen(true)} aria-label="เปิดเมนู">
        <Menu size={22} />
      </button>

      <nav className={styles.mobileBottomNav}>
        {userNavigationItems.slice(0, 5).map((item) => renderNavLink(item, true))}
      </nav>

      {mobileMenuOpen && (
        <div className={styles.mobileOverlay} onClick={closeMobileMenu}>
          <div className={styles.mobilePanel} onClick={(event) => event.stopPropagation()}>
            <div className={styles.mobilePanelHeader}>
              <div>
                <strong>เมนู</strong>
                <span>{appBrand.name}</span>
              </div>
              <button type="button" onClick={closeMobileMenu} aria-label="ปิดเมนู">
                <X size={18} />
              </button>
            </div>

            <div className={styles.mobilePanelNav}>
              {userNavigationItems.map((item) => renderNavLink(item))}
            </div>

            <Link href="/logout" className={`${styles.navItem} ${styles.logoutItem}`} onClick={closeMobileMenu}>
              <LogOut size={20} />
              <span>ออกจากระบบ</span>
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
