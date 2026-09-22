# โครงการต้นแบบระบบบริหารจัดการคลินิกขนาดเล็ก

เว็บสำหรับการนัดหมาย คิวผู้ป่วย เวชระเบียน และงานบริหารคลินิกหมอปิยะพันธ์ รองรับเครื่องชั่งและงานพิมพ์ผ่าน MQTT

## โครงสร้างและขอบเขต

| โฟลเดอร์ | เนื้อหา |
|---|---|
| `frontend/` | Next.js 15, React 19, TypeScript: หน้าผู้ป่วยและเจ้าหน้าที่ |
| `backend/` | Express API, authentication, สิทธิ์ผู้ใช้, จัดการคิวและ MQTT |
| `database/` | PostgreSQL schema, migrations และพจนานุกรมข้อมูล |

ฟังก์ชันหลัก: สมัคร/เข้าสู่ระบบ, consent ข้อมูลสุขภาพ, นัดหมาย, รับคิว walk-in, น้ำหนัก/ส่วนสูง/BMI, เวชระเบียน, จัดการผู้ใช้ และ audit logs ตามสิทธิ์ รองรับ Google/LINE OAuth, อีเมล, Google Drive และ MQTT เมื่อกำหนดค่าบริการเหล่านั้น

ซอฟต์แวร์ผ่าน unit tests 45 ข้อ และได้ทดสอบสร้างฐานข้อมูลใหม่ รัน migrations และเข้าสู่ระบบด้วยบัญชี demo ทั้งสองแล้ว ส่วนการเชื่อมต่อเซนเซอร์ การ calibration และการพิมพ์กับอุปกรณ์จริงยังต้องทดสอบร่วมกับทีมฮาร์ดแวร์ก่อนรับรองการใช้งานจริง

## ติดตั้งเพื่อสาธิตในเครื่อง

ใช้ Node.js 22 (package รองรับ `>=20 <23`), npm, Git และ PostgreSQL 17 พร้อม `psql`/`createdb` ใน PATH ตัวอย่างใช้ PowerShell และฐานข้อมูลใหม่ `cliniccare_demo` เท่านั้น

### 1. ดาวน์โหลดและติดตั้ง

```powershell
git clone --branch main https://github.com/Nattawut539/project2.git
cd project2
npm ci --prefix backend
npm ci --prefix frontend
```

ใช้ `git rev-parse HEAD` เพื่อดู commit SHA ของเวอร์ชันที่ดาวน์โหลดและอ้างอิงผลทดสอบให้ตรงกัน

### 2. สร้างฐานข้อมูลว่าง

เปิด PostgreSQL local แล้วรันจาก root (เปลี่ยน `postgres` หากใช้ชื่อเจ้าของฐานข้อมูลอื่น):

```powershell
createdb -h 127.0.0.1 -p 5432 -U postgres cliniccare_demo
psql -h 127.0.0.1 -p 5432 -U postgres -d cliniccare_demo -v ON_ERROR_STOP=1 -f database/schema.sql
```

`schema.sql` ใช้กับฐานข้อมูลว่าง ไม่ใช่สคริปต์รันซ้ำ หากคำสั่งล้มเหลวให้แก้ก่อนขั้นต่อไป ไม่ต้องรัน `supabase_render_grants.sql` สำหรับ demo local

### 3. ตั้งค่า backend

สร้าง `backend/.env` ตามตัวอย่างนี้ หากมีไฟล์เดิมให้ใช้สำเนาโปรเจกต์สำหรับ demo เพื่อไม่ทับค่าของงานเดิม:

```dotenv
NODE_ENV=development
PORT=5000
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000
TRUST_PROXY=false
COOKIE_SECURE=false
COOKIE_SAME_SITE=lax
JWT_SECRET=REPLACE_WITH_RANDOM_VALUE
DATABASE_URL=postgresql://postgres:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5432/cliniccare_demo
PGSSL=false
STORAGE_PROVIDER=local
RUN_MIGRATIONS_ON_START=false
DISABLE_EMAIL=true
DISABLE_GOOGLE_OAUTH=true
DISABLE_LINE_OAUTH=true
RECAPTCHA_ENABLED=false
MQTT_ENABLED=false
```

สร้าง JWT secret แล้วใส่แทน `REPLACE_WITH_RANDOM_VALUE`:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

รหัสผ่านใน DATABASE_URL ต้อง percent-encode อักขระพิเศษ เช่น `@` เป็น `%40` ใช้ DATABASE_URL หรือ DB_* ชุดเดียว ตัวแปรใน shell มีลำดับความสำคัญเหนือ `.env`; แนะนำเริ่ม terminal ใหม่สำหรับ demo

`backend/.env.example` เป็นรายการตัวแปร deployment/integrations ไม่ใช่ค่าพร้อมรัน local ตัวอย่างนี้ปิด SMTP/OAuth/MQTT จึงไม่ทดสอบการยืนยันอีเมลหรืออุปกรณ์จริง

รัน migrations หลัง schema:

```powershell
npm --prefix backend run migrate
```

คำสั่งนี้ปรับ queue, account/consent, audit, profile images และ measurement ACK outbox ตามโค้ดปัจจุบัน ไม่ต้องรัน SQL migration เก่าทุกไฟล์ซ้ำสำหรับฐานข้อมูลใหม่

### 4. สร้างบัญชีทดสอบ

เครื่องมือสร้างบัญชีจำลองสองบัญชี โดยไม่ใส่เลขบัตรประชาชนหรือ consent แทนผู้ใช้ รับ DATABASE_URL จาก shell โดยตรง ไม่โหลด `.env` และยอมรับเฉพาะ `cliniccare_demo` บน localhost:

```powershell
$env:NODE_ENV = 'development'
$demoConnection = Read-Host 'วาง DATABASE_URL ของ cliniccare_demo ในเครื่อง' -AsSecureString
$env:DATABASE_URL = [System.Net.NetworkCredential]::new('', $demoConnection).Password
$demoPassword = Read-Host 'ตั้งรหัสผ่าน demo อย่างน้อย 12 ตัวอักษร' -AsSecureString
$env:DEMO_PASSWORD = [System.Net.NetworkCredential]::new('', $demoPassword).Password
try {
    node backend/tools/createLocalDemoAccounts.js
} finally {
    Remove-Item Env:DEMO_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
    $demoConnection = $null
    $demoPassword = $null
}
```

| Username | Role | การใช้งาน |
|---|---|---|
| `demo_admin` | `super_admin` | บริหาร/คิว/audit/hardware |
| `demo_patient` | `user` | consent และหน้าผู้ป่วย |

ทั้งสองใช้รหัสผ่านที่ตั้งข้างต้น อีเมล `@example.test` ไม่รับเมลจริง หากบัญชีมีอยู่แล้ว เครื่องมือหยุดและ rollback โดยไม่เขียนทับบัญชี/รหัสผ่าน ส่งรหัสผ่าน demo ให้อาจารย์แยกจาก repository

### 5. ตั้งค่า frontend และเปิดระบบ

สร้าง `frontend/.env.local`:

```dotenv
NEXT_PUBLIC_API_BASE=/api
BACKEND_ORIGIN=http://localhost:5000
BACKEND_INTERNAL_URL=http://localhost:5000
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=
NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY=
```

เปิด terminal แรกที่ root:

```powershell
npm --prefix backend run dev
```

เปิดอีก terminal ที่ root:

```powershell
npm --prefix frontend run dev
```

เปิด `http://localhost:3000/userlogin` ด้วยบัญชี demo ตรวจ API ที่ `http://localhost:5000/readyz` โดย frontend proxy `/api` ไป backend

ข้อมูลเริ่มต้นมีโครงสร้างและ template เวลา ไม่มีประวัติผู้ป่วย นัดหมาย หรือชุดจังหวัดไทยครบถ้วน เมนูที่ต้องใช้ข้อมูลเหล่านี้อาจว่างจนกว่าจะเพิ่มข้อมูลจำลอง แผนที่อาจต้องใช้อินเทอร์เน็ต

## ทดสอบและ build

จาก root:

```powershell
node --test backend/tests/*.test.js frontend/tests/*.test.cjs
npm --prefix frontend run lint
npm --prefix frontend run build
```

Workflow tests อื่นใน backend อาจสร้าง/แก้ข้อมูล ให้ใช้ฐานข้อมูลทดสอบเท่านั้น อ่านเงื่อนไขก่อนรัน

## เอกสารเพิ่มเติม

- [Deployment และสิทธิ์ฐานข้อมูล production](DEPLOYMENT.md)
- [พจนานุกรมข้อมูล](database/DATABASE_DICTIONARY_TH.md)
- [Email / Google / LINE](INTEGRATIONS_SETUP_TH.md)
- [Google Drive storage](GOOGLE_DRIVE_STORAGE_TH.md)
- [MQTT contract](MQTT_HARDWARE_CONTRACT_TH.md)

ห้าม commit `.env` จริง, credentials, database dump หรือข้อมูลผู้ป่วย ใช้ `.env.example` และข้อมูลจำลองแทน เปลี่ยน JWT secret แล้ว token เก่าจะใช้ไม่ได้หลัง backend เริ่มใช้ค่าใหม่
