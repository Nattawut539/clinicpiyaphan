# อัปเดต Walk-in, การค้นหา และความยินยอม

Repository: `Nattawut539/project2` — branch `deployment/production-preparation`

## ก่อน Deploy

1. รัน `database/medical_consent_migration.sql` ในฐานข้อมูล production ด้วยบัญชีเจ้าของ schema เช่น SQL Editor ของฐานข้อมูลที่ใช้งาน ไฟล์นี้เพิ่มเฉพาะ 2 คอลัมน์และรันซ้ำได้ ไม่ลบข้อมูลเดิม
2. ตรวจว่ามี `clinic.users.medical_consent_at` และ `medical_consent_version` แล้วก่อนเริ่ม API ใหม่ ระบบ preflight จะตรวจทั้งสองคอลัมน์
3. ตรวจ branch ของบริการ backend และ frontend ใน Render ให้ตรงกับ branch ข้างต้น

บัญชีเดิมที่ไม่มีหลักฐานความยินยอมจะเห็น Modal เมื่อเข้าใช้งานครั้งถัดไปด้วย ไม่เติมความยินยอมแทนผู้ใช้ เจ้าหน้าที่ไม่ถูกบังคับเข้า Modal นี้

## Deploy บน Render หลัง push

ไฟล์ `render.yaml` ของ repository กำหนด `autoDeployTrigger: off` สำหรับ `cliniccare-api` และ `RUN_MIGRATIONS_ON_START=false` ส่วนการตั้งค่าจริงใน Dashboard ต้องตรวจแยก โดยเฉพาะ frontend ซึ่งไม่ได้ประกาศในไฟล์นี้

1. เปิดบริการ backend `cliniccare-api` → **Manual Deploy → Deploy latest commit** (หรือ Deploy a specific commit หากมี commit ใหม่กว่างานนี้แล้ว)
2. Render ดึงโค้ดจาก Git, ติดตั้งด้วย `npm ci --omit=dev --ignore-scripts`, แล้วเริ่มด้วย `npm run start:render` ซึ่งรัน `check:deploy` ก่อนเปิด API
3. รอ backend เป็น **Live** และ `/readyz` ตอบ 200 ตรวจ Logs ว่าไม่มี missing column หรือ authentication error
4. เปิดบริการ frontend แล้ว Deploy commit เดียวกัน ตรวจ build/start command ใน Dashboard ตาม Next.js ของโปรเจกต์ (`npm ci && npm run build`, `npm start`)
5. รอ frontend เป็น **Live** แล้วทดสอบเว็บจริงตามรายการด้านล่าง

การ push สำเร็จไม่ใช่หลักฐานว่า Render Deploy สำเร็จ ขั้นตอนในเอกสารนี้ยังต้องดำเนินการและตรวจผลในบัญชี Render จริง

อ้างอิง: [Render: Deploying on Render](https://render.com/docs/deploys)

## ตรวจหลัง Deploy

- Admin → dashboard → Walk-in: กรอกโรคประจำตัว บันทึกและเปิดข้อมูลผู้ป่วยอีกครั้ง ทั้งผู้ป่วยใหม่และผู้ป่วยเดิม
- ช่อง Vital signs/CC แสดงคำอธิบายไทย; เว้นคิว B หรือกรอก B000 แล้วบันทึกไม่ได้; กรอกเลขจากใบคิวจริงจึงบันทึกได้; คิวซ้ำในวันเดียวกันต้องถูกปฏิเสธ
- Admin → admins: ค้นด้วยชื่อ นามสกุล ชื่อเต็ม เบอร์โทรที่มี/ไม่มีขีด รหัสผู้ป่วย และเลขบัตร เลือกจากรายการกรณีหลายคนตรงกัน
- บัญชีผู้ใช้ที่ยังไม่ยินยอมทั้ง Google, LINE และบัญชีเว็บ: หลัง login ต้องเห็น Modal ก่อนหน้าข้อมูลผู้ใช้ รวมถึงก่อนหน้ากรอกโปรไฟล์
- ยินยอม: เข้าเว็บได้ และ login ครั้งถัดไป/อุปกรณ์อื่นไม่ถามซ้ำสำหรับประกาศฉบับเดิม
- ไม่ยินยอม: กลับหน้า login; URL หน้าผู้ใช้เข้าไม่ได้ และ token เดิมใช้ไม่ได้
- ไม่ตอบ Modal/กด Escape/เรียก API โดยตรง: ไม่ข้ามความยินยอม; ระบบผิดพลาดขณะบันทึกต้องแสดงข้อความและยังไม่อนุญาตเข้าเว็บ

## การทดสอบในเครื่อง

- Backend: `node --test tests/clinic-update.test.js` จากโฟลเดอร์ backend เป็นการทดสอบ handlers และ middleware จริงโดยจำลองฐานข้อมูล ไม่แตะข้อมูล production
- Frontend: `npm run build` จากโฟลเดอร์ frontend
- Middleware: `node --test tests/consent-middleware.test.cjs` จากโฟลเดอร์ frontend ทดสอบการ redirect ของบัญชีทุกช่องทางโดยจำลองคำตอบ session

หากต้องย้อน deploy ให้ย้อน backend และ frontend เป็นรุ่นเดิมที่ทำงานร่วมกัน คงคอลัมน์ฐานข้อมูลไว้ได้ ไม่จำเป็นต้องลบคอลัมน์หรือหลักฐานความยินยอม
