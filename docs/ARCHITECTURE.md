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
    ├── page_styleguide.html ← รวมทุก component (route `styleguide` เปิดได้เฉพาะ admin หรือเจ้าของสคริปต์ที่ล็อกอิน Google อยู่ ตรวจด้วย `isScriptOwner_()` ใน Code.gs)
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

- `doGet(e)` คืน `index.html` เสมอ และฝังพารามิเตอร์เริ่มต้น (`page`, `t`, `id`) ลงตัวแปร JS
- ลิงก์ภายในใช้ `<a href="#" data-route="news" data-param-id="NEWS-xxxx">` router แปลง `data-param-*` เป็นพารามิเตอร์ของหน้า
- `render(container, params, isCurrent)` ของแต่ละหน้า: หลัง `await callServer()` ต้องเช็ก `isCurrent()` ก่อนเขียน DOM (ผู้ใช้อาจเปลี่ยนหน้าไปแล้ว)
- เปลี่ยนหน้าในฝั่ง client ด้วย `google.script.history.push(state, query)` และฟัง `google.script.history.setChangeHandler`
- ไม่ reload หน้า session token จึงอยู่ในหน่วยความจำได้ตลอด (เก็บสำรองใน `sessionStorage` แบบห่อ try/catch)
- route: `home`, `timeline`, `news`, `documents`, `videos`, `register`, `teacher`, `track`, `library`, `login`, `admin`, `privacy`, `styleguide` (ดูเมนูและสิทธิ์ใน `docs/DESIGN.md` ข้อ 5)
- ค่าที่หน้าเว็บต้องใช้ (ป้ายสถานะ, ชนิดไฟล์, ไฟล์บังคับ, `MAX_FILE_MB`, ข้อมูลติดต่อ) มาจาก `getClientConfig_()` ใน config.gs ผ่าน `data-config` ของ `<body>` ฝั่ง client อ่านจาก `appConfig` ห้ามเขียนค่าเหล่านี้ซ้ำในฝั่ง client

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

รายละเอียดที่ทำไว้ (เฟส 4, `auth.gs`):
- OTP สุ่มจาก SHA-256 ของ UUID เก็บเฉพาะ hash (ผูกกับอีเมล) ใช้ได้ครั้งเดียว นับครั้งที่ผิดภายใต้ lock
- จำกัดการขอรหัสกับ**ทุก**อีเมล (รวมที่ไม่มีสิทธิ์) จึงใช้ข้อความ "ขอบ่อยเกินไป" แยกอีเมลที่มีสิทธิ์ไม่ได้
- `requireRole_()` ของ admin/reviewer ตรวจแท็บ `ADMINS` ซ้ำทุกครั้ง ถอดสิทธิ์แล้วมีผลทันที
- session หมดอายุ/ไม่มี: error มี `code: 'SESSION_EXPIRED'` (`userError_(msg, code)` + `wrapApi_` ส่ง `code` ไปด้วย) `callServer` ล้าง session แล้วพาไปหน้าเข้าสู่ระบบ (เฉพาะหน้าที่ต้องล็อกอิน)
- เปิดหน้าเว็บพร้อม session ใน `sessionStorage` → ตรวจด้วย `getMe()` เบื้องหลัง / ออกจากระบบเรียก `logout()` ลบ session ฝั่ง server
- ครูที่ยังไม่เคยส่งงานไม่มีชื่อในระบบ (แสดงอีเมลแทน) ชื่อบันทึกใน `PRESENTERS` ตอนส่งงานครั้งแรก

งานครู: `createTeacherSubmission(sessionToken, payload)` → `uploadFile` / `finalizeSubmission` ชุดเดียวกับบุคคลภายนอก (ทั้งสองใช้ `createDraftSubmission_()`) / `getMySubmissions(sessionToken)` ฝั่ง client ใช้ `runSubmissionUpload()` (js_upload.html) และ `createSubmissionSuccess()` (js_ui.html) ร่วมกับหน้าลงทะเบียน

(ทางเลือกภายหลัง: ถ้า deploy จากบัญชี Workspace โรงเรียน อาจลองใช้ `Session.getActiveUser()` ระบุครูอัตโนมัติ แต่ผลขึ้นกับนโยบายโดเมนและการตั้งค่า access จึงไม่ใช้เป็นวิธีหลัก)

## 6. การอัปโหลดไฟล์

ลำดับการส่งงาน 1 ครั้ง (ไม่ส่งทุกไฟล์ใน request เดียว เพราะ payload ใหญ่เกิน):

1. client ตรวจชนิดและขนาดไฟล์ก่อน
2. `createSubmission(payload)` → server validate, สร้าง PRESENTERS (หรือใช้คนเดิม) + SUBMISSIONS สถานะ `draft` + โฟลเดอร์ Drive → คืน `{ submissionId, uploadKey }` (`uploadKey` อายุ 1 ชม. เก็บใน Cache)
3. ต่อแต่ละไฟล์: `uploadFile(submissionId, uploadKey, fileKind, name, mimeType, base64)` → server ตรวจอีกรอบ (นามสกุล, MIME, ขนาดหลัง decode, magic bytes `%PDF` / `PK`) → `DriveApp.createFile(blob)` ในโฟลเดอร์ของงาน → บันทึก FILES
   - client แสดง progress ทีละไฟล์ และ retry อัตโนมัติ 2 ครั้งถ้าล้มเหลว
4. `finalizeSubmission(submissionId, uploadKey)` → ตรวจว่ามีไฟล์ครบตาม `REQUIRED_FILES[type]` → สถานะ `submitted` → STATUS_LOG → ส่งอีเมล → คืนรหัสงาน
5. draft ที่ไม่ finalize ภายใน 24 ชม. ถูกลบโดย trigger รายวัน

รายละเอียดที่ทำไว้ (เฟส 2):
- `createSubmission` ตรวจช่วงเปิดรับซ้ำฝั่ง server และจำกัด 5 ครั้ง / ชม. / อีเมล (กันการสร้าง draft และโฟลเดอร์รัวๆ)
- ตรวจไฟล์ด้วย `validateUploadedFile_()` (files.gs) ซึ่งไม่แตะ Drive/Sheets จึงทดสอบได้ด้วย `runSubmissionTests()` ใน tests.gs
- งาน draft ส่งไฟล์ชนิดเดิมซ้ำ (เปลี่ยนไฟล์ / ลองใหม่): ไฟล์เดิมถูกย้ายไปถังขยะ Drive และยังเป็น version 1 / ฉบับแก้ไขหลังส่งแล้ว (เฟส 3) จึงเป็น version + 1
- `finalizeSubmission` อ่านสถานะซ้ำภายใต้ lock กันกดส่งซ้อน แล้วลบ `uploadKey` ทิ้ง
- ฝั่ง client (`js_upload.html`): `google.script.run` ไม่มี progress event จริง progress bar จึงเป็น 0–30% อ่านไฟล์ → 30–90% ค่อยๆ เพิ่มระหว่างรอ → 100% สำเร็จ / ลองใหม่อัตโนมัติ 2 ครั้งเฉพาะกรณีเชื่อมต่อไม่ได้ / กดลองใหม่จะส่งเฉพาะไฟล์ที่ยังไม่สำเร็จ ไม่สร้างงานซ้ำ

ขนาดไฟล์สูงสุดเริ่มต้น 20 MB ต่อไฟล์ (base64 ทำให้ payload ใหญ่ขึ้นราว 33%)

**การเปิดไฟล์:**
- แอดมิน/เจ้าของงาน: `getFileForViewer(sessionOrTrackToken, fileId)` ตรวจสิทธิ์แล้วคืน base64 ให้ client สร้าง Blob URL เปิดในแท็บใหม่ (หรือคืน URL Drive ถ้าบัญชีผู้ใช้มีสิทธิ์อยู่แล้ว)
- คลังงานวิจัย (Workspace): เมื่องานเข้าคลัง ตั้ง `setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW)` แล้วให้ลิงก์ Drive
- ศูนย์ดาวน์โหลดเอกสารและรูปปกข่าว: เป็นข้อมูลสาธารณะ ตั้ง `setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)` ตอนแอดมินอัปโหลด ลิงก์ดาวน์โหลด `https://drive.google.com/uc?export=download&id={fileId}` **ห้ามใช้วิธีนี้กับไฟล์งานวิจัยที่ผู้ใช้ส่งมา**

**ติดตามสถานะและฉบับแก้ไข (เฟส 3)** ใช้ `track_token` จากลิงก์ในอีเมลแทนการล็อกอิน:
- `getTrackingInfo(trackToken)`: สถานะ ประวัติ หมายเหตุ ไฟล์ปัจจุบัน ไม่คืน token / อีเมล / เบอร์โทร / ผู้เปลี่ยนสถานะ / `drive_file_id` และงาน draft ถือว่าไม่พบ
- ฉบับแก้ไขเป็น 3 ขั้นเหมือนการส่งงาน: `startRevision(trackToken)` → `uploadRevisionFile(trackToken, uploadKey, ...)` ทีละไฟล์ → `submitRevision(trackToken, uploadKey)`
  - ทำได้เฉพาะสถานะ `revision_requested` ส่งเฉพาะไฟล์ที่แก้ได้ แต่ต้องมีอย่างน้อย 1 ไฟล์ (นับจากไฟล์ที่อัปโหลดด้วย uploadKey รอบนั้น เก็บใน cache)
  - ไฟล์ใหม่เป็น version + 1 ไฟล์เดิมยังอยู่ (`is_current = FALSE`) → สถานะ `resubmitted` + STATUS_LOG (`changed_by = presenter`) + อีเมลถึงผู้ส่ง (`status_changed`) และ `ADMIN_NOTIFY_EMAIL` (`resubmitted_admin`)

**อีเมล (email.gs):**
- `sendEmail_(to, template, data, submissionId)` เรียก Resend ด้วย `UrlFetchApp` (`muteHttpExceptions`) ไม่ throw เสมอ บันทึก `EMAIL_LOG` ทุกครั้ง ส่งไม่สำเร็จเก็บสาเหตุในคอลัมน์ `error`
- `buildEmail_(template, data)` สร้าง subject + HTML (inline CSS ตาราง กว้างสุด 600px) + ข้อความล้วน escape ทุกค่า ปุ่มลิงก์สร้างเฉพาะ URL `https://`
- ลิงก์ในอีเมลใช้ Script Property `WEBAPP_URL` ถ้าไม่ได้ตั้งใช้ `ScriptApp.getService().getUrl()` / บุคคลภายนอกได้ลิงก์ `?page=track&t=` ครูได้ลิงก์ `?page=teacher`
- ทดสอบ: `runEmailTests()` (ไม่ส่งจริง) และ `sendTestEmail()` (ส่งจริงทุก template ไปหาเจ้าของสคริปต์)

## 7. การเขียน Sheets และ concurrency

- `withLock_(fn)` ใช้ `LockService.getScriptLock().waitLock(20000)` ครอบทุกการเขียน
- สร้าง `submission_id` แบบเรียงลำดับภายใต้ lock (นับจากแถวที่ prefix ปีเดียวกัน)
- `db.gs` มี: `getSheet_(name)`, `readAll_(name)` → array ของ object, `findBy_(name, col, value)`, `insert_(name, obj)`, `updateBy_(name, keyCol, keyValue, patch)`
- cache ข้อมูลสาธารณะ (รอบกิจกรรม, Timeline, ข่าว, เอกสาร, วิดีโอ) ใน `CacheService` 10 นาที ผ่าน `cachedRead_()` ใน public.gs
  - key ทุกตัวมี version นำหน้า แอดมินแก้ข้อมูลแล้วเรียก `clearPublicCache_()` (เปลี่ยน version) ล้างได้ทั้งหมดรวมถึงรายละเอียดข่าวแต่ละข่าว
- `doGet` ส่งรอบกิจกรรมปัจจุบันไปใน `appConfig.currentEvent` เพื่อให้ทุกหน้ารู้ว่าเปิดรับลงทะเบียนอยู่หรือไม่ (ฝั่ง server ต้องตรวจช่วงเวลาซ้ำตอนรับงานในเฟส 2)
- `db.gs` มีเพิ่ม: `insertMany_(name, objs)` เขียนหลายแถวครั้งเดียว, `deleteWhere_(name, predicate)` ลบหลายแถว

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
