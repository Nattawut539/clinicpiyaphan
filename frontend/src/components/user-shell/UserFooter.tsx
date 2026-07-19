import { appBrand } from '@/config/navigation';
import styles from './UserShell.module.css';

export default function UserFooter() {
  return (
    <footer className={styles.footer}>
      © 2025 {appBrand.name}. All rights reserved.
    </footer>
  );
}
