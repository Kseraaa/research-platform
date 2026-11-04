/**
 * auth.gs
 * ล็อกอินครู / ผู้ตรวจ / แอดมิน ด้วยรหัส OTP ทางอีเมล (ดู docs/ARCHITECTURE.md ข้อ 5)
 * - OTP เก็บเป็น hash ใน CacheService 10 นาที ขอได้ 3 ครั้ง / 10 นาที / อีเมล ลองผิดได้ 5 ครั้ง
 * - session token (UUID) เก็บใน CacheService 6 ชม.
 * - ทุก public API ที่ต้องล็อกอินรับ sessionToken เป็นพารามิเตอร์แรกแล้วเรียก requireRole_()
 */

const OTP_REQUEST_MESSAGE = 'หากอีเมลนี้มีสิทธิ์เข้าใช้ระบบ เราได้ส่งรหัส 6 หลักไปแล้ว กรุณาตรวจกล่องจดหมาย (รวมถึงจดหมายขยะ)';
const OTP_RESEND_AFTER_SEC = 60;
const SESSION_EXPIRED = 'SESSION_EXPIRED';

// ---------- public API ----------

/**
 * ขอรหัส OTP ตอบข้อความเดียวกันเสมอไม่ว่าอีเมลมีสิทธิ์หรือไม่ (กันการเดาอีเมล)
 * @return {{ message: string, resendAfterSec: number }}
 */
function requestOtp(email) {
  return wrapApi_(() => {
    const normalized = normalizeEmail_(email);
    if (!EMAIL_PATTERN.test(normalized)) throw userError_('รูปแบบอีเมลไม่ถูกต้อง');

    // จำกัดจำนวนครั้งกับทุกอีเมล (รวมอีเมลที่ไม่มีสิทธิ์) เพื่อไม่ให้ใช้แยกได้ว่าอีเมลไหนมีสิทธิ์
    const cache = CacheService.getScriptCache();
    const countKey = 'otp-requests:' + normalized;
    const count = Number(cache.get(countKey) || 0);
    if (count >= LIMITS.OTP_MAX_REQUESTS) throw userError_('ขอรหัสบ่อยเกินไป กรุณารอ 10 นาทีแล้วลองใหม่');
    cache.put(countKey, String(count + 1), LIMITS.OTP_TTL_SEC);

    if (resolveUser_(normalized)) {
      const code = generateOtpCode_();
      cache.put(otpCacheKey_(normalized), JSON.stringify({
        hash: hashOtp_(normalized, code),
        attempts: 0,
        expiresAt: Date.now() + LIMITS.OTP_TTL_SEC * 1000
      }), LIMITS.OTP_TTL_SEC);
      sendEmail_(normalized, 'otp', { code: code, minutes: LIMITS.OTP_TTL_SEC / 60 }, '');
    }
    return { message: OTP_REQUEST_MESSAGE, resendAfterSec: OTP_RESEND_AFTER_SEC };
  });
}

/**
 * ตรวจรหัส OTP สำเร็จแล้วสร้าง session
 * @return {{ token: string, email: string, role: string, name: string }}
 */
function verifyOtp(email, code) {
  return wrapApi_(() => {
    const normalized = normalizeEmail_(email);
    const input = cleanText_(code, 10);
    if (!/^\d{6}$/.test(input)) throw userError_('กรุณากรอกรหัส 6 หลัก');

    const cache = CacheService.getScriptCache();
    const key = otpCacheKey_(normalized);
    const invalid = 'รหัสไม่ถูกต้องหรือหมดอายุ กรุณาตรวจอีกครั้งหรือขอรหัสใหม่';

    const ok = withLock_(() => {
      const entry = JSON.parse(cache.get(key) || 'null');
      if (!entry || entry.expiresAt < Date.now()) return false;
      if (entry.hash === hashOtp_(normalized, input)) {
        cache.remove(key);
        return true;
      }
      entry.attempts += 1;
      if (entry.attempts >= LIMITS.OTP_MAX_ATTEMPTS) {
        cache.remove(key);
        throw userError_('ใส่รหัสผิดเกิน ' + LIMITS.OTP_MAX_ATTEMPTS + ' ครั้ง กรุณาขอรหัสใหม่');
      }
      const remainingSec = Math.max(1, Math.floor((entry.expiresAt - Date.now()) / 1000));
      cache.put(key, JSON.stringify(entry), remainingSec);
      return false;
    });
    if (!ok) throw userError_(invalid);

    const user = resolveUser_(normalized);
    if (!user) throw userError_('อีเมลนี้ไม่มีสิทธิ์เข้าใช้ระบบ');
    const token = Utilities.getUuid();
    const session = { email: normalized, role: user.role, name: user.name };
    cache.put(sessionCacheKey_(token), JSON.stringify(session), LIMITS.SESSION_TTL_SEC);
    return Object.assign({ token: token }, session);
  });
}

/** ออกจากระบบ (ลบ session ฝั่ง server) */
function logout(sessionToken) {
  return wrapApi_(() => {
    const token = cleanText_(sessionToken, 60);
    if (token) CacheService.getScriptCache().remove(sessionCacheKey_(token));
    return true;
  });
}

/** ข้อมูลผู้ใช้ของ session ปัจจุบัน ใช้ตรวจ session ที่เก็บไว้ในเบราว์เซอร์ตอนเปิดหน้าเว็บ */
function getMe(sessionToken) {
  return wrapApi_(() => {
    const user = requireRole_(sessionToken, [ROLES.TEACHER, ROLES.REVIEWER, ROLES.ADMIN]);
    return { email: user.email, role: user.role, name: user.name };
  });
}

// ---------- ตรวจสิทธิ์ ----------

/**
 * คืนผู้ใช้ของ session ถ้า role อยู่ใน roles ไม่อย่างนั้น throw
 * admin/reviewer ตรวจแท็บ ADMINS ซ้ำทุกครั้ง (ถอดสิทธิ์แล้วมีผลทันที ไม่ต้องรอ session หมดอายุ)
 * @return {{ email: string, role: string, name: string }}
 */
function requireRole_(sessionToken, roles) {
  const token = cleanText_(sessionToken, 60);
  const raw = token ? CacheService.getScriptCache().get(sessionCacheKey_(token)) : null;
  if (!raw) throw userError_('กรุณาเข้าสู่ระบบอีกครั้ง', SESSION_EXPIRED);
  const session = JSON.parse(raw);

  if (ADMIN_ROLES.indexOf(session.role) !== -1) {
    const current = resolveUser_(session.email);
    if (!current || current.role !== session.role) {
      CacheService.getScriptCache().remove(sessionCacheKey_(token));
      throw userError_('สิทธิ์ของคุณเปลี่ยนไป กรุณาเข้าสู่ระบบอีกครั้ง', SESSION_EXPIRED);
    }
  }
  if (roles.indexOf(session.role) === -1) throw userError_('คุณไม่มีสิทธิ์ใช้งานส่วนนี้');
  return session;
}

/**
 * role ของอีเมล: อยู่ใน ADMINS (active) → admin/reviewer / โดเมนโรงเรียน → teacher / อื่นๆ → null
 * @return {{ role: string, name: string }|null}
 */
function resolveUser_(email) {
  const admin = readAll_('ADMINS').find(a => normalizeEmail_(a.email) === email && a.active && ADMIN_ROLES.indexOf(a.role) !== -1);
  if (admin) return { role: admin.role, name: admin.full_name || email };

  const domain = getConfig_().SCHOOL_EMAIL_DOMAIN;
  if (domain && email.slice(-(domain.length + 1)) === '@' + domain) {
    const presenter = findBy_('PRESENTERS', 'email', email);
    // ครูที่ยังไม่เคยส่งงานยังไม่มีชื่อในระบบ (หน้าเว็บแสดงอีเมลแทน และให้กรอกชื่อตอนส่งงาน)
    return { role: ROLES.TEACHER, name: presenter && presenter.full_name ? presenter.full_name : '' };
  }
  return null;
}

// ---------- util ----------

function normalizeEmail_(email) {
  return cleanText_(email, 254).toLowerCase();
}

function otpCacheKey_(email) {
  return 'otp:' + email;
}

function sessionCacheKey_(token) {
  return 'session:' + token;
}

/** รหัส 6 หลักจาก SHA-256 ของ UUID สุ่ม (Math.random ไม่ปลอดภัยพอ) */
function generateOtpCode_() {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid());
  const n = (((bytes[0] & 0xFF) << 24) | ((bytes[1] & 0xFF) << 16) | ((bytes[2] & 0xFF) << 8) | (bytes[3] & 0xFF)) >>> 0;
  return String(n % 1000000).padStart(6, '0');
}

/** เก็บแค่ hash ของรหัส (ผูกกับอีเมล) ไม่เก็บรหัสจริงใน cache */
function hashOtp_(email, code) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email + ':' + code)
    .map(b => ((b & 0xFF) + 0x100).toString(16).slice(1))
    .join('');
}
