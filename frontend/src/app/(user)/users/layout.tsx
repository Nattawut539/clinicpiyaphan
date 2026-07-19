import UserFooter from "@/components/user-shell/UserFooter";
import UserHeader from "@/components/user-shell/UserHeader";
import UserSidebar from "@/components/user-shell/UserSidebar";
import styles from "@/components/user-shell/UserShell.module.css";

export default function UserLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
