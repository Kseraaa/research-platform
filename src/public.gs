/**
 * public.gs
 * API สาธารณะ (ไม่ต้องล็อกอิน): หน้าแรก, Timeline, ข่าว, ศูนย์ดาวน์โหลดเอกสาร, คลังวิดีโอ
 * ผลลัพธ์ cache ใน CacheService 10 นาที แอดมินแก้ข้อมูลแล้วเรียก clearPublicCache_()
 * (getLibrary สำหรับคลังงานวิจัยทำในเฟส 6)
 */

const NEWS_PAGE_SIZE = 9;
const DOCUMENTS_PAGE_SIZE = 12;
const HOME_NEWS_COUNT = 3;
const PUBLIC_CACHE_VERSION_KEY = 'public:version';
const CACHE_MAX_SEC = 21600; // ค่าสูงสุดที่ CacheService รับ

// ---------- public API ----------

/**
 * หน้าแรก: รอบกิจกรรมปัจจุบัน + Timeline ของรอบนั้น + ข่าวล่าสุด 3 ข่าว
 */
function getHomeData() {
  return wrapApi_(() => {
    const timeline = getTimelineData_();
    return {
      event: timeline.event,
      timeline: timeline.items,
      news: getPublishedNews_().slice(0, HOME_NEWS_COUNT)
    };
  });
}

/** กำหนดการเต็มของรอบปัจจุบัน { event, items } */
function getTimeline() {
  return wrapApi_(() => getTimelineData_());
}

/**
 * รายการข่าวที่เผยแพร่แล้ว (ปักหมุดก่อน แล้วใหม่ไปเก่า)
 * @param {{ page?: number }} filters
 */
function getNews(filters) {
  return wrapApi_(() => {
    const f = asObject_(filters);
    return paginate_(getPublishedNews_(), f.page, NEWS_PAGE_SIZE);
  });
}

/** รายละเอียดข่าว (เฉพาะ published) */
function getNewsDetail(newsId) {
  return wrapApi_(() => {
    const id = cleanText_(newsId, 40);
    if (!/^NEWS-[A-Za-z0-9]+$/.test(id)) throw userError_('ไม่พบข่าวนี้');
    const detail = cachedRead_('news:' + id, () => {
      const news = findBy_('NEWS', 'news_id', id);
      return news && news.status === 'published' ? toNewsItem_(news, true) : null;
    });
    if (!detail) throw userError_('ไม่พบข่าวนี้ หรือข่าวถูกยกเลิกการเผยแพร่แล้ว');
    return detail;
  });
}

/**
 * ศูนย์ดาวน์โหลดเอกสาร: ค้นหาจากชื่อ/ผู้จัดทำ กรองหมวดและปีการศึกษา แบ่งหน้าละ 12
 * @param {{ q?: string, category?: string, year?: number, page?: number }} filters
 * @return {{ items, page, totalPages, total, categories: {category_id, name, count}[], years: number[] }}
 */
function getDocuments(filters) {
  return wrapApi_(() => {
    const f = asObject_(filters);
    const q = cleanText_(f.q, 100).toLowerCase();
    const category = cleanText_(f.category, 40);
    const year = toPositiveInt_(f.year, 0);
    const data = getDocumentsData_();

    const matched = data.documents.filter(doc =>
      (!q || doc.title.toLowerCase().indexOf(q) !== -1 || doc.author.toLowerCase().indexOf(q) !== -1) &&
      (!category || doc.category_id === category) &&
      (!year || doc.academic_year === year)
    );
    const result = paginate_(matched, f.page, DOCUMENTS_PAGE_SIZE);
    result.categories = data.categories;
    result.years = data.years;
    return result;
  });
}

/** คลังวิดีโอ: หมวดหมู่ที่มีวิดีโอ active เรียงตาม sort_order */
function getVideos() {
  return wrapApi_(() => cachedRead_('videos', () => {
    const videos = readAll_('VIDEOS').filter(v => v.active && v.youtube_id);
    return readAll_('VIDEO_CATEGORIES')
      .sort(bySortOrder_)
      .map(cat => ({
        category_id: cat.category_id,
        name: cat.name,
        description: cat.description,
        videos: videos
          .filter(v => v.category_id === cat.category_id)
          .sort(bySortOrder_)
          .map(v => ({ video_id: v.video_id, title: v.title, youtube_id: v.youtube_id, description: v.description }))
      }))
      .filter(cat => cat.videos.length > 0);
  }));
}

// ---------- ข้อมูลที่ใช้ร่วมกัน ----------

/** รอบกิจกรรมปัจจุบัน (is_current = TRUE) หรือ null */
function getCurrentEvent_() {
  return cachedRead_('event', () => {
    const event = readAll_('EVENTS').find(e => e.is_current);
    return event ? {
      event_id: event.event_id,
      name: event.name,
      year: event.year,
      open_date: event.open_date,
      close_date: event.close_date
    } : null;
  });
}

/** ใช้ใน doGet: ถ้ายังไม่ได้ setup หรืออ่านไม่ได้ ให้หน้าเว็บโหลดต่อได้ */
function getCurrentEventSafe_() {
  try {
    return getCurrentEvent_();
  } catch (e) {
    console.warn('อ่านรอบกิจกรรมปัจจุบันไม่ได้: ' + (e && e.message));
    return null;
  }
}

function getTimelineData_() {
  return cachedRead_('timeline', () => {
    const event = getCurrentEvent_();
    if (!event) return { event: null, items: [] };
    const items = readAll_('TIMELINE')
      .filter(t => t.event_id === event.event_id && t.start_date)
      .sort((a, b) => toTime_(a.start_date) - toTime_(b.start_date) || bySortOrder_(a, b))
      .map(t => ({ timeline_id: t.timeline_id, title: t.title, start_date: t.start_date, end_date: t.end_date, detail: t.detail }));
    return { event: event, items: items };
  });
}

/** ข่าว published ทั้งหมดแบบย่อ (ไม่มี body) ปักหมุดก่อน แล้วใหม่ไปเก่า */
function getPublishedNews_() {
  return cachedRead_('news', () => readAll_('NEWS')
    .filter(n => n.status === 'published')
    .sort((a, b) => (b.pinned === a.pinned ? 0 : b.pinned ? 1 : -1) || toTime_(b.published_at) - toTime_(a.published_at))
    .map(n => toNewsItem_(n, false)));
}

function toNewsItem_(news, withBody) {
  const item = {
    news_id: news.news_id,
    title: news.title,
    summary: news.summary,
    cover_url: driveImageUrl_(news.cover_file_id),
    published_at: news.published_at,
    pinned: news.pinned
  };
  if (withBody) item.body = news.body;
  return item;
}

function getDocumentsData_() {
  return cachedRead_('documents', () => {
    const documents = readAll_('DOCUMENTS')
      .filter(d => d.active && d.drive_file_id)
      .sort((a, b) => (Number(b.academic_year) || 0) - (Number(a.academic_year) || 0) || String(a.title).localeCompare(String(b.title), 'th'))
      .map(d => ({
        document_id: d.document_id,
        category_id: d.category_id,
        title: d.title,
        author: d.author,
        academic_year: Number(d.academic_year) || '',
        file_type: d.file_type,
        size_kb: d.size_kb,
        drive_file_id: d.drive_file_id
      }));
    const categories = readAll_('DOC_CATEGORIES').sort(bySortOrder_).map(c => ({
      category_id: c.category_id,
      name: c.name,
      count: documents.filter(d => d.category_id === c.category_id).length
    }));
    const years = documents.map(d => d.academic_year).filter(Boolean)
      .filter((y, i, all) => all.indexOf(y) === i)
      .sort((a, b) => b - a);
    return { documents: documents, categories: categories, years: years };
  });
}

// ---------- util ----------

function bySortOrder_(a, b) {
  return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
}

function toTime_(iso) {
  const t = new Date(iso).getTime();
  return isNaN(t) ? 0 : t;
}

/** URL รูปจาก Drive (ไฟล์ต้องแชร์แบบทุกคนที่มีลิงก์ดูได้) */
function driveImageUrl_(fileId) {
  return fileId && /^[A-Za-z0-9_-]+$/.test(fileId) ? 'https://lh3.googleusercontent.com/d/' + fileId : '';
}

// ---------- cache ----------

/**
 * อ่านจาก cache ถ้าไม่มีจึงเรียก fn() แล้วเก็บไว้ 10 นาที
 * key ทุกตัวขึ้นต้นด้วย version ทำให้ clearPublicCache_() ล้างได้ทั้งหมดในครั้งเดียว
 */
function cachedRead_(key, fn) {
  const cache = CacheService.getScriptCache();
  const fullKey = 'public:' + getPublicCacheVersion_(cache) + ':' + key;
  const hit = cache.get(fullKey);
  if (hit !== null) return JSON.parse(hit);
  const value = fn();
  try {
    cache.put(fullKey, JSON.stringify(value), LIMITS.PUBLIC_CACHE_SEC);
  } catch (e) {
    console.warn('cache ไม่สำเร็จ (' + key + '): ' + (e && e.message));
  }
  return value;
}

function getPublicCacheVersion_(cache) {
  let version = cache.get(PUBLIC_CACHE_VERSION_KEY);
  if (!version) {
    version = String(Date.now());
    cache.put(PUBLIC_CACHE_VERSION_KEY, version, CACHE_MAX_SEC);
  }
  return version;
}

/** ล้าง cache ข้อมูลสาธารณะทั้งหมด เรียกหลังแอดมินแก้ Timeline/ข่าว/เอกสาร/วิดีโอ/รอบกิจกรรม */
function clearPublicCache_() {
  CacheService.getScriptCache().put(PUBLIC_CACHE_VERSION_KEY, String(Date.now()), CACHE_MAX_SEC);
}
