# รายงานตรวจความพร้อมระบบสำหรับอาจารย์ที่ปรึกษา

วันที่ตรวจและแก้ไข: 18 สิงหาคม 2569 (Asia/Bangkok)

## สรุปหลังแก้ไข

| Requirement | ผลล่าสุด | หลักฐาน |
|---|---|---|
| สร้างผู้ป่วย → บันทึกเวชระเบียน → เปิดประวัติหลัง refresh | ผ่าน | HTTP 200 ทุกขั้น และ record เดิมยังอยู่หลังอ่านซ้ำ |
| จอง Slot เดียวกันพร้อมกันสองเครื่อง | ผ่าน | ได้ 201 หนึ่งคำขอ, 409 หนึ่งคำขอ และมี active row เดียว |
| ผู้ใช้คนเดียวจองคนละ Slot ในวันเดียวกันพร้อมกัน | ผ่าน | ได้ 201 หนึ่งคำขอ, 409 หนึ่งคำขอ และมี active row เดียว |
| สิทธิ์ข้อมูลส่วนบุคคลและระบบหลังบ้าน | ผ่าน | ทดสอบ ownership, user/staff role, no-token และ deleted account token |
| วงจรอนุมัติและยกเลิกนัด | ผ่าน | อนุมัติ 200, ยกเลิก 200, คืน Slot, ยกเลิกคิว และลบ access code สำเร็จ |
| Audit Log ถาวร | ผ่าน | สร้าง `clinic.audit_logs`; รอบทดสอบล่าสุดบันทึก 30 events รวม denied 16 events |
| Production build | ผ่าน | Next.js build, TypeScript และ ESLint ผ่าน |

## 1. Workflow และผลทดสอบ

ผลจาก `backend/tests/advisor-audit.js`:

```json
{
  "workflow": {
    "create_patient": 200,
    "save_record": 200,
    "first_read": 200,
    "after_refresh": 200,
    "own_history": 200,
    "persisted": true
  },
  "races": {
    "two_users_same_slot": { "statuses": [201, 409], "active_rows": 1 },
    "same_user_two_slots_same_day": { "statuses": [201, 409], "active_rows": 1 }
  },
  "lifecycle": {
    "approve_status": 200,
    "access_code_after_approval": 1,
    "resend_without_email_status": 400,
    "cancel_status": 200,
    "appointment_status": "cancelled",
    "slot_status": "open",
    "queue_status": "cancelled",
    "access_code_count": 0
  }
}
```

การป้องกัน race condition ใช้สองชั้น:

1. `SELECT ... FOR UPDATE` และ partial unique index ป้องกัน active appointment ซ้ำใน Slot เดียว
2. `pg_advisory_xact_lock(user_id, service_date)` ป้องกันบัญชีเดียวจองคนละ Slot ในวันเดียวกันพร้อมกัน

## 2. Authorization และข้อมูลส่วนบุคคล

ผล Negative/Authorization Test หลังแก้:

```text
patients:                    no token=401, user=403, staff=200
medical records:             no token=401, user=403, staff=200
own appointments:            owner=200, other user=403, no token=401
approved appointments/week:  user=403, staff=200
patients-debug:              no token=401
slots seed:                  no token=401, user=403
deleted account token:       401
audit logs:                  no token=401, user=403, staff=403, Super Admin=200
```

สิ่งที่แก้แล้ว:

- ปิด IDOR ของ `/appointments/user/:userId` ด้วย token, ownership และ staff role
- `/appointments/approved-week`, `/slots/seed`, `/patients-debug` บังคับ staff ที่ backend
- เปลี่ยน route จองนัดให้ใช้ middleware กลาง ไม่ถอด JWT ซ้ำเอง
- ทุก private request ตรวจว่าบัญชียังอยู่และอ่าน role ล่าสุดจากฐานข้อมูล
- Token ของบัญชีที่ถูกลบใช้ต่อไม่ได้
- Session middleware ของ Next.js ตรวจ token/role กับ backend ไม่ได้ตรวจเพียงชื่อ cookie
- หน้ารายการนัดของผู้ใช้แนบ Authorization header แล้ว
- การสมัครทั่วไปยังบังคับ role `user`; การสร้าง staff จำกัด Super Admin

## 3. Audit Log

ตารางใหม่ `clinic.audit_logs` มีข้อมูล:

```text
audit_id, request_id, actor_user_id, actor_role,
action, entity_type, entity_id, result,
http_method, route, status_code, ip_address,
user_agent, error_code, duration_ms, created_at
```

คุณสมบัติ:

- บันทึก success/denied/error ของ mutation และการอ่านข้อมูลสำคัญ
- ทุก response มี `X-Request-ID`
- ไม่บันทึก request body, password, JWT, access code หรือข้อมูลสุขภาพลง Log
- `REVOKE ALL ... FROM PUBLIC`
- อ่าน Log ได้ผ่าน `GET /api/audit-logs` เฉพาะ Super Admin
- ตรวจสอบผ่านหน้าเว็บ `/admin/audit-logs` พร้อมค้นหา กรองผลลัพธ์ และโหลดรายการย้อนหลัง
- จำกัดผลลัพธ์สูงสุด 100 รายการต่อคำขอและรองรับ `before_id`

## 4. Database และ Configuration Hardening

- ลบ default database username/password ออกจาก runtime source
- หากไม่มี `DATABASE_URL` ระบบบังคับ `DB_USER`, `DB_NAME`, `DB_PASSWORD`
- Production บังคับ JWT secret อย่างน้อย 32 ตัวอักษรและห้ามค่า default
- Production ปฏิเสธการเริ่มระบบเมื่อ PostgreSQL runtime role เป็น Superuser
- เพิ่ม security headers และจำกัด JSON request body ที่ 1 MB
- เพิ่ม rate limit สำหรับ login, forgot-password และ access code
- `set_config` ของ RLS context เปลี่ยนเป็น transaction-local ป้องกัน context รั่วข้าม pooled connection
- เพิ่ม global JSON error handler พร้อม request ID โดยไม่ส่ง stack trace ให้ client

ข้อกำหนดก่อน deploy: ต้องสร้าง PostgreSQL role `clinic_app` แบบ non-superuser และเปลี่ยนค่าใน environment ตาม `DEPLOYMENT.md` ระบบตั้งใจไม่เปลี่ยน credential ฐานข้อมูลจริงให้อัตโนมัติเพื่อป้องกันระบบหยุดทำงาน

## 5. โครงสร้างและโค้ดสำหรับนำเสนอ

ไฟล์หลัก:

- Authorization กลาง: `backend/tools/_utils.js`
- Appointment locking/ownership: `backend/routes/appointments.js`
- Staff-only Slot: `backend/routes/slots.js`
- Persistent Audit Log: `backend/tools/audit.js`
- Super Admin Audit API: `backend/routes/audit.js`
- Security startup/config: `backend/server.js`, `backend/tools/config.js`, `backend/tools/db.js`
- Frontend session verification: `frontend/middleware.ts`
- Integration audit: `backend/tests/advisor-audit.js`
- Deployment checklist: `DEPLOYMENT.md`

คำสั่งทดสอบบน staging/local:

```powershell
$env:AUDIT_TEST_ALLOW_MUTATION='true'
npm.cmd run test:audit
```

ชุดทดสอบสร้างเฉพาะข้อมูลสังเคราะห์และล้างผู้ใช้ นัดหมาย คิว เวชระเบียน และ measurement ที่สร้างขึ้นเมื่อจบการทดสอบ
ผลรอบล่าสุดตรวจข้อมูลสังเคราะห์คงเหลือ `0` รายการ

## 6. ผล Build และข้อสังเกต

- Backend JavaScript syntax: ผ่าน
- Frontend TypeScript: ผ่าน
- ESLint ของไฟล์ที่แก้: ผ่าน
- Next.js production build: ผ่าน
- Warning ที่เหลือเป็น React Hook dependency และ `<img>` ในหน้าเดิม ไม่ใช่ authorization/build failure

สถานะพร้อมนำเสนอ: **ผ่านในส่วนโค้ดและการทดสอบ** โดยก่อน deploy จริงต้องตั้ง dedicated non-superuser database role และ production secrets ตาม checklist
