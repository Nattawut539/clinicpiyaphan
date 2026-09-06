'use client';

import {
  CheckCircle,
  Thermometer,
  Stethoscope,
} from 'lucide-react';

import styles from './service.module.css';
const services = [
  {
    icon: Stethoscope,
    title: 'ตรวจโรคทั่วไป',
    desc: 'ไข้ ไอ หวัด ปวดหัว ปวดท้อง และอาการทั่วไปที่พบบ่อย',
    className: styles.serviceTeal,
  },
  {
    icon: Thermometer,
    title: 'ทำแผล / ล้างแผล',
    desc: 'ดูแลแผลสด แผลเย็บ ถอดไหม โดยผู้ช่วยแพทย์ที่มีประสบการณ์',
    className: styles.serviceOrange,
  },
];

const welfares = [
  {
    emoji: '💵',
    title: 'ชำระเอง',
    desc: 'เงินสด โอนเงิน พร้อมเพย์',
  }
];

export default function CustomerservicePage() {
  return (
    <div className={styles.servicesPage}>
      <section className={styles.servicesCard}>
        <div className={styles.sectionHeader}>
          <h2>บริการของเรา</h2>
          <p>ดูแลสุขภาพทุกด้านโดยแพทย์ผู้เชี่ยวชาญ</p>
        </div>

        <div className={styles.servicesGrid}>
          {services.map((service, index) => {
            const Icon = service.icon;

            return (
              <div
                key={service.title}
                className={`${styles.serviceItem} ${index === 0 ? styles.serviceItemWide : ''
                  }`}
              >
                <div className={`${styles.serviceIconBox} ${service.className}`}>
                  <Icon size={22} strokeWidth={1.6} />
                </div>

                <div>
                  <h3>{service.title}</h3>
                  <p>{service.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className={styles.welfareCard}>
        <div className={styles.sectionHeader}>
          <h2>สิทธิ์และสวัสดิการที่รับ</h2>
        </div>

        <div className={styles.welfareList}>
          {welfares.map((item) => (
            <div key={item.title} className={styles.welfareItem}>
              <span>{item.emoji}</span>

              <div>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className={styles.warningBox}>
            <CheckCircle size={17} strokeWidth={2.2} />
            <p>
              หมายเหตุ: คลินิกนี้ไม่รับบัตรทอง (30 บาท)
              กรุณาตรวจสอบก่อนมาพบแพทย์
            </p>
          </div>
      </section>
    </div>
  );
}
