/**
 * triggers.gs
 * งานอัตโนมัติ: ลบงาน draft ที่ค้างเกิน 24 ชม. (ผู้ส่งเริ่มส่งแต่อัปโหลดไม่ครบ/ไม่กดส่ง)
 * ติดตั้งครั้งเดียวด้วย installTriggers() ใน editor → รันทุกวันเวลา 02:00 น. (เวลาไทย)
 */

const DRAFT_CLEANUP_BATCH = 50; // ต่อรอบ กันเกินเวลา 6 นาที (เหลือค่อยลบรอบถัดไป)
const CLEANUP_HANDLER = 'cleanupDrafts';

/**
 * ลบ draft ที่สร้างเกิน LIMITS.DRAFT_TTL_HOURS: โฟลเดอร์ Drive ไปถังขยะ + แถว FILES + แถว SUBMISSIONS
 * เรียกจาก trigger รายวัน (ชื่อไม่ลงท้าย _ เพราะ trigger ต้องเรียกได้) ถ้ามีคนเรียกผ่านหน้าเว็บก็ลบได้แค่ draft ที่หมดอายุแล้วเหมือนกัน
 * upload key อายุแค่ 1 ชม. draft ที่เกิน 24 ชม. จึงไม่มีทาง finalize ได้อีก
 * @return {number} จำนวนงานที่ลบ
 */
function cleanupDrafts() {
  const cutoff = Date.now() - LIMITS.DRAFT_TTL_HOURS * 60 * 60 * 1000;
  const stale = readAll_('SUBMISSIONS')
    .filter(s => s.status === STATUSES.DRAFT && toTime_(s.created_at) < cutoff)
    .slice(0, DRAFT_CLEANUP_BATCH);
  if (!stale.length) return 0;

  stale.forEach(s => {
    if (!s.drive_folder_id) return;
    try {
      DriveApp.getFolderById(s.drive_folder_id).setTrashed(true);
    } catch (e) {
      console.warn('ย้ายโฟลเดอร์ของ ' + s.submission_id + ' ไปถังขยะไม่ได้: ' + (e && e.message));
    }
  });

  const ids = stale.map(s => s.submission_id);
  withLock_(() => {
    deleteWhere_('FILES', f => ids.indexOf(f.submission_id) !== -1);
    // ตรวจสถานะซ้ำภายใต้ lock เผื่อถูก finalize ระหว่างนี้
    deleteWhere_('SUBMISSIONS', s => ids.indexOf(s.submission_id) !== -1 && s.status === STATUSES.DRAFT);
  });
  console.log('ลบ draft ค้าง ' + ids.length + ' งาน: ' + ids.join(', '));
  return ids.length;
}

/**
 * รันใน editor ครั้งเดียว: ติดตั้ง trigger รายวัน 02:00 น. ของ cleanupDrafts (รันซ้ำได้ ไม่สร้างซ้ำ)
 */
function installTriggers() {
  assertEditorRun_();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === CLEANUP_HANDLER)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger(CLEANUP_HANDLER).timeBased().everyDays(1).atHour(2).inTimezone(TIMEZONE).create();
  const message = 'ติดตั้ง trigger ' + CLEANUP_HANDLER + ' ทุกวัน 02:00 น. แล้ว';
  console.log(message);
  return message;
}
