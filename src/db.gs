/**
 * db.gs
 * helper อ่าน/เขียน Google Sheets โดยอ้างอิงชื่อหัวคอลัมน์ (ห้ามใช้เลข index)
 * - ชนิดของแต่ละคอลัมน์มาจาก SCHEMA ใน setup.gs ใช้แปลงค่าตอนอ่าน/เขียน
 * - ทุกการเขียนอยู่ใน withLock_() เสมอ (insert_ / updateBy_ ครอบให้เอง)
 */

let dbSpreadsheetCache_ = null;
let dbLockDepth_ = 0;

function getSpreadsheet_() {
  if (!dbSpreadsheetCache_) {
    dbSpreadsheetCache_ = SpreadsheetApp.openById(requireConfig_('SPREADSHEET_ID'));
  }
  return dbSpreadsheetCache_;
}

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('ไม่พบแท็บ "' + name + '" กรุณารัน setup()');
  return sheet;
}

/**
 * รันฟังก์ชันภายใต้ script lock เรียกซ้อนกันได้ (ชั้นในไม่ขอ lock ซ้ำ)
 */
function withLock_(fn) {
  if (dbLockDepth_ > 0) return fn();
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LIMITS.LOCK_WAIT_MS);
  } catch (e) {
    throw userError_('ขณะนี้มีผู้ใช้งานจำนวนมาก กรุณาลองใหม่อีกครั้ง');
  }
  dbLockDepth_++;
  try {
    return fn();
  } finally {
    dbLockDepth_--;
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

// ---------- อ่าน ----------

/**
 * อ่านทุกแถวของแท็บเป็น array ของ object { ชื่อคอลัมน์: ค่า }
 */
function readAll_(name) {
  return readTable_(name).rows.map(item => item.record);
}

/**
 * หาแถวแรกที่คอลัมน์ col มีค่าเท่ากับ value (เทียบแบบ string) ไม่พบคืน null
 */
function findBy_(name, col, value) {
  const table = readTable_(name);
  assertColumns_(name, table.headers, [col]);
  const target = String(value);
  const found = table.rows.find(item => String(item.record[col]) === target);
  return found ? found.record : null;
}

/**
 * อ่านแท็บพร้อมเลขแถวจริงใน Sheets (ใช้ภายใน db.gs)
 * @return {{ sheet, headers: string[], rows: { rowNumber: number, record: Object }[] }}
 */
function readTable_(name) {
  const sheet = getSheet_(name);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return { sheet: sheet, headers: [], rows: [] };

  const values = sheet.getRange(1, 1, Math.max(lastRow, 1), lastCol).getValues();
  const headers = values[0].map(h => String(h).trim());
  const types = getColumnTypes_(name);
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row.every(v => v === '' || v === null)) continue;
    const record = {};
    headers.forEach((h, c) => {
      if (h) record[h] = fromCell_(row[c], types[h]);
    });
    rows.push({ rowNumber: r + 1, record: record });
  }
  return { sheet: sheet, headers: headers, rows: rows };
}

// ---------- เขียน ----------

/**
 * เพิ่มแถวใหม่ คอลัมน์ที่ไม่ได้ส่งมาจะว่าง
 * ถ้าแท็บมี created_at / updated_at และไม่ได้ส่งมา จะใส่เวลาปัจจุบันให้
 * @return {Object} record ที่บันทึก
 */
function insert_(name, obj) {
  return withLock_(() => {
    const sheet = getSheet_(name);
    const headers = getHeaders_(sheet);
    assertColumns_(name, headers, Object.keys(obj));

    const record = Object.assign({}, obj);
    const now = nowIso_();
    if (headers.indexOf('created_at') !== -1 && !record.created_at) record.created_at = now;
    if (headers.indexOf('updated_at') !== -1 && !record.updated_at) record.updated_at = now;

    const types = getColumnTypes_(name);
    const row = headers.map(h => toCell_(record[h], types[h]));
    const nextRow = sheet.getLastRow() + 1;
    if (nextRow > sheet.getMaxRows()) {
      // แถวที่แทรกจะได้ format (เช่น plain text) จากแถวด้านบน
      sheet.insertRowsAfter(sheet.getMaxRows(), 200);
    }
    sheet.getRange(nextRow, 1, 1, headers.length).setValues([row]);
    return record;
  });
}

/**
 * แก้แถวแรกที่ keyCol = keyValue ด้วยค่าใน patch (merge) ไม่พบคืน null
 * ถ้าแท็บมี updated_at และ patch ไม่ได้ระบุ จะใส่เวลาปัจจุบันให้
 * @return {Object|null} record หลังแก้
 */
function updateBy_(name, keyCol, keyValue, patch) {
  return withLock_(() => {
    const table = readTable_(name);
    assertColumns_(name, table.headers, [keyCol].concat(Object.keys(patch)));

    const target = String(keyValue);
    const found = table.rows.find(item => String(item.record[keyCol]) === target);
    if (!found) return null;

    const record = Object.assign({}, found.record, patch);
    if (table.headers.indexOf('updated_at') !== -1 && !('updated_at' in patch)) {
      record.updated_at = nowIso_();
    }

    const types = getColumnTypes_(name);
    const row = table.headers.map(h => (h ? toCell_(record[h], types[h]) : ''));
    table.sheet.getRange(found.rowNumber, 1, 1, table.headers.length).setValues([row]);
    return record;
  });
}

// ---------- แปลงค่า ----------

function getHeaders_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
}

function getColumnTypes_(name) {
  return SCHEMA[name] || {};
}

function assertColumns_(name, headers, cols) {
  const missing = cols.filter(c => headers.indexOf(c) === -1);
  if (missing.length) {
    throw new Error('แท็บ "' + name + '" ไม่มีคอลัมน์: ' + missing.join(', ') + ' (รัน setup() เพื่อเพิ่มคอลัมน์)');
  }
}

/** ค่าในเซลล์ → ค่าใน JS ตามชนิดคอลัมน์ */
function fromCell_(value, type) {
  if (value instanceof Date) return toIso_(value);
  switch (type) {
    case 'boolean':
      return value === true || String(value).toUpperCase() === 'TRUE';
    case 'number':
      return value === '' || value === null ? '' : Number(value);
    case 'json':
      if (value === '' || value === null) return [];
      try { return JSON.parse(value); } catch (e) { return value; }
    default:
      return value === null ? '' : String(value);
  }
}

/** ค่าใน JS → ค่าที่เขียนลงเซลล์ตามชนิดคอลัมน์ */
function toCell_(value, type) {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return toIso_(value);
  switch (type) {
    case 'boolean':
      if (value === '') return '';
      return value === true || String(value).toUpperCase() === 'TRUE';
    case 'number':
      return value === '' ? '' : Number(value);
    case 'json':
      return escapeFormula_(typeof value === 'string' ? value : JSON.stringify(value));
    default:
      return escapeFormula_(String(value));
  }
}

/**
 * กันข้อความจากผู้ใช้ถูกตีความเป็นสูตร (formula injection) ด้วยการเติม ' ข้างหน้า
 * Sheets ซ่อน ' ตัวนี้และ getValues() คืนข้อความเดิม
 */
function escapeFormula_(text) {
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

// ---------- เวลาและ ID ----------

/** ISO 8601 ตามเวลาไทย เช่น 2026-11-03T13:20:00+07:00 */
function toIso_(date) {
  return Utilities.formatDate(date, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function nowIso_() {
  return toIso_(new Date());
}

/** เช่น newId_('PRE') → PRE-3F2A9C1D */
function newId_(prefix) {
  return prefix + '-' + Utilities.getUuid().slice(0, 8).toUpperCase();
}
