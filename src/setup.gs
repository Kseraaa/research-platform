/**
 * setup.gs
 * SCHEMA ของทุกแท็บ (ต้องตรงกับ docs/DATABASE.md) + setup() สำหรับรันใน editor ครั้งแรก
 * setup() รันซ้ำได้: ไม่สร้างสเปรดชีต/แท็บ/โฟลเดอร์ซ้ำ และเติมเฉพาะคอลัมน์ที่ขาด (ไม่ลบ ไม่ย้ายคอลัมน์เดิม)
 *
 * ชนิดคอลัมน์: string | enum | datetime | json → เซลล์แบบ plain text, number | boolean → ปล่อยตามปกติ
 */

const SCHEMA = Object.freeze({
  PRESENTERS: {
    presenter_id: 'string',
    role: 'enum',
    full_name: 'string',
    email: 'string',
    phone: 'string',
    organization: 'string',
    pdpa_consent_at: 'datetime',
    created_at: 'datetime',
    updated_at: 'datetime'
  },
  SUBMISSIONS: {
    submission_id: 'string',
    event_id: 'string',
    presenter_id: 'string',
    type: 'enum',
    title: 'string',
    authors: 'json',
    subject_area: 'string',
    abstract_short: 'string',
    academic_year: 'number',
    status: 'enum',
    allow_publish: 'boolean',
    track_token: 'string',
    reviewer_note: 'string',
    drive_folder_id: 'string',
    submitted_at: 'datetime',
    created_at: 'datetime',
    updated_at: 'datetime'
  },
  FILES: {
    file_id: 'string',
    submission_id: 'string',
    file_kind: 'enum',
    version: 'number',
    is_current: 'boolean',
    drive_file_id: 'string',
    file_name: 'string',
    original_name: 'string',
    mime_type: 'string',
    size_kb: 'number',
    uploaded_at: 'datetime'
  },
  STATUS_LOG: {
    log_id: 'string',
    submission_id: 'string',
    from_status: 'enum',
    to_status: 'enum',
    note: 'string',
    changed_by: 'string',
    changed_at: 'datetime'
  },
  EMAIL_LOG: {
    email_id: 'string',
    submission_id: 'string',
    to_email: 'string',
    template: 'enum',
    result: 'enum',
    error: 'string',
    sent_at: 'datetime'
  },
  ADMINS: {
    email: 'string',
    full_name: 'string',
    role: 'enum',
    active: 'boolean'
  },
  EVENTS: {
    event_id: 'string',
    name: 'string',
    year: 'number',
    open_date: 'datetime',
    close_date: 'datetime',
    oral_template_url: 'string',
    poster_template_url: 'string',
    is_current: 'boolean'
  },
  TIMELINE: {
    timeline_id: 'string',
    event_id: 'string',
    title: 'string',
    start_date: 'datetime',
    end_date: 'datetime',
    detail: 'string',
    sort_order: 'number'
  },
  VIDEO_CATEGORIES: {
    category_id: 'string',
    name: 'string',
    description: 'string',
    sort_order: 'number'
  },
  VIDEOS: {
    video_id: 'string',
    category_id: 'string',
    title: 'string',
    youtube_id: 'string',
    description: 'string',
    sort_order: 'number',
    active: 'boolean'
  },
  DOC_CATEGORIES: {
    category_id: 'string',
    name: 'string',
    sort_order: 'number'
  },
  DOCUMENTS: {
    document_id: 'string',
    category_id: 'string',
    title: 'string',
    author: 'string',
    academic_year: 'number',
    file_type: 'enum',
    drive_file_id: 'string',
    size_kb: 'number',
    template_for: 'enum',
    download_count: 'number',
    active: 'boolean',
    created_at: 'datetime',
    updated_at: 'datetime'
  },
  NEWS: {
    news_id: 'string',
    title: 'string',
    summary: 'string',
    body: 'string',
    cover_file_id: 'string',
    status: 'enum',
    pinned: 'boolean',
    published_at: 'datetime',
    created_by: 'string',
    created_at: 'datetime',
    updated_at: 'datetime'
  }
});

const TEXT_COLUMN_TYPES = Object.freeze(['string', 'enum', 'datetime', 'json']);
const DRIVE_SUBFOLDERS = Object.freeze(['_documents', '_news']);

/**
 * รันจาก Apps Script editor: สร้าง/ตรวจสเปรดชีต แท็บ หัวคอลัมน์ โฟลเดอร์ Drive
 * และบันทึก SPREADSHEET_ID, ROOT_FOLDER_ID ลง Script Properties
 */
function setup() {
  assertEditorRun_();
  const report = [];

  const root = getOrCreateRootFolder_(report);
  DRIVE_SUBFOLDERS.forEach(name => getOrCreateFolder_(root, name, report));

  const created = !getConfig_().SPREADSHEET_ID;
  const ss = getOrCreateSpreadsheet_(root, report);
  dbSpreadsheetCache_ = ss;

  Object.keys(SCHEMA).forEach(name => ensureSheet_(ss, name, SCHEMA[name], report));
  if (created) removeUnusedDefaultSheets_(ss, report);
  seedDocCategories_(report);

  report.push('เสร็จสิ้น สเปรดชีต: ' + ss.getUrl());
  console.log(report.join('\n'));
  return report;
}

/**
 * ให้รันได้เฉพาะเจ้าของสคริปต์จาก editor (กันการเรียกผ่าน google.script.run)
 */
function assertEditorRun_() {
  const active = Session.getActiveUser().getEmail();
  const effective = Session.getEffectiveUser().getEmail();
  if (!active || active !== effective) {
    throw new Error('ฟังก์ชันนี้รันได้จาก Apps Script editor โดยเจ้าของสคริปต์เท่านั้น');
  }
}

function getOrCreateRootFolder_(report) {
  const id = getConfig_().ROOT_FOLDER_ID;
  if (id) {
    try {
      const folder = DriveApp.getFolderById(id);
      report.push('ใช้โฟลเดอร์เดิม: ' + folder.getName());
      return folder;
    } catch (e) {
      throw new Error('เปิดโฟลเดอร์ ROOT_FOLDER_ID="' + id + '" ไม่ได้ ตรวจค่าใน Script Properties หรือลบค่านี้เพื่อสร้างใหม่');
    }
  }
  const folder = DriveApp.createFolder(ORG_FULL_NAME + ' (ไฟล์ระบบ)');
  setConfig_('ROOT_FOLDER_ID', folder.getId());
  report.push('สร้างโฟลเดอร์ใหม่: ' + folder.getName());
  return folder;
}

/** หาโฟลเดอร์ย่อยตามชื่อ ไม่มีจะสร้างใหม่ */
function getOrCreateFolder_(parent, name, report) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  const folder = parent.createFolder(name);
  if (report) report.push('สร้างโฟลเดอร์: ' + name);
  return folder;
}

function getOrCreateSpreadsheet_(root, report) {
  const id = getConfig_().SPREADSHEET_ID;
  if (id) {
    try {
      const ss = SpreadsheetApp.openById(id);
      report.push('ใช้สเปรดชีตเดิม: ' + ss.getName());
      return ss;
    } catch (e) {
      throw new Error('เปิดสเปรดชีต SPREADSHEET_ID="' + id + '" ไม่ได้ ตรวจค่าใน Script Properties หรือลบค่านี้เพื่อสร้างใหม่');
    }
  }
  const ss = SpreadsheetApp.create(ORG_FULL_NAME + ' - ฐานข้อมูล');
  ss.setSpreadsheetTimeZone(TIMEZONE);
  DriveApp.getFileById(ss.getId()).moveTo(root);
  setConfig_('SPREADSHEET_ID', ss.getId());
  report.push('สร้างสเปรดชีตใหม่: ' + ss.getName());
  return ss;
}

/**
 * สร้างแท็บถ้ายังไม่มี เติมหัวคอลัมน์ที่ขาดต่อท้าย จัดรูปแบบหัว และตั้งคอลัมน์ข้อความเป็น plain text
 */
function ensureSheet_(ss, name, columns, report) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    report.push('สร้างแท็บ: ' + name);
  }

  const headers = getHeaders_(sheet);
  let lastUsed = headers.length;
  while (lastUsed > 0 && !headers[lastUsed - 1]) lastUsed--;

  const missing = Object.keys(columns).filter(col => headers.indexOf(col) === -1);
  if (missing.length) {
    const needCols = lastUsed + missing.length;
    if (sheet.getMaxColumns() < needCols) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), needCols - sheet.getMaxColumns());
    }
    sheet.getRange(1, lastUsed + 1, 1, missing.length).setValues([missing]);
    if (lastUsed > 0) report.push('เพิ่มคอลัมน์ใน ' + name + ': ' + missing.join(', '));
  }

  const finalHeaders = getHeaders_(sheet);
  sheet.getRange(1, 1, 1, finalHeaders.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  const bodyRows = sheet.getMaxRows() - 1;
  if (bodyRows > 0) {
    Object.keys(columns).forEach(col => {
      if (TEXT_COLUMN_TYPES.indexOf(columns[col]) === -1) return;
      sheet.getRange(2, finalHeaders.indexOf(col) + 1, bodyRows, 1).setNumberFormat('@');
    });
  }
}

/** ลบแท็บเริ่มต้น (เช่น Sheet1 / แผ่น1) ของสเปรดชีตที่เพิ่งสร้าง ที่ไม่อยู่ใน SCHEMA และไม่มีข้อมูล */
function removeUnusedDefaultSheets_(ss, report) {
  ss.getSheets().forEach(sheet => {
    if (SCHEMA[sheet.getName()]) return;
    if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0 && ss.getSheets().length > 1) {
      report.push('ลบแท็บว่าง: ' + sheet.getName());
      ss.deleteSheet(sheet);
    }
  });
}

function seedDocCategories_(report) {
  withLock_(() => {
    if (readAll_('DOC_CATEGORIES').length > 0) return;
    DEFAULT_DOC_CATEGORIES.forEach((name, i) => {
      insert_('DOC_CATEGORIES', {
        category_id: 'DOC-CAT-' + String(i + 1).padStart(2, '0'),
        name: name,
        sort_order: i + 1
      });
    });
    report.push('เพิ่มหมวดเอกสารเริ่มต้น ' + DEFAULT_DOC_CATEGORIES.length + ' หมวด');
  });
}
