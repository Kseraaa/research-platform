# CLAUDE.md

คู่มือสำหรับ Claude Code ในโปรเจกต์นี้ อ่านไฟล์นี้ก่อนเริ่มทุกงาน

## โปรเจกต์คืออะไร

แพลตฟอร์มของ **หน่วยส่งเสริมงานวิจัย โรงเรียน มอ.วิทยานุสรณ์** สำหรับ:

- ครูในโรงเรียนส่งงานวิจัย (PDF / Word)
- บุคคลภายนอกลงทะเบียนนำเสนอผลงานแบบ **Oral** หรือ **Poster**
- แสดง Timeline กิจกรรม
- คลังงานวิจัยให้ครูเปิดดู (เฉพาะงานที่เจ้าของอนุญาตเผยแพร่)
- คลังวิดีโอการสอนแยกหมวดหมู่
- ศูนย์ดาวน์โหลดเอกสาร (แบบฟอร์ม คู่มือ ตัวอย่างรายงาน)
- ข่าวประชาสัมพันธ์
- อีเมลแจ้งสถานะงานผ่าน Resend

รายละเอียดเต็มอยู่ใน `docs/`:

| ไฟล์ | เนื้อหา |
|---|---|
| `docs/SPEC.md` | ฟีเจอร์ ผู้ใช้ สถานะงาน ไฟล์ที่ต้องส่ง |
| `docs/DATABASE.md` | โครงสร้างทุกแท็บใน Google Sheets และค่า enum |
| `docs/ARCHITECTURE.md` | โครงไฟล์ การเรียก server, การอัปโหลด, auth, ความปลอดภัย |
| `docs/DESIGN.md` | สี ฟอนต์ layout component โครงแต่ละหน้า **อ่านก่อนเขียน HTML ทุกครั้ง** |
| `docs/TASKS.md` | แผนงานทีละเฟส ทำตามลำดับ |

## Tech stack

- **Google Apps Script** (V8 runtime) เป็น backend และ host หน้าเว็บผ่าน `HtmlService`
- **Google Sheets** เป็นฐานข้อมูล (1 แท็บ = 1 ตาราง)
- **Google Drive** เก็บไฟล์งานวิจัย
- **Resend** ส่งอีเมล เรียกผ่าน `UrlFetchApp`
- **YouTube (Unlisted)** สำหรับวิดีโอ ฝังด้วย iframe
- **Frontend:** HTML + JavaScript ธรรมดา (ไม่มี build step), Tailwind CSS ผ่าน CDN, ฟอนต์ `Noto Sans Thai` + `Noto Serif Thai` (หัวข้อ) จาก Google Fonts, ไอคอน Lucide
- **เครื่องมือพัฒนา:** `clasp` สำหรับ push โค้ดจากเครื่องขึ้น Apps Script

## คำสั่งที่ใช้บ่อย

```bash
clasp push            # อัปโหลดโค้ดใน src/ ขึ้น Apps Script
clasp push --watch    # push อัตโนมัติเมื่อแก้ไฟล์
clasp open-script     # เปิด editor บนเว็บ
clasp deploy -i <DEPLOYMENT_ID> -d "ข้อความ"   # อัปเดต deployment เดิม (URL ไม่เปลี่ยน)
clasp logs            # ดู log
```

หลังแก้โค้ดให้ `clasp push` เสมอ ทดสอบผ่าน URL ของ **Test deployment** (`/dev`) ก่อน แล้วค่อย deploy จริง

## กฎสำคัญของ Apps Script (ห้ามพลาด)

1. **ไม่มี npm / import / ES modules ใน runtime** ทุกไฟล์ `.gs` อยู่ใน global scope เดียวกัน ห้ามประกาศชื่อฟังก์ชันหรือตัวแปร global ซ้ำข้ามไฟล์
2. **ฟังก์ชันที่ลงท้ายด้วย `_` คือ private** เรียกจาก `google.script.run` ไม่ได้ ใช้กับ helper ทุกตัว ฟังก์ชันที่ไม่มี `_` ถือเป็น public API ที่หน้าเว็บเรียกได้ จึง**ต้องตรวจสิทธิ์และ validate input ทุกครั้ง**
3. **ฝั่ง client เรียก server ผ่าน `google.script.run` เท่านั้น** ห่อด้วย helper `callServer(fnName, ...args)` ที่คืน Promise (อยู่ใน `js_app.html`)
4. **ส่งข้อมูลระหว่าง client/server ได้แค่ค่า primitive, array, object ธรรมดา** ห้ามส่ง `Date` (แปลงเป็น ISO string ก่อน)
5. **การเขียน Sheets ต้องอยู่ใน `LockService.getScriptLock()`** เสมอ เพื่อกันข้อมูลชนกันตอนมีคนส่งพร้อมกัน
6. **อ่าน Sheets ทีละช่วงด้วย `getValues()` / เขียนด้วย `setValues()`** ห้ามวนลูป `getRange().getValue()` ทีละเซลล์
7. **ค่าลับอยู่ใน Script Properties** (`PropertiesService.getScriptProperties()`) ห้าม hard-code API key หรือ ID ลงในโค้ด อ่านผ่าน `getConfig_()` ใน `config.gs`
8. **เวลาทำงานต่อครั้งไม่เกิน 6 นาที** งานหนักแบ่งเป็นหลายครั้ง
9. **ป้องกัน XSS:** ข้อมูลจากผู้ใช้ให้แสดงด้วย `textContent` หรือ escape ก่อนใส่ `innerHTML` เสมอ ฝั่ง template ใช้ `<?= ?>` (escape) ไม่ใช้ `<?!= ?>` ยกเว้นตอน include ไฟล์ของเราเอง
10. **โซนเวลา `Asia/Bangkok`** เก็บวันที่เป็น ISO 8601 string

## Convention

- **ภาษา:** โค้ด ชื่อตัวแปร ชื่อคอลัมน์ = อังกฤษ / ข้อความที่ผู้ใช้เห็นและอีเมล = **ภาษาไทย**
- **ชื่อฟังก์ชัน:** camelCase, public API ขึ้นต้นด้วยกริยา เช่น `createSubmission`, `getTimeline`
- **ผลลัพธ์จาก public API:** คืนรูปแบบเดียวเสมอ `{ ok: true, data }` หรือ `{ ok: false, error: 'ข้อความภาษาไทย' }` ห้าม throw ออกไปให้ client โดยตรง ใช้ `wrapApi_(fn)` ห่อ
- **ID:** ใช้ prefix อ่านง่าย เช่น `SUB-2026-0001`, `PRE-xxxxxxxx` (ดู `docs/DATABASE.md`)
- **คอลัมน์ใน Sheets:** อ้างอิงด้วยชื่อหัวคอลัมน์ผ่าน helper ใน `db.gs` ห้ามอ้างอิงด้วยเลข index
- ไฟล์ HTML ทั้งหมดอยู่ใน `src/` แบบ flat (ไม่มีโฟลเดอร์ย่อย) ตั้งชื่อตามหน้าที่: `page_*.html`, `css_*.html`, `js_*.html`

## กฎการออกแบบ UI

- ใช้ token สีและ class ตาม `docs/DESIGN.md` เท่านั้น ห้ามใส่สี hex หรือขนาดตัวอักษรเองในหน้า
- ใช้ component จาก `page_styleguide.html` / `css_main.html` / `js_ui.html` ถ้าต้องการ component ใหม่ ให้เพิ่มใน `DESIGN.md` และ styleguide ก่อน แล้วค่อยนำไปใช้ในหน้า
- ทุกหน้าต้องใช้ได้บนมือถือ 375px และมีสถานะ loading, empty, error
- ถ้ามีลิงก์ Figma ให้ใช้เป็นแค่ reference แล้วแปลงเป็น HTML + Tailwind ตามกฎนี้ ห้ามใช้ React หรือ build step

## เมื่อทำงานเสร็จแต่ละงาน

- อัปเดต checkbox ใน `docs/TASKS.md`
- ถ้าเปลี่ยนโครงสร้างข้อมูล ให้แก้ `docs/DATABASE.md` และ `setup.gs` ให้ตรงกัน
- สรุปสั้นๆ ว่าต้องทดสอบอะไรบน Test deployment
