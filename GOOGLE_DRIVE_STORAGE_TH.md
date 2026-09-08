# การเก็บรูปโปรไฟล์ใน Google Drive

Backend รองรับ `STORAGE_PROVIDER=local` (ค่าเริ่มต้น) และ `google_drive`
Google Drive ใช้ OAuth ของบัญชีเจ้าของพื้นที่และ scope `drive.file` โดยโฟลเดอร์
ต้องสร้างผ่าน API ของ OAuth app เดียวกัน หรือได้รับอนุญาตผ่าน Google Picker
การคัดลอก ID ของโฟลเดอร์ทั่วไปมาใส่เพียงอย่างเดียวอาจยังเข้าถึงไม่ได้

## ตั้งค่า

ใส่ค่าจริงเฉพาะ `backend/.env` และระบบ Secrets ของโฮสต์:

```env
STORAGE_PROVIDER=google_drive
GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=
GOOGLE_DRIVE_REFRESH_TOKEN=
GOOGLE_DRIVE_FOLDER_ID=
SERVE_LEGACY_UPLOADS=true
```

ตัวแปร `GOOGLE_*` ที่ใช้ Google Login ยังคงใช้ตามเดิม ให้เก็บโฟลเดอร์ Drive
เป็น Restricted; ผู้ใช้เว็บไม่ต้องเชื่อมบัญชี Drive ของตนเอง
ใช้บัญชี OAuth app เดิมและโฟลเดอร์เดิมต่อเนื่อง เพราะไฟล์และ appProperties
ถูกผูกกับแอปที่สร้างไฟล์นั้น

## ติดตั้งและตรวจสอบ

จากโฟลเดอร์ `backend`:

```powershell
npm.cmd ci
npm.cmd run migrate
npm.cmd run check:storage
npm.cmd run test:profile-images
```

`check:storage` อ่าน metadata เพื่อตรวจ token, โฟลเดอร์, สถานะถังขยะ และสิทธิ์เพิ่มไฟล์
ไม่มีการอัปโหลดไฟล์ในคำสั่งนี้ การทดสอบอัปโหลดจริงใช้คำสั่งด้านล่างกับฐานข้อมูล
และโฟลเดอร์ทดสอบ โดยสร้างบัญชีสังเคราะห์และรูปทดสอบแล้วล้างเมื่อจบ:

```powershell
$env:PROFILE_IMAGE_TEST_ALLOW_MUTATION='true'
npm.cmd run test:profile-images-workflow
```

Production ต้องรัน migration ก่อนเริ่ม backend ตาม `DEPLOYMENT.md` และรัน
`npm.cmd run check:deploy` ภายใต้ `NODE_ENV=production` เพื่อรวมการตรวจ DB role,
schema, configuration และพื้นที่เก็บรูป โหมด Drive ไม่บังคับดิสก์ถาวรสำหรับรูปใหม่

## รูปแบบข้อมูลและสิทธิ์

- `clinic.user_details.profile_image_drive_id` เก็บ File ID
- `profile_image` เก็บ `/api/profile-images/<userId>` สำหรับรูป Drive
- API เดิมที่ส่ง `profile_image` จึงแสดงรูปใหม่ผ่าน frontend เดิมได้
- `GET /api/profile-images/:userId` ตรวจ session; ผู้ใช้ดูได้เฉพาะรูปตนเอง
  ส่วน doctor/assistant/admin/super_admin ดูรูปตามสิทธิ์เจ้าหน้าที่
- API อ่านไฟล์เฉพาะในโฟลเดอร์ที่ตั้งค่าและมี appProperties ของระบบนี้
- รูปเป็น private และส่ง `Cache-Control: private, no-store`
- Next.js ต้อง proxy `/api` ไป backend และ Browser ส่ง cookie ล็อกอินได้
  โดย `<img>` ไม่แนบ Bearer token จาก JavaScript ให้อัตโนมัติ
- รูปใหม่จำกัด 3 MB และตรวจ signature ของ JPG/PNG/WEBP/GIF ก่อนอัปโหลด

Backend จอง Drive File ID และบันทึก cleanup ก่อนอัปโหลด เพื่อให้ตามลบไฟล์ค้าง
กรณี process หยุดกลางทางได้ หลัง DB commit จึงตอบสำเร็จและลบรูปเก่า
ถ้า rollback จะเก็บรูปเดิมและพยายามลบไฟล์ใหม่ โดยตรวจ DB reference ก่อนลบเสมอ
คำขอเปลี่ยนรูปด้วย HTTPS imageUrl ของเจ้าหน้าที่รองรับอยู่ แต่ไม่รับ File ID
หรือ URL API ภายในจาก client มาใช้เป็นรูปของผู้ป่วยรายอื่น

## ย้ายรูปเดิม

สำรอง PostgreSQL ด้วย `pg_dump --format=custom` ก่อนเริ่มย้าย แล้วตรวจจำนวน:

```powershell
npm.cmd run migrate:profile-images:drive
```

คำสั่งเริ่มต้นเป็น dry-run ตรวจไฟล์ local/Base64 โดยไม่อัปโหลดหรือเปลี่ยนข้อมูล
URL รูปจาก Google/LINE ภายนอกจะไม่ถูกดาวน์โหลดหรือย้าย

เมื่อตรวจผ่าน:

```powershell
npm.cmd run migrate:profile-images:drive -- --apply
npm.cmd run check:profile-images:drive
```

แต่ละรอบสร้าง `.local-backups/drive-images-<timestamp>` (ถูก ignore ใน Git)
เก็บสำเนารูปต้นฉบับและ `images.jsonl` ที่มีค่า DB เดิม ก่อนอัปโหลดแต่ละไฟล์
ดาวน์โหลดกลับมาเทียบ SHA-256 แล้วจึงอัปเดต File ID และ URL ใน transaction
ใช้เงื่อนไขเปรียบเทียบค่าเดิมเพื่อไม่ทับรูปที่ผู้ใช้แก้ระหว่างย้าย
รันซ้ำได้ โดยข้ามแถวที่มี File ID แล้ว ไฟล์ local ต้นฉบับไม่ถูกลบโดย migration
ไฟล์สำรองอาจมีข้อมูลส่วนบุคคล ให้เก็บเป็นส่วนตัวและอย่านำขึ้น Git/เว็บ

ถ้าต้องย้อนกลับ ให้อ่าน `images.jsonl` และคืน `profile_image` เดิมเฉพาะแถว
ที่ยังใช้รูปจากการย้ายรอบนั้น พร้อมล้าง `profile_image_drive_id` ใน transaction
แล้วจัดการ Drive file ที่ไม่มี reference หลัง commit ห้ามคืน backup ทับรูป
ที่ผู้ใช้เปลี่ยนภายหลัง หรือสลับ provider กลับ local แล้วคิดว่ารูปจะย้ายกลับเอง

หลังย้ายและตรวจหน้าโปรไฟล์/Header/รายการผู้ป่วยครบแล้วจึงตั้ง
`SERVE_LEGACY_UPLOADS=false` ได้ โดยตรวจรูป static ที่อ้าง `/uploads` ด้วย:
หน้า aboutus เดิมอ้าง `doctor.jpg` ซึ่งไม่ใช่แถวโปรไฟล์ที่ migration จัดการ
ต้องย้าย asset นั้นหรือคง legacy serving ไว้พร้อมไฟล์ก่อนปิด `/uploads`

## ล้างไฟล์ค้าง

```powershell
npm.cmd run cleanup:profile-images
```

ให้ scheduler ของโฮสต์เรียกทุกชั่วโมง คำสั่งอ่าน `clinic.profile_image_cleanup`
เฉพาะโฟลเดอร์ปัจจุบันและรายการอายุเกินหนึ่งชั่วโมง (ครั้งละไม่เกิน 100)
ตรวจว่าไม่มีผู้ใช้อ้างไฟล์แล้วจึงลบ หาก Drive ล้มเหลวจะเก็บรายการไว้ลองใหม่
รูปที่ยังมี DB reference จะไม่ถูกลบ การลบ Drive file เป็นการลบถาวร

## OAuth และการแก้ปัญหา

- External/Testing ที่ขอ Drive scope มี refresh token อายุ 7 วัน
  ก่อนใช้งานต่อเนื่องให้จัดการ Publishing status และขอ token ใหม่ตามขั้นตอน Google
- `invalid_grant`/สิทธิ์ถูกถอน: อนุญาตใหม่ด้วย OAuth client และบัญชีเดิม
  แล้วอัปเดต refresh token ใน secrets ของโฮสต์
- Folder check ไม่ผ่าน: ตรวจ Folder ID (ไม่ใช่ URL), บัญชี, OAuth client และ scope
- โฟลเดอร์ผ่านแต่ upload ไม่ผ่าน: ตรวจพื้นที่บัญชีและโควตา Drive
- หน้ารูปได้ 401: ตรวจ cookie/session และ Next.js `/api` proxy
- หน้ารูปได้ 403: ผู้ใช้ไม่มีสิทธิ์ดูรูปของเจ้าของ ID นั้น
- หน้ารูปได้ 404: ตรวจไฟล์ถูกย้าย/ลบ/อยู่ในถังขยะ หรือไม่มี File ID ใน DB
- API ส่งข้อความทั่วไปเมื่อ Drive ล้มเหลว เพื่อไม่ให้ token/headers ใน SDK error รั่ว

อ้างอิง: [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
[Uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads),
[Downloads](https://developers.google.com/workspace/drive/api/guides/manage-downloads),
[OAuth token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)
