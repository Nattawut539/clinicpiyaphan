'use client';

import { useEffect, useRef, useState } from 'react';
import Cookies from '@/lib/cookies';
import { API_BASE } from '@/lib/api';
import styles from './consent.module.css';

const CONSENT_VERSION = '2026-09-18';

export default function MedicalConsentPage() {
    const dialog = useRef<HTMLDialogElement>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => { dialog.current?.showModal(); }, []);

    async function decide(accepted: boolean) {
        if (busy) return;
        setBusy(true);
        setError('');
        try {
            const response = await fetch(`${API_BASE}/users/medical-consent`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Cookies.get('userToken') || ''}` },
                body: JSON.stringify({ accepted, version: CONSENT_VERSION }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'บันทึกความยินยอมไม่สำเร็จ กรุณาลองอีกครั้ง');
            if (!accepted) {
                Cookies.remove('userToken');
                localStorage.removeItem('user');
            }
            window.location.replace(accepted ? '/users/userHome' : '/userlogin');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองอีกครั้ง');
            setBusy(false);
        }
    }

    return <main className={styles.page}>
        <dialog ref={dialog} className={styles.dialog} aria-labelledby="consent-title" onCancel={(event) => event.preventDefault()}>
            <h1 id="consent-title">ความยินยอมในการใช้ข้อมูลส่วนบุคคลและข้อมูลสุขภาพ</h1>
            <p>ก่อนเข้าใช้งานเว็บไซต์คลินิกหมอปิยะพันธ์ โปรดอ่านรายละเอียดและเลือกด้วยตนเอง</p>
            <p>คลินิกขอเก็บรวบรวมและใช้ข้อมูลระบุตัวตน ข้อมูลติดต่อ โรคประจำตัว ประวัติแพ้ยาและอาหาร อาการ ผลวัดสัญญาณชีพ และประวัติการรักษาที่คุณให้ไว้หรือเกิดจากการรับบริการ เพื่อจัดการนัดหมาย คิว ตรวจรักษา ติดตามการรักษา และจัดทำเวชระเบียน</p>
            <p>ข้อมูลส่วนบุคคลและข้อมูลทางการแพทย์ของคุณจะเปิดเผยให้แพทย์และเจ้าหน้าที่ของคลินิกที่ได้รับสิทธิ์เข้าถึงตามหน้าที่ เพื่อให้บริการดังกล่าว โดยไม่ได้เป็นการยินยอมให้เผยแพร่ข้อมูลต่อสาธารณะ</p>
            <p>เมื่อเลือก “ยินยอมและเข้าใช้งาน” ระบบจะบันทึกวันเวลาและฉบับของประกาศนี้กับบัญชีของคุณ หากเลือก “ไม่ยินยอม” ระบบจะออกจากระบบและกลับไปหน้าเข้าสู่ระบบ โดยยังเข้าใช้บริการผ่านเว็บไซต์ไม่ได้ คุณสามารถติดต่อคลินิกเพื่อสอบถามการรับบริการหรือขอถอนความยินยอมได้ที่ 086-856-8646 หรือ clinic.piyaphan@gmail.com</p>
            <p className={styles.version}>ประกาศฉบับ {CONSENT_VERSION}</p>
            <p><a href="/privacy-policy" target="_blank" rel="noopener noreferrer">อ่านนโยบายความเป็นส่วนตัวฉบับเต็ม (เปิดหน้าต่างใหม่)</a></p>
            {error && <p role="alert" className={styles.error}>{error}</p>}
            <div className={styles.actions}>
                <button autoFocus disabled={busy} onClick={() => decide(false)}>ไม่ยินยอม</button>
                <button className={styles.accept} disabled={busy} onClick={() => decide(true)}>{busy ? 'กำลังบันทึก...' : 'ยินยอมและเข้าใช้งาน'}</button>
            </div>
        </dialog>
    </main>;
}
