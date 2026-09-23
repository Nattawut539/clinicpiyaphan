'use client';

import { useEffect } from 'react';
import Cookies from '@/lib/cookies';
import ClinicChat from '@/components/chat/ClinicChat';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const verifySession = () => {
      if (!Cookies.get('adminToken')) window.location.replace('/userlogin');
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') verifySession();
    };

    verifySession();
    window.addEventListener('pageshow', verifySession);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('pageshow', verifySession);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return <>{children}<ClinicChat staff /></>;
}
