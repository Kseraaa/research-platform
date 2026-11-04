/**
 * files.gs
 * รับไฟล์ base64 จาก client: ตรวจนามสกุล, MIME, ขนาด, magic bytes แล้วบันทึกลง Drive + แท็บ FILES
 * ไฟล์งานวิจัยทุกไฟล์เป็นส่วนตัว (ไม่แชร์) จนกว่าจะเข้าคลังในเฟส 6
 */

/** ไบต์แรกของไฟล์แต่ละชนิด (PDF = "%PDF", DOCX = zip "PK\x03\x04") */
const FILE_SIGNATURES = Object.freeze({
  pdf: [0x25, 0x50, 0x44, 0x46],
  docx: [0x50, 0x4B, 0x03, 0x04]
});

/** MIME ที่ยอมรับจาก client นอกจาก MIME ของชนิดนั้น (บางเครื่องไม่ส่ง MIME ของ .docx มา) */
const LOOSE_MIME_TYPES = Object.freeze(['', 'application/octet-stream']);

/**
 * ตรวจไฟล์ที่ client ส่งมา (ไม่แตะ Drive/Sheets ใช้ทดสอบใน tests.gs ได้)
 * @return {{ bytes: Byte[], spec: Object, sizeKb: number, originalName: string }}
 */
function validateUploadedFile_(type, fileKind, name, mimeType, base64, maxMb) {
  const required = REQUIRED_FILES[type] || [];
  if (required.indexOf(fileKind) === -1) throw userError_('ไม่รู้จักชนิดไฟล์ที่ส่งมา');
  const spec = FILE_KIND_SPECS[fileKind];
  const typeText = spec.ext === 'pdf' ? 'PDF' : 'Word (.docx)';

  const originalName = cleanText_(name, 200);
  if (!originalName.toLowerCase().endsWith('.' + spec.ext)) {
    throw userError_(spec.label + ': ต้องเป็นไฟล์ ' + typeText + ' เท่านั้น');
  }
  const mime = cleanText_(mimeType, 120).toLowerCase();
  if (mime !== spec.mime && LOOSE_MIME_TYPES.indexOf(mime) === -1) {
    throw userError_(spec.label + ': ต้องเป็นไฟล์ ' + typeText + ' เท่านั้น');
  }

  const maxBytes = maxMb * 1024 * 1024;
  if (typeof base64 !== 'string' || !base64) throw userError_(spec.label + ': ไม่พบข้อมูลไฟล์');
  // ตรวจความยาว base64 ก่อน decode เพื่อไม่เสียเวลากับไฟล์ที่ใหญ่เกินแน่ๆ
  if (base64.length > Math.ceil(maxBytes / 3) * 4 + 4) throw userError_(spec.label + ': ไฟล์ใหญ่เกิน ' + maxMb + ' MB');

  let bytes;
  try {
    bytes = Utilities.base64Decode(base64);
  } catch (e) {
    throw userError_(spec.label + ': ไฟล์เสียหาย กรุณาเลือกไฟล์ใหม่');
  }
  if (!bytes.length) throw userError_(spec.label + ': ไฟล์ว่างเปล่า');
  if (bytes.length > maxBytes) throw userError_(spec.label + ': ไฟล์ใหญ่เกิน ' + maxMb + ' MB');

  const signature = FILE_SIGNATURES[spec.ext];
  // Utilities.base64Decode คืน byte แบบมีเครื่องหมาย (-128..127) จึงต้อง & 0xFF
  const matches = signature.every((b, i) => (bytes[i] & 0xFF) === b);
  if (!matches) throw userError_(spec.label + ': เนื้อไฟล์ไม่ใช่ ' + typeText + ' (อาจเปลี่ยนนามสกุลมา)');

  return { bytes: bytes, spec: spec, sizeKb: Math.ceil(bytes.length / 1024), originalName: originalName };
}

/**
 * บันทึกไฟล์ที่ผ่านการตรวจลงโฟลเดอร์ของงาน + เพิ่มแถว FILES (is_current = TRUE)
 * - งาน draft ส่งไฟล์ชนิดเดิมซ้ำ (เปลี่ยนไฟล์/ลองใหม่): ลบไฟล์เดิม ใช้ version 1 เหมือนเดิม
 * - งานที่ส่งแล้ว (ฉบับแก้ไขในเฟส 3): version + 1 และไฟล์เดิม is_current = FALSE
 * @return {{ file_id, file_kind, file_name, size_kb, version }}
 */
function saveUploadedFile_(submission, fileKind, checked) {
  const existing = readAll_('FILES').filter(f => f.submission_id === submission.submission_id && f.file_kind === fileKind);
  const isDraft = submission.status === STATUSES.DRAFT;
  const version = isDraft ? 1 : existing.reduce((max, f) => Math.max(max, Number(f.version) || 0), 0) + 1;
  const fileName = submission.submission_id + '_' + fileKind + '_v' + version + '.' + checked.spec.ext;

  const folder = DriveApp.getFolderById(submission.drive_folder_id);
  const driveFile = folder.createFile(Utilities.newBlob(checked.bytes, checked.spec.mime, fileName));

  return withLock_(() => {
    if (isDraft) {
      existing.forEach(f => trashDriveFile_(f.drive_file_id));
      deleteWhere_('FILES', f => f.submission_id === submission.submission_id && f.file_kind === fileKind);
    } else {
      existing.filter(f => f.is_current).forEach(f => updateBy_('FILES', 'file_id', f.file_id, { is_current: false }));
    }
    const record = insert_('FILES', {
      file_id: newId_('FIL'),
      submission_id: submission.submission_id,
      file_kind: fileKind,
      version: version,
      is_current: true,
      drive_file_id: driveFile.getId(),
      file_name: fileName,
      original_name: checked.originalName,
      mime_type: checked.spec.mime,
      size_kb: checked.sizeKb,
      uploaded_at: nowIso_()
    });
    return { file_id: record.file_id, file_kind: fileKind, file_name: fileName, size_kb: checked.sizeKb, version: version };
  });
}

/** ย้ายไฟล์ Drive ไปถังขยะ (กู้คืนได้ 30 วัน) ไม่ทำให้งานหลักล้มถ้าไฟล์หายไปแล้ว */
function trashDriveFile_(driveFileId) {
  if (!driveFileId) return;
  try {
    DriveApp.getFileById(driveFileId).setTrashed(true);
  } catch (e) {
    console.warn('ย้ายไฟล์ ' + driveFileId + ' ไปถังขยะไม่ได้: ' + (e && e.message));
  }
}

/**
 * โฟลเดอร์ของงาน: ROOT/{ปี ค.ศ.}/{type}/{submission_id} (สร้างถ้ายังไม่มี เรียกภายใต้ lock กันโฟลเดอร์ซ้ำ)
 */
function createSubmissionFolder_(submissionId, type, year) {
  const root = DriveApp.getFolderById(requireConfig_('ROOT_FOLDER_ID'));
  const yearFolder = getOrCreateFolder_(root, String(year));
  const typeFolder = getOrCreateFolder_(yearFolder, type);
  return getOrCreateFolder_(typeFolder, submissionId);
}

/**
 * เปิดไฟล์งานวิจัย (ไฟล์ไม่ได้แชร์ใน Drive จึงส่ง base64 ให้ client สร้างไฟล์ดาวน์โหลด)
 * token เป็น session ได้ (admin/reviewer ทุกไฟล์, ครูเฉพาะงานตัวเอง) หรือ track_token (เจ้าของงานภายนอก)
 * @return {{ name: string, mime_type: string, base64: string }}
 */
function getFileForViewer(token, fileId) {
  return wrapApi_(() => {
    const t = cleanText_(token, 60);
    const file = findBy_('FILES', 'file_id', cleanText_(fileId, 40));
    const submission = file ? findBy_('SUBMISSIONS', 'submission_id', file.submission_id) : null;
    if (!file || !submission || submission.status === STATUSES.DRAFT) throw userError_('ไม่พบไฟล์');

    let allowed = false;
    if (t && CacheService.getScriptCache().get(sessionCacheKey_(t))) {
      const user = requireRole_(t, [ROLES.TEACHER, ROLES.REVIEWER, ROLES.ADMIN]);
      if (ADMIN_ROLES.indexOf(user.role) !== -1) {
        allowed = true;
      } else {
        const presenter = findBy_('PRESENTERS', 'presenter_id', submission.presenter_id);
        // ครูเปิดได้: งานของตัวเอง (ทุกฉบับ) หรือไฟล์ฉบับล่าสุดของงานในคลังงานวิจัย
        allowed = Boolean(presenter && presenter.email === user.email) || (isLibrarySubmission_(submission) && file.is_current);
      }
    } else {
      allowed = TRACK_TOKEN_PATTERN.test(t) && submission.track_token === t;
    }
    if (!allowed) throw userError_('คุณไม่มีสิทธิ์เปิดไฟล์นี้');

    const blob = DriveApp.getFileById(file.drive_file_id).getBlob();
    return { name: file.file_name, mime_type: file.mime_type, base64: Utilities.base64Encode(blob.getBytes()) };
  });
}

/**
 * งานเข้าคลังงานวิจัย: แชร์ไฟล์ฉบับล่าสุดแบบ "ทุกคนในโดเมนที่มีลิงก์ ดูได้" (docs/SPEC.md ข้อ 4)
 * ต้อง deploy จากบัญชี Google Workspace ของโรงเรียน ถ้าแชร์ไม่ได้ (เช่น Gmail ส่วนตัว) แค่บันทึก log
 * คลังงานวิจัยยังเปิดไฟล์ได้ผ่าน getFileForViewer จึงไม่กระทบการใช้งาน
 * @return {number} จำนวนไฟล์ที่แชร์สำเร็จ
 */
function shareLibraryFiles_(submission) {
  let shared = 0;
  readAll_('FILES').filter(f => f.submission_id === submission.submission_id && f.is_current).forEach(f => {
    try {
      DriveApp.getFileById(f.drive_file_id).setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
      shared++;
    } catch (e) {
      console.warn('แชร์ไฟล์ ' + f.file_name + ' แบบ domain ไม่ได้: ' + (e && e.message));
    }
  });
  return shared;
}

/** ชนิดไฟล์ที่ยังขาดเทียบกับ REQUIRED_FILES[type] */
function findMissingFiles_(type, currentKinds) {
  return (REQUIRED_FILES[type] || []).filter(kind => currentKinds.indexOf(kind) === -1);
}
