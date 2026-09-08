"use client";

import UserFooter from "@/components/user-shell/UserFooter";
import UserHeader from "@/components/user-shell/UserHeader";
import UserSidebar from "@/components/user-shell/UserSidebar";
import styles from "@/components/user-shell/UserShell.module.css";
import Cookies from "@/lib/cookies";
import { useEffect } from "react";

export default function UserLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    const verifySession = () => {
      if (!Cookies.get("userToken")) window.location.replace("/userlogin");
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") verifySession();
    };

    verifySession();
    window.addEventListener("pageshow", verifySession);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("pageshow", verifySession);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return (
    <div className={styles.wrapper}>
      <UserHeader />
      <UserSidebar />
      <main className={styles.main}>
        {children}
      </main>
      <UserFooter />
    </div>
  );
}
