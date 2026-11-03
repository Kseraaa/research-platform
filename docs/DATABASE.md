# DATABASE: โครงสร้าง Google Sheets

- สเปรดชีตเดียว (`SPREADSHEET_ID` ใน Script Properties) 1 แท็บ = 1 ตาราง
- **แถวที่ 1 = หัวคอลัมน์** ตามชื่อด้านล่างทุกตัวอักษร ลำดับคอลัมน์เปลี่ยนได้ เพราะโค้ดอ้างอิงด้วยชื่อหัวคอลัมน์
- วันที่เก็บเป็น ISO 8601 string (`2026-11-03T13:20:00+07:00`)
- boolean เก็บเป็น `TRUE` / `FALSE`
- ค่าที่เป็นรายการหลายค่า (เช่นรายชื่อผู้ร่วมวิจัย) เก็บเป็น JSON string
- `setup.gs` ต้องสร้างแท็บและหัวคอลัมน์ทั้งหมดตามไฟล์นี้ ถ้าแก้ไฟล์นี้ต้องแก้ `SCHEMA` ใน `setup.gs` ด้วย

## ความสัมพันธ์

```
EVENTS 1──* SUBMISSIONS *──1 PRESENTERS
EVENTS 1──* TIMELINE
SUBMISSIONS 1──* FILES
SUBMISSIONS 1──* STATUS_LOG *──1 ADMINS
SUBMISSIONS 1──* EMAIL_LOG
VIDEO_CATEGORIES 1──* VIDEOS
DOC_CATEGORIES 1──* DOCUMENTS
NEWS (ไม่มีความสัมพันธ์)
```

---

## PRESENTERS (ผู้ส่งงาน: ครู + บุคคลภายนอก)

| column | type | หมายเหตุ |
|---|---|---|
| `presenter_id` | string PK | `PRE-` + 8 ตัวแรกของ UUID |
| `role` | enum | `teacher` \| `external` |
| `full_name` | string | |
| `email` | string | lower-case, ใช้หาคนเดิมซ้ำ (1 อีเมล = 1 presenter) |
| `phone` | string | |
| `organization` | string | ครู = ชื่อโรงเรียน/กลุ่มสาระ |
| `pdpa_consent_at` | datetime | บังคับสำหรับ `external` |
| `created_at` | datetime | |
| `updated_at` | datetime | |

## SUBMISSIONS (งานที่ส่ง)

| column | type | หมายเหตุ |
|---|---|---|
| `submission_id` | string PK | `SUB-{ปี}-{ลำดับ 4 หลัก}` เช่น `SUB-2026-0001` สร้างภายใต้ lock |
| `event_id` | string FK → EVENTS | งานครูอาจว่างได้ |
| `presenter_id` | string FK → PRESENTERS | |
| `type` | enum | `teacher` \| `oral` \| `poster` |
| `title` | string | |
| `authors` | JSON string | `["ชื่อ 1","ชื่อ 2"]` |
| `subject_area` | string | กลุ่มสาระ/สาขา |
| `abstract_short` | string | ไม่เกิน 1,500 ตัวอักษร |
| `academic_year` | number | ปีการศึกษา พ.ศ. |
| `status` | enum | ดู `docs/SPEC.md` ข้อ 3 |
| `allow_publish` | boolean | ผู้ส่งต้องเลือกเอง |
| `track_token` | string | `Utilities.getUuid()` ใช้กับลิงก์ติดตาม **ห้ามส่งให้ client ยกเว้นเจ้าของ** |
| `reviewer_note` | string | หมายเหตุล่าสุดที่ผู้ส่งเห็น |
| `drive_folder_id` | string | โฟลเดอร์ของงานนี้ใน Drive |
| `submitted_at` | datetime | ตอน finalize |
| `created_at` | datetime | |
| `updated_at` | datetime | |

## FILES (ไฟล์แนบ)

| column | type | หมายเหตุ |
|---|---|---|
| `file_id` | string PK | `FIL-` + 8 ตัวแรกของ UUID |
| `submission_id` | string FK | |
| `file_kind` | enum | `research_pdf` \| `research_docx` \| `paper_pdf` \| `paper_docx` \| `abstract_pdf` \| `abstract_docx` \| `poster_pdf` |
| `version` | number | เริ่มที่ 1, ฉบับแก้ไข +1 |
| `is_current` | boolean | ไฟล์ล่าสุดของ kind นั้น |
| `drive_file_id` | string | |
| `file_name` | string | ชื่อหลัง rename |
| `original_name` | string | ชื่อที่ผู้ใช้อัปโหลด |
| `mime_type` | string | |
| `size_kb` | number | |
| `uploaded_at` | datetime | |

## STATUS_LOG (ประวัติสถานะ)

| column | type | หมายเหตุ |
|---|---|---|
| `log_id` | string PK | `LOG-` + 8 ตัวแรกของ UUID |
| `submission_id` | string FK | |
| `from_status` | enum | |
| `to_status` | enum | |
| `note` | string | |
| `changed_by` | string | อีเมลแอดมิน หรือ `system` / `presenter` |
| `changed_at` | datetime | |

## EMAIL_LOG

| column | type | หมายเหตุ |
|---|---|---|
| `email_id` | string PK | id ที่ Resend คืนมา หรือ `EML-` + UUID ถ้าส่งไม่สำเร็จ |
| `submission_id` | string FK | ว่างได้ (เช่น OTP) |
| `to_email` | string | |
| `template` | enum | `otp` \| `submitted` \| `status_changed` \| `resubmitted_admin` |
| `result` | enum | `sent` \| `failed` |
| `error` | string | |
| `sent_at` | datetime | |

## ADMINS

| column | type | หมายเหตุ |
|---|---|---|
| `email` | string PK | lower-case |
| `full_name` | string | |
| `role` | enum | `admin` \| `reviewer` |
| `active` | boolean | |

## EVENTS (รอบกิจกรรม)

| column | type | หมายเหตุ |
|---|---|---|
| `event_id` | string PK | เช่น `EVT-2026` |
| `name` | string | ชื่องานประชุม/กิจกรรม |
| `year` | number | พ.ศ. |
| `open_date` | datetime | เปิดรับสมัคร |
| `close_date` | datetime | ปิดรับสมัคร |
| `oral_template_url` | string | ลิงก์แบบฟอร์ม Word ของ Oral |
| `poster_template_url` | string | ลิงก์แบบฟอร์ม Word ของ Poster |
| `is_current` | boolean | รอบที่แสดงบนหน้าเว็บ มีได้ TRUE แค่ 1 แถว |

## TIMELINE

| column | type | หมายเหตุ |
|---|---|---|
| `timeline_id` | string PK | |
| `event_id` | string FK | |
| `title` | string | |
| `start_date` | datetime | |
| `end_date` | datetime | ว่างได้ (กิจกรรมวันเดียว) |
| `detail` | string | |
| `sort_order` | number | |

## VIDEO_CATEGORIES

| column | type | หมายเหตุ |
|---|---|---|
| `category_id` | string PK | |
| `name` | string | |
| `description` | string | |
| `sort_order` | number | |

## VIDEOS

| column | type | หมายเหตุ |
|---|---|---|
| `video_id` | string PK | |
| `category_id` | string FK | |
| `title` | string | |
| `youtube_id` | string | เก็บแค่ id เช่น `dQw4w9WgXcQ` ไม่ใช่ URL เต็ม |
| `description` | string | |
| `sort_order` | number | |
| `active` | boolean | |

## DOC_CATEGORIES (หมวดเอกสารดาวน์โหลด)

| column | type | หมายเหตุ |
|---|---|---|
| `category_id` | string PK | เช่น `DOC-CAT-01` |
| `name` | string | เช่น "แบบฟอร์มคำขอทุน" |
| `sort_order` | number | |

## DOCUMENTS (ศูนย์ดาวน์โหลดเอกสาร)

| column | type | หมายเหตุ |
|---|---|---|
| `document_id` | string PK | `DOC-` + 8 ตัวแรกของ UUID |
| `category_id` | string FK → DOC_CATEGORIES | |
| `title` | string | |
| `author` | string | ผู้จัดทำ เช่น "ฝ่ายส่งเสริมงานวิจัย" |
| `academic_year` | number | ปีการศึกษา พ.ศ. |
| `file_type` | enum | `pdf` \| `docx` \| `pptx` \| `xlsx` |
| `drive_file_id` | string | อยู่ในโฟลเดอร์ `_documents` แชร์แบบทุกคนที่มีลิงก์ดูได้ |
| `size_kb` | number | |
| `template_for` | enum | ว่าง \| `oral` \| `poster` ใช้ระบุว่าเป็นแบบฟอร์ม Word ที่ฟอร์มลงทะเบียนลิงก์ไป |
| `download_count` | number | เพิ่มทีละ 1 เมื่อกดดาวน์โหลด (ไม่บังคับ) |
| `active` | boolean | |
| `created_at` | datetime | |
| `updated_at` | datetime | |

> เมื่อมี `template_for` แล้ว คอลัมน์ `oral_template_url` / `poster_template_url` ใน `EVENTS` ใช้เป็นค่า override เฉพาะรอบได้ ถ้าว่างให้ใช้เอกสารที่ `template_for` ตรงกันและ `active = TRUE`

## NEWS (ข่าวประชาสัมพันธ์)

| column | type | หมายเหตุ |
|---|---|---|
| `news_id` | string PK | `NEWS-` + 8 ตัวแรกของ UUID |
| `title` | string | |
| `summary` | string | ไม่เกิน 200 ตัวอักษร ใช้บนการ์ด |
| `body` | string | ข้อความธรรมดา แบ่งย่อหน้าด้วยบรรทัดว่าง ห้ามเก็บ HTML |
| `cover_file_id` | string | รูปปกในโฟลเดอร์ `_news` ว่างได้ |
| `status` | enum | `draft` \| `published` |
| `pinned` | boolean | ปักหมุดไว้บนสุด |
| `published_at` | datetime | |
| `created_by` | string | อีเมลแอดมิน |
| `created_at` | datetime | |
| `updated_at` | datetime | |

---

## โครงสร้างโฟลเดอร์ใน Google Drive

```
ROOT_FOLDER (ROOT_FOLDER_ID)
├── 2026/
│   ├── teacher/SUB-2026-0001/
│   ├── oral/SUB-2026-0002/
│   └── poster/SUB-2026-0003/
├── _documents/   ← ไฟล์ศูนย์ดาวน์โหลด + แบบฟอร์ม Word (แชร์แบบทุกคนที่มีลิงก์ดูได้)
└── _news/        ← รูปปกข่าว (แชร์แบบทุกคนที่มีลิงก์ดูได้)
```
