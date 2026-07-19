'use client';

import styles from './aboutus.module.css';
import { Clock, Phone, Award, GraduationCap } from 'lucide-react';

export default function AboutusPage() {
  return (
    <div className={styles.aboutPage}>
      {/* Intro */}
      <section className={styles.introCard}>
        <div className={styles.introTopLine} />

        <div className={styles.introBody}>
          <h2>ทีมผู้ดูแลสุขภาพของคุณ</h2>
          <p>
            เราเป็นคลินิกขนาดเล็กที่ให้ความสำคัญกับการดูแลผู้ป่วยอย่างใกล้ชิดและตรงไปตรงมา
            ทีมของเรามีเพียง 2 คน แต่เราทุ่มเทให้กับทุกๆ คนที่มาใช้บริการ
          </p>
        </div>
      </section>

      {/* Doctor card */}
      <section className={styles.staffCard}>
        <div className={styles.staffGrid}>
          <div className={styles.doctorPhotoArea}>
            <div className={styles.staffAvatarGroup}>
              <div className={styles.doctorAvatar}>
                <span>👨‍⚕️</span>
              </div>

              <div className={styles.ratingBox}>
                <div className={styles.starRow}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <span key={s}>★</span>
                  ))}
                </div>
                <p>4.9 · 312 รีวิว</p>
              </div>
            </div>
          </div>

          <div className={styles.staffInfo}>
            <div className={styles.staffHeader}>
              <div>
                <h3>นพ. สมศักดิ์ ศรีวิไล</h3>
                <span className={styles.doctorBadge}>แพทย์ประจำคลินิก</span>
              </div>

              <span className={styles.experienceBadge}>
                ประสบการณ์ 15 ปี
              </span>
            </div>

            <p className={styles.staffDescription}>
              จบแพทยศาสตรบัณฑิตจากจุฬาลงกรณ์มหาวิทยาลัย และมีวุฒิบัตรอายุรกรรมทั่วไป
              ดูแลผู้ป่วยในชุมชนมากว่า 15 ปี เชี่ยวชาญโรคทั่วไปและโรคเรื้อรัง
            </p>

            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <GraduationCap className={styles.blueIcon} />
                <div>
                  <p>การศึกษา</p>
                  <span>แพทยศาสตร์บัณฑิต จุฬาลงกรณ์</span>
                  <span>วุฒิบัตรอายุรกรรม มหิดล</span>
                </div>
              </div>

              <div className={styles.infoItem}>
                <Award className={styles.amberIcon} />
                <div>
                  <p>ความเชี่ยวชาญ</p>
                  <span>โรคทั่วไป · โรคเรื้อรัง</span>
                  <span>เบาหวาน · ความดัน · ไขมัน</span>
                </div>
              </div>
            </div>

            <div className={styles.doctorSchedule}>
              <Clock />
              <div>
                <strong>วันออกตรวจ: </strong>
                <span>จันทร์ – เสาร์ · 08:00–17:00 น.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Assistant card */}
      <section className={styles.staffCard}>
        <div className={styles.staffGrid}>
          <div className={styles.assistantPhotoArea}>
            <div className={styles.assistantAvatar}>
              <span>👩‍⚕️</span>
            </div>
          </div>

          <div className={styles.staffInfo}>
            <div className={styles.assistantHeader}>
              <h3>นางสาวมาลี ใจดี</h3>
              <span className={styles.assistantBadge}>
                ผู้ช่วยแพทย์ประจำคลินิก
              </span>
            </div>

            <p className={styles.staffDescription}>
              ผู้ช่วยแพทย์ประจำคลินิกมากว่า 8 ปี ดูแลตั้งแต่การลงทะเบียน
              วัดความดัน ชั่งน้ำหนัก ฉีดยา ทำแผล และดูแลผู้ป่วยในคลินิก
            </p>

            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <Award className={styles.roseIcon} />
                <div>
                  <p>หน้าที่รับผิดชอบ</p>
                  <span>ลงทะเบียน · วัดสัญญาณชีพ</span>
                  <span>ฉีดยา · ทำแผล · จ่ายยา</span>
                </div>
              </div>

              <div className={styles.infoItem}>
                <GraduationCap className={styles.blueIcon} />
                <div>
                  <p>คุณวุฒิ</p>
                  <span>ผู้ช่วยพยาบาล (PN)</span>
                  <span>ประสบการณ์ 8 ปี</span>
                </div>
              </div>
            </div>

            <div className={styles.assistantSchedule}>
              <Clock />
              <span>อยู่ประจำคลินิกทุกวันทำการ</span>
            </div>
          </div>
        </div>
      </section>

      {/* Contact note */}
      <section className={styles.contactCard}>
        <div>
          <h3>มีข้อสงสัย? ติดต่อเราได้เลย</h3>
          <p>หมอสมศักดิ์และทีมยินดีตอบทุกคำถาม</p>
        </div>

        <a href="tel:021234567" className={styles.callButton}>
          <Phone />
          02-123-4567
        </a>
      </section>
    </div>
  );
}
