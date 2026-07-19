'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Cookies from 'js-cookie';

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        const token = Cookies.get('adminToken');

        // หน้าในแอดมินที่ไม่ต้องเช็ค token
        const publicPages = ['/logout'];

        // ถ้าไม่มี token และไม่ใช่หน้าที่อนุญาต
        if (!token && !publicPages.includes(pathname)) {
            router.replace('/userlogin'); // ไปหน้า login ของ admin
        }
    }, [pathname]);

    return <>{children}</>;
}
