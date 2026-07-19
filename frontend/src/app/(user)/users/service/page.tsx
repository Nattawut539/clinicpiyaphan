'use client';
'use client';

import {
  CheckCircle,
  Syringe,
  Heart,
  FlaskConical,
  Droplets,
  Thermometer,
  Stethoscope,
  Activity,
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
    icon: Activity,
    title: 'ตรวจสุขภาพประจำปี',
    desc: 'ตรวจเลือด วัดความดัน ไขมัน น้ำตาล และความเสี่ยงโรคต่างๆ',
    className: styles.serviceBlue,
  },
  {
    icon: Syringe,
    title: 'ฉีดวัคซีน',
    desc: 'วัคซีนไข้หวัดใหญ่ วัคซีนพิษสุนัขบ้า และวัคซีนอื่นๆ ตามที่ต้องการ',
    className: styles.serviceViolet,
  },
  {
    icon: Heart,
    title: 'โรคเรื้อรัง',
    desc: 'ติดตามและรักษาเบาหวาน ความดัน ไขมันในเลือด อย่างต่อเนื่อง',
    className: styles.serviceRed,
  },
  {
    icon: FlaskConical,
    title: 'เจาะเลือดตรวจ',
    desc: 'ตรวจเลือดครบชุด CBC ตรวจตับ ตรวจไต และค่าต่างๆ ที่ต้องการ',
    className: styles.serviceAmber,
  },
  {
    icon: Droplets,
    title: 'น้ำเกลือ / วิตามิน',
    desc: 'ให้น้ำเกลือและวิตามินทางหลอดเลือด เพื่อฟื้นฟูร่างกายอย่างรวดเร็ว',
    className: styles.serviceCyan,
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
    emoji: '🛡️',
    title: 'ประกันสังคม',
    desc: 'รับสิทธิ์ประกันสังคมทุกกรณี ไม่มีค่าใช้จ่ายเพิ่มเติม',
  },
  {
    emoji: '📋',
    title: 'ประกันสุขภาพเอกชน',
    desc: 'รับประกันทุกบริษัท กรุณานำบัตรประกันมาด้วย',
  },
  {
    emoji: '🏛️',
    title: 'สิทธิ์ข้าราชการ',
    desc: 'รับสิทธิ์กรมบัญชีกลางและครอบครัว',
  },
  {
    emoji: '💵',
    title: 'ชำระเอง',
    desc: 'เงินสด โอนเงิน พร้อมเพย์ บัตรเครดิต/เดบิต',
  },
  {
    emoji: '⭐',
    title: 'สมาชิกคลินิก',
    desc: 'ส่วนลด 10% ทุกครั้งสำหรับผู้ลงทะเบียนสมาชิก',
  },
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

      <section className={styles.priceCard}>
        <div className={styles.priceIconBox}>
          <span>💊</span>
        </div>

        <div>
          <h3>ค่าบริการ</h3>
          <p>
            ค่าตรวจพื้นฐานเริ่มต้นที่ <strong>200 บาท</strong>{' '}
            ขึ้นอยู่กับประเภทการรักษาและยาที่สั่ง
            ราคาโปร่งใสไม่มีค่าใช้จ่ายแอบแฝง
          </p>
        </div>
      </section>

      <section className={styles.welfareCard}>
        <div className={styles.sectionHeader}>
          <h2>สิทธิ์และสวัสดิการที่รับ</h2>

          <div className={styles.warningBox}>
            <CheckCircle size={17} strokeWidth={2.2} />
            <p>
              หมายเหตุ: คลินิกนี้ไม่รับบัตรทอง (30 บาท)
              กรุณาตรวจสอบก่อนมาพบแพทย์
            </p>
          </div>
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
      </section>
    </div>
  );
}
