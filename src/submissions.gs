/**
 * submissions.gs
 * ลงทะเบียนนำเสนอของบุคคลภายนอก (ดู docs/ARCHITECTURE.md ข้อ 6):
 *   createSubmission → uploadFile (ทีละไฟล์) → finalizeSubmission
 * งานครู (เฟส 4) ใช้ helper ชุดเดียวกัน / หน้าติดตามสถานะและฉบับแก้ไข (เฟส 3)
 */

const SUBMISSION_ID_PATTERN = /^SUB-\d{4}-\d{4,}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CO_AUTHORS = 10;
const CREATE_LIMIT_PER_EMAIL = 5; // ต่อชั่วโมง กันการสร้าง draft รัวๆ
const CREATE_LIMIT_WINDOW_SEC = 60 * 60;
const CREATE_LIMIT_GLOBAL = 200; // ทั้งระบบต่อ 10 นาที กันการเปลี่ยนอีเมลไปเรื่อยๆ เพื่อสร้างโฟลเดอร์ Drive รัวๆ
const CREATE_LIMIT_GLOBAL_WINDOW_SEC = 10 * 60;

// ---------- public API ----------

/**
 * ข้อมูลที่หน้าลงทะเบียนต้องใช้: เปิดรับอยู่หรือไม่ + ลิงก์แบบฟอร์ม Word ของ Oral/Poster
 * @return {{ open: boolean, event: Object|null, templates: { oral: string, poster: string } }}
 */
function getRegistrationInfo() {
  return wrapApi_(() => {
    const event = getCurrentEvent_();
    return {
      open: isRegistrationOpen_(event),
      event: event,
      templates: getTemplateUrls_()
    };
  });
}

/**
 * ขั้นที่ 1 ของการส่ง: ตรวจข้อมูล สร้าง/อัปเดต PRESENTERS + SUBMISSIONS (draft) + โฟลเดอร์ Drive
 * @param {Object} payload { type, full_name, email, phone, organization, title, co_authors[], subject_area, pdpa_consent, allow_publish }
 * @return {{ submissionId: string, uploadKey: string }}
 */
function createSubmission(payload) {
  return wrapApi_(() => {
    const event = getCurrentEvent_();
    if (!isRegistrationOpen_(event)) throw userError_('ขณะนี้ไม่อยู่ในช่วงเปิดรับลงทะเบียน');
    const data = validateRegistrationPayload_(payload);
    checkCreateRateLimit_(data.email);

    return createDraftSubmission_(() => upsertExternalPresenter_(data), {
      event_id: event.event_id,
      type: data.type,
      title: data.title,
      authors: [data.full_name].concat(data.co_authors),
      subject_area: data.subject_area,
      abstract_short: '',
      academic_year: event.year,
      allow_publish: data.allow_publish
    });
  });
}

/**
 * ครูส่งงานวิจัย (ต้องล็อกอิน) ขั้นต่อไปใช้ uploadFile / finalizeSubmission ชุดเดียวกับบุคคลภายนอก
 * @param {Object} payload { full_name, title, authors[], subject_area, abstract_short, academic_year, allow_publish }
 * @return {{ submissionId: string, uploadKey: string }}
 */
function createTeacherSubmission(sessionToken, payload) {
  return wrapApi_(() => {
    const user = requireRole_(sessionToken, [ROLES.TEACHER]);
    const data = validateTeacherPayload_(payload);
    checkCreateRateLimit_(user.email);
    const event = getCurrentEvent_();

    return createDraftSubmission_(() => upsertTeacherPresenter_(user.email, data.full_name), {
      event_id: event ? event.event_id : '',
      type: SUBMISSION_TYPES.TEACHER,
      title: data.title,
      authors: data.authors,
      subject_area: data.subject_area,
      abstract_short: data.abstract_short,
      academic_year: data.academic_year,
      allow_publish: data.allow_publish
    });
  });
}

/**
 * งานของฉัน: ทุกงานที่ส่งด้วยอีเมลนี้ (ไม่รวม draft) ใหม่ไปเก่า
 */
function getMySubmissions(sessionToken) {
  return wrapApi_(() => {
    const user = requireRole_(sessionToken, [ROLES.TEACHER]);
    const presenter = findBy_('PRESENTERS', 'email', user.email);
    if (!presenter) return [];
    return readAll_('SUBMISSIONS')
      .filter(s => s.presenter_id === presenter.presenter_id && s.status !== STATUSES.DRAFT)
      .sort((a, b) => toTime_(b.submitted_at) - toTime_(a.submitted_at))
      .map(s => ({
        submission_id: s.submission_id,
        title: s.title,
        type: s.type,
        status: s.status,
        reviewer_note: s.reviewer_note,
        submitted_at: s.submitted_at
      }));
  });
}

/**
 * สร้าง presenter (ผ่าน upsertPresenter) + SUBMISSIONS สถานะ draft + โฟลเดอร์ Drive ภายใต้ lock
 * @return {{ submissionId: string, uploadKey: string }}
 */
function createDraftSubmission_(upsertPresenter, fields) {
  const submission = withLock_(() => {
    const presenter = upsertPresenter();
    const submissionId = nextSubmissionId_();
    const folder = createSubmissionFolder_(submissionId, fields.type, submissionId.split('-')[1]);
    return insert_('SUBMISSIONS', Object.assign({}, fields, {
      submission_id: submissionId,
      presenter_id: presenter.presenter_id,
      status: STATUSES.DRAFT,
      track_token: Utilities.getUuid(),
      reviewer_note: '',
      drive_folder_id: folder.getId(),
      submitted_at: ''
    }));
  });
  return { submissionId: submission.submission_id, uploadKey: issueUploadKey_(submission.submission_id) };
}

/**
 * ขั้นที่ 2: รับไฟล์ทีละไฟล์ (base64) ตรวจซ้ำฝั่ง server แล้วบันทึก
 * @return {{ file_id, file_kind, file_name, size_kb, version }}
 */
function uploadFile(submissionId, uploadKey, fileKind, name, mimeType, base64) {
  return wrapApi_(() => {
    const submission = requireDraftWithKey_(submissionId, uploadKey);
    const checked = validateUploadedFile_(submission.type, cleanText_(fileKind, 40), name, mimeType, base64, getConfig_().MAX_FILE_MB);
    return saveUploadedFile_(submission, cleanText_(fileKind, 40), checked);
  });
}

/**
 * ขั้นที่ 3: ตรวจว่าไฟล์ครบ → สถานะ submitted + STATUS_LOG
 * @return {{ submissionId: string, email: string }}
 */
function finalizeSubmission(submissionId, uploadKey) {
  return wrapApi_(() => {
    const submission = requireDraftWithKey_(submissionId, uploadKey);
    const currentKinds = readAll_('FILES')
      .filter(f => f.submission_id === submission.submission_id && f.is_current)
      .map(f => f.file_kind);
    const missing = findMissingFiles_(submission.type, currentKinds);
    if (missing.length) {
      throw userError_('ยังขาดไฟล์: ' + missing.map(kind => FILE_KIND_SPECS[kind].label).join(', '));
    }

    const now = nowIso_();
    withLock_(() => {
      // อ่านสถานะซ้ำภายใต้ lock กันการกดส่งซ้อนกัน
      const fresh = findBy_('SUBMISSIONS', 'submission_id', submission.submission_id);
      if (!fresh || fresh.status !== STATUSES.DRAFT) throw userError_('งานนี้ส่งไปแล้ว');
      updateBy_('SUBMISSIONS', 'submission_id', submission.submission_id, { status: STATUSES.SUBMITTED, submitted_at: now });
      insert_('STATUS_LOG', {
        log_id: newId_('LOG'),
        submission_id: submission.submission_id,
        from_status: STATUSES.DRAFT,
        to_status: STATUSES.SUBMITTED,
        note: '',
        changed_by: 'system',
        changed_at: now
      });
    });
    CacheService.getScriptCache().remove(uploadKeyCacheKey_(submission.submission_id));

    // ส่งอีเมลหลังบันทึกแล้ว ส่งไม่สำเร็จไม่ทำให้การส่งงานล้มเหลว (ดูได้ใน EMAIL_LOG)
    const presenter = findBy_('PRESENTERS', 'presenter_id', submission.presenter_id);
    const submitted = Object.assign({}, submission, { status: STATUSES.SUBMITTED });
    if (presenter) sendEmail_(presenter.email, 'submitted', submissionEmailData_(submitted, presenter), submission.submission_id);
    return { submissionId: submission.submission_id, email: presenter ? presenter.email : '' };
  });
}

// ---------- ติดตามสถานะ + ฉบับแก้ไข (ใช้ track_token จากลิงก์ในอีเมล) ----------

/**
 * ข้อมูลหน้าติดตามสถานะ ไม่คืน track_token / อีเมล / เบอร์โทร / ผู้เปลี่ยนสถานะ
 * @return {{ submission_id, title, type, status, reviewer_note, submitted_at, authors, history: Object[], files: Object[], can_revise: boolean }}
 */
function getTrackingInfo(trackToken) {
  return wrapApi_(() => {
    const submission = requireTrackedSubmission_(trackToken);
    const history = readAll_('STATUS_LOG')
      .filter(l => l.submission_id === submission.submission_id)
      .sort((a, b) => toTime_(a.changed_at) - toTime_(b.changed_at))
      .map(l => ({ from_status: l.from_status, to_status: l.to_status, note: l.note, changed_at: l.changed_at }));
    const files = readAll_('FILES')
      .filter(f => f.submission_id === submission.submission_id && f.is_current)
      .map(f => ({ file_id: f.file_id, file_kind: f.file_kind, file_name: f.file_name, version: f.version, size_kb: f.size_kb, uploaded_at: f.uploaded_at }));
    return {
      submission_id: submission.submission_id,
      title: submission.title,
      type: submission.type,
      status: submission.status,
      reviewer_note: submission.reviewer_note,
      submitted_at: submission.submitted_at,
      authors: submission.authors,
      history: history,
      files: files,
      can_revise: submission.status === STATUSES.REVISION_REQUESTED
    };
  });
}

/**
 * เริ่มส่งฉบับแก้ไข (สถานะต้องเป็น revision_requested) คืน uploadKey อายุ 1 ชม.
 * @return {{ uploadKey: string }}
 */
function startRevision(trackToken) {
  return wrapApi_(() => {
    const submission = requireTrackedSubmission_(trackToken);
    if (submission.status !== STATUSES.REVISION_REQUESTED) throw userError_('ขณะนี้ผลงานนี้ไม่ได้อยู่ในสถานะขอให้แก้ไข');
    return { uploadKey: issueUploadKey_(submission.submission_id) };
  });
}

/**
 * อัปโหลดไฟล์ฉบับแก้ไขทีละไฟล์ เก็บเป็น version ใหม่ ไฟล์เดิมยังอยู่ (is_current = FALSE)
 * ลำดับอาร์กิวเมนต์เหมือน uploadFile เพื่อใช้ uploadFilesInOrder ใน js_upload.html ร่วมกัน
 */
function uploadRevisionFile(trackToken, uploadKey, fileKind, name, mimeType, base64) {
  return wrapApi_(() => {
    const submission = requireRevisionWithKey_(trackToken, uploadKey);
    const kind = cleanText_(fileKind, 40);
    const checked = validateUploadedFile_(submission.type, kind, name, mimeType, base64, getConfig_().MAX_FILE_MB);
    const saved = saveUploadedFile_(submission, kind, checked);
    // จดว่ารอบแก้ไขนี้ (ผูกกับ uploadKey) อัปโหลดไฟล์ชนิดใดไปแล้ว ใช้ตรวจตอน submitRevision
    const cache = CacheService.getScriptCache();
    const key = revisionFilesCacheKey_(submission.submission_id, uploadKey);
    const kinds = JSON.parse(cache.get(key) || '[]');
    if (kinds.indexOf(kind) === -1) kinds.push(kind);
    cache.put(key, JSON.stringify(kinds), LIMITS.UPLOAD_KEY_TTL_SEC);
    return saved;
  });
}

function revisionFilesCacheKey_(submissionId, uploadKey) {
  return 'revision-files:' + submissionId + ':' + cleanText_(uploadKey, 60);
}

/**
 * ส่งฉบับแก้ไข: ต้องมีไฟล์ใหม่อย่างน้อย 1 ไฟล์หลังถูกขอให้แก้ไข → resubmitted + STATUS_LOG + อีเมลผู้ส่งและแอดมิน
 * @return {{ status: string }}
 */
function submitRevision(trackToken, uploadKey) {
  return wrapApi_(() => {
    const submission = requireRevisionWithKey_(trackToken, uploadKey);
    const filesKey = revisionFilesCacheKey_(submission.submission_id, uploadKey);
    const newFiles = JSON.parse(CacheService.getScriptCache().get(filesKey) || '[]');
    if (!newFiles.length) throw userError_('กรุณาอัปโหลดไฟล์ฉบับแก้ไขอย่างน้อย 1 ไฟล์');

    const now = nowIso_();
    withLock_(() => {
      const fresh = findBy_('SUBMISSIONS', 'submission_id', submission.submission_id);
      if (!fresh || fresh.status !== STATUSES.REVISION_REQUESTED) throw userError_('ส่งฉบับแก้ไขไปแล้ว');
      updateBy_('SUBMISSIONS', 'submission_id', submission.submission_id, { status: STATUSES.RESUBMITTED });
      insert_('STATUS_LOG', {
        log_id: newId_('LOG'),
        submission_id: submission.submission_id,
        from_status: STATUSES.REVISION_REQUESTED,
        to_status: STATUSES.RESUBMITTED,
        note: 'ส่งไฟล์ฉบับแก้ไข ' + newFiles.length + ' ไฟล์',
        changed_by: 'presenter',
        changed_at: now
      });
    });
    CacheService.getScriptCache().remove(uploadKeyCacheKey_(submission.submission_id));
    CacheService.getScriptCache().remove(filesKey);

    const presenter = findBy_('PRESENTERS', 'presenter_id', submission.presenter_id);
    const resubmitted = Object.assign({}, submission, { status: STATUSES.RESUBMITTED });
    if (presenter) sendEmail_(presenter.email, 'status_changed', submissionEmailData_(resubmitted, presenter), submission.submission_id);
    const adminEmail = getConfig_().ADMIN_NOTIFY_EMAIL;
    if (adminEmail) {
      const base = getWebAppUrl_();
      sendEmail_(adminEmail, 'resubmitted_admin', {
        submission_id: submission.submission_id,
        title: submission.title,
        type: submission.type,
        presenter_name: presenter ? presenter.full_name : '',
        link_url: base ? base + '?page=admin' : ''
      }, submission.submission_id);
    }
    return { status: STATUSES.RESUBMITTED };
  });
}

const TRACK_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** หางานจาก track_token (งาน draft ถือว่ายังไม่มี เพราะยังไม่ได้ส่งลิงก์ให้ใคร) */
function requireTrackedSubmission_(trackToken) {
  const token = cleanText_(trackToken, 60);
  const notFound = 'ไม่พบผลงาน ลิงก์อาจไม่ถูกต้อง กรุณาเปิดจากลิงก์ในอีเมลอีกครั้ง';
  if (!TRACK_TOKEN_PATTERN.test(token)) throw userError_(notFound);
  const submission = findBy_('SUBMISSIONS', 'track_token', token);
  if (!submission || submission.status === STATUSES.DRAFT) throw userError_(notFound);
  return submission;
}

function requireRevisionWithKey_(trackToken, uploadKey) {
  const submission = requireTrackedSubmission_(trackToken);
  if (submission.status !== STATUSES.REVISION_REQUESTED) throw userError_('ขณะนี้ผลงานนี้ไม่ได้อยู่ในสถานะขอให้แก้ไข');
  const stored = CacheService.getScriptCache().get(uploadKeyCacheKey_(submission.submission_id));
  if (!stored || stored !== cleanText_(uploadKey, 60)) throw userError_('หมดเวลาการส่ง (เกิน 1 ชั่วโมง) กรุณารีเฟรชหน้าแล้วส่งใหม่');
  return submission;
}

// ---------- ตรวจข้อมูล ----------

/**
 * ตรวจและทำความสะอาด payload ของฟอร์มบุคคลภายนอก (ไม่แตะ Sheets ใช้ทดสอบใน tests.gs ได้)
 */
function validateRegistrationPayload_(payload) {
  const p = asObject_(payload);
  const errors = [];
  const type = cleanText_(p.type, 20);
  if (type !== SUBMISSION_TYPES.ORAL && type !== SUBMISSION_TYPES.POSTER) errors.push('กรุณาเลือกรูปแบบการนำเสนอ');

  const fullName = cleanText_(p.full_name, 200);
  if (!fullName) errors.push('กรุณากรอกชื่อ-นามสกุล');

  const email = cleanText_(p.email, 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) errors.push('รูปแบบอีเมลไม่ถูกต้อง');

  const phone = cleanText_(p.phone, 30);
  const phoneDigits = phone.replace(/\D/g, '');
  if (!/^[0-9+\-\s()]+$/.test(phone) || phoneDigits.length < 9 || phoneDigits.length > 15) errors.push('เบอร์โทรไม่ถูกต้อง');

  const organization = cleanText_(p.organization, 200);
  if (!organization) errors.push('กรุณากรอกหน่วยงาน/สถานศึกษา');

  const title = cleanText_(p.title, LIMITS.TITLE_MAX);
  if (!title) errors.push('กรุณากรอกชื่อเรื่อง');

  const subjectArea = cleanText_(p.subject_area, 100);
  if (!subjectArea) errors.push('กรุณากรอกสาขา');

  const coAuthors = (Array.isArray(p.co_authors) ? p.co_authors : [])
    .map(name => cleanText_(name, 200)).filter(Boolean);
  if (coAuthors.length > MAX_CO_AUTHORS) errors.push('ผู้ร่วมวิจัยได้ไม่เกิน ' + MAX_CO_AUTHORS + ' คน');

  if (p.pdpa_consent !== true) errors.push('กรุณายินยอมการเก็บข้อมูลส่วนบุคคล');
  if (typeof p.allow_publish !== 'boolean') errors.push('กรุณาเลือกว่าอนุญาตให้เผยแพร่หรือไม่');

  if (errors.length) throw userError_(errors.join(' / '));
  return {
    type: type,
    full_name: fullName,
    email: email,
    phone: phone,
    organization: organization,
    title: title,
    subject_area: subjectArea,
    co_authors: coAuthors,
    allow_publish: p.allow_publish
  };
}

/**
 * ตรวจ payload ฟอร์มส่งงานครู (ไม่แตะ Sheets ใช้ทดสอบใน tests.gs ได้)
 */
function validateTeacherPayload_(payload) {
  const p = asObject_(payload);
  const errors = [];
  const fullName = cleanText_(p.full_name, 200);
  if (!fullName) errors.push('กรุณากรอกชื่อ-นามสกุล');

  const title = cleanText_(p.title, LIMITS.TITLE_MAX);
  if (!title) errors.push('กรุณากรอกชื่อเรื่อง');

  const authors = (Array.isArray(p.authors) ? p.authors : []).map(name => cleanText_(name, 200)).filter(Boolean);
  if (!authors.length) errors.push('กรุณากรอกชื่อผู้วิจัยอย่างน้อย 1 คน');
  if (authors.length > MAX_CO_AUTHORS + 1) errors.push('ผู้วิจัยได้ไม่เกิน ' + (MAX_CO_AUTHORS + 1) + ' คน');

  const subjectArea = cleanText_(p.subject_area, 100);
  if (!subjectArea) errors.push('กรุณากรอกกลุ่มสาระ/สาขา');

  const abstractShort = cleanText_(p.abstract_short, LIMITS.ABSTRACT_SHORT_MAX + 1);
  if (!abstractShort) errors.push('กรุณากรอกบทคัดย่อสั้น');
  if (abstractShort.length > LIMITS.ABSTRACT_SHORT_MAX) errors.push('บทคัดย่อยาวเกิน ' + LIMITS.ABSTRACT_SHORT_MAX + ' ตัวอักษร');

  const academicYear = Math.floor(Number(p.academic_year));
  if (!(academicYear >= 2500 && academicYear <= 2700)) errors.push('ปีการศึกษาต้องเป็น พ.ศ. 4 หลัก เช่น 2569');

  if (typeof p.allow_publish !== 'boolean') errors.push('กรุณาเลือกว่าอนุญาตให้เผยแพร่หรือไม่');

  if (errors.length) throw userError_(errors.join(' / '));
  return {
    full_name: fullName,
    title: title,
    authors: authors,
    subject_area: subjectArea,
    abstract_short: abstractShort,
    academic_year: academicYear,
    allow_publish: p.allow_publish
  };
}

function isRegistrationOpen_(event, now) {
  if (!event || !event.open_date || !event.close_date) return false;
  const t = (now || new Date()).getTime();
  return t >= toTime_(event.open_date) && t <= toTime_(event.close_date);
}

function checkCreateRateLimit_(email) {
  const cache = CacheService.getScriptCache();
  const key = 'create-limit:' + email;
  const count = Number(cache.get(key) || 0);
  if (count >= CREATE_LIMIT_PER_EMAIL) throw userError_('ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
  const globalCount = Number(cache.get('create-limit:all') || 0);
  if (globalCount >= CREATE_LIMIT_GLOBAL) throw userError_('ขณะนี้มีผู้ส่งงานจำนวนมาก กรุณาลองใหม่ในอีก 10 นาที');
  cache.put(key, String(count + 1), CREATE_LIMIT_WINDOW_SEC);
  cache.put('create-limit:all', String(globalCount + 1), CREATE_LIMIT_GLOBAL_WINDOW_SEC);
}

// ---------- ผู้ส่งงาน + รหัสงาน ----------

/** 1 อีเมล = 1 presenter: มีแล้วอัปเดตข้อมูลติดต่อ ไม่มีสร้างใหม่ (เรียกภายใต้ lock) */
function upsertExternalPresenter_(data) {
  const now = nowIso_();
  const existing = findBy_('PRESENTERS', 'email', data.email);
  if (existing) {
    return updateBy_('PRESENTERS', 'presenter_id', existing.presenter_id, {
      full_name: data.full_name,
      phone: data.phone,
      organization: data.organization,
      pdpa_consent_at: now
    });
  }
  return insert_('PRESENTERS', {
    presenter_id: newId_('PRE'),
    role: ROLES.EXTERNAL,
    full_name: data.full_name,
    email: data.email,
    phone: data.phone,
    organization: data.organization,
    pdpa_consent_at: now
  });
}

/** ครู: ใช้อีเมลจาก session ชื่ออัปเดตตามที่กรอกล่าสุด (เรียกภายใต้ lock) */
function upsertTeacherPresenter_(email, fullName) {
  const existing = findBy_('PRESENTERS', 'email', email);
  if (existing) {
    return existing.full_name === fullName
      ? existing
      : updateBy_('PRESENTERS', 'presenter_id', existing.presenter_id, { full_name: fullName });
  }
  return insert_('PRESENTERS', {
    presenter_id: newId_('PRE'),
    role: ROLES.TEACHER,
    full_name: fullName,
    email: email,
    phone: '',
    organization: SCHOOL_NAME
  });
}

/**
 * SUB-{ปี ค.ศ.}-{ลำดับ 4 หลัก} ต่อจากเลขที่มากที่สุดของปีนั้น (ต้องเรียกภายใต้ lock)
 */
function nextSubmissionId_() {
  const year = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy');
  const prefix = 'SUB-' + year + '-';
  const max = readAll_('SUBMISSIONS').reduce((m, s) => {
    const id = String(s.submission_id);
    return id.indexOf(prefix) === 0 ? Math.max(m, Number(id.slice(prefix.length)) || 0) : m;
  }, 0);
  return prefix + String(max + 1).padStart(4, '0');
}

// ---------- upload key ----------

function uploadKeyCacheKey_(submissionId) {
  return 'upload-key:' + submissionId;
}

/** กุญแจสำหรับอัปโหลด/finalize งานนี้ อายุ 1 ชม. เก็บใน cache ฝั่ง server */
function issueUploadKey_(submissionId) {
  const key = Utilities.getUuid();
  CacheService.getScriptCache().put(uploadKeyCacheKey_(submissionId), key, LIMITS.UPLOAD_KEY_TTL_SEC);
  return key;
}

/** ตรวจ upload key แล้วคืนงานที่ยังเป็น draft */
function requireDraftWithKey_(submissionId, uploadKey) {
  const id = cleanText_(submissionId, 40);
  const key = cleanText_(uploadKey, 60);
  if (!SUBMISSION_ID_PATTERN.test(id) || !key) throw userError_('ข้อมูลการส่งไม่ถูกต้อง');
  const submission = findBy_('SUBMISSIONS', 'submission_id', id);
  if (!submission) throw userError_('ไม่พบงานนี้');
  if (submission.status !== STATUSES.DRAFT) throw userError_('งานนี้ส่งไปแล้ว');
  const stored = CacheService.getScriptCache().get(uploadKeyCacheKey_(id));
  if (!stored || stored !== key) throw userError_('หมดเวลาการส่งงาน (เกิน 1 ชั่วโมง) กรุณารีเฟรชหน้าแล้วส่งใหม่');
  return submission;
}

// ---------- แบบฟอร์ม Word ----------

/**
 * ลิงก์แบบฟอร์ม Word: ใช้ค่าใน EVENTS (override เฉพาะรอบ) ถ้าว่างใช้เอกสารที่ template_for ตรงกันและ active
 */
function getTemplateUrls_() {
  const event = getCurrentEvent_();
  const eventRow = event ? findBy_('EVENTS', 'event_id', event.event_id) : null;
  const docs = getDocumentsData_().documents;
  const fromDocs = kind => {
    const doc = docs.find(d => d.template_for === kind);
    return doc ? 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(doc.drive_file_id) : '';
  };
  return {
    oral: (eventRow && eventRow.oral_template_url) || fromDocs(SUBMISSION_TYPES.ORAL),
    poster: (eventRow && eventRow.poster_template_url) || fromDocs(SUBMISSION_TYPES.POSTER)
  };
}
