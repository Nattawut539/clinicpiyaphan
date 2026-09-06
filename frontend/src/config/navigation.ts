import {
  BarChart3,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  FileClock,
  HeartPulse,
  HelpCircle,
  Home,
  Info,
  LayoutGrid,
  ScrollText,
  Stethoscope,
  Users,
} from 'lucide-react';
import type { ComponentType } from 'react';

export type NavigationItem = {
  href: string;
  label: string;
  shortLabel?: string;
  icon: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  superAdminOnly?: boolean;
  allowedRoles?: string[];
};

export const userNavigationItems: NavigationItem[] = [
  { href: '/users/userHome', label: 'หน้าหลัก', shortLabel: 'Home', icon: Home },
  { href: '/users/service', label: 'บริการ', shortLabel: 'บริการ', icon: Stethoscope },
  { href: '/users/pending', label: 'จองคิว', shortLabel: 'จองคิว', icon: CalendarCheck },
  { href: '/users/appointment', label: 'คิวของฉัน', shortLabel: 'คิว', icon: ClipboardList },
  { href: '/users/history', label: 'ประวัติการรักษา', shortLabel: 'ประวัติ', icon: FileClock },
  { href: '/users/help', label: 'ช่วยเหลือ / FAQ', shortLabel: 'FAQ', icon: HelpCircle },
  { href: '/users/aboutus', label: 'เกี่ยวกับเรา', shortLabel: 'เกี่ยวกับ', icon: Info },
];

export const adminNavigationItems: NavigationItem[] = [
  { href: '/admin/dashboard', label: 'หน้าหลัก', icon: LayoutGrid },
  { href: '/admin/admins', label: 'รายชื่อผู้ป่วย', icon: Users },
  { href: '/admin/appointment', label: 'รายการจองคิว', icon: CalendarDays },
  {
    href: '/admin/medicalrecords',
    label: 'เวชระเบียน',
    icon: ClipboardList,
    allowedRoles: ['doctor', 'super_admin', 'superadmin'],
  },
  { href: '/admin/compile', label: 'คะแนนการบริการ', icon: BarChart3 },
  { href: '/admin/audit-logs', label: 'บันทึกการใช้งานระบบ', icon: ScrollText, superAdminOnly: true },
  { href: '/admin/help', label: 'ช่วยเหลือ', icon: HelpCircle },
];

export const appBrand = {
  name: 'คลินิกหมอปิยะพันธ์',
  productName: 'ClinicCare',
  portalName: 'Patient Portal',
  icon: HeartPulse,
};
