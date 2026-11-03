# ARCHITECTURE

## 1. ภาพรวม

```
เบราว์เซอร์ (SPA ใน index.html)
   │  google.script.run  (ผ่าน helper callServer)
   ▼
Apps Script (Code.gs + โมดูล .gs)
   ├── Google Sheets  ← ฐานข้อมูล
   ├── Google Drive   ← ไฟล์งานวิจัย
   ├── Resend API     ← อีเมล (UrlFetchApp)
   └── CacheService   ← OTP, session
YouTube (iframe ฝังตรงจากหน้าเว็บ)
```

Deploy เป็น Web App:
- **Execute as:** Me (บัญชีเจ้าของสคริปต์) → ไฟล์ทุกไฟล์เข้า Drive ของบัญชีนี้
- **Who has access:** Anyone → บุคคลภายนอกไม่ต้องมีบัญชี Google

> **แนะนำให้สร้างโปรเจกต์ด้วยบัญชี Google Workspace ของโรงเรียน** (ไม่ใช่ Gmail ส่วนตัว) เพื่อให้ไฟล์เป็นของหน่วยงาน และใช้การแชร์ไฟล์แบบ "ทุกคนในโดเมน" กับคลังงานวิจัยได้ ถ้าจำเป็นต้องใช้ Gmail ส่วนตัว ให้คลังงานวิจัยเปิดไฟล์ผ่านฟังก์ชัน `getFileForViewer` (ข้อ 6) แทนการแชร์ลิงก์ Drive

## 2. โครงไฟล์

```
research-platform/
├── CLAUDE.md
├── README.md
├── docs/
├── .clasp.json            ← สร้างโดย clasp create (rootDir = src)
└── src/
    ├── appsscript.json    ← manifest
    ├── Code.gs            ← doGet, include(), wrapApi_()
    ├── config.gs          ← getConfig_(), ค่าคงที่, enum
    ├── db.gs              ← helper อ่าน/เขียน Sheets ตามชื่อคอลัมน์
    ├── auth.gs            ← OTP, session, requireRole_()
    ├── submissions.gs     ← สร้าง/finalize/ติดตาม/ส่งฉบับแก้ไข
    ├── files.gs           ← รับไฟล์ base64, ตรวจชนิด/ขนาด, บันทึก Drive
    ├── admin.gs           ← เปลี่ยนสถานะ, จัดการ Timeline/วิดีโอ/รอบ
    ├── public.gs          ← getHomeData, getTimeline, getVideos, getDocuments, getNews, getLibrary
    ├── email.gs           ← sendEmail_() + template ภาษาไทย
    ├── setup.gs           ← setup(): สร้างแท็บ หัวคอลัมน์ โฟลเดอร์
    ├── triggers.gs        ← ลบ draft ค้าง (รายวัน)
    ├── tests.gs           ← ฟังก์ชันทดสอบรันใน editor
    ├── index.html         ← โครง SPA: header, nav, <main id="app">
    ├── css_main.html      ← tailwind.config (token จาก DESIGN.md) + class component (.btn-primary ฯลฯ)
    ├── js_app.html        ← callServer, router, state, util (escape, format วันที่ไทย)
    ├── js_ui.html         ← component JS: toast, modal, dropzone, statusBadge, pagination, skeleton
    ├── js_upload.html     ← อ่านไฟล์เป็น base64 + progress
    ├── page_styleguide.html ← รวมทุก component (route `styleguide` เปิดได้เฉพาะ admin หรือ Test deployment)
    ├── page_home.html     ← หน้าแรก
    ├── page_timeline.html ← กำหนดการเต็ม
    ├── page_news.html     ← รายการข่าว + รายละเอียดข่าว
    ├── page_documents.html ← ศูนย์ดาวน์โหลดเอกสาร
    ├── page_register.html ← ฟอร์ม Oral/Poster
    ├── page_teacher.html  ← ส่งงานครู + งานของฉัน
    ├── page_track.html    ← ติดตามสถานะ + ส่งฉบับแก้ไข
    ├── page_library.html  ← คลังงานวิจัย
    ├── page_videos.html   ← คลังวิดีโอ
    ├── page_login.html    ← ขอ OTP / ใส่ OTP
    └── page_admin.html    ← หน้าแอดมิน
```

แต่ละ `page_*.html` เป็น `<template id="tpl-xxx">` + `<script>` ที่ลงทะเบียนฟังก์ชัน `render(params)` กับ router ใน `js_app.html`

## 3. Routing (SPA)

- `doGet(e)` คืน `index.html` เสมอ และฝังพารามิเตอร์เริ่มต้น (`e.parameter.page`, `e.parameter.t`) ลงตัวแปร JS
- เปลี่ยนหน้าในฝั่ง client ด้วย `google.script.history.push(state, query)` และฟัง `google.script.history.setChangeHandler`
- ไม่ reload หน้า session token จึงอยู่ในหน่วยความจำได้ตลอด (เก็บสำรองใน `sessionStorage` แบบห่อ try/catch)
- route: `home`, `timeline`, `news`, `documents`, `videos`, `register`, `teacher`, `track`, `library`, `login`, `admin`, `styleguide` (ดูเมนูและสิทธิ์ใน `docs/DESIGN.md` ข้อ 5)

## 4. รูปแบบการเรียก server

```js
// js_app.html
function callServer(fn, ...args) {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(res => res && res.ok ? resolve(res.data) : reject(new Error(res ? res.error : 'ไม่มีการตอบกลับ')))
      .withFailureHandler(err => reject(new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่')))
      [fn](...args);
  });
}
```

```js
// Code.gs
function wrapApi_(fn) {
  try { return { ok: true, data: fn() }; }
  catch (e) {
    console.error(e && e.stack || e);
    return { ok: false, error: e && e.userMessage ? e.userMessage : 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
  }
}
function userError_(msg) { const e = new Error(msg); e.userMessage = msg; return e; }
```

ทุก public function มีรูปแบบ:
```js
function getMySubmissions(sessionToken) {
  return wrapApi_(() => {
    const user = requireRole_(sessionToken, ['teacher', 'reviewer', 'admin']);
    // ...
  });
}
```

## 5. Authentication

**บุคคลภายนอก:** ไม่มีบัญชี ใช้ `track_token` (UUID) ในลิงก์ที่ส่งทางอีเมลเพื่อดูและแก้ไขงานของตัวเองเท่านั้น

**ครู / reviewer / admin:** ล็อกอินด้วย OTP
1. `requestOtp(email)`: ต้องเป็นอีเมลโดเมน `SCHOOL_EMAIL_DOMAIN` หรืออยู่ในแท็บ `ADMINS` → สร้างรหัส 6 หลัก เก็บ hash ใน `CacheService` 10 นาที → ส่งอีเมล
   - จำกัดการขอ 3 ครั้ง / 10 นาที / อีเมล
   - ตอบข้อความเดียวกันเสมอไม่ว่าอีเมลมีสิทธิ์หรือไม่ (กันการเดาอีเมล)
2. `verifyOtp(email, code)`: ผิดได้ไม่เกิน 5 ครั้ง → สร้าง session token (UUID) เก็บใน `CacheService` 6 ชม. คืน `{ token, email, role, name }`
3. ทุก API ที่ต้องล็อกอินรับ `sessionToken` เป็นพารามิเตอร์แรก แล้วเรียก `requireRole_()`
4. role: อยู่ใน `ADMINS` (active) → `admin`/`reviewer` ไม่อย่างนั้น โดเมนโรงเรียน → `teacher`

(ทางเลือกภายหลัง: ถ้า deploy จากบัญชี Workspace โรงเรียน อาจลองใช้ `Session.getActiveUser()` ระบุครูอัตโนมัติ แต่ผลขึ้นกับนโยบายโดเมนและการตั้งค่า access จึงไม่ใช้เป็นวิธีหลัก)

## 6. การอัปโหลดไฟล์

ลำดับการส่งงาน 1 ครั้ง (ไม่ส่งทุกไฟล์ใน request เดียว เพราะ payload ใหญ่เกิน):

1. client ตรวจชนิดและขนาดไฟล์ก่อน
2. `createSubmission(payload)` → server validate, สร้าง PRESENTERS (หรือใช้คนเดิม) + SUBMISSIONS สถานะ `draft` + โฟลเดอร์ Drive → คืน `{ submissionId, uploadKey }` (`uploadKey` อายุ 1 ชม. เก็บใน Cache)
3. ต่อแต่ละไฟล์: `uploadFile(submissionId, uploadKey, fileKind, name, mimeType, base64)` → server ตรวจอีกรอบ (นามสกุล, MIME, ขนาดหลัง decode, magic bytes `%PDF` / `PK`) → `DriveApp.createFile(blob)` ในโฟลเดอร์ของงาน → บันทึก FILES
   - client แสดง progress ทีละไฟล์ และ retry อัตโนมัติ 2 ครั้งถ้าล้มเหลว
4. `finalizeSubmission(submissionId, uploadKey)` → ตรวจว่ามีไฟล์ครบตาม `REQUIRED_FILES[type]` → สถานะ `submitted` → STATUS_LOG → ส่งอีเมล → คืนรหัสงาน
5. draft ที่ไม่ finalize ภายใน 24 ชม. ถูกลบโดย trigger รายวัน

ขนาดไฟล์สูงสุดเริ่มต้น 20 MB ต่อไฟล์ (base64 ทำให้ payload ใหญ่ขึ้นราว 33%)

**การเปิดไฟล์:**
- แอดมิน/เจ้าของงาน: `getFileForViewer(sessionOrTrackToken, fileId)` ตรวจสิทธิ์แล้วคืน base64 ให้ client สร้าง Blob URL เปิดในแท็บใหม่ (หรือคืน URL Drive ถ้าบัญชีผู้ใช้มีสิทธิ์อยู่แล้ว)
- คลังงานวิจัย (Workspace): เมื่องานเข้าคลัง ตั้ง `setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW)` แล้วให้ลิงก์ Drive
- ศูนย์ดาวน์โหลดเอกสารและรูปปกข่าว: เป็นข้อมูลสาธารณะ ตั้ง `setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)` ตอนแอดมินอัปโหลด ลิงก์ดาวน์โหลด `https://drive.google.com/uc?export=download&id={fileId}` **ห้ามใช้วิธีนี้กับไฟล์งานวิจัยที่ผู้ใช้ส่งมา**

## 7. การเขียน Sheets และ concurrency

- `withLock_(fn)` ใช้ `LockService.getScriptLock().waitLock(20000)` ครอบทุกการเขียน
- สร้าง `submission_id` แบบเรียงลำดับภายใต้ lock (นับจากแถวที่ prefix ปีเดียวกัน)
- `db.gs` มี: `getSheet_(name)`, `readAll_(name)` → array ของ object, `findBy_(name, col, value)`, `insert_(name, obj)`, `updateBy_(name, keyCol, keyValue, patch)`
- cache ข้อมูลที่อ่านบ่อยและเปลี่ยนน้อย (Timeline, วิดีโอ) ใน `CacheService` 10 นาที และล้าง cache เมื่อแอดมินแก้

## 8. Config (Script Properties)

| key | ตัวอย่าง | ใช้ทำอะไร |
|---|---|---|
| `SPREADSHEET_ID` | `1AbC...` | ฐานข้อมูล (setup() ตั้งให้อัตโนมัติ) |
| `ROOT_FOLDER_ID` | `1XyZ...` | โฟลเดอร์รากใน Drive (setup() ตั้งให้) |
| `RESEND_API_KEY` | `re_...` | ส่งอีเมล |
| `EMAIL_FROM` | `หน่วยส่งเสริมงานวิจัย <research@โดเมน>` | ผู้ส่ง (โดเมนต้อง verify ใน Resend) |
| `ADMIN_NOTIFY_EMAIL` | `research@...` | รับแจ้งเตือนฝั่งแอดมิน |
| `SCHOOL_EMAIL_DOMAIN` | `example.ac.th` | โดเมนอีเมลครู |
| `WEBAPP_URL` | `https://script.google.com/macros/s/.../exec` | ใช้สร้างลิงก์ในอีเมล |
| `MAX_FILE_MB` | `20` | ขนาดไฟล์สูงสุด |

## 9. Checklist ความปลอดภัย

- [ ] public function ทุกตัวตรวจสิทธิ์และ validate input (ความยาว, enum, รูปแบบอีเมล)
- [ ] helper ทุกตัวลงท้ายด้วย `_`
- [ ] ไม่ส่ง `track_token`, อีเมล, เบอร์โทรของผู้อื่นให้ client
- [ ] แสดงข้อมูลผู้ใช้ด้วย `textContent` / escape
- [ ] ไม่มี API key ในโค้ด
- [ ] ไฟล์ใน Drive ไม่แชร์สาธารณะ
- [ ] จำกัดอัตราการขอ OTP และการลองรหัส
- [ ] ค่า `track_token` และ session เป็น UUID สุ่ม ไม่เดาได้
