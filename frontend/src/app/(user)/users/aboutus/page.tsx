'use client';

import styles from './aboutus.module.css';
import { Building2, Clock, GraduationCap } from 'lucide-react';

export default function AboutusPage() {
  return (
    <div className={styles.aboutPage}>
      <div className={styles.profileIntro}>
        <h2>รู้จักแพทย์ประจำคลินิก</h2>
        <p>
          คลินิกเวชกรรมหมอปิยะพันธ์ให้บริการตรวจรักษาและดูแลสุขภาพ
          โดยแพทย์ประจำคลินิกอย่างใกล้ชิดและต่อเนื่อง
        </p>
      </div>

      {/* Doctor card */}
      <section className={styles.staffCard}>
        <div className={styles.staffGrid}>
          <div className={styles.doctorPhotoArea}>
            <div className={styles.staffAvatarGroup}>
              <img
                className={styles.doctorImage}
                src="/img/profileclinic.png"
                alt="นายแพทย์ปิยะพันธ์ ตรงสุจิตร"
              />
            </div>
            <h3>นพ. ปิยะพันธ์ ตรงสุจิตร</h3>
          </div>

          <div className={styles.staffInfo}>
            <div className={styles.staffHeader}>
              <div>
                <span className={styles.doctorBadge}>แพทย์ประจำคลินิก</span>
              </div>

              <span className={styles.experienceBadge}>
                ประสบการณ์ 16 ปี (พ.ศ. 2553–2569)
              </span>
            </div>

            <p className={styles.staffDescription}>
              แพทย์ประจำคลินิกผู้มีประสบการณ์ดูแลผู้ป่วยตั้งแต่ พ.ศ. 2553
              ให้คำปรึกษา ตรวจรักษาโรคทั่วไป และดูแลสุขภาพเบื้องต้น
            </p>

            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <GraduationCap className={styles.blueIcon} />
                <div>
                  <p>การศึกษา</p>
                  <span>แพทยศาสตรบัณฑิต</span>
                  <span>มหาวิทยาลัยมหิดล</span>
                </div>
              </div>

              <div className={styles.infoItem}>
                <Building2 className={styles.amberIcon} />
                <div>
                  <p>ข้อมูลคลินิก</p>
                  <span>คลินิกเอกชน · รหัสหน่วยบริการ 30508</span>
                  <span>119 ต.นาเชือก อ.นาเชือก จ.มหาสารคาม 44170</span>
                </div>
              </div>
            </div>

            <div className={styles.doctorSchedule}>
              <Clock />
              <div>
                <strong>วันออกตรวจ: </strong>
                <span>จันทร์ – เสาร์  07:00–19:00 น.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}
