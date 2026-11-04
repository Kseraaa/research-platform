/**
 * config.gs
 * ค่าคงที่, enum, ข้อความสถานะภาษาไทย และ getConfig_() สำหรับอ่าน Script Properties
 * ห้าม hard-code ค่าลับหรือ ID ในไฟล์นี้ ให้อยู่ใน Script Properties เท่านั้น
 */

const ORG_NAME = 'หน่วยส่งเสริมงานวิจัย';
const SCHOOL_NAME = 'โรงเรียน มอ.วิทยานุสรณ์';
const ORG_FULL_NAME = ORG_NAME + ' ' + SCHOOL_NAME;
const TIMEZONE = 'Asia/Bangkok';

/** ข้อมูลติดต่อใน footer (placeholder ระหว่างพัฒนา เปลี่ยนเป็นของจริงก่อน deploy) */
const ORG_CONTACT = Object.freeze({
  address: 'ที่อยู่โรงเรียน (รอข้อมูลจริง)',
  phone: '0-0000-0000',
  email: 'research@example.ac.th'
});

// ---------- Script Properties ----------

const CONFIG_KEYS = Object.freeze([
  'SPREADSHEET_ID',
  'ROOT_FOLDER_ID',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'ADMIN_NOTIFY_EMAIL',
  'SCHOOL_EMAIL_DOMAIN',
  'WEBAPP_URL',
  'MAX_FILE_MB'
]);

const CONFIG_DEFAULTS = Object.freeze({
  MAX_FILE_MB: '20'
});

/**
 * อ่านค่า config ทั้งหมดจาก Script Properties (ค่าที่ไม่ได้ตั้งจะเป็น '' หรือค่าเริ่มต้น)
 * @return {Object} เช่น { SPREADSHEET_ID: '...', MAX_FILE_MB: 20, ... }
 */
function getConfig_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const config = {};
  CONFIG_KEYS.forEach(key => {
    const value = props[key] !== undefined && props[key] !== '' ? props[key] : CONFIG_DEFAULTS[key];
    config[key] = value === undefined ? '' : String(value).trim();
  });
  config.MAX_FILE_MB = Number(config.MAX_FILE_MB) > 0 ? Number(config.MAX_FILE_MB) : Number(CONFIG_DEFAULTS.MAX_FILE_MB);
  config.SCHOOL_EMAIL_DOMAIN = config.SCHOOL_EMAIL_DOMAIN.toLowerCase().replace(/^@/, '');
  return config;
}

/**
 * อ่านค่า config ที่ต้องมี ถ้าไม่ได้ตั้งไว้จะ throw (ข้อความสำหรับผู้ดูแล ไม่ส่งให้ผู้ใช้)
 */
function requireConfig_(key) {
  const value = getConfig_()[key];
  if (value === '' || value === undefined) {
    throw new Error('Script Property "' + key + '" ยังไม่ได้ตั้งค่า');
  }
  return value;
}

function setConfig_(key, value) {
  if (CONFIG_KEYS.indexOf(key) === -1) throw new Error('ไม่รู้จัก config key: ' + key);
  PropertiesService.getScriptProperties().setProperty(key, String(value));
}

// ---------- Enum ----------

const ROLES = Object.freeze({
  TEACHER: 'teacher',
  EXTERNAL: 'external',
  REVIEWER: 'reviewer',
  ADMIN: 'admin'
});

/** role ใน PRESENTERS */
const PRESENTER_ROLES = Object.freeze([ROLES.TEACHER, ROLES.EXTERNAL]);

/** role ใน ADMINS */
const ADMIN_ROLES = Object.freeze([ROLES.ADMIN, ROLES.REVIEWER]);

const SUBMISSION_TYPES = Object.freeze({
  TEACHER: 'teacher',
  ORAL: 'oral',
  POSTER: 'poster'
});

const STATUSES = Object.freeze({
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under_review',
  REVISION_REQUESTED: 'revision_requested',
  RESUBMITTED: 'resubmitted',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  RECORDED: 'recorded'
});

const TYPE_LABELS_TH = Object.freeze({
  teacher: 'งานวิจัยของครู',
  oral: 'นำเสนอแบบ Oral',
  poster: 'นำเสนอแบบ Poster'
});

const STATUS_LABELS_TH = Object.freeze({
  draft: 'กำลังอัปโหลดไฟล์',
  submitted: 'ส่งงานแล้ว',
  under_review: 'กำลังพิจารณา',
  revision_requested: 'ขอให้แก้ไข',
  resubmitted: 'ส่งฉบับแก้ไขแล้ว',
  accepted: 'ผ่านการพิจารณา',
  rejected: 'ไม่ผ่านการพิจารณา',
  recorded: 'บันทึกเข้าคลังแล้ว'
});

/**
 * transition ที่อนุญาต แยกตามกลุ่มประเภทงาน (ดู docs/SPEC.md ข้อ 3)
 * งานครูจบที่ recorded (ไม่ใช้ accepted), งานบุคคลภายนอกจบที่ accepted
 */
const ALLOWED_TRANSITIONS = Object.freeze({
  teacher: Object.freeze({
    draft: ['submitted'],
    submitted: ['under_review', 'recorded'],
    under_review: ['recorded', 'revision_requested', 'rejected'],
    revision_requested: ['resubmitted'],
    resubmitted: ['under_review'],
    recorded: [],
    rejected: []
  }),
  external: Object.freeze({
    draft: ['submitted'],
    submitted: ['under_review'],
    under_review: ['accepted', 'revision_requested', 'rejected'],
    revision_requested: ['resubmitted'],
    resubmitted: ['under_review'],
    accepted: [],
    rejected: []
  })
});

/**
 * ตรวจว่าเปลี่ยนสถานะจาก from → to ได้หรือไม่สำหรับงานประเภท type
 */
function canTransition_(type, fromStatus, toStatus) {
  const group = type === SUBMISSION_TYPES.TEACHER ? 'teacher' : 'external';
  const allowed = ALLOWED_TRANSITIONS[group][fromStatus];
  return Array.isArray(allowed) && allowed.indexOf(toStatus) !== -1;
}

const FILE_KINDS = Object.freeze({
  RESEARCH_PDF: 'research_pdf',
  RESEARCH_DOCX: 'research_docx',
  PAPER_PDF: 'paper_pdf',
  PAPER_DOCX: 'paper_docx',
  ABSTRACT_PDF: 'abstract_pdf',
  ABSTRACT_DOCX: 'abstract_docx',
  POSTER_PDF: 'poster_pdf'
});

const MIME_PDF = 'application/pdf';
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** รายละเอียดของแต่ละ file_kind: นามสกุล, MIME และชื่อที่แสดงบนหน้าเว็บ */
const FILE_KIND_SPECS = Object.freeze({
  research_pdf: { ext: 'pdf', mime: MIME_PDF, label: 'งานวิจัยฉบับ PDF' },
  research_docx: { ext: 'docx', mime: MIME_DOCX, label: 'งานวิจัยฉบับ Word' },
  paper_pdf: { ext: 'pdf', mime: MIME_PDF, label: 'เปเปอร์วิจัยฉบับ PDF' },
  paper_docx: { ext: 'docx', mime: MIME_DOCX, label: 'เปเปอร์วิจัยฉบับ Word (ตามแบบฟอร์ม)' },
  abstract_pdf: { ext: 'pdf', mime: MIME_PDF, label: 'Abstract ฉบับ PDF' },
  abstract_docx: { ext: 'docx', mime: MIME_DOCX, label: 'Abstract ฉบับ Word (ตามแบบฟอร์ม)' },
  poster_pdf: { ext: 'pdf', mime: MIME_PDF, label: 'ไฟล์ Poster (PDF)' }
});

/** ไฟล์ที่ต้องส่งครบทุกไฟล์ตามประเภทงาน (ดู docs/SPEC.md ข้อ 2.1, 2.2) */
const REQUIRED_FILES = Object.freeze({
  teacher: Object.freeze(['research_pdf', 'research_docx']),
  oral: Object.freeze(['paper_pdf', 'paper_docx']),
  poster: Object.freeze(['abstract_pdf', 'abstract_docx', 'poster_pdf'])
});

const EMAIL_TEMPLATES = Object.freeze(['otp', 'submitted', 'status_changed', 'resubmitted_admin']);
const EMAIL_RESULTS = Object.freeze(['sent', 'failed']);
const DOC_FILE_TYPES = Object.freeze(['pdf', 'docx', 'pptx', 'xlsx']);
const DOC_TEMPLATE_FOR = Object.freeze(['', 'oral', 'poster']);
const NEWS_STATUSES = Object.freeze(['draft', 'published']);

// ---------- ข้อจำกัดและอายุข้อมูล ----------

const LIMITS = Object.freeze({
  ABSTRACT_SHORT_MAX: 1500,
  NEWS_SUMMARY_MAX: 200,
  TITLE_MAX: 300,
  DRAFT_TTL_HOURS: 24,
  UPLOAD_KEY_TTL_SEC: 60 * 60,
  OTP_TTL_SEC: 10 * 60,
  OTP_MAX_REQUESTS: 3,
  OTP_MAX_ATTEMPTS: 5,
  SESSION_TTL_SEC: 6 * 60 * 60,
  PUBLIC_CACHE_SEC: 10 * 60,
  LOCK_WAIT_MS: 20000
});

/**
 * ค่าที่หน้าเว็บต้องใช้ (ไม่มีค่าลับ) ส่งไปกับ index.html ใน doGet
 * ฝั่ง client อ่านจาก appConfig ใน js_app.html
 */
function getClientConfig_() {
  return {
    orgName: ORG_NAME,
    schoolName: SCHOOL_NAME,
    contact: ORG_CONTACT,
    statusLabels: STATUS_LABELS_TH,
    typeLabels: TYPE_LABELS_TH,
    fileKinds: FILE_KIND_SPECS,
    requiredFiles: REQUIRED_FILES,
    maxFileMb: getConfig_().MAX_FILE_MB
  };
}

/** หมวดเอกสารเริ่มต้นที่ setup() ใส่ให้เมื่อแท็บ DOC_CATEGORIES ยังว่าง */
const DEFAULT_DOC_CATEGORIES = Object.freeze([
  'แบบฟอร์มคำขอทุน',
  'คู่มือผู้ใช้งาน',
  'ตัวอย่างรายงานผลการวิจัย',
  'เทมเพลตและพาวเวอร์พอยต์'
]);
