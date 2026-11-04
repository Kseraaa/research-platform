/**
 * email.gs
 * ส่งอีเมลผ่าน Resend (UrlFetchApp) + บันทึก EMAIL_LOG ทุกครั้ง
 * sendEmail_() ไม่ throw เสมอ: ส่งไม่สำเร็จจะบันทึก error แล้วคืน false งานหลักต้องทำต่อได้
 * template ทั้งหมดเป็นภาษาไทย ใช้ inline CSS และตาราง เพื่อให้แสดงถูกในโปรแกรมอีเมลทั่วไปและบนมือถือ
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** สีจาก design token (docs/DESIGN.md ข้อ 2) อีเมลใช้ class ไม่ได้ จึงต้องเป็นค่า hex */
const EMAIL_COLORS = Object.freeze({
  navy800: '#0D2F4B', navy900: '#082238', navy100: '#D5E1EC', navy500: '#1F4E79',
  gold500: '#C9A22F', ink: '#1C2430', inkMuted: '#4A5565', line: '#E3E7ED', surfaceAlt: '#F5F7FA',
  info: ['#EAF2FB', '#1F4E79'], success: ['#E8F5EE', '#1E6B43'], warning: ['#FFF4E0', '#8A5300'], danger: ['#FDECEC', '#A12A2A']
});

const EMAIL_STATUS_VARIANTS = Object.freeze({
  submitted: 'info', under_review: 'info', resubmitted: 'info',
  revision_requested: 'warning', accepted: 'success', recorded: 'success', rejected: 'danger'
});

/**
 * ส่งอีเมล 1 ฉบับ
 * @param {string} to อีเมลผู้รับ
 * @param {string} template หนึ่งใน EMAIL_TEMPLATES
 * @param {Object} data ข้อมูลของ template (ดู buildEmail_)
 * @param {string} submissionId ว่างได้ (เช่น OTP)
 * @return {boolean} ส่งสำเร็จหรือไม่
 */
function sendEmail_(to, template, data, submissionId) {
  let emailId = '';
  let error = '';
  try {
    const config = getConfig_();
    if (!config.RESEND_API_KEY || !config.EMAIL_FROM) throw new Error('ยังไม่ได้ตั้ง Script Property RESEND_API_KEY หรือ EMAIL_FROM');
    if (!EMAIL_PATTERN.test(String(to || ''))) throw new Error('อีเมลผู้รับไม่ถูกต้อง: ' + to);
    const email = buildEmail_(template, data);
    const response = UrlFetchApp.fetch(RESEND_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + config.RESEND_API_KEY },
      payload: JSON.stringify({ from: config.EMAIL_FROM, to: [to], subject: email.subject, html: email.html, text: email.text }),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    const body = response.getContentText();
    let parsed = {};
    try { parsed = JSON.parse(body || '{}'); } catch (e) { parsed = {}; }
    if (code >= 200 && code < 300 && parsed.id) emailId = parsed.id;
    else error = 'Resend HTTP ' + code + ': ' + (parsed.message || body || '');
  } catch (e) {
    error = (e && e.message) || String(e);
  }

  try {
    insert_('EMAIL_LOG', {
      email_id: emailId || newId_('EML'),
      submission_id: submissionId || '',
      to_email: String(to || '').toLowerCase(),
      template: template,
      result: emailId ? 'sent' : 'failed',
      error: error.slice(0, 500),
      sent_at: nowIso_()
    });
  } catch (e) {
    console.error('บันทึก EMAIL_LOG ไม่สำเร็จ: ' + (e && e.message));
  }
  if (error) console.warn('ส่งอีเมล ' + template + ' ถึง ' + to + ' ไม่สำเร็จ: ' + error);
  return Boolean(emailId);
}

// ---------- template ----------

/**
 * สร้าง subject / html / text ของแต่ละ template (ไม่แตะ network ใช้ทดสอบได้)
 *  - otp:               { code, minutes }
 *  - submitted:         { name, submission_id, title, type, status, link_url, link_label }
 *  - status_changed:    { name, submission_id, title, type, status, note, link_url, link_label }
 *  - resubmitted_admin: { submission_id, title, type, presenter_name, link_url }
 */
function buildEmail_(template, data) {
  const d = data || {};
  if (template === 'otp') {
    return emailLayout_(
      'รหัสเข้าสู่ระบบ ' + d.code,
      'รหัสเข้าสู่ระบบของคุณคือ ' + d.code,
      '<p style="margin:0 0 16px">รหัสสำหรับเข้าสู่ระบบของคุณคือ</p>' +
        '<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:8px;color:' + EMAIL_COLORS.navy800 + '">' + escapeHtml_(d.code) + '</p>' +
        '<p style="margin:0;color:' + EMAIL_COLORS.inkMuted + '">รหัสนี้ใช้ได้ ' + escapeHtml_(d.minutes) + ' นาที ห้ามบอกรหัสนี้กับผู้อื่น หากคุณไม่ได้ขอรหัส ไม่ต้องทำอะไร</p>',
      ['รหัสเข้าสู่ระบบของคุณคือ ' + d.code, 'รหัสนี้ใช้ได้ ' + d.minutes + ' นาที ห้ามบอกรหัสนี้กับผู้อื่น']
    );
  }

  if (template === 'submitted') {
    return emailLayout_(
      'ได้รับผลงานแล้ว ' + d.submission_id,
      'เราได้รับผลงาน "' + d.title + '" แล้ว รหัสงาน ' + d.submission_id,
      greeting_(d.name) +
        '<p style="margin:0 0 16px">หน่วยส่งเสริมงานวิจัยได้รับผลงานของคุณเรียบร้อยแล้ว กรุณาเก็บรหัสงานไว้ใช้อ้างอิง</p>' +
        submissionTable_(d) +
        emailButton_(d.link_url, d.link_label) +
        '<p style="margin:16px 0 0;color:' + EMAIL_COLORS.inkMuted + ';font-size:14px">เราจะแจ้งทางอีเมลอีกครั้งเมื่อสถานะของผลงานเปลี่ยน</p>',
      ['เราได้รับผลงานของคุณแล้ว', 'รหัสงาน: ' + d.submission_id, 'ชื่อเรื่อง: ' + d.title, linkLine_(d)]
    );
  }

  if (template === 'status_changed') {
    const label = STATUS_LABELS_TH[d.status] || d.status;
    const noteHtml = d.note
      ? '<div style="margin:0 0 20px;padding:16px;border-radius:8px;background:' + EMAIL_COLORS.warning[0] + ';color:' + EMAIL_COLORS.warning[1] + '">' +
          '<p style="margin:0 0 4px;font-weight:600">หมายเหตุจากผู้ตรวจ</p>' +
          '<p style="margin:0">' + escapeHtml_(d.note).replace(/\n/g, '<br>') + '</p></div>'
      : '';
    const action = d.status === STATUSES.REVISION_REQUESTED
      ? '<p style="margin:0 0 16px">กรุณาแก้ไขตามหมายเหตุ แล้วส่งไฟล์ฉบับแก้ไขผ่านลิงก์ด้านล่าง</p>'
      : '';
    return emailLayout_(
      'สถานะผลงาน ' + d.submission_id + ': ' + label,
      'ผลงาน "' + d.title + '" เปลี่ยนสถานะเป็น ' + label,
      greeting_(d.name) +
        '<p style="margin:0 0 16px">สถานะผลงานของคุณมีการเปลี่ยนแปลง</p>' +
        submissionTable_(d) + noteHtml + action +
        emailButton_(d.link_url, d.link_label),
      ['สถานะผลงานของคุณเปลี่ยนเป็น: ' + label, 'รหัสงาน: ' + d.submission_id, 'ชื่อเรื่อง: ' + d.title,
        d.note ? 'หมายเหตุจากผู้ตรวจ: ' + d.note : '', linkLine_(d)]
    );
  }

  if (template === 'resubmitted_admin') {
    return emailLayout_(
      'มีฉบับแก้ไขส่งเข้ามา ' + d.submission_id,
      d.presenter_name + ' ส่งฉบับแก้ไขของ ' + d.submission_id,
      '<p style="margin:0 0 16px">มีผู้ส่งไฟล์ฉบับแก้ไขเข้ามา รอการพิจารณา</p>' +
        submissionTable_(Object.assign({}, d, { status: STATUSES.RESUBMITTED }), [['ผู้ส่ง', d.presenter_name]]) +
        emailButton_(d.link_url, 'เปิดหน้าจัดการระบบ'),
      ['มีฉบับแก้ไขส่งเข้ามา', 'รหัสงาน: ' + d.submission_id, 'ชื่อเรื่อง: ' + d.title, 'ผู้ส่ง: ' + d.presenter_name,
        d.link_url ? 'หน้าจัดการระบบ: ' + d.link_url : '']
    );
  }

  throw new Error('ไม่รู้จัก template: ' + template);
}

function greeting_(name) {
  return name ? '<p style="margin:0 0 16px">เรียน คุณ' + escapeHtml_(name) + '</p>' : '';
}

function linkLine_(d) {
  return d.link_url ? (d.link_label || 'ลิงก์') + ': ' + d.link_url : '';
}

/** ตารางรหัสงาน / ชื่อเรื่อง / ประเภท / สถานะ (+ แถวเพิ่ม) */
function submissionTable_(d, extraRows) {
  const variant = EMAIL_COLORS[EMAIL_STATUS_VARIANTS[d.status] || 'info'];
  const badge = d.status
    ? '<span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:600;background:' + variant[0] + ';color:' + variant[1] + '">' +
        escapeHtml_(STATUS_LABELS_TH[d.status] || d.status) + '</span>'
    : '';
  const rows = [['รหัสงาน', '<strong>' + escapeHtml_(d.submission_id) + '</strong>'], ['ชื่อเรื่อง', escapeHtml_(d.title)]];
  if (d.type) rows.push(['ประเภท', escapeHtml_(TYPE_LABELS_TH[d.type] || d.type)]);
  (extraRows || []).forEach(r => rows.push([r[0], escapeHtml_(r[1])]));
  if (badge) rows.push(['สถานะ', badge]);
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid ' + EMAIL_COLORS.line + ';border-radius:8px;border-collapse:separate">' +
    rows.map((r, i) =>
      '<tr><td style="padding:10px 14px;width:96px;vertical-align:top;font-size:14px;color:' + EMAIL_COLORS.inkMuted + (i ? ';border-top:1px solid ' + EMAIL_COLORS.line : '') + '">' + r[0] + '</td>' +
      '<td style="padding:10px 14px;vertical-align:top;word-break:break-word' + (i ? ';border-top:1px solid ' + EMAIL_COLORS.line : '') + '">' + r[1] + '</td></tr>'
    ).join('') + '</table>';
}

function emailButton_(url, label) {
  if (!/^https:\/\//.test(url || '')) return '';
  return '<p style="margin:0"><a href="' + escapeHtml_(url) + '" style="display:inline-block;padding:12px 24px;border-radius:8px;background:' + EMAIL_COLORS.gold500 +
    ';color:' + EMAIL_COLORS.navy900 + ';font-weight:600;text-decoration:none">' + escapeHtml_(label || 'เปิดลิงก์') + '</a></p>';
}

/**
 * โครงอีเมล: หัวกรมท่า (ชื่อหน่วยงาน) + เนื้อหา + ท้ายอีเมล (ข้อมูลติดต่อ)
 * @param {string} subject
 * @param {string} preheader ข้อความย่อที่โปรแกรมอีเมลแสดงต่อจากหัวเรื่อง
 * @param {string} bodyHtml เนื้อหา (escape แล้ว)
 * @param {string[]} textLines เนื้อหาแบบข้อความล้วน
 */
function emailLayout_(subject, preheader, bodyHtml, textLines) {
  const c = EMAIL_COLORS;
  const html =
    '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + escapeHtml_(subject) + '</title></head>' +
    '<body style="margin:0;padding:0;background:' + c.surfaceAlt + ';font-family:\'Noto Sans Thai\',Tahoma,Arial,sans-serif;color:' + c.ink + '">' +
    '<div style="display:none;max-height:0;overflow:hidden">' + escapeHtml_(preheader) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + c.surfaceAlt + '"><tr><td align="center" style="padding:24px 12px">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid ' + c.line + ';border-radius:12px;overflow:hidden">' +
        '<tr><td style="background:' + c.navy800 + ';padding:20px 24px">' +
          '<div style="font-size:18px;font-weight:700;color:#FFFFFF">' + escapeHtml_(ORG_NAME) + '</div>' +
          '<div style="font-size:14px;color:' + c.navy100 + '">' + escapeHtml_(SCHOOL_NAME) + '</div></td></tr>' +
        '<tr><td style="padding:24px;font-size:16px;line-height:1.7">' + bodyHtml + '</td></tr>' +
        '<tr><td style="padding:16px 24px;background:' + c.surfaceAlt + ';font-size:13px;line-height:1.6;color:' + c.inkMuted + '">' +
          escapeHtml_(ORG_FULL_NAME) + '<br>' + escapeHtml_(ORG_CONTACT.address) + ' · โทร ' + escapeHtml_(ORG_CONTACT.phone) + ' · ' + escapeHtml_(ORG_CONTACT.email) +
          '<br>อีเมลนี้ส่งอัตโนมัติ กรุณาอย่าตอบกลับ</td></tr>' +
      '</table>' +
    '</td></tr></table></body></html>';
  const text = textLines.filter(Boolean).join('\n') + '\n\n--\n' + ORG_FULL_NAME + '\n' + ORG_CONTACT.email;
  return { subject: subject, html: html, text: text };
}

/** escape ข้อความก่อนใส่ HTML ของอีเมล */
function escapeHtml_(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- ลิงก์ในอีเมล ----------

/** URL ของ Web App (/exec) จาก Script Property WEBAPP_URL ถ้าไม่ได้ตั้งใช้ URL ของ deployment ปัจจุบัน */
function getWebAppUrl_() {
  const configured = getConfig_().WEBAPP_URL;
  if (configured) return configured;
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    return '';
  }
}

function trackingUrl_(trackToken) {
  const base = getWebAppUrl_();
  return base ? base + '?page=track&t=' + encodeURIComponent(trackToken) : '';
}

/** ข้อมูลอีเมลของงาน 1 ชิ้น: บุคคลภายนอกได้ลิงก์ติดตาม ครูได้ลิงก์เข้าสู่ระบบ */
function submissionEmailData_(submission, presenter, extra) {
  const isTeacher = submission.type === SUBMISSION_TYPES.TEACHER;
  const base = getWebAppUrl_();
  return Object.assign({
    name: presenter ? presenter.full_name : '',
    submission_id: submission.submission_id,
    title: submission.title,
    type: submission.type,
    status: submission.status,
    link_url: isTeacher ? (base ? base + '?page=teacher' : '') : trackingUrl_(submission.track_token),
    link_label: isTeacher ? 'เข้าสู่ระบบเพื่อดูงานของฉัน' : 'ติดตามสถานะผลงาน'
  }, extra || {});
}
