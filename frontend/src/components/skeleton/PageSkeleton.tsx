import styles from './PageSkeleton.module.css';

type PageSkeletonProps = {
  variant?: 'screen' | 'content' | 'admin';
};

const Line = ({ size }: { size?: 'short' | 'medium' }) => (
  <div className={`${styles.line} ${size ? styles[size] : ''}`} />
);

export default function PageSkeleton({ variant = 'screen' }: PageSkeletonProps) {
  const wrapperClass = variant === 'admin'
    ? styles.adminScreen
    : variant === 'content'
      ? styles.content
      : styles.screen;

  return (
    <div className={wrapperClass} role="status" aria-live="polite" aria-busy="true">
      <span className={styles.srOnly}>กำลังโหลดเนื้อหา กรุณารอสักครู่</span>
      <div className={styles.shell} aria-hidden="true">
        <div className={styles.topbar}>
          <div className={styles.titleGroup}>
            <Line size="medium" />
            <Line size="short" />
          </div>
          <div className={styles.actions}>
            <div className={styles.button} />
            <div className={styles.button} />
          </div>
        </div>

        <div className={styles.grid}>
          <section className={styles.card}>
            <div className={styles.circle} />
            <Line size="medium" />
            <Line size="short" />
          </section>
          <section className={styles.card}>
            <div className={styles.circle} />
            <Line size="medium" />
            <Line size="short" />
          </section>
          <section className={styles.card}>
            <div className={styles.circle} />
            <Line size="medium" />
            <Line size="short" />
          </section>

          <section className={styles.wideCard}>
            <Line size="short" />
            <div className={styles.chart} />
          </section>
          <section className={styles.card}>
            <Line size="medium" />
            <div className={styles.rows}>
              {[0, 1, 2, 3].map((row) => (
                <div className={styles.row} key={row}>
                  <div className={styles.circle} />
                  <Line />
                  <Line />
                  <Line />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
