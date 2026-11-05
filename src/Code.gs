/**
 * Code.gs
 * จุดเข้า Web App: doGet(), include() สำหรับประกอบไฟล์ HTML, wrapApi_() / userError_() สำหรับ public API
 */

/** พารามิเตอร์ใน URL ที่ส่งต่อให้ router ฝั่ง client (อย่างอื่นตัดทิ้ง) */
const INITIAL_PARAM_KEYS = Object.freeze(['page', 't', 'id']);
const INITIAL_PARAM_MAX_LENGTH = 100;

/** ไฟล์ HTML ที่ include() ยอมให้โหลด */
const INCLUDE_PATTERN = /^(css|js|page)_[a-z0-9_]+$/;

function doGet(e) {
  const params = (e && e.parameter) || {};
  const initialParams = {};
  INITIAL_PARAM_KEYS.forEach(key => {
    if (params[key]) initialParams[key] = String(params[key]).slice(0, INITIAL_PARAM_MAX_LENGTH);
  });

  const clientConfig = getClientConfig_();
  clientConfig.isOwner = isScriptOwner_();
  clientConfig.currentEvent = getCurrentEventSafe_();

  const template = HtmlService.createTemplateFromFile('index');
  // ส่งผ่าน data-attribute ด้วย <?= ?> (escape) ฝั่ง client อ่านด้วย JSON.parse
  template.initialParamsJson = JSON.stringify(initialParams);
  template.clientConfigJson = JSON.stringify(clientConfig);
  template.orgName = ORG_NAME;
  template.schoolName = SCHOOL_NAME;
  template.contact = ORG_CONTACT;

  // ALLOWALL: ให้หน้าห่อบน Netlify (โดเมนของโรงเรียน) ฝังเป็น iframe ได้ ดู netlify/ และ ARCHITECTURE ข้อ 9
  // ผลข้างเคียง: เว็บอื่นก็ฝังได้ (clickjacking) แต่การกระทำสำคัญต้องมี session / track token อยู่แล้ว
  return template.evaluate()
    .setTitle(ORG_FULL_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * ผู้เปิดหน้าเว็บคือเจ้าของสคริปต์ที่ล็อกอิน Google อยู่หรือไม่ (เช่นเปิด Test deployment /dev)
 * ใช้แค่เปิดหน้า styleguide ห้ามใช้แทนการตรวจสิทธิ์ข้อมูล
 */
function isScriptOwner_() {
  try {
    const active = Session.getActiveUser().getEmail();
    return Boolean(active) && active === Session.getEffectiveUser().getEmail();
  } catch (e) {
    return false;
  }
}

/**
 * ใช้ใน template: <?!= include('css_main'); ?>
 */
function include(filename) {
  if (!INCLUDE_PATTERN.test(String(filename))) throw new Error('include ไม่อนุญาต: ' + filename);
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * ห่อ public API ให้คืนรูปแบบเดียวเสมอ { ok: true, data } | { ok: false, error }
 * error ที่สร้างด้วย userError_() จะส่งข้อความนั้นให้ผู้ใช้ นอกนั้นส่งข้อความทั่วไป
 */
function wrapApi_(fn) {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    console.error(e && e.stack || e);
    if (!(e && e.userMessage)) recordServerError_(e);
    const result = { ok: false, error: e && e.userMessage ? e.userMessage : 'เกิดข้อผิดพลาด กรุณาลองใหม่' };
    if (e && e.code) result.code = e.code;
    return result;
  }
}

const LAST_ERRORS_KEY = 'debug:last_errors';
const LAST_ERRORS_MAX = 10;

/**
 * เก็บ error ที่ไม่คาดคิด 10 รายการล่าสุดไว้ใน cache (6 ชม.)
 * เพราะการเรียกจากผู้ใช้ที่ไม่ได้ล็อกอินไม่แสดง log ในหน้า Executions ดูได้ด้วย showLastServerErrors()
 */
function recordServerError_(e) {
  try {
    const cache = CacheService.getScriptCache();
    const list = JSON.parse(cache.get(LAST_ERRORS_KEY) || '[]');
    list.unshift({ at: new Date().toISOString(), message: String(e && e.message || e), stack: String(e && e.stack || '').slice(0, 1500) });
    cache.put(LAST_ERRORS_KEY, JSON.stringify(list.slice(0, LAST_ERRORS_MAX)), 21600);
  } catch (ignored) {
    // ห้ามให้การบันทึก error ทำให้ API พังซ้ำ
  }
}

/**
 * รันใน editor: แสดง error ที่ไม่คาดคิดล่าสุดจากหน้าเว็บ (ข้อความจริงที่ผู้ใช้เห็นเป็นแค่ "เกิดข้อผิดพลาด")
 */
function showLastServerErrors() {
  assertEditorRun_();
  const list = JSON.parse(CacheService.getScriptCache().get(LAST_ERRORS_KEY) || '[]');
  if (!list.length) {
    console.log('ไม่มี error ใน 6 ชั่วโมงที่ผ่านมา');
    return 'ไม่มี error';
  }
  list.forEach(item => console.log(item.at + '\n' + item.message + '\n' + item.stack));
  return list;
}

/**
 * สร้าง error ที่ข้อความแสดงให้ผู้ใช้เห็นได้ (ภาษาไทย)
 * code (ไม่บังคับ) ให้ client แยกกรณีได้โดยไม่ต้องเทียบข้อความ เช่น 'SESSION_EXPIRED'
 */
function userError_(msg, code) {
  const e = new Error(msg);
  e.userMessage = msg;
  if (code) e.code = code;
  return e;
}

// ---------- ตรวจ input จาก client ----------

/** ข้อความ: แปลงเป็น string, ตัดช่องว่างหัวท้าย, ตัดความยาวไม่เกิน max */
function cleanText_(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max || 200);
}

/** จำนวนเต็มบวก ไม่ใช่ตัวเลขหรือน้อยกว่า 1 ใช้ค่า fallback */
function toPositiveInt_(value, fallback) {
  const n = Math.floor(Number(value));
  return isFinite(n) && n >= 1 ? n : fallback;
}

/** filters จาก client ต้องเป็น object ธรรมดา */
function asObject_(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** แบ่งหน้า array → { items, page, totalPages, total } */
function paginate_(items, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(toPositiveInt_(page, 1), totalPages);
  return {
    items: items.slice((current - 1) * pageSize, current * pageSize),
    page: current,
    totalPages: totalPages,
    total: items.length
  };
}
