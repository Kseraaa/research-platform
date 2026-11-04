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

    const submission = withLock_(() => {
      const presenter = upsertExternalPresenter_(data);
      const submissionId = nextSubmissionId_();
      const folder = createSubmissionFolder_(submissionId, data.type, submissionId.split('-')[1]);
      return insert_('SUBMISSIONS', {
        submission_id: submissionId,
        event_id: event.event_id,
        presenter_id: presenter.presenter_id,
        type: data.type,
        title: data.title,
        authors: [data.full_name].concat(data.co_authors),
        subject_area: data.subject_area,
        abstract_short: '',
        academic_year: event.year,
        status: STATUSES.DRAFT,
        allow_publish: data.allow_publish,
        track_token: Utilities.getUuid(),
        reviewer_note: '',
        drive_folder_id: folder.getId(),
        submitted_at: ''
      });
    });

    return { submissionId: submission.submission_id, uploadKey: issueUploadKey_(submission.submission_id) };
  });
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

    // เฟส 3: ส่งอีเมล template "submitted" พร้อมลิงก์ติดตามสถานะ (track_token) ที่นี่

    const presenter = findBy_('PRESENTERS', 'presenter_id', submission.presenter_id);
    return { submissionId: submission.submission_id, email: presenter ? presenter.email : '' };
  });
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
  cache.put(key, String(count + 1), CREATE_LIMIT_WINDOW_SEC);
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
