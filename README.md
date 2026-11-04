# แพลตฟอร์มหน่วยส่งเสริมงานวิจัย โรงเรียน มอ.วิทยานุสรณ์

Web App บน Google Apps Script สำหรับส่งงานวิจัย ลงทะเบียนนำเสนอ Oral/Poster, Timeline, คลังงานวิจัย และคลังวิดีโอ

เอกสาร: [`CLAUDE.md`](CLAUDE.md) · [`docs/SPEC.md`](docs/SPEC.md) · [`docs/DATABASE.md`](docs/DATABASE.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/DESIGN.md`](docs/DESIGN.md) · [`docs/TASKS.md`](docs/TASKS.md)

## สิ่งที่ต้องมี

- บัญชี Google (แนะนำบัญชี Workspace ของโรงเรียน)
- Node.js 18+ และ [Claude Code](https://docs.claude.com/en/docs/claude-code/overview)
- บัญชี [Resend](https://resend.com) + โดเมนผู้ส่งที่ verify แล้ว (ตั้ง SPF/DKIM)

## ตั้งค่าครั้งแรก

```bash
# 1. ติดตั้ง clasp และล็อกอิน
npm install -g @google/clasp
clasp login

# 2. เปิด Google Apps Script API (ครั้งเดียวต่อบัญชี)
#    https://script.google.com/home/usersettings → เปิด "Google Apps Script API"

# 3. สร้างโปรเจกต์ Apps Script โดยให้โค้ดอยู่ในโฟลเดอร์ src/
cd research-platform
clasp create --type webapp --title "Research Platform" --rootDir src
#   ถ้า clasp เขียนทับ src/appsscript.json ให้คัดลอกเนื้อหาเดิมกลับคืน (ดู git diff)

# 4. เปิด Claude Code แล้วเริ่มเฟส 0
claude
```

หลัง Claude Code ทำเฟส 0 เสร็จ:

1. `clasp push`
2. `clasp open-script` → เลือกฟังก์ชัน `setup` → Run → อนุญาตสิทธิ์
3. Project Settings → Script Properties เพิ่ม `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_NOTIFY_EMAIL`, `SCHOOL_EMAIL_DOMAIN`, `MAX_FILE_MB`
4. เพิ่มอีเมลตัวเองในแท็บ `ADMINS` ของสเปรดชีตที่ `setup()` สร้าง (role = `admin`, active = `TRUE`)
   - (ไม่บังคับ) รัน `seedSampleData` เพื่อใส่ข้อมูลตัวอย่างไว้ทดสอบหน้าเว็บ ลบทิ้งด้วย `clearSampleData` (ลบเฉพาะแถวที่ ID มีคำว่า `SAMPLE`)
   - รัน `runSubmissionTests` เพื่อทดสอบการตรวจไฟล์และฟอร์มลงทะเบียน (ไม่สร้างข้อมูลหรือไฟล์ใดๆ)
   - รัน `runEmailTests` เพื่อทดสอบ template อีเมล (ไม่ส่งจริง) และ `sendTestEmail` เพื่อส่งอีเมลจริงทุกแบบไปหาตัวเอง ใช้ตรวจว่าตั้ง `RESEND_API_KEY` / `EMAIL_FROM` ถูก
5. Deploy → Test deployments → คัดลอก URL `/dev` ไปทดสอบ
6. ตอน deploy จริง: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone) แล้วนำ URL `/exec` ไปใส่ใน Script Property `WEBAPP_URL`

## การพัฒนาประจำวัน

```bash
clasp push --watch     # แก้ไฟล์แล้ว push อัตโนมัติ
```

ทดสอบที่ URL `/dev` (เห็นโค้ดล่าสุดทันที) เมื่อพร้อมจึงอัปเดต deployment จริง:

```bash
clasp deployments                       # ดู DEPLOYMENT_ID
clasp deploy -i <DEPLOYMENT_ID> -d "v1.1 แก้ฟอร์มลงทะเบียน"
```

## ข้อควรระวัง

- ห้าม commit API key หรือไฟล์ `.clasprc.json`
- Apps Script จำกัดเวลาทำงานต่อครั้งและจำนวนการทำงานพร้อมกัน ช่วงใกล้ปิดรับสมัครให้ประกาศล่วงหน้าเพื่อกระจายการส่งงาน
