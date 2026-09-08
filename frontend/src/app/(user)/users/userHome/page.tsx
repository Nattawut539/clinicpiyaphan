'use client';

import {
    Phone,
    MapPin,
    Clock,
    ChevronRight,
    CalendarCheck,
    Stethoscope,
    Mail,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Swal from 'sweetalert2';
import styles from './userHome.module.css';

type UserPageId = 'appointment' | 'services';

const clinicName = 'คลินิกหมอปิยะพันธ์';
const clinicAddress =
    'คลินิกหมอปิยะพันธ์ ตำบลนาเชือก อำเภอนาเชือก จังหวัดมหาสารคาม 44170';
const phoneNumber = '086-856-8646';
const email = 'clinic.piyaphan@gmail.com';
const clinicLatitude = '15.79998408639681';
const clinicLongitude = '103.0360518657376';
const clinicCoordinates = `${clinicLatitude},${clinicLongitude}`;
const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY;
const googleMapsQuery = `${clinicName} ${clinicAddress}`;
const googleMapsEmbedUrl = googleMapsApiKey
    ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(googleMapsApiKey)}&q=${encodeURIComponent(googleMapsQuery)}&center=${clinicCoordinates}&zoom=16`
    : `https://www.google.com/maps?q=${clinicCoordinates}&z=16&output=embed`;
const googleMapsAppUrl = `https://www.google.com/maps/search/?api=1&query=${clinicCoordinates}`;

export default function UserHomePage() {
    const router = useRouter();

    useEffect(() => {
        const completion = sessionStorage.getItem('lineProfileCompleted');
        if (!completion) return;
        sessionStorage.removeItem('lineProfileCompleted');
        void Swal.fire({
            icon: 'success',
            title: 'ตั้งค่าบัญชีสำเร็จ',
            text: completion === 'email-sent'
                ? 'เข้าสู่ระบบเรียบร้อย และส่งอีเมลแจ้งเตือนการเพิ่มช่องทางเข้าสู่ระบบแล้ว'
                : 'เข้าสู่ระบบเรียบร้อย คุณสามารถใช้ LINE หรืออีเมลพร้อมรหัสผ่านได้ในครั้งถัดไป',
            confirmButtonText: 'เริ่มใช้งาน',
            confirmButtonColor: '#0f9f8f',
        });
    }, []);

    const onNavigate = (page: UserPageId) => {
        if (page === 'appointment') {
            router.push('/users/pending');
            return;
        }

        if (page === 'services') {
            router.push('/users/service');
        }
    };

    const services = [
        'ตรวจโรคทั่วไป',
        'ดูแลอย่างต่อเนื่อง',
        'ตรวจอาการเจ็บป่วยเบื้องต้น พร้อมคำแนะนำที่เหมาะสม',
        'ติดตามอาการและดูแลสุขภาพของคนทุกวัย',
    ];

    const contacts = [
        {
            icon: Phone,
            label: 'โทรศัพท์',
            value: phoneNumber,
            sub: 'สอบถามและนัดหมาย',
            className: styles.contactGreen,
        },
        {
            icon: Mail,
            label: 'อีเมล',
            value: email,
            sub: 'ส่งข้อความถึงคลินิก',
            className: styles.contactLime,
        },
        {
            icon: MapPin,
            label: 'ที่ตั้ง',
            value: 'ต.นาเชือก อ.นาเชือก',
            sub: 'จ.มหาสารคาม',
            className: styles.contactBlue,
        },
    ];

    const travelTags = [
        'ต.นาเชือก',
        'อ.นาเชือก',
        'จ.มหาสารคาม 44170',
    ];

    return (
        <div className={styles.page}>
            <section className={styles.heroCard}>
                <div className={styles.heroTopLine} />

                <div className={styles.heroContent}>
                    <div className={styles.heroGrid}>
                        <div className={styles.heroLeft}>
                            <div className={styles.openBadge}>
                                <span />
                                <p>พร้อมดูแลคุณเมื่อคุณต้องการ</p>
                            </div>

                            <h1 className={styles.heroTitle}>
                                {clinicName}
                                <br className={styles.mobileBreak} /> ดูแลทุกความกังวล
                            </h1>

                            <p className={styles.heroDescription}>
                                บริการตรวจรักษาโรคทั่วไปด้านสุขภาพ
                                โดยแพทย์ที่เชียวชาญที่พร้อมดูแลคุณอย่างใกล้ชิด
                            </p>

                            <div className={styles.heroActions}>
                                <button
                                    type="button"
                                    onClick={() => onNavigate('appointment')}
                                    className={styles.primaryButton}
                                >
                                    <CalendarCheck size={16} />
                                    นัดหมายเข้ารับบริการ
                                </button>

                                <button
                                    type="button"
                                    onClick={() => onNavigate('services')}
                                    className={styles.secondaryButton}
                                >
                                    ดูบริการ
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        </div>

                        <div className={styles.quickInfo}>
                            <div className={styles.quickInfoItem}>
                                <Clock className={styles.quickInfoIcon} />
                                <div>
                                    <p>จันทร์-เสาร์ 07.00-10.00 / 16.00-19.00 น.</p>
                                    <span className={styles.closedText}>อาทิตย์ 07.00-10.00 น.</span>
                                </div>
                            </div>

                            <div className={styles.quickInfoItem}>
                                <Phone className={styles.quickInfoIcon} />
                                <div>
                                    <p>{phoneNumber}</p>
                                    <span>สอบถามรายละเอียดหรือนัดหมาย</span>
                                </div>
                            </div>

                            <div className={styles.quickInfoItem}>
                                <MapPin className={styles.quickInfoIcon} />
                                <div>
                                    <p>ต.นาเชือก อ.นาเชือก</p>
                                    <span>จังหวัดมหาสารคาม</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section className={styles.twoColumnGrid}>
                <div className={styles.card}>
                    <div className={styles.cardTitleRow}>
                        <Stethoscope size={20} className={styles.cardIcon} strokeWidth={1.5} />
                        <h3>บริการของเรา</h3>
                    </div>

                    <div className={styles.serviceList}>
                        {services.map((service) => (
                            <div key={service} className={styles.serviceItem}>
                                <span />
                                <p>{service}</p>
                            </div>
                        ))}

                        <button
                            type="button"
                            onClick={() => onNavigate('services')}
                            className={styles.textButton}
                        >
                            ดูทั้งหมด <ChevronRight size={14} />
                        </button>
                    </div>
                </div>

                <div className={styles.card}>
                    <h3 className={styles.cardTitle}>ช่องทางติดต่อ</h3>

                    <div className={styles.contactList}>
                        {contacts.map((contact) => {
                            const Icon = contact.icon;

                            return (
                                <div
                                    key={contact.label}
                                    className={`${styles.contactItem} ${contact.className}`}
                                >
                                    <Icon className={styles.contactIcon} />
                                    <div>
                                        <p>{contact.value}</p>
                                        <span>
                                            {contact.label} · {contact.sub}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>
            <section className={styles.ctaCard}>
                <div>
                    <h3>พร้อมดูแลสุขภาพของคุณและครอบครัว</h3>
                    <p>จองคิวออนไลน์ล่วงหน้า เพื่อประหยัดเวลารอรับบริการ</p>
                </div>

                <button
                    type="button"
                    onClick={() => onNavigate('appointment')}
                    className={styles.ctaButton}
                >
                    <CalendarCheck size={16} />
                    จองเลย
                </button>
            </section>

            <section className={styles.mapCard}>
                <div className={styles.mapBox}>
                    <div className={styles.mapGrid}>
                        <iframe
                            className={styles.googleMapFrame}
                            title={`Google Maps - ${clinicName}`}
                            src={googleMapsEmbedUrl}
                            loading="lazy"
                            allowFullScreen
                            referrerPolicy="no-referrer-when-downgrade"
                        />

                        <a
                            className={styles.mapOpenLink}
                            href={googleMapsAppUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="เปิดตำแหน่งคลินิกใน Google Maps"
                        >
                            <MapPin size={15} />
                            เปิดแผนที่
                        </a>

                        {[0, 20, 40, 60, 80].map((top) => (
                            <div
                                key={`h-${top}`}
                                className={styles.mapLineHorizontal}
                                style={{ top: `${top}%` }}
                            />
                        ))}

                        {[0, 16, 33, 50, 66, 83].map((left) => (
                            <div
                                key={`v-${left}`}
                                className={styles.mapLineVertical}
                                style={{ left: `${left}%` }}
                            />
                        ))}

                        <div className={styles.roadHorizontal} />
                        <div className={styles.roadVertical} />

                        <span className={styles.roadLabel}>อ.นาเชือก</span>

                        <div className={styles.mapPin}>
                            <div className={styles.mapPinCircle}>
                                <span>+</span>
                            </div>
                            <div className={styles.mapPinArrow} />
                        </div>

                        <div className={styles.mapClinicLabel}>
                            <span>{clinicName}</span>
                        </div>
                    </div>

                    <div className={styles.mapNote}>
                        <span>แผนที่โดยประมาณ</span>
                    </div>
                </div>

                <div className={styles.addressBox}>
                    <h3>ติดต่อและเดินทาง</h3>

                    <div className={styles.addressRow}>
                        <MapPin className={styles.addressIcon} />
                        <p>{clinicAddress}</p>
                    </div>

                    <div className={styles.travelTags}>
                        {travelTags.map((tag) => (
                            <span key={tag}>{tag}</span>
                        ))}
                    </div>
                </div>
            </section>
        </div>
    );
}
