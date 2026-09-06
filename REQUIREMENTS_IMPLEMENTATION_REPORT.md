# รายงานการพัฒนา Requirement จาก Advisor Comment logbooks4

วันที่ตรวจสอบ: 27 สิงหาคม 2569 (Asia/Bangkok)

## ผลการพัฒนา

### 1. วงจรสถานะบัญชีและคำร้องหยุดใช้งาน

- เพิ่มสถานะ `active`, `pending_verification`, `deactivated`, `suspended`, `duplicate`, `unclaimed`
- เพิ่ม `session_version` และตรวจสถานะ/เวอร์ชันกับฐานข้อมูลทุก private request
- ผู้ใช้ส่งคำร้อง `account_deactivation` จากหน้า `/users/help`
- Admin อนุมัติหรือปฏิเสธคำร้อง พร้อมบันทึกเหตุผลและวิธีตรวจตัวตน
- เมื่ออนุมัติ ระบบปิดบัญชี เพิ่ม session version และจัดการนัดที่ยังรอดำเนินการในอนาคต
- Super Admin เปิดขั้นตอนใช้งานบัญชีกลับคืนได้ โดยผู้ป่วยต้องยืนยัน OTP ใหม่

### 2. Email Verification และ OAuth Profile Completion

- สมัครใหม่เป็น `pending_verification`
- OTP 6 หลักเก็บเฉพาะ HMAC hash, อายุ 15 นาที, ใช้ครั้งเดียว, ผิดได้สูงสุด 5 ครั้ง
- ส่งใหม่ได้หลัง 60 วินาทีและมี HTTP rate limit
- เพิ่มหน้า `/verify-email`
- Google Login ตรวจ `email_verified` และบันทึกแหล่งที่มา
- OAuth user ที่โปรไฟล์ไม่ครบถูกส่งไป `/users/userprofile?complete=1`
- Backend ปฏิเสธการจองหากยังไม่ยืนยันอีเมลหรือโปรไฟล์ผู้ป่วยไม่ครบ

### 3. Walk-in Claim

- ผู้ป่วย Walk-in ใหม่ถูกสร้างเป็น `unclaimed` และ `registration_source=walkin`
- ค้นผู้ป่วยเดิมด้วยเลขบัตรประชาชน ไม่จับคู่ด้วยชื่ออย่างเดียว
- ตรวจเลขบัตร 13 หลักและเพิ่ม unique index เมื่อข้อมูลเดิมไม่มีเลขซ้ำ
- หากผู้ป่วย `unclaimed` สมัครด้วยข้อมูลที่ตรง ระบบ Claim ผู้ป่วยเดิมแทนการสร้างประวัติใหม่

### 4. รหัสเครื่องชั่งและสถานะบน Header

- รายการนัดของผู้ใช้ส่ง `queue_number` จริงและสถานะรหัสจาก Backend
- หน้า “คิวของฉัน” แสดงส่วนรหัสใน `metaRow`
- ผู้ใช้ขอรหัสใหม่ได้เฉพาะนัดของตนที่อนุมัติแล้ว รหัสเดิมถูกยกเลิก
- รหัสจริงส่งกลับเฉพาะ response ครั้งนั้น ฐานข้อมูลเก็บเฉพาะ hash
- เพิ่มวงกลมสถานะบัญชีมุมล่างขวาของรูปโปรไฟล์

### 5. Admin Check-in

- เพิ่มการค้นหานัดวันนี้จากเลขบัตรประชาชน + ชื่อ + นามสกุล
- ผลการค้นหาแสดงอีเมลแบบปิดบัง
- นัด `approved` สามารถ Check-in และออกรหัสเครื่องชั่งอายุ 15 นาทีจากเวลาออกจริง
- นัด `pending` ต้องอนุมัติก่อน และนัดที่ยกเลิกต้องใช้ Walk-in
- ป้องกัน Check-in เพื่อออกรหัสซ้ำหลังมีผลชั่งแล้ว
- บันทึกผู้ตรวจ วิธีตรวจ วันเวลา เหตุผล และอายุรหัสใน `patient_checkins`
- รหัสจริงไม่ถูกบันทึกใน Audit Log

## Schema ที่เพิ่ม

- คอลัมน์สถานะและ session ใน `clinic.users`
- ตาราง `clinic.email_verification_otps`
- ตาราง `clinic.patient_checkins`
- คอลัมน์ workflow ใน `clinic.help_requests`
- คอลัมน์ผู้สร้างและเหตุผลใน `clinic.appointment_access_codes`
- index ค้นหา/ป้องกันเลขบัตรประชาชนซ้ำ

Migration ทำงานแบบ `IF NOT EXISTS` และถูกรันระหว่าง backend startup หลัง queue schema migration

## หลักฐานการตรวจสอบ

คำสั่งและผลล่าสุด:

```text
node --check [backend files]                PASS
npm.cmd run test:requirements-schema       PASS
npm.cmd run test:requirements-api          PASS
npm.cmd run test:requirements-workflow     PASS
npm.cmd run build (frontend)               PASS
git diff --check                           PASS
```

ผล workflow integration:

```json
{
  "email_verification": 200,
  "deactivation_request": 200,
  "admin_approval": 200,
  "revoked_session": 403,
  "final_account_status": "deactivated",
  "synthetic_rows_removed": true
}
```

ชุดทดสอบ workflow สร้างเฉพาะข้อมูลสังเคราะห์และตรวจยืนยันการล้างข้อมูลหลังทดสอบ

## ข้อสังเกตก่อน Production

- Production ต้องใช้ PostgreSQL role แบบ non-superuser ตาม `DEPLOYMENT.md`; environment ปัจจุบันแจ้งเตือนว่าใช้ `postgres`
- ต้องทดสอบการส่งอีเมลกับ SMTP/โดเมนจริงอีกครั้งก่อนเปิดใช้ เพราะ integration test ตรวจ logic OTP โดยไม่ส่งอีเมลไปยังผู้รับจริง
- Frontend build ผ่านโดยมี warning เดิมเรื่อง React Hook dependencies และ `<img>` แต่ไม่มี TypeScript, ESLint หรือ build error
