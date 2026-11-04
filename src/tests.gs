/**
 * tests.gs
 * ฟังก์ชันสำหรับรันใน Apps Script editor โดยเจ้าของสคริปต์เท่านั้น
 * - seedSampleData(): ใส่ข้อมูลตัวอย่างสำหรับทดสอบหน้าสาธารณะ (ID ทุกตัวมีคำว่า SAMPLE)
 * - clearSampleData(): ลบข้อมูลตัวอย่างทั้งหมด ไม่แตะข้อมูลจริง
 */

const SAMPLE_MARKER = 'SAMPLE';
const SAMPLE_TABLES = Object.freeze({
  EVENTS: 'event_id',
  TIMELINE: 'timeline_id',
  NEWS: 'news_id',
  DOCUMENTS: 'document_id',
  VIDEO_CATEGORIES: 'category_id',
  VIDEOS: 'video_id'
});

/** ตัวอย่างวิดีโอ YouTube ที่เปิดดูได้แน่นอน (เปลี่ยนเป็นวิดีโอจริงของโรงเรียนภายหลัง) */
const SAMPLE_YOUTUBE_IDS = Object.freeze(['M7lc1UVf-VE', 'aqz-KE-bpKQ']);

/**
 * ใส่ข้อมูลตัวอย่าง: รอบกิจกรรม, Timeline, ข่าว 5 ข่าว (+ draft 1), เอกสาร 12 รายการ, วิดีโอ 3 หมวด
 * วันที่อิงจากวันที่รัน เพื่อให้เห็นรายการที่ผ่านแล้ว / กำลังดำเนินการ / กำลังจะมาถึง
 * รันซ้ำได้: ลบข้อมูลตัวอย่างเดิมก่อนทุกครั้ง
 */
function seedSampleData() {
  assertEditorRun_();
  clearSampleData();

  const day = offset => toIso_(new Date(Date.now() + offset * 24 * 60 * 60 * 1000));
  const thaiYear = Number(Utilities.formatDate(new Date(), TIMEZONE, 'yyyy')) + 543;
  const hasRealCurrentEvent = readAll_('EVENTS').some(e => e.is_current);
  const eventId = 'EVT-' + SAMPLE_MARKER;

  insert_('EVENTS', {
    event_id: eventId,
    name: 'การประชุมวิชาการนำเสนอผลงานวิจัยในชั้นเรียน ครั้งที่ 1 (ตัวอย่าง)',
    year: thaiYear,
    open_date: day(-10),
    close_date: day(20),
    oral_template_url: '',
    poster_template_url: '',
    is_current: !hasRealCurrentEvent
  });

  insertMany_('TIMELINE', [
    ['ประชุมชี้แจงการส่งผลงาน', -25, null, 'ห้องประชุมใหญ่ อาคาร 1'],
    ['เปิดรับลงทะเบียนนำเสนอผลงาน', -10, 20, 'ลงทะเบียนและอัปโหลดไฟล์ผ่านเว็บไซต์นี้'],
    ['อบรมการเขียนบทคัดย่อ (ออนไลน์)', 3, null, 'ผ่าน Google Meet ลิงก์แจ้งทางอีเมล'],
    ['ประกาศรายชื่อผู้นำเสนอ', 27, null, ''],
    ['ส่งไฟล์ฉบับแก้ไข', 28, 35, 'เฉพาะผลงานที่ได้รับแจ้งให้แก้ไข'],
    ['วันนำเสนอผลงาน', 45, null, 'โรงเรียน มอ.วิทยานุสรณ์']
  ].map((t, i) => ({
    timeline_id: 'TL-' + SAMPLE_MARKER + pad2_(i + 1),
    event_id: eventId,
    title: t[0],
    start_date: day(t[1]),
    end_date: t[2] === null ? '' : day(t[2]),
    detail: t[3],
    sort_order: i + 1
  })));

  const newsBody = 'ย่อหน้าแรกของข่าวตัวอย่าง ใช้ทดสอบการแสดงผลข้อความภาษาไทยหลายบรรทัด\n' +
    'บรรทัดที่สองในย่อหน้าเดียวกัน\n\n' +
    'ย่อหน้าที่สอง มีลิงก์ https://www.google.com เพื่อทดสอบการแปลง URL เป็นลิงก์\n\n' +
    'ย่อหน้าสุดท้าย <b>ข้อความนี้ต้องไม่เป็นตัวหนา</b> เพราะเนื้อหาข่าวต้อง escape';
  insertMany_('NEWS', [
    ['เปิดรับลงทะเบียนนำเสนอผลงานวิจัยในชั้นเรียน ปี ' + thaiYear, 'ครูและบุคลากรทางการศึกษาที่สนใจ ลงทะเบียนนำเสนอแบบ Oral หรือ Poster ได้แล้ววันนี้', -9, true, 'published'],
    ['ประกาศผลการคัดเลือกทุนวิจัยประจำภาคเรียนที่ 2', 'รายชื่อครูที่ได้รับทุนสนับสนุนการทำวิจัยในชั้นเรียน', -5, false, 'published'],
    ['อบรมเชิงปฏิบัติการ การวิเคราะห์ข้อมูลด้วย Google Sheets', 'กิจกรรมพัฒนาครูด้านการวิเคราะห์ข้อมูลงานวิจัย', -3, false, 'published'],
    ['แนะนำคู่มือการเขียนรายงานวิจัยฉบับปรับปรุงใหม่', 'ดาวน์โหลดคู่มือได้ที่ศูนย์ดาวน์โหลดเอกสาร', -15, false, 'published'],
    ['ภาพบรรยากาศการนำเสนอผลงานปีที่ผ่านมา', 'ประมวลภาพกิจกรรมการนำเสนอผลงานวิจัยของครูและนักเรียน', -40, false, 'published'],
    ['ข่าวฉบับร่าง (ต้องไม่แสดงบนหน้าเว็บ)', 'ข่าวนี้ยังเป็น draft', -1, false, 'draft']
  ].map((n, i) => ({
    news_id: 'NEWS-' + SAMPLE_MARKER + pad2_(i + 1),
    title: n[0],
    summary: n[1],
    body: newsBody,
    cover_file_id: '',
    status: n[4],
    pinned: n[3],
    published_at: day(n[2]),
    created_by: Session.getEffectiveUser().getEmail()
  })));

  const categories = readAll_('DOC_CATEGORIES').sort(bySortOrder_).map(c => c.category_id);
  if (categories.length) {
    const docs = [
      ['แบบฟอร์มคำขอทุนวิจัยในชั้นเรียน', 'docx', 0, 84],
      ['แบบฟอร์มรายงานความก้าวหน้าโครงการวิจัย', 'docx', 0, 61],
      ['แบบฟอร์มเปเปอร์สำหรับนำเสนอแบบ Oral', 'docx', 0, 120],
      ['แบบฟอร์ม Abstract สำหรับนำเสนอแบบ Poster', 'docx', 0, 95],
      ['คู่มือการใช้งานระบบส่งงานวิจัย', 'pdf', 1, 2300],
      ['คู่มือการเขียนรายงานวิจัยในชั้นเรียน ฉบับปรับปรุง', 'pdf', 1, 4100],
      ['ตัวอย่างรายงานวิจัย วิชาภาษาไทย ม.2', 'pdf', 2, 3200],
      ['ตัวอย่างรายงานวิจัย วิชาคณิตศาสตร์ ม.4', 'pdf', 2, 2800],
      ['ตัวอย่างรายงานวิจัย วิชาวิทยาศาสตร์ ม.1 ที่มีชื่อเรื่องยาวมากเพื่อทดสอบการตัดบรรทัดของการ์ด', 'pdf', 2, 5600],
      ['เทมเพลตสไลด์นำเสนอผลงานแบบ Oral', 'pptx', 3, 5100],
      ['เทมเพลตโปสเตอร์ขนาด A1', 'pptx', 3, 7400],
      ['ตารางบันทึกคะแนนประเมินผลงาน', 'xlsx', 3, 40]
    ];
    insertMany_('DOCUMENTS', docs.map((d, i) => ({
      document_id: 'DOC-' + SAMPLE_MARKER + pad2_(i + 1),
      category_id: categories[Math.min(d[2], categories.length - 1)],
      title: d[0],
      author: i % 3 === 0 ? 'ฝ่ายวิชาการ' : 'หน่วยส่งเสริมงานวิจัย',
      academic_year: i < 9 ? thaiYear : thaiYear - 1,
      file_type: d[1],
      drive_file_id: 'SAMPLE-not-a-real-file-' + (i + 1),
      size_kb: d[3],
      template_for: i === 2 ? 'oral' : i === 3 ? 'poster' : '',
      download_count: 0,
      active: true
    })));
  }

  const videoCategories = [
    ['การทำวิจัยในชั้นเรียน', 'ขั้นตอนตั้งแต่ตั้งโจทย์จนเขียนรายงาน'],
    ['เทคนิคการสอน', 'แนวทางจัดการเรียนรู้เชิงรุก'],
    ['เทคโนโลยีการศึกษา', 'เครื่องมือดิจิทัลสำหรับครู']
  ];
  insertMany_('VIDEO_CATEGORIES', videoCategories.map((c, i) => ({
    category_id: 'VCAT-' + SAMPLE_MARKER + pad2_(i + 1),
    name: c[0],
    description: c[1],
    sort_order: i + 1
  })));
  const videoTitles = [
    ['การตั้งโจทย์วิจัยจากปัญหาในห้องเรียน', 0], ['การออกแบบเครื่องมือเก็บข้อมูล', 0], ['การเขียนบทคัดย่อให้กระชับ', 0],
    ['การจัดการเรียนรู้แบบโครงงาน', 1], ['การใช้คำถามกระตุ้นการคิด', 1],
    ['การใช้ Google Forms เก็บข้อมูลวิจัย', 2]
  ];
  insertMany_('VIDEOS', videoTitles.map((v, i) => ({
    video_id: 'VID-' + SAMPLE_MARKER + pad2_(i + 1),
    category_id: 'VCAT-' + SAMPLE_MARKER + pad2_(v[1] + 1),
    title: v[0],
    youtube_id: SAMPLE_YOUTUBE_IDS[i % SAMPLE_YOUTUBE_IDS.length],
    description: 'วิดีโอตัวอย่างสำหรับทดสอบหน้าเว็บ',
    sort_order: i + 1,
    active: true
  })));

  clearPublicCache_();
  const message = 'ใส่ข้อมูลตัวอย่างแล้ว' +
    (hasRealCurrentEvent ? ' (มีรอบกิจกรรมจริงเป็น is_current อยู่แล้ว จึงตั้งรอบตัวอย่างเป็น FALSE)' : '') +
    (categories.length ? '' : ' (ไม่มีหมวดเอกสาร จึงไม่ได้ใส่เอกสาร รัน setup() ก่อน)');
  console.log(message);
  return message;
}

/** ลบแถวที่ ID มีคำว่า SAMPLE ในทุกแท็บที่ seedSampleData() ใส่ */
function clearSampleData() {
  assertEditorRun_();
  let total = 0;
  withLock_(() => {
    Object.keys(SAMPLE_TABLES).forEach(name => {
      const col = SAMPLE_TABLES[name];
      total += deleteWhere_(name, record => String(record[col]).indexOf(SAMPLE_MARKER) !== -1);
    });
  });
  clearPublicCache_();
  console.log('ลบข้อมูลตัวอย่าง ' + total + ' แถว');
  return total;
}

function pad2_(n) {
  return String(n).padStart(2, '0');
}
