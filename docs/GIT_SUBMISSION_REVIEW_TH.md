# ผลตรวจ Repository ก่อนส่งอาจารย์

วันที่ตรวจ: 23 กันยายน 2569 (Asia/Bangkok)

## อัปเดตหลังดำเนินการตามคำขอ

ส่วนนี้เป็นสถานะล่าสุด ส่วนผลตรวจด้านล่างเก็บเป็นบันทึกก่อนแก้ไข:

- เพิ่ม root `README.md` พร้อมวิธีตั้งค่า local, schema/migration, เปิดสองบริการ และทดสอบ เปลี่ยน frontend README ให้เชื่อมกลับไปคู่มือหลัก
- เพิ่ม `backend/tools/createLocalDemoAccounts.js` สร้าง demo_admin/demo_patient ด้วยรหัสผ่านที่ผู้รันกำหนด ใช้ bcrypt และ transaction ปฏิเสธ production, host ภายนอก, ชื่อฐานข้อมูลอื่น และไม่เขียนทับบัญชีเดิม
- ทดสอบ PostgreSQL 17 cluster ใหม่เฉพาะ 127.0.0.1:55439: schema.sql ผ่าน, migrate ผ่าน, สร้างบัญชีผ่าน, ทดสอบ guard และ duplicate rollback ผ่าน, API readyz และ login ทั้งสองบัญชีผ่าน ไม่แตะฐานข้อมูลเดิม
- การทดสอบใช้ dependencies ที่ติดตั้งอยู่ ไม่ใช่ fresh clone/npm ci และไม่ได้ทดสอบ UI ทุกหน้าหรือ integrations จริง
- ลบ aria-describedby ที่ไม่มี target โดยคงการลบข้อความช่วยกรอกเดิมของผู้ใช้ไว้
- เพิ่ม ignore สำหรับ `.codesight/` และเลิกติดตาม `.codesight/default.json` แล้ว ไฟล์จริงยังอยู่ในเครื่อง การเลิกติดตามนี้อยู่ใน Git index รอ commit
- เปลี่ยน JWT_SECRET เฉพาะ backend/.env ในเครื่องเป็นค่าสุ่ม 48 bytes; ไม่แสดง/commit ค่าลับ ต้อง restart backend เพื่อใช้ค่าใหม่และ login ใหม่ ไม่ได้เปลี่ยน secret บน Render หรือแก้ Git history
- เลือก HTML และ PDF ใน reports สำหรับส่ง เก็บ DOCX ไว้ในเครื่องและ ignore ตรวจ PDF ครบ 8 หน้า รวมข้อความและ metadata แล้ว ดูรายละเอียดใน reports/README.md
- หลังแก้ไข unit tests ผ่าน 45/45, frontend lint ผ่าน และทดสอบเครื่องมือ demo กับ API จริงบนฐานข้อมูลแยกผ่าน ปิดบริการทดสอบเมื่อเสร็จแล้ว
- ยังไม่ได้ commit/push/merge/deploy; ไฟล์ที่เพิ่มและแก้ส่วนใหญ่ยังไม่ stage

## สรุป

โค้ดผ่าน unit tests, lint, TypeScript และ production build ในเครื่องนี้ แต่ควรจัดเตรียม README สำหรับติดตั้งจากเครื่องใหม่ เลือก branch ที่ส่งให้ถูกต้อง และจัดการไฟล์ส่วนตัวก่อนส่ง ไม่ควรอ้างว่าผ่าน end-to-end กับฐานข้อมูลหรืออุปกรณ์จริงจากผลตรวจรอบนี้

ตรวจรายการ tracked ทั้งหมด 208 ไฟล์ โครงสร้าง frontend/backend/database/docs/reports, manifests, configuration, SQL, working diff และประวัติ Git ที่มีในเครื่อง การตรวจนี้เป็นการตรวจความพร้อมส่ง repository และตรวจโค้ดบางส่วนตามประเด็น ไม่ใช่การรับรองความถูกต้องทุกเส้นทางของโปรแกรม

## Git ที่ตรวจพบ

- Remote: `https://github.com/Nattawut539/project2.git`
- Branch ปัจจุบัน: `deployment/production-preparation`
- HEAD และ remote branch นี้: `6b47809848560492b885f860a8e001dd5cf33653`
- main และ remote main: `fc54836d255f5554679ce6751cd278d83a82e240`
- main ตามหลัง branch ปัจจุบัน 3 commit และไม่มี commit ที่แยกไปอีกทาง ณ เวลาตรวจ
- ตรวจ remote สดด้วย `git -c http.sslBackend=openssl ls-remote --heads origin` สำเร็จ การเรียกแบบค่าเดิมล้มเหลวด้วย Schannel `SEC_E_NO_CREDENTIALS`; ไม่ได้เปลี่ยน Git config ถาวร และไม่ได้ปิดการตรวจ TLS
- ตรวจสอบสิทธิ์ push และ default branch บน GitHub ไม่ได้จากคำสั่งนี้

สาม commit ที่ยังไม่อยู่ใน main:

1. `4b2dd35b` Fix walk-in intake and patient search; require medical data consent
2. `f10f3156` Diagnose Google Drive deployment failures without exposing credentials
3. `6b478098` Calculate dashboard BMI immediately from manually entered vitals

สถานะก่อนเริ่มตรวจ:

```text
 M frontend/src/app/(admin)/admin/dashboard/page.tsx
?? reports/
```

ไฟล์รายงานฉบับนี้เป็นไฟล์ใหม่ที่เพิ่มจากการตรวจ ไม่ได้ stage, commit, merge หรือ push อะไร

## สิ่งที่ควรจัดการก่อนส่ง

### 1. ส่ง branch ที่มีโค้ดล่าสุด

ถ้าส่ง URL ของ repository เฉย ๆ อาจารย์อาจเปิด branch ที่ไม่มีงานล่าสุด ควรนำงานที่ตรวจแล้วเข้า main ผ่าน PR หรือส่งลิงก์ branch นี้โดยตรง:

`https://github.com/Nattawut539/project2/tree/deployment/production-preparation`

ลิงก์นี้ยังไม่รวม working diff และ reports ที่ไม่ได้ commit ควรบันทึก commit SHA ที่ใช้ส่งหลังเตรียมเสร็จ เพื่อให้ระบุรุ่นได้แน่นอน

### 2. เพิ่ม README.md ที่ root

ยังไม่มี root README และ `frontend/README.md` เป็นข้อความเริ่มต้นของ create-next-app ควรมี:

- ชื่อโครงงาน วัตถุประสงค์ ผู้จัดทำ และขอบเขตที่ทำเสร็จ/รอฮาร์ดแวร์
- โครงสร้าง Next.js frontend, Express backend, PostgreSQL และบริการภายนอก
- Node.js ที่รองรับ (`>=20 <23`; รอบนี้ทดสอบด้วย v22.12.0), ขั้นตอน `npm ci` แยกสองโฟลเดอร์
- ขั้นตอนสร้างฐานข้อมูลว่างด้วย schema และลำดับ migration ที่ได้ทดลองจริง
- วิธีคัดลอก `.env.example` และปรับสำหรับ local เพราะตัวอย่าง backend ใช้ `NODE_ENV=production`, secure cookie, HTTPS และค่าบริการภายนอก ส่วน frontend ชี้ placeholder HTTPS backend
- วิธีสร้างบัญชีทดสอบและผู้ดูแลในฐานข้อมูลจำลอง โดยไม่ใส่รหัสผ่านระบบจริง
- คำสั่งเริ่มสองส่วน URL ที่เปิด วิธีทดสอบ และลิงก์เอกสารประกอบ

ยังไม่ได้ทดลองติดตั้งด้วย fresh clone และฐานข้อมูลว่าง จึงยังยืนยันขั้นตอน onboarding ตั้งแต่ต้นไม่ได้

### 3. ตรวจ working diff ของ Dashboard ก่อน commit

มีการลบ `<p id="receipt-queue-hint">` แถวเดิม 1908 แต่ยังมี `aria-describedby="receipt-queue-hint"` ที่แถว 1953 ของไฟล์ปัจจุบัน ทำให้คำอธิบายที่ผูกกับช่องกรอกหายไป ควรคืนข้อความหรือปรับ reference ให้ตรงกับ UI ที่ต้องการก่อน commit แม้ build และ lint ผ่าน

ไม่ได้แก้หรือย้อนการเปลี่ยนแปลงเดิมของผู้ใช้

### 4. เอาไฟล์ตั้งค่าเครื่องส่วนตัวออกจากการติดตาม

`.codesight/default.json` ถูก tracked และมี absolute path ของเครื่องผู้พัฒนา ไม่จำเป็นต่อการรันโครงงาน ควรเพิ่ม `/.codesight/` ใน `.gitignore` และใช้ `git rm --cached -- .codesight/default.json` เพื่อเลิกติดตามโดยเก็บไฟล์ในเครื่องไว้

การเพิ่ม ignore อย่างเดียวไม่ทำให้ไฟล์ที่ tracked อยู่แล้วออกจาก Git คำสั่งข้างต้นเป็นข้อเสนอ ยังไม่ได้รัน

### 5. เปลี่ยน JWT secret ก่อนใช้กับข้อมูลจริง

การเปรียบเทียบค่าลับใน `.env` กับโค้ดพบว่า JWT_SECRET ในเครื่องเป็นค่าแบบพัฒนาที่ปรากฏในประวัติ source และเป็นส่วนหนึ่งของ development fallback ใน `backend/tools/config.js:8` ด้วย ไม่แสดงค่าลับในรายงาน

ค่าในเครื่องยาว 20 ตัวอักษรและไม่ได้กำหนด NODE_ENV ส่วน production config ปัจจุบันบังคับ secret อย่างน้อย 32 ตัวอักษร ควรสร้างค่าสุ่มใหม่สำหรับแต่ละ environment ที่ใช้งานจริง หากเคยใช้ค่าเดิมกับระบบที่มีผู้ใช้งาน ต้องเปลี่ยนค่าใน environment นั้นและให้เข้าสู่ระบบใหม่ ไม่ได้ตรวจค่า environment บน Render และไม่ได้เปลี่ยน secret ระหว่าง audit

## ควร push / ไม่ควร push

| รายการ | ข้อเสนอ | เหตุผล |
|---|---|---|
| `frontend/src/`, `frontend/public/` | Push | ตัวระบบและ asset ที่ใช้แสดงผล; รูปควรเป็นภาพที่มีสิทธิ์ใช้และไม่มีข้อมูลผู้ป่วย |
| `backend/routes/`, `backend/services/`, `backend/tools/`, `backend/server.js` | Push | API, business logic และเครื่องมือที่โครงงานใช้ |
| `backend/tests/`, `frontend/tests/` | Push | หลักฐานและวิธีทดสอบซ้ำ |
| `package.json` และ `package-lock.json` ทั้งสองส่วน | Push | ติดตั้ง dependencies ให้ตรงรุ่น; ไม่ควรลบ lockfile |
| `.env.example` ทั้งสองส่วน | Push | ตรวจแล้วเป็น placeholder/ช่องว่าง ไม่ใช่ไฟล์ค่าจริง |
| `database/*.sql`, `DATABASE_DICTIONARY_TH.md` | Push | Schema/migrations และคำอธิบายฐานข้อมูล; SQL ที่ตรวจไม่พบ dump ผู้ป่วย มี seed ตารางเวลาและ SQL สำหรับงานระบบ |
| Dockerfile, `.dockerignore`, `render.yaml`, config ของ Next/TS/ESLint | Push | ใช้ build/deploy; render.yaml อ้าง production branch ปัจจุบันและใช้ sync:false/generated secret |
| เอกสาร root และ `docs/` | Push | ใช้อธิบายโครงงาน แต่ต้องระบุวันและขอบเขตของผลทดสอบเก่าให้ชัด |
| `reports/Hardware_Team_Handoff_Report_TH.html` | Push ได้ | ต้นฉบับรายงานที่แก้ไขและตรวจ diff ได้ |
| `reports/Hardware_Team_Handoff_Report_TH.pdf` | เหมาะสำหรับแนบส่งหลังตรวจหน้าเอกสาร | อ่านสะดวก ขนาดประมาณ 251 KB; รอบนี้ยังไม่ได้เปิดตรวจภาพทุกหน้า/metadata ของ PDF |
| `reports/Hardware_Team_Handoff_Report_TH.docx` | Push ได้หากต้องส่งไฟล์แก้ไข | ขนาดประมาณ 44 KB; เนื้อหาข้อความที่ดึงอ่านเป็นรายงานฮาร์ดแวร์ ไม่จำเป็นต้องมีทั้งสามรูปแบบถ้าอาจารย์ไม่ได้ต้องการ |
| `backend/uploads/.gitkeep` | Push | รักษาโครงสร้างโฟลเดอร์ว่าง |
| `backend/.env`, `frontend/.env.local`, `.env` ค่าจริง | ไม่ push | ข้อมูลรับรองและการตั้งค่าเฉพาะเครื่อง; ปัจจุบันถูก ignore |
| `backend/uploads/profiles/` | ไม่ push | รูปที่อัปโหลด/อาจเป็นข้อมูลส่วนบุคคล; ปัจจุบันถูก ignore |
| `node_modules/`, `.next/`, npm cache, tsbuildinfo, next-env.d.ts | ไม่ push | สร้างใหม่ได้; ปัจจุบันถูก ignore |
| `.local-backups/`, `.vscode/`, `.hardware-test/` | ไม่ push | สำรองข้อมูล การตั้งค่าเครื่อง และผลจำลอง; ปัจจุบันถูก ignore |
| `.codesight/` | ไม่ควร push | เป็นการตั้งค่าเครื่องและมี local path แต่ปัจจุบันยัง tracked |
| Database dump, credential JSON, private key, logs/ภาพที่มีข้อมูลผู้ป่วย | ไม่ push | ใช้ schema และข้อมูลจำลองแทน; `.gitignore` ไม่ใช่ตัวตรวจข้อมูลลับทุกชนิด |

รายงานฮาร์ดแวร์ระบุสถานะ ณ 16 กันยายน 2569 และยังรอทดสอบเครื่องจริง ไม่ควรแก้ข้อความให้กลายเป็น “ผ่านทั้งหมด” จากผล unit tests รอบนี้ เนื้อหา HTML และข้อความหลักของ DOCX ถูกอ่านตรวจ แต่ไม่ได้รับรองเนื้อหาแฝง รูปภาพ หรือ metadata ของไฟล์เอกสารทั้งหมด

## ข้อมูลลับและประวัติ Git

- ตรวจรูปแบบ private key, Google API key/OAuth secret, GitHub token, JWT และ URL ที่มี password ใน tracked files และ HTML report
- เทียบค่าลับที่เข้าข่ายจาก env ในเครื่องโดยไม่พิมพ์ค่าลงผลลัพธ์ พบประเด็น JWT ตามที่อธิบายด้านบน ไม่พบค่าจริงอื่นจากวิธีตรวจนี้
- URL ของฐานข้อมูลที่ scanner พบใน `.env.example` เป็น placeholder `user:password@host` ไม่ใช่หลักฐานว่ามี credential จริงรั่ว
- สแกน historical text blobs 413 รายการจาก refs ที่มีในเครื่อง ไม่รวม dependencies/build output และไฟล์ไบนารี ไม่ใช่ secret scanner ครบทุกชนิดหรือทุก object ที่ไม่มี ref
- ไม่พบไฟล์ `.env` ค่าจริงในรายชื่อ path ประวัติที่ตรวจ แต่การไม่พบไม่ใช่หลักฐานว่าทุก commit ปราศจากข้อมูลลับ
- พบว่าเคย commit `backend/node_modules` ในอดีต แม้ปัจจุบันเลิกติดตามแล้ว โดยมีรายการ object/path ใต้ node_modules 2,888 รายการในการไล่ประวัติ
- `git count-objects -vH` รายงาน loose objects ประมาณ 542.53 MiB และ pack ประมาณ 151.96 MiB; ตัวเลขนี้เป็นพื้นที่ Git ในเครื่อง ไม่ใช่ขนาดดาวน์โหลดจาก GitHub ที่ยืนยันแล้ว
- ไม่ต้อง rewrite history หรือ force-push เพื่อส่งงานเพียงอย่างเดียว หากต้องการ repo สำหรับส่งที่สะอาด อาจเตรียม repo ใหม่จากไฟล์ที่เลือกโดยเก็บ repo เดิมไว้ แต่ยังไม่ได้ทำในรอบนี้

## ผลตรวจที่รันจริง

| รายการ | ผล |
|---|---|
| `node --test backend/tests/*.test.js frontend/tests/*.test.cjs` จาก root | ผ่าน 45/45, fail 0, skip 0 |
| `npm run lint` ใน frontend | ผ่าน |
| `npm run build` ใน frontend | ผ่าน compile, lint/type validation และ static generation 34/34 |
| `npm audit --json --ignore-scripts` ใน backend | ช่องโหว่ที่ registry รายงาน 0 |
| คำสั่ง audit เดียวกันใน frontend | ช่องโหว่ที่ registry รายงาน 0 |
| `git diff --check` | ไม่พบ whitespace error; มีคำเตือน LF จะถูกเปลี่ยนเป็น CRLF |
| ตรวจ branch สดกับ GitHub | สำเร็จโดยเลือก OpenSSL เฉพาะคำสั่ง |

ผล build ใช้ dependencies และ `.env.local` ที่มีอยู่ในเครื่อง ไม่ใช่ผลติดตั้งจาก clean clone ผล npm audit เป็นสถานะฐานข้อมูลช่องโหว่ ณ เวลารัน ไม่ใช่การรับรองความปลอดภัยของแอปทั้งหมด

ไม่ได้รัน workflow tests ที่สร้าง/แก้ข้อมูลจริง ไม่ได้ทดสอบฐานข้อมูลว่าง SMTP, Google/LINE OAuth, Google Drive จริง, broker จริง, เครื่องชั่งหรือเครื่องพิมพ์จริง และไม่ได้ทดสอบ UI ทุกหน้าในเบราว์เซอร์

## ลำดับเตรียมส่งที่แนะนำ

1. เพิ่ม root README พร้อมทดลองขั้นตอนกับฐานข้อมูลจำลองบนเครื่องใหม่
2. จัดการ Dashboard diff และเอา `.codesight/default.json` ออกจาก tracking
3. เลือกรายงานที่จะส่ง ตรวจ PDF ทุกหน้า และระบุขอบเขตผลทดสอบตามจริง
4. ตรวจ `git status --short` แล้ว stage เฉพาะไฟล์ที่ตั้งใจส่ง หลีกเลี่ยง `git add .` โดยไม่ตรวจรายการ
5. ตรวจ `git diff --cached --stat` และ `git diff --cached` ก่อน commit
6. Commit/push branch ที่เตรียม แล้วใช้ PR เข้า main หรือส่ง URL branch พร้อม commit SHA ให้ชัดเจน
7. ตรวจว่าอาจารย์เปิด repository ได้ หาก private ให้จัดสิทธิ์เข้าถึงตามที่ตกลงกัน และส่งบัญชี demo แยกช่องทางจาก source code

รายงานฉบับนี้ไม่มีการเปลี่ยนโค้ดแอป, Git index, branches, remote config หรือ deployment
