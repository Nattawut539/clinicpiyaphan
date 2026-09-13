# เตรียมเปิดใช้งาน Email, Google และ LINE

เอกสารนี้ใช้กับระบบชั่วคราวบน Render:

- Frontend: `https://cliniccare-frontend-umdi.onrender.com`
- Backend: `https://cliniccare-api-3hfi.onrender.com`

ห้ามใส่ Client Secret, SMTP password หรือ token ใด ๆ ลง GitHub ให้เพิ่มค่าเหล่านี้ใน
Render Backend service (`cliniccare-api`) ที่เมนู **Environment** เท่านั้น

## 1. ค่าพื้นฐาน Backend

```env
FRONTEND_URL=https://cliniccare-frontend-umdi.onrender.com
CORS_ORIGINS=https://cliniccare-frontend-umdi.onrender.com,https://clinicpiyaphan.online
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
TRUST_PROXY=1
```

เมื่อซื้อและยืนยันโดเมน `clinicpiyaphan.online` แล้ว ค่อยเปลี่ยน `FRONTEND_URL`
เป็นโดเมนนั้น ส่วน `CORS_ORIGINS` สามารถเก็บทั้ง URL ของ Render และโดเมนจริงได้

## 2. Email และ OTP

เลือกผู้ให้บริการ SMTP ที่รองรับพอร์ตอื่นนอกเหนือจาก 25, 465 และ 587 หาก Backend
ยังใช้ Render Free เพราะ Render Free บล็อก outbound SMTP ทั้งสามพอร์ตดังกล่าว

เพิ่มใน Environment ของ Backend:

```env
SMTP_HOST=<smtp-host>
SMTP_PORT=2525
SMTP_USER=<smtp-username>
SMTP_PASS=<smtp-password-or-api-key>
MAIL_FROM=<verified-sender-address>
RESET_TOKEN_EXPIRE_MIN=10
DISABLE_EMAIL=false
```

`MAIL_FROM` ต้องเป็น sender/domain ที่ผ่านการยืนยันกับผู้ให้บริการอีเมลแล้ว

ทดสอบจากเครื่องที่มี `.env` ชุด production:

```powershell
npm.cmd run check:integrations:smtp
```

จากนั้นทดสอบจริงตามลำดับ:

1. สมัครสมาชิกใหม่
2. รับ OTP ยืนยันอีเมล
3. ยืนยัน OTP
4. ขอ OTP ลืมรหัสผ่าน
5. ตั้งรหัสผ่านใหม่และเข้าสู่ระบบ
6. สร้าง/อนุมัตินัดหมายและตรวจอีเมลแจ้งเตือน

## 3. Google OAuth

สร้าง OAuth 2.0 Client ชนิด **Web application** ใน Google Cloud Console แล้วกำหนด:

```text
Authorized JavaScript origin:
https://cliniccare-frontend-umdi.onrender.com

Authorized redirect URI:
https://cliniccare-frontend-umdi.onrender.com/api/google/callback
```

เพิ่มใน Environment ของ Backend:

```env
GOOGLE_CLIENT_ID=<client-id>
GOOGLE_CLIENT_SECRET=<client-secret>
GOOGLE_REDIRECT_URI=https://cliniccare-frontend-umdi.onrender.com/api/google/callback
GOOGLE_SCOPES=openid email profile
DISABLE_GOOGLE_OAUTH=false
```

Redirect URI ใน Render และ Google Console ต้องตรงกันทุกตัว รวมถึง `https` และ path

## 4. LINE Login

สร้าง LINE Login Channel ชนิด **Web app** ใน LINE Developers Console แล้วกำหนด
Callback URL:

```text
https://cliniccare-frontend-umdi.onrender.com/api/line/callback
```

เปิดสิทธิ์ email ของ LINE Login channel ก่อนใช้ scope `email` แล้วเพิ่มใน Environment
ของ Backend:

```env
LINE_CHANNEL_ID=<channel-id>
LINE_CHANNEL_SECRET=<channel-secret>
LINE_REDIRECT_URI=https://cliniccare-frontend-umdi.onrender.com/api/line/callback
LINE_SCOPES=openid profile email
DISABLE_LINE_OAUTH=false
```

## 5. reCAPTCHA สำหรับหน้าสมัครสมาชิก

สร้าง Google reCAPTCHA v2 Checkbox สำหรับโดเมน Frontend แล้วตั้งค่าแยกกัน โดย Site Key อยู่ที่ Frontend และ Secret Key อยู่ที่ Backend เท่านั้น:

```env
# Frontend
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=<site-key>

# Backend
RECAPTCHA_ENABLED=true
RECAPTCHA_SECRET_KEY=<secret-key>
RECAPTCHA_ALLOWED_HOSTNAMES=cliniccare-frontend-umdi.onrender.com
```

ต้อง rebuild ทั้ง Frontend และ Backend หลังเพิ่มค่า ห้ามใส่ Secret Key ในตัวแปร `NEXT_PUBLIC_*` หรือ commit ลง GitHub

## 6. Google Drive สำหรับเก็บรูปถาวร

Render Free ไม่มี persistent disk ดังนั้นให้ใช้ Google Drive หากต้องการให้รูปโปรไฟล์ไม่หายหลัง restart หรือ redeploy
สร้าง OAuth credentials และ refresh token ตาม `GOOGLE_DRIVE_STORAGE_TH.md` แล้วเพิ่มใน Environment ของ Backend:

```env
STORAGE_PROVIDER=google_drive
GOOGLE_DRIVE_CLIENT_ID=<client-id>
GOOGLE_DRIVE_CLIENT_SECRET=<client-secret>
GOOGLE_DRIVE_REFRESH_TOKEN=<refresh-token>
GOOGLE_DRIVE_FOLDER_ID=<folder-id-only>
SERVE_LEGACY_UPLOADS=true
ALLOW_EPHEMERAL_UPLOADS=false
```

บัญชี Google ที่ออก refresh token ต้องมีสิทธิ์เพิ่มไฟล์ในโฟลเดอร์นั้น และ `GOOGLE_DRIVE_FOLDER_ID` ต้องเป็น ID ไม่ใช่ URL ทั้งเส้น

## 7. MQTT และอุปกรณ์ฮาร์ดแวร์

เตรียม MQTT broker ที่รองรับ TLS และสร้าง credentials แยกสำหรับ Backend จากนั้นเพิ่มใน Environment ของ Backend:

```env
MQTT_ENABLED=true
MQTT_URL=mqtts://<broker-host>:8883
MQTT_CLIENT_ID=clinic-backend-production
MQTT_USERNAME=<backend-username>
MQTT_PASSWORD=<backend-password>
MQTT_TOPIC_PREFIX=clinic/v1
MQTT_QOS=1
MQTT_RECONNECT_PERIOD_MS=5000
MQTT_REJECT_UNAUTHORIZED=true
```

ถ้า broker ใช้ client certificate ให้ตั้ง `MQTT_CA_FILE`, `MQTT_CERT_FILE` และ `MQTT_KEY_FILE` เป็น path ของ Render Secret Files
แทน username/password ได้ ห้ามปิด `MQTT_REJECT_UNAUTHORIZED` ใน production อุปกรณ์แต่ละเครื่องต้องมี device ID และ credentials
ของตัวเอง และส่งข้อมูลตาม `MQTT_HARDWARE_CONTRACT_TH.md`

## 8. ตรวจความพร้อมก่อน Deploy

ใส่ค่าจริงไว้ใน `backend/.env` เฉพาะเครื่อง (ไฟล์นี้ถูก `.gitignore`) แล้วรัน:

```powershell
cd backend
npm.cmd run check:integrations
npm.cmd run check:integrations:smtp
npm.cmd run check:integrations:strict
npm.cmd run check:integrations:live
npm.cmd run check:deploy
```

`check:integrations` ตรวจรูปแบบค่าทั้งหมดโดยไม่เชื่อมต่อบริการภายนอก ส่วน `check:integrations:strict` จะไม่ยอมผ่านหากยังปิด
Email, Google, LINE, Google Drive หรือ MQTT คำสั่ง `check:integrations:live` เชื่อมต่อ SMTP, Google Drive และ MQTT จริง
โดยไม่ส่งอีเมลหรือข้อมูลอุปกรณ์ และ `check:deploy` ตรวจฐานข้อมูล, runtime role, RLS และ storage

หลังผ่านทั้งหมด ให้ Save Environment และ Deploy Backend ใหม่ จากนั้นตรวจ:

```text
GET  /readyz
GET  /api/google/login       -> redirect ไป Google
GET  /api/line/login         -> redirect ไป LINE
POST /api/users/email-verification/resend
POST /api/users/forgot-password/request
```

## 9. ข้อจำกัดที่ต้องตัดสินใจก่อน production จริง

- Render Free sleep เมื่อไม่มีการใช้งาน ทำให้ request แรกช้าได้
- local upload บน Render Free เป็น ephemeral และไฟล์อาจหายเมื่อ restart/redeploy
- หากต้องเก็บรูปถาวร ให้เปิด `STORAGE_PROVIDER=google_drive` และตั้งค่า
  `GOOGLE_DRIVE_*` ตาม `GOOGLE_DRIVE_STORAGE_TH.md`
- MQTT ต้องมี broker แบบ `mqtts://`, device credentials และ hardware จริงก่อนเปลี่ยน
  `MQTT_ENABLED=true`
