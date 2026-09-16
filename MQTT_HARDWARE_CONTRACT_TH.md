# MQTT Contract สำหรับเครื่องชั่ง

เอกสารนี้เป็น contract ที่ firmware และเว็บต้องใช้ตรงกัน เวอร์ชัน `1.0`

## การเชื่อมต่อ

- Protocol: MQTT 3.1.1 หรือ MQTT 5
- Production URL: `mqtts://<broker>:8883`
- QoS: `1`
- Measurement และ OTP ต้องใช้ `retain=false`
- Encoding: UTF-8 JSON
- Payload สูงสุด: 16 KB
- `{deviceId}` ต้องตรงกับ `device_id` ใน JSON

## Flow A: จองออนไลน์

### 1. ตรวจ OTP

Publish:

```text
clinic/v1/devices/{deviceId}/otp-verify
```

```json
{
  "schema_version": "1.0",
  "request_id": "REQ-000001",
  "device_id": "SCALE-001",
  "otp": "123456"
}
```

Subscribe:

```text
clinic/v1/devices/{deviceId}/otp-result
```

สำเร็จ:

```json
{
  "request_id": "REQ-000001",
  "status": "accepted",
  "measurement_session_id": "4e31e4b2-5a14-4690-9297-3e926f266f97",
  "queue_number": "A001",
  "expires_at": "2026-09-06T03:35:00.000Z"
}
```

ไม่สำเร็จ:

```json
{
  "request_id": "REQ-000001",
  "status": "rejected",
  "error_code": "INVALID_OTP"
}
```

OTP error ที่แยกสถานะแล้ว:

- `INVALID_OTP` — รูปแบบรหัสไม่ถูกต้อง
- `OTP_NOT_FOUND` — ไม่พบรหัสในระบบ
- `OTP_EXPIRED` — หมดอายุหรือเลยวันนัดแล้ว
- `OTP_USED` — ใช้บันทึก Measurement สำเร็จไปแล้ว
- `OTP_NOT_ACTIVE_YET` — เป็น OTP ของวันนัดในอนาคต

### 2. ส่งผลวัด

Publish:

```text
clinic/v1/devices/{deviceId}/measurements
```

```json
{
  "schema_version": "1.0",
  "message_id": "MSG-A-000001",
  "device_id": "SCALE-001",
  "mode": "online",
  "measurement_session_id": "4e31e4b2-5a14-4690-9297-3e926f266f97",
  "measured_at": "2026-09-06T03:31:00.000Z",
  "weight": 60.0,
  "height": 170.0
}
```

## Flow B: Walk-in

เมื่อผู้ใช้กด B ให้วัดแล้ว Publish topic `/measurements` ได้ทันที ไม่ต้องส่ง OTP

```json
{
  "schema_version": "1.0",
  "message_id": "MSG-B-000001",
  "device_id": "SCALE-001",
  "mode": "walk_in",
  "measured_at": "2026-09-06T03:31:00.000Z",
  "weight": 60.0,
  "height": 170.0
}
```

เว็บจะเป็นผู้ออกเลข B ที่ไม่ซ้ำและบันทึกผลวัด

## Measurement ACK

Subscribe:

```text
clinic/v1/devices/{deviceId}/measurement-ack
```

```json
{
  "message_id": "MSG-B-000001",
  "status": "accepted",
  "measurement_id": 1025,
  "queue_number": "B009",
  "print_pending": true
}
```

`status` เป็น `accepted`, `duplicate` หรือ `rejected` หากส่งซ้ำต้องใช้ `message_id`
เดิม เว็บจะไม่สร้าง measurement หรือคิวซ้ำ

Error code ที่ firmware ต้องรองรับ:

- `INVALID_OTP`
- `OTP_NOT_FOUND`
- `OTP_EXPIRED`
- `OTP_USED`
- `OTP_NOT_ACTIVE_YET`
- `INVALID_SESSION`
- `INVALID_MODE`
- `DEVICE_MISMATCH`
- `WEIGHT_OUT_OF_RANGE`
- `HEIGHT_OUT_OF_RANGE`
- `RETAIN_NOT_ALLOWED`
- `RATE_LIMITED`
- `MESSAGE_ID_CONFLICT`
- `INTERNAL_ERROR`

## Print Job

หลัง Backend บันทึก Measurement และคำนวณ BMI แล้ว Backend จะสร้าง Print Job
ใน transaction เดียวกันและส่งผ่าน Outbox โดยไม่ต้องเปิดหน้า Admin Dashboard ค้างไว้

```text
clinic/v1/devices/{deviceId}/print
```

```json
{
  "schema_version": "1.0",
  "print_job_id": "PRINT-c2e863bf5d4b4ed1db1c990f",
  "message_id": "MSG-B-000001",
  "queue_number": "B009",
  "weight": 60.0,
  "height": 170.0,
  "bmi": 20.76,
  "measured_at": "2026-09-06T03:31:00.000Z"
}
```

Firmware ต้อง deduplicate ด้วย `print_job_id` และห้ามคำนวณ BMI ใหม่

Backend ใช้ `print_job_id` เดิมเมื่อส่งซ้ำ และ retry แบบ backoff 30/60 วินาที
รวมไม่เกิน 3 attempts หากได้ `PRINTER_NOT_CONNECTED`, `UNSUPPORTED_SCHEMA`,
`INVALID_PRINT_JOB` หรือ `INVALID_PRINT_DATA` จะหยุดส่งซ้ำทันที ส่วน error ชั่วคราว
เช่น `PAPER_OUT` จะรอตาม backoff ก่อนส่งงานเดิมอีกครั้ง

หลังพิมพ์ให้ Publish:

```text
clinic/v1/devices/{deviceId}/print-ack
```

```json
{
  "print_job_id": "PRINT-c2e863bf5d4b4ed1db1c990f",
  "device_id": "SCALE-001",
  "status": "printed"
}
```

หากพิมพ์ไม่สำเร็จ:

```json
{
  "print_job_id": "PRINT-c2e863bf5d4b4ed1db1c990f",
  "device_id": "SCALE-001",
  "status": "failed",
  "error_code": "PAPER_OUT"
}
```

## ข้อกำหนดสำคัญ

- Firmware ส่งเฉพาะน้ำหนักและส่วนสูง ไม่ส่ง BMI
- คิว A มาจาก OTP ที่เว็บตรวจสอบ
- คิว B สร้างโดยเว็บหลังรับผล Walk-in
- OTP ใช้เฉพาะการขอ session ห้ามส่งซ้ำใน measurement
- เก็บข้อความที่ยังไม่ได้ ACK และ reconnect อัตโนมัติ
- ห้ามพิมพ์ `print_job_id` เดิมซ้ำ แม้ได้รับ MQTT ซ้ำ

## Backend operations

- Payload ที่ใช้ `device_id + message_id` เดิมแต่ข้อมูลต่างจากเดิมจะถูกปฏิเสธด้วย `MESSAGE_ID_CONFLICT`
- Manual reprint เรียก `POST /api/hardware/reprint` และสร้าง `print_job_id` ใหม่เสมอ
- ตรวจ Health/Metric ได้ที่ `GET /api/hardware/health`
- ค้น Audit ตาม request/session/message/print job ID ได้ที่ `GET /api/hardware/events`
