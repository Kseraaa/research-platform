/**
 * admin.gs
 * หน้าจัดการระบบ
 * - งานที่ส่ง (reviewer + admin): รายการ/ตัวกรอง/สรุป, รายละเอียด, เปลี่ยนสถานะ + อีเมลแจ้งผู้ส่ง
 * - ข้อมูลเว็บไซต์ (admin เท่านั้น): CRUD กลางของ Timeline, รอบกิจกรรม, วิดีโอ, เอกสาร, ข่าว, ผู้ดูแล
 *   ทุกตารางกำหนดฟิลด์/กฎใน ADMIN_TABLES ที่เดียว หน้าเว็บสร้างตารางและฟอร์มจากข้อมูลนี้
 */

const ADMIN_PAGE_SIZE = 20;
// ห้ามอ้างค่าคงที่/ฟังก์ชันของไฟล์อื่นที่ระดับบนสุด: Apps Script โหลดไฟล์ทีละไฟล์ตามลำดับ (admin.gs มาก่อน config.gs)
const STAFF_ROLES = Object.freeze(['reviewer', 'admin']);

// ---------- งานที่ส่ง ----------

/**
 * รายการงาน (ไม่รวม draft) + ตัวกรอง + สรุปจำนวนตามประเภท/สถานะ
 * @param {{ event_id?, type?, status?, q?, page? }} filters
 */
function adminListSubmissions(sessionToken, filters) {
  return wrapApi_(() => {
    const user = requireRole_(sessionToken, STAFF_ROLES);
    const f = asObject_(filters);
    const eventId = cleanText_(f.event_id, 40);
    const type = cleanText_(f.type, 20);
    const status = cleanText_(f.status, 30);
    const q = cleanText_(f.q, 100).toLowerCase();

    const presenters = indexBy_(readAll_('PRESENTERS'), 'presenter_id');
    const inEvent = readAll_('SUBMISSIONS')
      .filter(s => s.status !== STATUSES.DRAFT && (!eventId || s.event_id === eventId));

    const summary = { total: inEvent.length, byType: {}, byStatus: {} };
    inEvent.forEach(s => {
      summary.byType[s.type] = (summary.byType[s.type] || 0) + 1;
      summary.byStatus[s.status] = (summary.byStatus[s.status] || 0) + 1;
    });

    const rows = inEvent
      .filter(s => (!type || s.type === type) && (!status || s.status === status))
      .map(s => {
        const p = presenters[s.presenter_id] || {};
        return {
          submission_id: s.submission_id, title: s.title, type: s.type, status: s.status,
          presenter_name: p.full_name || '', organization: p.organization || '',
          submitted_at: s.submitted_at, event_id: s.event_id
        };
      })
      .filter(r => !q || [r.submission_id, r.title, r.presenter_name].some(v => String(v).toLowerCase().indexOf(q) !== -1))
      .sort((a, b) => toTime_(b.submitted_at) - toTime_(a.submitted_at));

    const result = paginate_(rows, f.page, ADMIN_PAGE_SIZE);
    result.summary = summary;
    // ลิงก์ Export (SPEC 2.7): เปิดแท็บ SUBMISSIONS ใน Sheets ใช้ตัวกรองของ Sheets เอง (แอดมินต้องมีสิทธิ์ในไฟล์)
    result.sheet_url = user.role === ROLES.ADMIN ? getSpreadsheet_().getUrl() + '#gid=' + getSheet_('SUBMISSIONS').getSheetId() : '';
    result.events = readAll_('EVENTS').map(e => ({ event_id: e.event_id, name: e.name, is_current: e.is_current }));
    return result;
  });
}

/**
 * รายละเอียดงาน 1 ชิ้น: ข้อมูลงาน ไฟล์ทุก version ประวัติ และสถานะที่เปลี่ยนไปได้
 * ข้อมูลติดต่อ (อีเมล/เบอร์โทร) ส่งให้เฉพาะ admin (docs/SPEC.md ข้อ 6)
 */
function adminGetSubmission(sessionToken, submissionId) {
  return wrapApi_(() => {
    const user = requireRole_(sessionToken, STAFF_ROLES);
    return buildAdminSubmissionDetail_(requireSubmission_(submissionId), user);
  });
}

/**
 * เปลี่ยนสถานะ + หมายเหตุ → STATUS_LOG → อีเมลแจ้งผู้ส่ง (ส่งไม่สำเร็จไม่ทำให้การเปลี่ยนสถานะล้ม)
 * @return รายละเอียดงานหลังเปลี่ยน (รูปแบบเดียวกับ adminGetSubmission)
 */
function adminChangeStatus(sessionToken, submissionId, toStatus, note) {
  return wrapApi_(() => {
    const user = requireRole_(sessionToken, STAFF_ROLES);
    const target = cleanText_(toStatus, 30);
    const cleanNote = cleanText_(note, 2000);
    const now = nowIso_();

    const updated = withLock_(() => {
      const submission = requireSubmission_(submissionId);
      if (allowedAdminTransitions_(submission).indexOf(target) === -1) {
        throw userError_('เปลี่ยนจาก "' + STATUS_LABELS_TH[submission.status] + '" เป็น "' + (STATUS_LABELS_TH[target] || target) + '" ไม่ได้');
      }
      if (target === STATUSES.REVISION_REQUESTED && !cleanNote) throw userError_('กรุณาใส่หมายเหตุว่าต้องแก้ไขอะไร');
      insert_('STATUS_LOG', {
        log_id: newId_('LOG'),
        submission_id: submission.submission_id,
        from_status: submission.status,
        to_status: target,
        note: cleanNote,
        changed_by: user.email,
        changed_at: now
      });
      return updateBy_('SUBMISSIONS', 'submission_id', submission.submission_id, { status: target, reviewer_note: cleanNote });
    });

    // เฟส 6: งานที่ accepted/recorded และ allow_publish → แชร์ไฟล์ current แบบ domain view ที่นี่

    const presenter = findBy_('PRESENTERS', 'presenter_id', updated.presenter_id);
    if (presenter) {
      sendEmail_(presenter.email, 'status_changed', submissionEmailData_(updated, presenter, { note: cleanNote }), updated.submission_id);
    }
    return buildAdminSubmissionDetail_(updated, user);
  });
}

/** สถานะที่ผู้ตรวจเปลี่ยนไปได้ (ไม่รวม submitted/resubmitted ซึ่งเป็นของระบบ/ผู้ส่ง) */
function allowedAdminTransitions_(submission) {
  return Object.keys(STATUS_LABELS_TH).filter(to =>
    to !== STATUSES.SUBMITTED && to !== STATUSES.RESUBMITTED && canTransition_(submission.type, submission.status, to));
}

function requireSubmission_(submissionId) {
  const id = cleanText_(submissionId, 40);
  const submission = SUBMISSION_ID_PATTERN.test(id) ? findBy_('SUBMISSIONS', 'submission_id', id) : null;
  if (!submission || submission.status === STATUSES.DRAFT) throw userError_('ไม่พบงานนี้');
  return submission;
}

function buildAdminSubmissionDetail_(submission, user) {
  const presenter = findBy_('PRESENTERS', 'presenter_id', submission.presenter_id) || {};
  const event = submission.event_id ? findBy_('EVENTS', 'event_id', submission.event_id) : null;
  const isAdmin = user.role === ROLES.ADMIN;
  return {
    submission_id: submission.submission_id,
    title: submission.title,
    type: submission.type,
    status: submission.status,
    event_name: event ? event.name : '',
    authors: submission.authors,
    subject_area: submission.subject_area,
    abstract_short: submission.abstract_short,
    academic_year: submission.academic_year,
    allow_publish: submission.allow_publish,
    reviewer_note: submission.reviewer_note,
    submitted_at: submission.submitted_at,
    presenter: {
      full_name: presenter.full_name || '',
      organization: presenter.organization || '',
      email: isAdmin ? presenter.email || '' : '',
      phone: isAdmin ? presenter.phone || '' : ''
    },
    files: readAll_('FILES')
      .filter(f => f.submission_id === submission.submission_id)
      .sort((a, b) => String(a.file_kind).localeCompare(String(b.file_kind)) || b.version - a.version)
      .map(f => ({ file_id: f.file_id, file_kind: f.file_kind, version: f.version, is_current: f.is_current, file_name: f.file_name, size_kb: f.size_kb, uploaded_at: f.uploaded_at })),
    history: readAll_('STATUS_LOG')
      .filter(l => l.submission_id === submission.submission_id)
      .sort((a, b) => toTime_(a.changed_at) - toTime_(b.changed_at))
      .map(l => ({ from_status: l.from_status, to_status: l.to_status, note: l.note, changed_by: l.changed_by, changed_at: l.changed_at })),
    allowed_statuses: allowedAdminTransitions_(submission)
  };
}

function indexBy_(rows, key) {
  const map = {};
  rows.forEach(r => { map[r[key]] = r; });
  return map;
}

// ---------- CRUD กลาง ----------

/**
 * นิยามตารางที่แอดมินจัดการได้
 * field.type: text | textarea | number | date | datetime | boolean | select | url | email | youtube
 * field.default: ค่าเริ่มต้นในฟอร์มเพิ่มใหม่ / field.options: [{ value, label }] หรือชื่อรายการที่ server สร้างให้ ('events' | 'videoCategories' | 'docCategories')
 * id: { prefix } = PREFIX-สุ่ม8 / { seq } = SEQ-01 เรียงลำดับ / { manual } = แอดมินกรอกเอง (pattern)
 * hooks (ใช้ฝั่ง server เท่านั้น): beforeSave(record, existing, user), canDelete(record, user), afterDelete(record)
 * สร้างครั้งแรกตอนเรียกใช้ (ไม่ใช่ตอนโหลดไฟล์) เพราะอ้าง ROLES, EMAIL_PATTERN, bySortOrder_ จากไฟล์อื่น
 */
let adminTablesCache_ = null;

function adminTables_() {
  if (adminTablesCache_) return adminTablesCache_;
  adminTablesCache_ = {
  EVENTS: {
    label: 'รอบกิจกรรม', key: 'event_id', id: { manual: /^EVT-[A-Z0-9-]{1,20}$/, example: 'EVT-2027' },
    fields: [
      { name: 'event_id', label: 'รหัสรอบ', type: 'text', required: true, createOnly: true, max: 24, help: 'ตัวพิมพ์ใหญ่ เช่น EVT-2027 แก้ภายหลังไม่ได้' },
      { name: 'name', label: 'ชื่องาน', type: 'text', required: true, max: 200 },
      { name: 'year', label: 'ปี (พ.ศ.)', type: 'number', required: true, min: 2500, max: 2700 },
      { name: 'open_date', label: 'เปิดรับสมัคร', type: 'datetime', required: true },
      { name: 'close_date', label: 'ปิดรับสมัคร', type: 'datetime', required: true },
      { name: 'oral_template_url', label: 'ลิงก์แบบฟอร์ม Oral (ไม่บังคับ)', type: 'url', help: 'เว้นว่างเพื่อใช้เอกสารที่ตั้ง "แบบฟอร์มของ" = Oral' },
      { name: 'poster_template_url', label: 'ลิงก์แบบฟอร์ม Poster (ไม่บังคับ)', type: 'url' },
      { name: 'is_current', label: 'เป็นรอบปัจจุบัน (แสดงบนเว็บ)', type: 'boolean' }
    ],
    columns: ['event_id', 'name', 'open_date', 'close_date', 'is_current'],
    sort: (a, b) => toTime_(b.open_date) - toTime_(a.open_date),
    beforeSave: record => {
      if (toTime_(record.close_date) <= toTime_(record.open_date)) throw userError_('วันปิดรับสมัครต้องอยู่หลังวันเปิดรับสมัคร');
      // รอบปัจจุบันมีได้รอบเดียว
      if (record.is_current) {
        readAll_('EVENTS').filter(e => e.is_current && e.event_id !== record.event_id)
          .forEach(e => updateBy_('EVENTS', 'event_id', e.event_id, { is_current: false }));
      }
    },
    canDelete: record => {
      if (readAll_('SUBMISSIONS').some(s => s.event_id === record.event_id)) throw userError_('ลบไม่ได้ เพราะมีงานที่ส่งในรอบนี้แล้ว');
      if (readAll_('TIMELINE').some(t => t.event_id === record.event_id)) throw userError_('ลบไม่ได้ กรุณาลบกำหนดการของรอบนี้ก่อน');
    }
  },

  TIMELINE: {
    label: 'กำหนดการ', key: 'timeline_id', id: { prefix: 'TL' },
    fields: [
      { name: 'event_id', label: 'รอบกิจกรรม', type: 'select', required: true, options: 'events' },
      { name: 'title', label: 'หัวข้อ', type: 'text', required: true, max: 200 },
      { name: 'start_date', label: 'วันเริ่ม', type: 'date', required: true },
      { name: 'end_date', label: 'วันสิ้นสุด', type: 'date', help: 'เว้นว่างถ้าเป็นกิจกรรมวันเดียว' },
      { name: 'detail', label: 'รายละเอียด', type: 'textarea', max: 500 },
      { name: 'sort_order', label: 'ลำดับ (วันเดียวกัน)', type: 'number' }
    ],
    columns: ['start_date', 'title', 'event_id'],
    sort: (a, b) => toTime_(a.start_date) - toTime_(b.start_date) || bySortOrder_(a, b),
    beforeSave: record => {
      if (record.end_date && toTime_(record.end_date) < toTime_(record.start_date)) throw userError_('วันสิ้นสุดต้องไม่อยู่ก่อนวันเริ่ม');
    }
  },

  NEWS: {
    label: 'ข่าว', key: 'news_id', id: { prefix: 'NEWS' },
    file: { field: 'cover_file_id', label: 'รูปปก (JPG / PNG / WEBP ไม่เกิน 5 MB)', exts: ['jpg', 'jpeg', 'png', 'webp'], maxMb: 5, folder: '_news' },
    fields: [
      { name: 'title', label: 'หัวข้อข่าว', type: 'text', required: true, max: 200 },
      { name: 'summary', label: 'สรุปสั้น (แสดงบนการ์ด)', type: 'textarea', required: true, max: 200 },
      { name: 'body', label: 'เนื้อหา', type: 'textarea', required: true, max: 20000, rows: 10,
        help: 'ข้อความธรรมดา เว้นบรรทัดว่างเพื่อขึ้นย่อหน้าใหม่ ลิงก์ https:// จะกดได้อัตโนมัติ (ไม่รับ HTML)' },
      { name: 'status', label: 'สถานะ', type: 'select', required: true, default: 'draft', options: [{ value: 'draft', label: 'ฉบับร่าง' }, { value: 'published', label: 'เผยแพร่' }] },
      { name: 'pinned', label: 'ปักหมุดไว้บนสุด', type: 'boolean' },
      { name: 'published_at', label: 'วันที่เผยแพร่', type: 'datetime', help: 'เว้นว่างเพื่อใช้เวลาที่กดเผยแพร่' }
    ],
    columns: ['published_at', 'title', 'status', 'pinned'],
    sort: (a, b) => toTime_(b.published_at || b.created_at) - toTime_(a.published_at || a.created_at),
    beforeSave: (record, existing, user) => {
      if (record.status === 'published' && !record.published_at) record.published_at = nowIso_();
      if (!existing) record.created_by = user.email;
    }
  },

  DOC_CATEGORIES: {
    label: 'หมวดเอกสาร', key: 'category_id', id: { seq: 'DOC-CAT' },
    fields: [
      { name: 'name', label: 'ชื่อหมวด', type: 'text', required: true, max: 100 },
      { name: 'sort_order', label: 'ลำดับ', type: 'number' }
    ],
    columns: ['name', 'sort_order'],
    sort: bySortOrder_,
    canDelete: record => {
      if (readAll_('DOCUMENTS').some(d => d.category_id === record.category_id)) throw userError_('ลบไม่ได้ เพราะยังมีเอกสารในหมวดนี้');
    }
  },

  DOCUMENTS: {
    label: 'เอกสาร', key: 'document_id', id: { prefix: 'DOC' },
    file: { field: 'drive_file_id', label: 'ไฟล์ (PDF / Word / PowerPoint / Excel)', exts: ['pdf', 'docx', 'pptx', 'xlsx'], requiredOnCreate: true, folder: '_documents' },
    fields: [
      { name: 'category_id', label: 'หมวด', type: 'select', required: true, options: 'docCategories' },
      { name: 'title', label: 'ชื่อเอกสาร', type: 'text', required: true, max: 200 },
      { name: 'author', label: 'ผู้จัดทำ', type: 'text', required: true, max: 100 },
      { name: 'academic_year', label: 'ปีการศึกษา (พ.ศ.)', type: 'number', required: true, min: 2500, max: 2700 },
      { name: 'template_for', label: 'เป็นแบบฟอร์มของ', type: 'select', default: '', options: [{ value: '', label: '-' }, { value: 'oral', label: 'Oral' }, { value: 'poster', label: 'Poster' }],
        help: 'ฟอร์มลงทะเบียนจะลิงก์ไปที่เอกสารนี้' },
      { name: 'active', label: 'แสดงบนเว็บ', type: 'boolean', default: true }
    ],
    columns: ['title', 'category_id', 'academic_year', 'file_type', 'active'],
    extraColumns: [{ name: 'file_type', label: 'ชนิด' }],
    sort: (a, b) => (Number(b.academic_year) || 0) - (Number(a.academic_year) || 0) || String(a.title).localeCompare(String(b.title), 'th'),
    afterDelete: record => trashDriveFile_(record.drive_file_id)
  },

  VIDEO_CATEGORIES: {
    label: 'หมวดวิดีโอ', key: 'category_id', id: { seq: 'VCAT' },
    fields: [
      { name: 'name', label: 'ชื่อหมวด', type: 'text', required: true, max: 100 },
      { name: 'description', label: 'คำอธิบาย', type: 'textarea', max: 300 },
      { name: 'sort_order', label: 'ลำดับ', type: 'number' }
    ],
    columns: ['name', 'description', 'sort_order'],
    sort: bySortOrder_,
    canDelete: record => {
      if (readAll_('VIDEOS').some(v => v.category_id === record.category_id)) throw userError_('ลบไม่ได้ เพราะยังมีวิดีโอในหมวดนี้');
    }
  },

  VIDEOS: {
    label: 'วิดีโอ', key: 'video_id', id: { prefix: 'VID' },
    fields: [
      { name: 'category_id', label: 'หมวด', type: 'select', required: true, options: 'videoCategories' },
      { name: 'title', label: 'ชื่อวิดีโอ', type: 'text', required: true, max: 200 },
      { name: 'youtube_id', label: 'ลิงก์ YouTube', type: 'youtube', required: true, help: 'วางลิงก์ YouTube (Unlisted ได้) ระบบเก็บเฉพาะรหัสวิดีโอ' },
      { name: 'description', label: 'คำอธิบาย', type: 'textarea', max: 300 },
      { name: 'sort_order', label: 'ลำดับ', type: 'number' },
      { name: 'active', label: 'แสดงบนเว็บ', type: 'boolean', default: true }
    ],
    columns: ['title', 'category_id', 'sort_order', 'active'],
    sort: (a, b) => String(a.category_id).localeCompare(String(b.category_id)) || bySortOrder_(a, b)
  },

  ADMINS: {
    label: 'ผู้ดูแล', key: 'email', id: { manual: EMAIL_PATTERN, lowercase: true, example: 'name@example.ac.th' },
    fields: [
      { name: 'email', label: 'อีเมล', type: 'email', required: true, createOnly: true, max: 254 },
      { name: 'full_name', label: 'ชื่อ-นามสกุล', type: 'text', required: true, max: 200 },
      { name: 'role', label: 'สิทธิ์', type: 'select', required: true, default: 'reviewer',
        options: [{ value: 'reviewer', label: 'ผู้ตรวจ (ดูงาน เปลี่ยนสถานะ)' }, { value: 'admin', label: 'แอดมิน (ทุกอย่าง)' }] },
      { name: 'active', label: 'ใช้งานได้', type: 'boolean', default: true }
    ],
    columns: ['email', 'full_name', 'role', 'active'],
    sort: (a, b) => String(a.email).localeCompare(String(b.email)),
    // กันแอดมินล็อกตัวเองออกจากระบบ
    beforeSave: (record, existing, user) => {
      if (record.email === user.email && (record.role !== ROLES.ADMIN || !record.active)) throw userError_('ลดสิทธิ์หรือปิดบัญชีของตัวเองไม่ได้');
    },
    canDelete: (record, user) => {
      if (record.email === user.email) throw userError_('ลบบัญชีของตัวเองไม่ได้');
    }
  }
  };
  return adminTablesCache_;
}

/**
 * ข้อมูลของตาราง: นิยามฟิลด์ (สำหรับสร้างฟอร์ม) + แถวทั้งหมด + ตัวเลือกของฟิลด์ select
 */
function adminListRecords(sessionToken, table) {
  return wrapApi_(() => {
    requireRole_(sessionToken, [ROLES.ADMIN]);
    const name = requireAdminTable_(table);
    const spec = adminTables_()[name];
    return {
      table: name,
      spec: publicSpec_(name),
      options: resolveOptions_(spec),
      records: readAll_(name).sort(spec.sort || (() => 0))
    };
  });
}

/**
 * เพิ่ม (ไม่มี key) หรือแก้ไข (มี key) 1 แถว แล้วล้าง cache หน้าสาธารณะ
 * @param {Object} record ค่าจากฟอร์ม (ฟิลด์ที่ไม่ได้นิยามจะถูกตัดทิ้ง)
 * @param {{ name, mimeType, base64 }=} file ไฟล์เอกสาร/รูปปก (เฉพาะตารางที่มี spec.file)
 */
function adminSaveRecord(sessionToken, table, record, file) {
  return wrapApi_(() => {
    const user = requireRole_(sessionToken, [ROLES.ADMIN]);
    const name = requireAdminTable_(table);
    const spec = adminTables_()[name];
    const input = asObject_(record);
    const keyValue = cleanText_(input[spec.key], 254);
    const existing = keyValue ? findBy_(name, spec.key, spec.id.lowercase ? keyValue.toLowerCase() : keyValue) : null;
    const isCreate = !existing;
    if (!isCreate && !keyValue) throw userError_('ไม่พบข้อมูลที่จะแก้ไข');

    const clean = validateAdminRecord_(spec, input, isCreate, resolveOptions_(spec));
    if (spec.file) {
      const uploaded = file && asObject_(file).base64 ? saveSharedUpload_(spec.file, asObject_(file)) : null;
      if (isCreate && spec.file.requiredOnCreate && !uploaded) throw userError_('กรุณาเลือกไฟล์');
      if (uploaded) {
        Object.assign(clean, uploaded.fields);
        if (existing && existing[spec.file.field]) trashDriveFile_(existing[spec.file.field]);
      }
    }

    const saved = withLock_(() => {
      if (isCreate) {
        clean[spec.key] = generateAdminKey_(name, spec, keyValue);
        if (findBy_(name, spec.key, clean[spec.key])) throw userError_('มี ' + clean[spec.key] + ' อยู่แล้ว');
      } else {
        clean[spec.key] = existing[spec.key];
      }
      const merged = Object.assign({}, existing || {}, clean);
      if (spec.beforeSave) spec.beforeSave(merged, existing, user);
      Object.keys(merged).forEach(k => { if (!(k in clean) && (!existing || merged[k] !== existing[k])) clean[k] = merged[k]; });
      return isCreate ? insert_(name, merged) : updateBy_(name, spec.key, existing[spec.key], clean);
    });
    clearPublicCache_();
    return saved;
  });
}

/** ลบ 1 แถว (ตรวจความสัมพันธ์ก่อน) แล้วล้าง cache หน้าสาธารณะ */
function adminDeleteRecord(sessionToken, table, keyValue) {
  return wrapApi_(() => {
    const user = requireRole_(sessionToken, [ROLES.ADMIN]);
    const name = requireAdminTable_(table);
    const spec = adminTables_()[name];
    const key = cleanText_(keyValue, 254);
    const removed = withLock_(() => {
      const existing = findBy_(name, spec.key, key);
      if (!existing) throw userError_('ไม่พบข้อมูลนี้ (อาจถูกลบไปแล้ว)');
      if (spec.canDelete) spec.canDelete(existing, user);
      deleteWhere_(name, r => String(r[spec.key]) === key);
      return existing;
    });
    if (spec.afterDelete) spec.afterDelete(removed);
    if (spec.file && removed[spec.file.field]) trashDriveFile_(removed[spec.file.field]);
    clearPublicCache_();
    return true;
  });
}

// ---------- ช่วยของ CRUD ----------

function requireAdminTable_(table) {
  const name = cleanText_(table, 40);
  if (!Object.prototype.hasOwnProperty.call(adminTables_(), name)) throw userError_('ไม่รู้จักตารางนี้');
  return name;
}

/** นิยามตารางที่ส่งให้ client ได้ (ตัด function และ RegExp ออก) */
function publicSpec_(name) {
  const spec = adminTables_()[name];
  return {
    label: spec.label,
    key: spec.key,
    keyEditable: Boolean(spec.id.manual),
    keyExample: spec.id.example || '',
    columns: spec.columns,
    extraColumns: spec.extraColumns || [],
    fields: spec.fields,
    file: spec.file ? { field: spec.file.field, label: spec.file.label, exts: spec.file.exts, requiredOnCreate: Boolean(spec.file.requiredOnCreate),
      maxMb: spec.file.maxMb || getConfig_().MAX_FILE_MB } : null
  };
}

/** ตัวเลือกของฟิลด์ select ที่อ้างตารางอื่น { field_name: [{ value, label }] } */
function resolveOptions_(spec) {
  const options = {};
  spec.fields.filter(f => f.type === 'select').forEach(f => {
    if (Array.isArray(f.options)) options[f.name] = f.options;
    else if (f.options === 'events') options[f.name] = readAll_('EVENTS').map(e => ({ value: e.event_id, label: e.name }));
    else if (f.options === 'videoCategories') options[f.name] = readAll_('VIDEO_CATEGORIES').sort(bySortOrder_).map(c => ({ value: c.category_id, label: c.name }));
    else if (f.options === 'docCategories') options[f.name] = readAll_('DOC_CATEGORIES').sort(bySortOrder_).map(c => ({ value: c.category_id, label: c.name }));
  });
  return options;
}

/**
 * ตรวจและแปลงค่าตามชนิดฟิลด์ (ไม่แตะ Sheets ใช้ทดสอบใน tests.gs ได้)
 * @return {Object} เฉพาะฟิลด์ที่นิยามไว้ (ฟิลด์ createOnly ตอนแก้ไขจะถูกข้าม)
 */
function validateAdminRecord_(spec, input, isCreate, options) {
  const clean = {};
  const errors = [];
  spec.fields.forEach(field => {
    if (field.createOnly && !isCreate) return;
    const raw = input[field.name];
    const value = coerceAdminField_(field, raw, options[field.name], errors);
    if (field.required && (value === '' || value === null || value === undefined)) {
      if (!errors.some(e => e.indexOf(field.label) === 0)) errors.push(field.label + ': กรุณากรอก');
      return;
    }
    clean[field.name] = value;
  });
  if (errors.length) throw userError_(errors.join(' / '));
  return clean;
}

function coerceAdminField_(field, raw, options, errors) {
  const fail = message => { errors.push(field.label + ': ' + message); return ''; };
  switch (field.type) {
    case 'boolean':
      return raw === true || raw === 'true';
    case 'number': {
      if (raw === '' || raw === null || raw === undefined) return '';
      const n = Number(raw);
      if (!isFinite(n) || Math.floor(n) !== n) return fail('ต้องเป็นจำนวนเต็ม');
      if ((field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max)) return fail('ต้องอยู่ระหว่าง ' + field.min + ' ถึง ' + field.max);
      return n;
    }
    case 'date':
    case 'datetime': {
      const text = cleanText_(raw, 40);
      if (!text) return '';
      const iso = toBangkokIso_(text, field.type);
      return iso || fail('รูปแบบวันที่ไม่ถูกต้อง');
    }
    case 'select': {
      const text = cleanText_(raw, 100);
      if (text === '' && !field.required) return '';
      return (options || []).some(o => o.value === text) ? text : fail('กรุณาเลือกจากรายการ');
    }
    case 'url': {
      const text = cleanText_(raw, 500);
      if (text && !/^https?:\/\/\S+$/i.test(text)) return fail('ต้องเป็นลิงก์ที่ขึ้นต้นด้วย https://');
      return text;
    }
    case 'email': {
      const text = cleanText_(raw, 254).toLowerCase();
      if (text && !EMAIL_PATTERN.test(text)) return fail('รูปแบบอีเมลไม่ถูกต้อง');
      return text;
    }
    case 'youtube': {
      const text = cleanText_(raw, 300);
      if (!text) return '';
      const id = parseYoutubeId_(text);
      return id || fail('ไม่พบรหัสวิดีโอในลิงก์ YouTube');
    }
    default: {
      const text = cleanText_(raw, (field.max || 200) + 1);
      if (field.max && text.length > field.max) return fail('ยาวเกิน ' + field.max + ' ตัวอักษร');
      return text;
    }
  }
}

/**
 * '2026-11-15' / '2026-11-15T09:30' / ISO เดิม → '2026-11-15T09:30:00+07:00' (เวลาไทย)
 * วันที่อย่างเดียว: date = 00:00, ช่อง datetime ที่ใส่แค่วันที่ = 00:00 เช่นกัน
 */
function toBangkokIso_(text, type) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
  if (!m) return '';
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  const time = type === 'date' ? '00:00:00' : (m[4] || '00') + ':' + (m[5] || '00') + ':' + (m[6] || '00');
  return m[1] + '-' + m[2] + '-' + m[3] + 'T' + time + '+07:00';
}

/** รับรหัสหรือ URL YouTube (watch?v=, youtu.be/, shorts/, embed/) คืนรหัส 11 ตัว */
function parseYoutubeId_(text) {
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  const m = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(text);
  return m ? m[1] : '';
}

/** key ของแถวใหม่ตาม spec.id */
function generateAdminKey_(name, spec, inputKey) {
  if (spec.id.prefix) return newId_(spec.id.prefix);
  if (spec.id.seq) {
    const prefix = spec.id.seq + '-';
    const max = readAll_(name).reduce((m, r) => {
      const id = String(r[spec.key]);
      return id.indexOf(prefix) === 0 ? Math.max(m, Number(id.slice(prefix.length)) || 0) : m;
    }, 0);
    return prefix + String(max + 1).padStart(2, '0');
  }
  const key = spec.id.lowercase ? inputKey.toLowerCase() : inputKey;
  if (!spec.id.manual.test(key)) throw userError_('รูปแบบรหัสไม่ถูกต้อง ตัวอย่าง: ' + spec.id.example);
  return key;
}

// ---------- ไฟล์สาธารณะ (เอกสารดาวน์โหลด + รูปปกข่าว) ----------

const PUBLIC_FILE_TYPES = Object.freeze({
  pdf: { mime: 'application/pdf', signature: [0x25, 0x50, 0x44, 0x46] },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', signature: [0x50, 0x4B, 0x03, 0x04] },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', signature: [0x50, 0x4B, 0x03, 0x04] },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', signature: [0x50, 0x4B, 0x03, 0x04] },
  jpg: { mime: 'image/jpeg', signature: [0xFF, 0xD8, 0xFF] },
  jpeg: { mime: 'image/jpeg', signature: [0xFF, 0xD8, 0xFF] },
  png: { mime: 'image/png', signature: [0x89, 0x50, 0x4E, 0x47] },
  webp: { mime: 'image/webp', signature: [0x52, 0x49, 0x46, 0x46] }
});

/**
 * ตรวจไฟล์ที่แอดมินอัปโหลด (นามสกุล ขนาด magic bytes) ไม่แตะ Drive
 * @return {{ ext, mime, bytes, sizeKb, name }}
 */
function validatePublicUpload_(fileSpec, file) {
  const name = cleanText_(file.name, 200);
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (fileSpec.exts.indexOf(ext) === -1) throw userError_('ชนิดไฟล์ไม่ถูกต้อง รับเฉพาะ ' + fileSpec.exts.join(', '));
  const type = PUBLIC_FILE_TYPES[ext];
  const maxMb = fileSpec.maxMb || getConfig_().MAX_FILE_MB;
  if (typeof file.base64 !== 'string' || file.base64.length > Math.ceil(maxMb * 1024 * 1024 / 3) * 4 + 4) throw userError_('ไฟล์ใหญ่เกิน ' + maxMb + ' MB');
  let bytes;
  try { bytes = Utilities.base64Decode(file.base64); } catch (e) { throw userError_('ไฟล์เสียหาย'); }
  if (!bytes.length || bytes.length > maxMb * 1024 * 1024) throw userError_('ไฟล์ว่างหรือใหญ่เกิน ' + maxMb + ' MB');
  if (!type.signature.every((b, i) => (bytes[i] & 0xFF) === b)) throw userError_('เนื้อไฟล์ไม่ตรงกับนามสกุล .' + ext);
  return { ext: ext === 'jpeg' ? 'jpg' : ext, mime: type.mime, bytes: bytes, sizeKb: Math.ceil(bytes.length / 1024), name: name };
}

/**
 * บันทึกไฟล์สาธารณะลง ROOT/{folder} แชร์แบบ "ทุกคนที่มีลิงก์ ดูได้" (ห้ามใช้กับไฟล์งานวิจัย)
 * @return {{ fields: Object }} ค่าที่ต้องบันทึกลงแถว (drive_file_id / cover_file_id, file_type, size_kb)
 */
function saveSharedUpload_(fileSpec, file) {
  const checked = validatePublicUpload_(fileSpec, file);
  const root = DriveApp.getFolderById(requireConfig_('ROOT_FOLDER_ID'));
  const folder = getOrCreateFolder_(root, fileSpec.folder);
  const driveFile = folder.createFile(Utilities.newBlob(checked.bytes, checked.mime, checked.name));
  try {
    driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    driveFile.setTrashed(true);
    throw userError_('แชร์ไฟล์แบบ "ทุกคนที่มีลิงก์" ไม่ได้ (นโยบาย Google Workspace ของโรงเรียนอาจปิดไว้) กรุณาติดต่อผู้ดูแลโดเมน');
  }
  const fields = {};
  fields[fileSpec.field] = driveFile.getId();
  if (fileSpec.field === 'drive_file_id') {
    fields.file_type = checked.ext;
    fields.size_kb = checked.sizeKb;
  }
  return { fields: fields };
}
