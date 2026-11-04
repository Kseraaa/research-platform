# TASKS: แผนงานทีละเฟส

ทำตามลำดับ ทำเสร็จหนึ่งงานให้ทดสอบบน Test deployment แล้วติ๊ก `[x]` ก่อนเริ่มงานถัดไป
แต่ละเฟสมี **prompt ตัวอย่าง** สำหรับพิมพ์ใน Claude Code

---

## เฟส 0: โครงโปรเจกต์

- [x] สร้าง `src/` ตามโครงใน `docs/ARCHITECTURE.md` ข้อ 2 (ไฟล์ว่างพร้อมคอมเมนต์หน้าที่)
- [x] `config.gs`: `getConfig_()`, enum (`ROLES`, `SUBMISSION_TYPES`, `STATUSES`, `FILE_KINDS`, `REQUIRED_FILES`), ข้อความสถานะภาษาไทย
- [x] `db.gs`: helper อ่าน/เขียนตามชื่อคอลัมน์ + `withLock_()`
- [x] `setup.gs`: `SCHEMA` ตาม `docs/DATABASE.md` + `setup()` สร้างสเปรดชีต แท็บ หัวคอลัมน์ (ตัวหนา, freeze แถว 1) โฟลเดอร์ Drive แล้วบันทึก ID ลง Script Properties (รันซ้ำได้โดยไม่สร้างซ้ำ)
- [x] `Code.gs`: `doGet`, `include`, `wrapApi_`, `userError_`
- [x] `index.html` + `js_app.html`: layout ภาษาไทย, nav, router, `callServer`, `escapeHtml`, `formatThaiDate`

> **Prompt:** อ่าน CLAUDE.md และ docs/ ทั้งหมด แล้วทำเฟส 0 ใน docs/TASKS.md ให้ครบ เริ่มจาก config.gs, db.gs, setup.gs ก่อน แล้วค่อย Code.gs และ SPA shell บอกฉันว่าต้องรัน setup() และตั้ง Script Properties อะไรบ้าง

## เฟส 0.5: Design system + Styleguide

- [x] `css_main.html`: `tailwind.config` ตาม token ใน `docs/DESIGN.md` ข้อ 2 + class component (`.btn-primary`, `.btn-secondary`, `.card`, `.field`, `.badge-*` ฯลฯ)
- [x] `index.html`: header (เมนูตาม DESIGN.md ข้อ 5, ปุ่มทอง "ลงทะเบียนนำเสนอ", hamburger บนมือถือ) + footer + กรอบเนื้อหา `max-w-content`
- [x] `js_ui.html`: `toast()`, `modal()`, `renderStatusBadge()`, `createDropzone()`, `createPagination()`, `renderSkeleton()`, `renderEmptyState()`
- [x] `page_styleguide.html`: แสดงทุก component ในทุกสถานะ (ปกติ, hover, disabled, loading, error, empty) ทั้งบนจอกว้างและมือถือ
- [x] ตรวจสีตัดกันตาม WCAG AA

> **Prompt:** อ่าน docs/DESIGN.md แล้วทำเฟส 0.5 ใน docs/TASKS.md สร้าง styleguide ให้ครบทุก component ในข้อ 3 ยังไม่ต้องทำหน้าจริง เสร็จแล้วบอก URL ที่ฉันใช้เปิดดู styleguide

> **ตรวจก่อนไปต่อ:** เปิด styleguide บนคอมและมือถือ สั่งปรับจนพอใจ ทุกหน้าหลังจากนี้จะใช้ component ชุดนี้

## เฟส 1: หน้าสาธารณะ

- [x] `public.gs`: `getHomeData()` คืนรอบกิจกรรมปัจจุบัน + Timeline + ข่าวล่าสุด 3 ข่าว (cache 10 นาที)
- [x] `page_home.html`: โครงตาม DESIGN.md ข้อ 6 (hero + กล่องสรุปรอบกิจกรรม, ทางลัด 4 การ์ด, Timeline ย่อ, ข่าวล่าสุด)
- [x] `page_timeline.html`: กำหนดการเต็มของรอบปัจจุบัน
- [x] `public.gs`: `getNews(filters)`, `getNewsDetail(newsId)` (เฉพาะ `published`)
- [x] `page_news.html`: รายการข่าว + หน้ารายละเอียด (แปลง body เป็นย่อหน้าแบบ escape)
- [x] `public.gs`: `getDocuments(filters)` ค้นหา กรองหมวด/ปี แบ่งหน้า
- [x] `page_documents.html`: โครงตามดีไซน์ Figma เดิม (ค้นหา + sidebar ตัวกรอง + grid การ์ด + pagination) มือถือใช้ drawer ตัวกรอง
- [x] `public.gs`: `getVideos()` คืนหมวดหมู่ + วิดีโอที่ active
- [x] `page_videos.html`: แท็บหมวดหมู่ + การ์ดวิดีโอ ฝัง `youtube-nocookie.com` (โหลด iframe เมื่อกดเล่น)
- [x] `tests.gs` → `seedSampleData()`: รอบกิจกรรม, Timeline, ข่าว 5 ข่าว, เอกสาร 12 รายการ, วิดีโอ 3 หมวด

> **Prompt:** ทำเฟส 1 ใน docs/TASKS.md ใช้ component จาก styleguide เท่านั้น ทุกหน้าต้องมีสถานะ loading/empty/error และใช้งานบนมือถือ 375px ได้

## เฟส 2: ลงทะเบียนบุคคลภายนอก (หัวใจของระบบ)

- [x] `files.gs`: `saveUploadedFile_()` ตรวจนามสกุล MIME ขนาด magic bytes แล้วบันทึก Drive + FILES
- [x] `submissions.gs`: `createSubmission`, `uploadFile`, `finalizeSubmission` ตาม `docs/ARCHITECTURE.md` ข้อ 6
- [x] `js_upload.html`: อ่านไฟล์เป็น base64, progress bar ทีละไฟล์, retry 2 ครั้ง
- [x] `page_register.html`: stepper 4 ขั้นตาม DESIGN.md ข้อ 6, เลือก Oral/Poster ด้วย radio card → แสดง dropzone ตามประเภท, ลิงก์แบบฟอร์ม Word (จาก `DOCUMENTS.template_for`), PDPA checkbox, allow_publish (ใช่/ไม่ใช่ ต้องเลือก), validate ครบก่อนกดส่ง, ย้อนกลับได้ไม่เสียข้อมูล, ปิดฟอร์มนอกช่วงเปิดรับ
- [x] หน้าส่งสำเร็จ: แสดงรหัสงานตัวใหญ่ + ปุ่มคัดลอก + บอกให้ตรวจอีเมล

> **Prompt:** ทำเฟส 2 ใน docs/TASKS.md ตาม flow การอัปโหลดใน ARCHITECTURE.md ข้อ 6 อย่างเคร่งครัด ใส่ LockService ตอนสร้าง submission_id และเขียน test ใน tests.gs สำหรับ validate ไฟล์ไม่ครบ ชนิดผิด และขนาดเกิน

## เฟส 3: อีเมล + หน้าติดตามสถานะ

- [x] `email.gs`: `sendEmail_(to, template, data, submissionId)` ผ่าน Resend + บันทึก EMAIL_LOG (ล้มเหลวต้องไม่ทำให้งานหลักพัง)
- [x] template HTML ภาษาไทย: `submitted`, `status_changed`, `resubmitted_admin`, `otp`
- [x] เรียกอีเมล `submitted` ใน `finalizeSubmission`
- [x] `getTrackingInfo(trackToken)` + `page_track.html` (สถานะ, ประวัติ, หมายเหตุ)
- [x] `submitRevision(trackToken, ...)` สำหรับสถานะ `revision_requested` (version ใหม่, `is_current`)

> **Prompt:** ทำเฟส 3 ใน docs/TASKS.md อีเมลต้องดูดีบนมือถือ ใช้ inline CSS และมีลิงก์ติดตามสถานะ

## เฟส 4: ล็อกอินครู + ส่งงานครู

- [x] `auth.gs`: `requestOtp`, `verifyOtp`, `logout`, `requireRole_` + rate limit ตาม ARCHITECTURE.md ข้อ 5
- [x] `page_login.html`: ขั้นใส่อีเมล → ขั้นใส่รหัส 6 หลัก
- [x] `page_teacher.html`: ฟอร์มส่งงานวิจัย (reuse flow อัปโหลดจากเฟส 2) + รายการ "งานของฉัน" พร้อมสถานะ
- [x] nav แสดงเมนูตาม role

> **Prompt:** ทำเฟส 4 ใน docs/TASKS.md reuse โค้ดอัปโหลดจากเฟส 2 ห้ามเขียนซ้ำ

## เฟส 5: หน้าแอดมิน

- [x] `admin.gs`: `adminListSubmissions(filters)`, `adminGetSubmission(id)`, `adminChangeStatus(id, toStatus, note)` (ตรวจ transition ที่อนุญาต → STATUS_LOG → อีเมล)
- [x] `getFileForViewer` สำหรับเปิดไฟล์
- [x] `page_admin.html`: ตาราง + ตัวกรอง + แผงรายละเอียด + ฟอร์มเปลี่ยนสถานะ + ตัวเลขสรุป (จำนวนตามประเภท/สถานะ)
- [x] CRUD: Timeline, รอบกิจกรรม, หมวดหมู่วิดีโอ, วิดีโอ, รายชื่อแอดมิน (admin เท่านั้น) + ล้าง cache
- [x] CRUD เอกสารดาวน์โหลด: อัปโหลดไฟล์ (PDF/DOCX/PPTX/XLSX) ลง `_documents` แชร์แบบทุกคนที่มีลิงก์ดูได้, แก้ไข, ปิดการแสดง, จัดการหมวด
- [x] CRUD ข่าว: เขียน/แก้ไข, อัปโหลดรูปปก, draft/published, ปักหมุด

> **Prompt:** ทำเฟส 5 ใน docs/TASKS.md reviewer เปลี่ยนสถานะได้ แต่จัดการ Timeline/วิดีโอ/เอกสาร/ข่าว/แอดมินได้เฉพาะ admin reuse dropzone จาก styleguide

## เฟส 6: คลังงานวิจัย

- [ ] `getLibrary(sessionToken, filters)`: เฉพาะ `allow_publish = TRUE` และสถานะ `accepted`/`recorded` ไม่คืนข้อมูลติดต่อ
- [ ] เมื่อเปลี่ยนเป็น `accepted`/`recorded` และ allow_publish → แชร์ไฟล์ current แบบ domain view
- [ ] `page_library.html`: ค้นหา, กรองปี/ประเภท/สาขา, การ์ดงาน, ปุ่มเปิดไฟล์

## เฟส 7: ความเรียบร้อยก่อนใช้งานจริง

- [ ] `triggers.gs`: `cleanupDrafts()` + `installTriggers()` (รายวัน 02:00)
- [ ] ตรวจ checklist ความปลอดภัยใน ARCHITECTURE.md ข้อ 9 ทุกข้อ
- [ ] หน้าประกาศความเป็นส่วนตัว (PDPA)
- [ ] ทดสอบส่งพร้อมกันหลายแท็บ, ไฟล์ใหญ่, เน็ตช้า, มือถือ
- [ ] Deploy เวอร์ชันจริง + ฝังใน Google Sites หรือเว็บโรงเรียน

> **Prompt:** ทบทวนโค้ดทั้งหมดตาม checklist ความปลอดภัยใน docs/ARCHITECTURE.md ข้อ 9 รายงานจุดที่ไม่ผ่านพร้อมแก้ให้

## เฟสถัดไป (หลังเปิดใช้งานจริง)

- [ ] ประกาศผลรางวัลงานวิจัย (ตาราง `AWARDS` + หน้า `awards`) ดูแนวทางใน SPEC.md ข้อ 7
- [ ] ออกเกียรติบัตรอัตโนมัติด้วย Google Slides template
