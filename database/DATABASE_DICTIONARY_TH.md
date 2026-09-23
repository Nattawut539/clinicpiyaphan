# โครงสร้างฐานข้อมูลระบบคลินิก

ฐานข้อมูลใช้ PostgreSQL ชื่อแนะนำ `projectfinal` และใช้ schema หลักชื่อ `clinic`
ไฟล์ติดตั้ง: `database/schema.sql`

## แชทผู้ใช้–ทีมคลินิก

| ตาราง | คอลัมน์สำคัญ | ความหมาย |
|---|---|---|
| `chat_conversations` | `patient_user_id` PK/FK → users, `created_at`, `updated_at` | ผู้ใช้หนึ่งคนมีบทสนทนาร่วมกับทีมคลินิกหนึ่งรายการ |
| `chat_messages` | `message_id` PK, `patient_user_id` FK, `sender_user_id` FK | ลำดับข้อความ บทสนทนา และบัญชีผู้ส่ง |
| `chat_messages` | `sender_first_name`, `sender_last_name`, `sender_role` | ชื่อ–นามสกุลและสิทธิ์ของผู้ส่ง ณ เวลาส่ง |
| `chat_messages` | `client_id` uuid, `body` text, `created_at` | รหัสป้องกันการส่งซ้ำ เนื้อหา 1–4,000 ตัวอักษร และวันเวลา |
| `chat_reads` | `patient_user_id` + `reader_user_id` PK, `last_message_id` | ข้อความล่าสุดที่แต่ละบัญชีอ่านถึง ไม่ลดค่าเมื่ออ่านประวัติเก่า |

`UNIQUE(sender_user_id, client_id)` ป้องกันข้อความซ้ำจากการลองส่งใหม่ มีดัชนี `(patient_user_id, message_id DESC)` สำหรับโหลดประวัติ ทุกตารางเปิด RLS และ policy `chat_participants` จำกัดผู้ใช้ตาม `app.user_id` และเจ้าหน้าที่เฉพาะ admin/doctor/superadmin ชื่อผู้ส่งมาจากฐานข้อมูล ไม่รับจาก browser

## สัญลักษณ์

- **PK** = Primary Key (คีย์หลัก)
- **FK** = Foreign Key (คีย์เชื่อมไปยังอีกตาราง)
- **UQ** = Unique (ค่าห้ามซ้ำ)
- `NULL` = ไม่จำเป็นต้องมีค่า
- ชื่อ `avaliable_date` สะกดตาม backend เดิม จึงคงไว้เพื่อไม่ให้ API พัง โดยหมายถึงช่วงเวลา `morning` หรือ `afternoon`

## 1. กลุ่มบัญชีและข้อมูลบุคคล

### `clinic.users` — บัญชีสำหรับเข้าสู่ระบบ

คีย์หลัก: `user_id`

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | user_id | integer | รหัสบัญชี |
| UQ | username | varchar(50) | ชื่อผู้ใช้สำหรับ login |
| UQ | email | varchar(60) | อีเมลบัญชี |
|  | password_hash | text | รหัสผ่านที่ hash แล้ว |
|  | role | user_role | สิทธิ์: super_admin/admin/doctor/assistant/user |
| UQ | google_id | varchar(50) | รหัสบัญชี Google OAuth |
| UQ | line_id | varchar(50) | รหัสบัญชี LINE OAuth |
|  | created_at | timestamp | วันที่สร้างบัญชี |
|  | last_login_at | timestamp | เวลา login ล่าสุด |
|  | account_status | varchar(32) | active/pending_verification/deactivated/suspended/duplicate/unclaimed |
|  | email_verified_at | timestamptz | เวลาที่ยืนยันอีเมลแล้ว |
|  | profile_completed_at | timestamptz | เวลาที่กรอกประวัติครบ |
|  | medical_consent_at | timestamptz | เวลาที่ผู้ใช้ยินยอมใช้ข้อมูลสุขภาพ; NULL หากยังไม่ยินยอม |
|  | medical_consent_version | text | รุ่นข้อความยินยอมที่ผู้ใช้ยอมรับ |
|  | registration_source | varchar(32) | แหล่งสมัคร เช่น local/google/line/walkin |
|  | status_reason | text | เหตุผลที่เปลี่ยนสถานะบัญชี |
|  | status_changed_at | timestamptz | เวลาเปลี่ยนสถานะ |
| FK | status_changed_by | integer | ผู้ดูแลที่เปลี่ยนสถานะ → users.user_id |
|  | deactivated_at | timestamptz | เวลาปิดบัญชี |
|  | session_version | integer | รุ่นของ session ใช้ยกเลิก token เก่า |

### `clinic.user_details` — ประวัติผู้ป่วย/บุคลากร

คีย์หลัก: `detail_id`; ความสัมพันธ์กับ `users` เป็น 1:1 ผ่าน `user_id`

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | detail_id | integer | รหัสข้อมูลรายละเอียด |
| FK, UQ | user_id | integer | เจ้าของข้อมูล → users.user_id |
| UQ* | national_id | varchar(20) | เลขบัตรประชาชน (unique เมื่อมีค่า) |
|  | first_name | varchar(100) | ชื่อ |
|  | last_name | varchar(100) | นามสกุล |
|  | birth_date | date | วันเกิด |
|  | profile_image | text | URL/ตำแหน่งรูปโปรไฟล์ |
|  | gender | varchar(20) | เพศ |
|  | blood_type | varchar(2) | กรุ๊ปเลือด |
|  | address | text | ที่อยู่ |
| FK | province_code | varchar(10) | จังหวัด → provinces.province_code |
|  | ethnicity | varchar(10) | เชื้อชาติ |
|  | nationality | varchar(10) | สัญชาติ |
|  | phone | varchar(10) | เบอร์โทรศัพท์ |
|  | emergency_phone | varchar(10) | เบอร์ติดต่อฉุกเฉิน |
|  | email | varchar(50) | อีเมลติดต่อในโปรไฟล์ |
|  | congenital_disease | text | โรคประจำตัว |
|  | drug_allergy | text | ประวัติแพ้ยา |
|  | food_allergy | text | ประวัติแพ้อาหาร |
|  | position | text | ตำแหน่งบุคลากร |
|  | license_no | varchar(50) | เลขใบประกอบวิชาชีพ |
|  | created_at | timestamp | วันที่สร้าง |
|  | updated_at | timestamp | วันที่แก้ไขล่าสุด |
|  | title | varchar(20) | คำนำหน้าชื่อ |
|  | patient_code | text | รหัสผู้ป่วยที่ระบบสร้างจาก user_id |

### `clinic.provinces` — ข้อมูลอ้างอิงจังหวัด

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | province_code | varchar(10) | รหัสจังหวัด |
|  | name_th | varchar(50) | ชื่อจังหวัดภาษาไทย |
|  | name_en | varchar(50) | ชื่อจังหวัดภาษาอังกฤษ |
|  | region | varchar(50) | ภูมิภาค |
|  | updated_at | timestamp | วันที่แก้ไขล่าสุด |

### `clinic.email_verification_otps` — OTP ยืนยันอีเมล

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | verification_id | bigint | รหัสรายการ OTP |
| FK | user_id | integer | บัญชีผู้รับ OTP → users.user_id |
|  | token_hash | varchar(64) | ค่า hash ของ OTP (ไม่เก็บ OTP ตรง ๆ) |
|  | expires_at | timestamptz | เวลาหมดอายุ |
|  | used_at | timestamptz | เวลาที่ใช้สำเร็จ |
|  | attempt_count | integer | จำนวนครั้งที่กรอกผิด |
|  | last_sent_at | timestamptz | เวลาส่งล่าสุด ใช้ควบคุม resend |
|  | created_at | timestamptz | เวลาสร้างรายการ |

### `clinic.password_reset_otps` — OTP รีเซ็ตรหัสผ่านที่ backend ปัจจุบันใช้

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | id | integer | รหัสรายการ |
|  | email | varchar(100) | อีเมลผู้ขอรีเซ็ต |
|  | otp | varchar(6) | OTP 6 หลัก |
|  | token | text | token หลังยืนยัน OTP |
|  | expires_at | timestamp | เวลาหมดอายุ |
|  | created_at | timestamp | เวลาสร้าง |

### `clinic.password_resets` — token รีเซ็ตรหัสผ่านแบบ hash (รองรับ workflow เดิม/อนาคต)

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | reset_id | integer | รหัสคำขอ |
| FK | user_id | integer | เจ้าของคำขอ → users.user_id |
|  | token_hash | text | hash ของ reset token |
|  | expires_at | timestamp | เวลาหมดอายุ |
|  | used | boolean | ใช้ token แล้วหรือไม่ |
|  | created_at | timestamp | เวลาสร้าง |

## 2. กลุ่มนัดหมายและคิว

### `clinic.appointment_slot_templates` — แม่แบบช่วงเวลาตรวจ

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | template_id | integer | รหัสแม่แบบ |
| UQ* | avaliable_date | varchar(20) | ช่วงเช้า/บ่าย (unique ร่วมกับ hour_of_day) |
| UQ* | hour_of_day | smallint | ชั่วโมงเริ่มตรวจ 0–23 |

### `clinic.appointment_slots` — ช่องเวลาที่เปิดให้จองจริง

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | slot_id | integer | รหัสช่องเวลา |
| UQ* | service_date | date | วันที่ให้บริการ |
| UQ* | avaliable_date | varchar(20) | ช่วงเช้าหรือบ่าย |
| UQ* | hour_of_day | smallint | ชั่วโมงเริ่มตรวจ |
| FK | template_id | integer | แม่แบบเวลา → appointment_slot_templates.template_id |
|  | notes | text | หมายเหตุช่องเวลา |
|  | status | slot_status | open/locked/closed |
|  | start_ts | timestamp | วันเวลาเริ่ม (generated) |
|  | bookable_until | timestamp | เวลาสิ้นสุดการจอง (generated) |

`service_date + avaliable_date + hour_of_day` เป็น unique ร่วมกัน

### `clinic.appointments` — รายการนัดหมาย

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | appointment_id | integer | รหัสนัดหมาย |
| FK | user_id | integer | ผู้ป่วยที่นัด → users.user_id |
| FK | slot_id | integer | ช่องเวลาที่จอง → appointment_slots.slot_id |
|  | status | varchar(20) | pending/approved/rejected/cancelled/completed/no_show |
|  | created_at | timestamp | เวลาสร้างนัด |
|  | action_taken | boolean | เจ้าหน้าที่ดำเนินการแล้วหรือไม่ |
|  | description | text | รายละเอียดอาการ/เหตุผลนัด |
|  | service_type | varchar(100) | ประเภทบริการ |
|  | cancellation_reason | text | เหตุผลยกเลิก |

Partial unique index ป้องกันการมีนัด active มากกว่า 1 รายการใน slot เดียว

### `clinic.queue_tickets` — บัตรคิวออนไลน์และ Walk-in

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | queue_id | integer | รหัสคิวภายใน |
| UQ* | queue_number | varchar(20) | หมายเลขคิว เช่น A001/B001 (unique ต่อวันเมื่อไม่ยกเลิก) |
|  | prefix | char(1) | A=นัดออนไลน์, B=Walk-in |
|  | numeric_no | integer | ลำดับคิวตัวเลข |
|  | service_date | date | วันที่รับบริการ |
|  | avaliable_date | varchar(20) | ช่วงเช้า/บ่าย |
|  | source | queue_source | kiosk/online/staff |
| FK | appointment_id | integer | นัดที่เป็นต้นทาง → appointments.appointment_id |
| FK | user_id | integer | เจ้าของคิว → users.user_id |
|  | service_type | varchar(50) | ประเภทบริการ |
|  | status | queue_status | waiting/called/skipped/served/cancelled/no_show |
|  | issued_at | timestamp | เวลาออกบัตรคิว |
|  | called_at | timestamp | เวลาเรียกคิว |
|  | served_at | timestamp | เวลาให้บริการเสร็จ |
|  | skipped_at | timestamp | เวลาข้ามคิว |
|  | window_id | varchar(20) | ช่องบริการ |
|  | created_at | timestamptz | เวลาสร้างข้อมูล |

### `clinic.appointment_access_codes` — รหัสเข้าเครื่องชั่ง/วัดสัญญาณชีพ

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | access_code_id | bigint | รหัสรายการ |
| FK, UQ | appointment_id | integer | นัดหมาย → appointments.appointment_id |
| FK, UQ | queue_id | integer | คิว → queue_tickets.queue_id |
| UQ | code_hash | varchar(64) | hash ของรหัสใช้งาน |
|  | used_at | timestamptz | เวลาที่ใช้รหัสแล้ว |
|  | created_at | timestamptz | เวลาออกรหัส |
|  | expires_at | timestamptz | เวลาหมดอายุ (ปกติ 15 นาที) |
| FK | issued_by | integer | เจ้าหน้าที่ผู้ออกรหัส → users.user_id |
|  | issue_reason | varchar(80) | เหตุผลที่ออก/ออกใหม่ |
|  | code_ciphertext | text | รหัสที่เข้ารหัสแล้วสำหรับ workflow ที่ต้องส่งซ้ำ |

### `clinic.patient_checkins` — หลักฐานการ Check-in โดยเจ้าหน้าที่

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | checkin_id | bigint | รหัส check-in |
| FK, UQ | appointment_id | integer | นัดหมาย (check-in ได้ครั้งเดียว) |
| FK | user_id | integer | ผู้ป่วย → users.user_id |
| FK | verified_by_user_id | integer | เจ้าหน้าที่ผู้ตรวจตัวตน → users.user_id |
|  | verification_method | varchar(80) | วิธีตรวจตัวตน |
|  | verification_note | text | หมายเหตุการตรวจ |
|  | verified_at | timestamptz | เวลายืนยันตัวตน |
|  | code_issued_at | timestamptz | เวลาออกรหัสเครื่องชั่ง |
|  | code_expires_at | timestamptz | เวลารหัสหมดอายุ |
|  | reason | varchar(80) | เหตุผลของการ check-in โดยเจ้าหน้าที่ |
|  | created_at | timestamptz | เวลาสร้าง |

## 3. กลุ่มการตรวจรักษา

### `clinic.measurements` — ผลวัดร่างกายและสัญญาณชีพ

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | measurement_id | integer | รหัสผลวัด |
|  | queue_number | varchar(20) | หมายเลขคิวที่แสดง |
|  | weight | numeric(5,2) | น้ำหนัก กก. |
|  | height | numeric(5,2) | ส่วนสูง ซม. |
|  | bmi | numeric(5,2) | ดัชนีมวลกาย |
|  | created_at | timestamp | เวลาวัด |
| FK | queue_id | integer | คิวเจ้าของผลวัด → queue_tickets.queue_id |
|  | chief_complaint | text | อาการสำคัญ |
|  | temperature | numeric(4,1) | อุณหภูมิร่างกาย °C |
|  | heart_rate | integer | ชีพจร ครั้ง/นาที |
|  | respiratory_rate | integer | อัตราหายใจ ครั้ง/นาที |
|  | systolic_bp | integer | ความดันตัวบน mmHg |
|  | diastolic_bp | integer | ความดันตัวล่าง mmHg |

### `clinic.medical_records` — เวชระเบียน

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | record_id | integer | รหัสเวชระเบียน |
| FK | user_id | integer | ผู้ป่วย → users.user_id |
|  | visit_date | timestamp | วันเวลารับการรักษา |
|  | symptoms | text | อาการ |
|  | diagnosis | text | การวินิจฉัย |
|  | treatment | text | การรักษา |
|  | medications | jsonb | รายการยาในรูป JSON array |
|  | notes | text | หมายเหตุแพทย์ |
| FK | doctor_id | integer | แพทย์ผู้บันทึก → users.user_id |
|  | follow_up_date | date | วันนัดติดตาม |
|  | visibility | record_visibility | private/team/public |
|  | created_at | timestamp | เวลาสร้าง |
|  | updated_at | timestamp | เวลาแก้ไขล่าสุด |
|  | body_drawing_data | text | ข้อมูลตำแหน่งอาการบนภาพร่างกาย |

### `clinic.user_feedbacks` — แบบประเมินหลังรับบริการ

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | feedback_id | integer | รหัสแบบประเมิน |
| FK | user_id | integer | ผู้ประเมิน → users.user_id |
|  | score | integer | คะแนน 1–5 |
|  | liked | boolean | ชอบ/ไม่ชอบบริการ |
|  | category | text | หมวดที่ประเมิน |
|  | comment | text | ความคิดเห็น |
|  | created_at | timestamp | เวลาส่งแบบประเมิน |
| FK | record_id | integer | เวชระเบียนที่ประเมิน → medical_records.record_id |
|  | visit_date | date | วันที่มารับบริการ |
|  | service_type | text | ประเภทบริการ |

ผู้ใช้ส่ง feedback ได้หนึ่งรายการต่อหนึ่งเวชระเบียน (`user_id + record_id` unique)

## 4. กลุ่มช่วยเหลือและแจ้งเตือน

### `clinic.help_requests` — คำร้องช่วยเหลือ/คำขอปิดบัญชี/FAQ

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | help_id | integer | รหัสคำร้อง |
| FK | user_id | integer | ผู้ส่งคำร้อง → users.user_id |
|  | title | text | หัวข้อ |
|  | description | text | รายละเอียด |
|  | updated_at | timestamp | เวลาแก้ไขล่าสุด |
|  | created_at | timestamp | เวลาสร้าง |
|  | category | text | หมวดคำร้อง |
|  | tags | text[] | ป้ายกำกับ |
|  | visibility | record_visibility | private/shared; shared ใช้แสดง FAQ |
|  | view_count | integer | จำนวนครั้งที่เปิดอ่าน |
| FK | related_feedback_id | integer | feedback ที่เกี่ยวข้อง |
|  | request_status | varchar(24) | pending/approved/rejected/resolved |
| FK | reviewed_by | integer | ผู้ตรวจคำร้อง → users.user_id |
|  | reviewed_at | timestamptz | เวลาตรวจ |
|  | review_note | text | ความเห็นผู้ตรวจ |
|  | verification_method | varchar(80) | วิธีตรวจสอบตัวตน |

### `clinic.user_notifications` — การแจ้งเตือนผู้ใช้

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | notification_id | bigint | รหัสแจ้งเตือน |
| FK | user_id | integer | ผู้รับ → users.user_id |
| UQ* | source_type | varchar(40) | ประเภทต้นทาง เช่น appointment/medical |
| UQ* | source_id | text | รหัสข้อมูลต้นทาง |
| UQ* | event_key | varchar(80) | ชนิดเหตุการณ์ |
|  | title | text | หัวข้อแจ้งเตือน |
|  | message | text | ข้อความ |
|  | severity | varchar(20) | info/success/warning/error |
|  | target_url | text | URL เมื่อกดแจ้งเตือน |
|  | event_at | timestamptz | เวลาเกิดเหตุการณ์ |
|  | email_required | boolean | ต้องส่งอีเมลด้วยหรือไม่ |
|  | email_sent_at | timestamptz | เวลาส่งอีเมลแล้ว |
|  | is_read | boolean | อ่านแล้วหรือไม่ |
|  | read_at | timestamptz | เวลาอ่าน |
|  | created_at | timestamptz | เวลาสร้าง |
|  | updated_at | timestamptz | เวลาแก้ไข |
|  | expires_at | timestamptz | เวลาหมดอายุแจ้งเตือน |

`user_id + source_type + source_id + event_key` เป็น unique ร่วมกัน ป้องกันแจ้งซ้ำ

## 5. กลุ่มปฏิทินคลินิก

### `clinic.clinic_holidays` — วันที่/ช่วงเวลาปิดพิเศษ

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK* | service_date | date | วันที่ปิด |
| PK* | avaliable_date | varchar(20) | morning/afternoon/all_day |
|  | reason | text | เหตุผลที่ปิด |
| FK | created_by | integer | ผู้สร้าง → users.user_id |
|  | created_at | timestamptz | เวลาสร้าง |
|  | updated_at | timestamptz | เวลาแก้ไข |

### `clinic.clinic_open_days` — วันเปิดพิเศษทับกฎปิดประจำ

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | service_date | date | วันที่เปิดพิเศษ |
|  | reason | text | เหตุผล |
| FK | created_by | integer | ผู้สร้าง → users.user_id |
|  | created_at | timestamptz | เวลาสร้าง |
|  | updated_at | timestamptz | เวลาแก้ไข |

### `clinic.weekly_closed_windows` — กฎปิดประจำสัปดาห์

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK* | weekday | smallint | วัน 0–6 ตาม PostgreSQL (0=อาทิตย์) |
| PK* | avaliable_date | varchar(20) | ช่วงเช้า/บ่าย |
|  | is_closed | boolean | ปิดช่วงนี้หรือไม่ |
|  | reason | text | เหตุผล |

### `clinic.advance_booking_weeks` — สัปดาห์ที่เปิดจองล่วงหน้า

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | week_start | date | วันเริ่มสัปดาห์ |
|  | week_end | date | วันสิ้นสุดสัปดาห์ (ต้องอยู่เดือนเดียวกัน) |
| FK | created_by | integer | ผู้เปิดจอง → users.user_id |
|  | created_at | timestamptz | เวลาสร้าง |

## 6. Audit

### `clinic.audit_logs` — ประวัติการใช้งานสำคัญ

คีย์หลัก: `audit_id` และตั้งใจไม่ผูก FK กับ `users` เพื่อเก็บหลักฐานไว้แม้บัญชีถูกลบ

| คีย์ | ชื่อคอลัมน์ | ชนิดข้อมูล | ความหมาย |
|---|---|---|---|
| PK | audit_id | bigint | รหัส log |
|  | request_id | uuid | รหัส request สำหรับ trace |
|  | actor_user_id | integer | รหัสผู้กระทำ ณ ตอนนั้น |
|  | actor_role | varchar(32) | role ณ ตอนนั้น |
|  | action | varchar(160) | การกระทำ |
|  | entity_type | varchar(80) | ประเภทข้อมูลที่ถูกกระทำ |
|  | entity_id | varchar(100) | รหัสข้อมูลเป้าหมาย |
|  | result | varchar(20) | success/denied/error |
|  | http_method | varchar(10) | HTTP method |
|  | route | text | API route |
|  | status_code | integer | HTTP status |
|  | ip_address | inet | IP ผู้เรียก |
|  | user_agent | text | browser/client |
|  | error_code | varchar(100) | รหัสข้อผิดพลาด |
|  | duration_ms | integer | เวลาทำงานเป็นมิลลิวินาที |
|  | created_at | timestamptz | เวลาเกิดเหตุการณ์ |

## View ที่ระบบใช้

| View | หน้าที่ |
|---|---|
| clinic.staff_profiles | รวมบัญชีและข้อมูลโปรไฟล์ของบุคลากร |
| clinic.faqs_public | แสดง help request ที่อนุมัติและเปิดเป็นข้อมูลสาธารณะ |
| clinic.slots_status_today | สถานะ slot วันนี้ พร้อมค่า is_empty/is_bookable |
| clinic.calendar_this_week | สรุปจำนวน slot ว่าง/ถูกจองรายวันในสัปดาห์ปัจจุบัน |

## ความสัมพันธ์หลัก (ER แบบย่อ)

```text
provinces 1 ───< user_details >─── 1 users
                                      │
           ┌──────────────────────────┼───────────────────────────┐
           │                          │                           │
           v                          v                           v
     appointments               medical_records             help_requests
           │                          │                           │
           ├──> appointment_slots     └──< user_feedbacks         └──> user_feedbacks
           │         └──> appointment_slot_templates
           v
     queue_tickets ───< measurements
           │
           └── 1 appointment_access_codes 1 ── appointments
                    ^
                    └── patient_checkins (ตรวจตัวตนก่อนออกรหัส)

users ───< email_verification_otps
users ───< password_resets
users ───< user_notifications
users ───< audit_logs (logical relation; ไม่บังคับ FK)
```

## ลำดับการทำงานของตาราง

1. สมัครสมาชิก: สร้าง `users` → `user_details` → `email_verification_otps`; ยืนยันสำเร็จจึงเปลี่ยน `account_status` เป็น `active`.
2. จองนัด: เลือก `appointment_slots` → สร้าง `appointments` สถานะ `pending` → เจ้าหน้าที่อนุมัติเป็น `approved`.
3. สร้างคิว: นัดออนไลน์สร้าง `queue_tickets` ที่อ้าง `appointment_id`; Walk-in สร้างคิวโดยตรงและอาจสร้างบัญชี `unclaimed`.
4. Check-in: เจ้าหน้าที่บันทึก `patient_checkins` → ออก `appointment_access_codes` อายุสั้นให้ผู้ป่วยใช้เครื่องวัด.
5. ตรวจวัด: เครื่องตรวจรหัส → บันทึก `measurements` โดยผูก `queue_id`.
6. รักษา: แพทย์อ่านข้อมูลผู้ป่วย/ผลวัด → บันทึก `medical_records` → ปิดนัดและคิวเมื่อให้บริการเสร็จ.
7. หลังรักษา: ผู้ป่วยส่ง `user_feedbacks`; ระบบสร้าง `user_notifications` สำหรับนัด ผลรักษา และวันติดตาม.
8. งานสนับสนุน: `help_requests` รับคำร้องและ FAQ; ทุกการกระทำสำคัญบันทึกลง `audit_logs`.
9. ปฏิทิน: `weekly_closed_windows`, `clinic_holidays`, `clinic_open_days` และ `advance_booking_weeks` ควบคุมว่า slot ใดเปิดให้จอง.

## วิธีติดตั้ง

`schema.sql` รวมโครงสร้างล่าสุด ฟังก์ชัน และสิทธิ์แล้ว ใช้กับฐานข้อมูลว่างเท่านั้น หากมีฐานข้อมูลอยู่แล้วให้ใช้ `npm --prefix backend run migrate` ด้วยบัญชีเจ้าของ schema ตาม README โดยไม่รันไฟล์สร้างตารางซ้ำ

```powershell
# 1) สร้างฐานข้อมูล (ทำครั้งเดียว)
psql -U postgres -c "CREATE DATABASE projectfinal ENCODING 'UTF8';"

# 2) สร้าง schema/tables/indexes/views
psql -U postgres -d projectfinal -f database/schema.sql
```

จากนั้นกำหนด backend `.env` ให้ `DB_NAME=projectfinal` หรือใช้ `DATABASE_URL` ตาม `backend/.env.example`.
