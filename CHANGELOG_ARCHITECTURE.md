# 📋 เอกสารบันทึกประวัติการพัฒนาและปรับปรุงระบบ (CHANGELOG & ARCHITECTURE AUDIT)
**โครงการ:** ระบบตรวจสอบความปลอดภัยถังดับเพลิงและไฟฉุกเฉิน โรงพยาบาลพยุหะคีรี (Pyuha Safety System)  
**วันที่ปรับปรุงล่าสุด:** 10 พฤศจิกายน 2026  
**สถานะภาพรวม:** ปรับปรุงโครงสร้างระดับลึก & รองรับการสแกนผ่าน LINE / กล้องมือถือ / Google Lens พร้อมระบบ Public Inspection Tag

---

## 📌 สรุปภาพรวมการเปลี่ยนแปลง (Executive Summary)
ระบบได้รับการตรวจสอบเชิงลึก (Code Review & Vulnerability Assessment) จากเดิมที่คะแนนความปลอดภัยและสถาปัตยกรรมอยู่ในระดับวิกฤต (ประเมินครั้งแรก 2/10) ได้รับการผ่าตัดโครงสร้างใหม่จนขยับขึ้นสู่เกรด A- (ประมาณ 8.5/10) โดยแก้ปัญหาตั้งแต่ช่องโหว่ความปลอดภัยระดับสูงสุด การตัดแยกรหัสต้นฉบับที่มีขนาดใหญ่เกินไป การกำจัดโค้ด HTML/JS แบบเก่า และการวางระบบ State/Storage แบบสากล

ล่าสุด (10 พ.ย. 2026) ได้เพิ่มขีดความสามารถการสแกน QR Code ให้เปิดตรงผ่านแอปภายนอก (LINE / Google Lens / กล้องมือถือ) พร้อมแยกบทบาทการแสดงผล: คนนอก/ผู้ตรวจ HA สแกนแล้วเห็นรายงานประวัติความปลอดภัยทันที ส่วนเจ้าหน้าที่สามารถกดล็อกอินเพื่อบันทึกผลต่อได้ทันที

---

## 🆕 ประวัติเวอร์ชันล่าสุด (Recent Updates)

### 📌 [Version 1.2.0] - 10 พฤศจิกายน 2026
* **📱 รองรับการสแกน QR Code ผ่านแอปภายนอก (LINE, Google Lens, กล้องมือถือทุกรุ่น):**
  * ปรับรูปแบบเนื้อหาใน QR Code ที่ระบบสร้างขึ้น (ทั้งหน้าลงทะเบียน, โมดอลดู QR และฟังก์ชันพิมพ์สติกเกอร์ทั้งหมด) จากเดิมที่เป็น Plain ID ให้กลายเป็น **Direct Deep Link URL** เช่น:
    `https://equipmentphayuha.github.io/safety-system/?scan=PYH-FE-ER1-01`
  * เพิ่มฟังก์ชัน `getAssetDirectUrl()` และ `extractAssetIdFromScan()` ใน [js/constants.js](js/constants.js) เพื่อรองรับการแปลงและถอดรหัสรหัสอุปกรณ์ทั้งจาก URL และแบบข้อความตรง
* **🏥 ระบบ Public Inspection Tag Card (สำหรับคนนอก / กรรมการตรวจประเมิน HA):**
  * เมื่อบุคคลทั่วไปหรือผู้ตรวจประเมินใช้กล้องสแกน QR Code โดยที่ยังไม่ได้เข้าสู่ระบบ ระบบจะไม่บล็อกด้วยหน้า Login อีกต่อไป
  * แสดงหน้าต่างสรุปข้อมูลสถานะความพร้อมใช้งานล่าสุด (`🟢 ปกติ พร้อมใช้งาน` / `🔧 อยู่ระหว่างส่งซ่อม` / `⚠️ พบปัญหา ชำรุด`), วันที่ตรวจล่าสุด, เจ้าหน้าที่ผู้รับผิดชอบ และตารางประวัติการตรวจสอบย้อนหลังพร้อมรูปถ่ายหลักฐาน
* **🔐 Seamless Technician Inspection Flow:**
  * เพิ่มปุ่ม `📝 สำหรับเจ้าหน้าที่: บันทึกผลตรวจเช็ก` ที่ด้านล่างของการ์ดรายงานประวัติ
  * เมื่อเจ้าหน้าที่กดปุ่ม จะมีหน้าต่างเข้าสู่ระบบ และเมื่อยืนยันตัวตนสำเร็จ ระบบจะนำเข้าสู่แบบฟอร์มบันทึกผลการตรวจ (Checklist) ของจุดนั้นทันทีโดยไม่ต้องสแกนใหม่
  * กรณีเจ้าหน้าที่ที่ล็อกอินค้างไว้อยู่แล้ว เมื่อสแกนจะเด้งเข้าสู่แบบฟอร์มตรวจเช็กทันทีเพื่อความรวดเร็วในการปฏิบัติงาน

---

## 🔍 บันทึกรายละเอียดการปรับปรุงแยกตามหมวดหมู่ (Technical Details)

### 1. 🛡️ ความมั่นคงปลอดภัยและการจัดการสิทธิ์แท้จริง (Security & Server-Side Enforcement)
* **กำจัดข้อมูลระบุตัวตนและรหัสผ่านหลุด (Credential Leak Remediation):**
  * **ไฟล์ที่ลบ:** ลบไฟล์ `seed-users.html` ทิ้งอย่างถาวร
  * **สาเหตุ:** พบการระบุข้อมูลชื่อ-สกุลจริง ตำแหน่ง อีเมล และรหัสผ่าน Plaintext ของเจ้าหน้าที่และผู้บริหาร เช่น `Admin@Pyuha2026!`, `Director@2026!` รวมถึง Firebase Config ของโปรเจกต์อื่น
* **การเขียนกฎความปลอดภัยฐานข้อมูลแบบ Role-Based ([firestore.rules](firestore.rules)):**
  * **เดิม:** กำหนด `allow read, write: if true;` ซึ่งอนุญาตให้บุคคลภายนอกที่ไม่ได้รับอนุญาตสามารถเข้าถึง แก้ไข หรือส่งคำสั่งลบฐานข้อมูลทั้งหมดได้
  * **ใหม่ (Server-Side Role Enforcement):**
    * กำหนด Helper Functions: `isAuthenticated()`, `getUserData()`, `isAdmin()`, `isInspectorOrAdmin()`
    * ตาราง `assets`: อนุญาตให้อ่านได้ทั่วไป แต่การเพิ่ม/แก้ไข ต้องเป็น Inspector หรือ Admin เท่านั้น และการ **"ลบอุปกรณ์" อนุญาตเฉพาะสิทธิ์ Admin เท่านั้น** แม้ผู้ใช้จะแอบแก้ค่าในหน้าเว็บ แต่คำสั่ง Delete จะถูก Cloud Firestore ปฏิเสธทันที (Permission Denied)
    * ตาราง `inspection_logs`: ล็อกไม่ให้ผู้ตรวจทั่วไปแก้ไขหรือลบประวัติย้อนหลัง (เฉพาะ Admin เท่านั้น) เพื่อความโปร่งใสของรายงานความปลอดภัย
    * ตาราง `system_users`: การแก้ไขข้อมูลและบทบาทสิทธิ์ (Role Assignment) อนุญาตเฉพาะ Admin เท่านั้น ป้องกันการแอบสถาปนาตัวเองเป็นผู้ดูแลระบบ
    * ตาราง `system_configs`: ค่าคอนฟิกหลักของโรงพยาบาลแก้ไขได้เฉพาะ Admin
    * ปิดกั้น Collection อื่นๆ ทั้งหมดเป็นค่าเริ่มต้น (`deny by default`)
* **ระบบตรวจจับการปลอมแปลงสิทธิ์ในฝั่ง Client (Anti-Tampering & Auth Sync):**
  * ใน [app.js](app.js) ผูก `onAuthStateChanged` ร่วมกับคอลเลกชัน `system_users` บน Firestore
  * หากผู้ใช้แก้ไข LocalStorage หรือ Session ผ่าน Console F12 ระบบจะตรวจสอบกับฐานข้อมูล Cloud จริง หากไม่ตรงกัน หรือไม่ได้ Login ผ่าน Firebase Auth จริง ระบบจะล้าง Session ทิ้งทันทีและดีดกลับสู่โหมดผู้เยี่ยมชม (Guest Mode) ทันที

---

### 2. 🏛️ การปรับปรุงสถาปัตยกรรมและการแยกโมดูล (Modular Architecture)
จากเดิมที่ไฟล์ [app.js](app.js) มีความยาวมากกว่า **6,012 บรรทัด** เป็นศูนย์รวมของตรรกะทุกอย่าง (God Object) ได้ทำการสกัดและแยกความรับผิดชอบออกเป็นโมดูลในโฟลเดอร์ `js/`:

* **[js/constants.js](js/constants.js):**
  * รวบรวมข้อมูลพิกัดและผังอาคารของโรงพยาบาลทั้ง 9 โซน (`floorConfigs`)
  * ปรับค่า Metadata สีและชื่ออาคาร (`buildingMetadata`)
  * ฟังก์ชันจัดระเบียบข้อความ (`getCleanName`)
  * ฟังก์ชันแปลงประเภทอุปกรณ์ (`cleanAssetType`)
* **[js/auth.js](js/auth.js):**
  * ระบบตรวจจับ Session Timeout อัตโนมัติ (1 ชั่วโมง)
  * ฟังก์ชันจัดเก็บและดึงสถานะผู้ใช้งาน (`getSession`, `setSession`, `clearSession`)
  * ระบบตรวจจับกิจกรรมผู้ใช้ผ่าน Event Listener (`click`, `keydown`, `touchstart`, `scroll`) เพื่อยืดอายุ Session แบบไดนามิก
* **[js/report-constants.js](js/report-constants.js):**
  * ข้อมูลและคำย่ออาคารสำหรับระบบออกหนังสือราชการและรายงานสถิติของผู้บริหาร (`reportBuildingMetadata`)
* **[js/report-module.js](js/report-module.js):**
  * สกัดโค้ดขนาดใหญ่กว่า **2,220 บรรทัด** ที่เกี่ยวกับระบบออกรายงานสารบรรณ
  * ระบบจัดทำบันทึกข้อความราชการ (Official Memo Generator)
  * การตั้งค่าระยะขอบ (Margins) ขนาดฟอนต์ ระยะบรรทัด และตำแหน่งกล่องสั่งการ
  * ระบบบันทึกลายเซ็นดิจิทัล (Digital Signature Pad) พร้อมระบบรับรองผลตรวจ 3 ระดับ (นายช่างเทคนิค, หัวหน้ากลุ่มงาน, ผู้อำนวยการโรงพยาบาล)
  * รองรับการส่งผ่าน Context State (`initReportModule`) เพื่อเชื่อมโยงข้อมูลกับระบบหลัก
* **[js/scanner-controller.js](js/scanner-controller.js):**
  * สกัดตรรกะระบบสแกน QR Code (Html5Qrcode)
  * ควบคุมการเปิด/ปิดกล้อง, การแจ้งเตือนกรณีไม่มีกล้องหรือเครื่องไม่รองรับ, และคู่มือขั้นตอนการตรวจเช็ก
* **[js/register-controller.js](js/register-controller.js):**
  * สกัดระบบลงทะเบียนอุปกรณ์ใหม่และการเลือกพิกัดบนแผนที่ Leaflet ย่อย
  * ฟังก์ชันสร้างสติกเกอร์ QR Code และอัปเดตข้อมูลขึ้น Firestore/Local
* **[app.js](app.js) หลังการปรับปรุง:**
  * ขนาดลดลงจากเดิม **6,012 บรรทัด** เหลือเพียง **~3,430 บรรทัด** โครงสร้างโปรเจกต์แยกเป็นสัดส่วนชัดเจน

---

### 3. ⚡ ประสิทธิภาพและการบริหารจัดการแคช (Performance & Caching)
* **ยกเลิก Dynamic Cache-Buster ที่ผิดวิธี:**
  * **เดิม:** มีการเติม `?v=' + Date.now()` ต่อท้าย URL รูปภาพแผนที่ผังอาคารทุกอาคาร ส่งผลให้เบราว์เซอร์ไม่บันทึกภาพลงแคช และต้องดาวน์โหลดภาพขนาดใหญ่ใหม่ซ้ำๆ ทุกครั้งที่กดเปลี่ยนผังอาคาร สิ้นเปลืองเน็ตและทำให้การแสดงผลช้า
  * **ใหม่:** เปลี่ยนไปใช้ Semantic Versioning คงที่ `?v=1.0.0` ใน [js/constants.js](js/constants.js) ทำให้เบราว์เซอร์ทำ HTTP Image Caching ได้จริง โหลดภาพแผนที่ได้ทันที
* **ปรับปรุง Version Tag ของสคริปต์และ CSS:**
  * ปรับใน [index.html](index.html) จาก `style.css?t=77777` และ `app.js?t=77777` เป็น `?v=1.0.0`

---

### 4. 🎯 การตรวจสอบและจัดหมวดหมู่อุปกรณ์ (Robust Validation Logic)
* **ปรับปรุงฟังก์ชัน `cleanAssetType` ใน [js/constants.js](js/constants.js):**
  * **เดิม:** ตรวจสอบคำหลวมๆ เช่น `str.includes('ไฟ')` ทำให้คำทั่วไปที่ไม่ใช่อุปกรณ์ (เช่น *"ไฟแนนซ์"*, *"ตู้เก็บอุปกรณ์ดับไฟ"*) ถูกตัดสินผิดพลาดกลายเป็น `"ไฟฉุกเฉิน"` ทั้งหมด และไม่มี Fallback ส่งผลให้คืนค่า `undefined`
  * **ใหม่:**
    * ป้องกันข้อผิดพลาดจากค่า `null`, `undefined` หรือชนิดข้อมูลที่ไม่ใช่ string
    * ใช้ Regular Expression ที่เจาะจงความหมาย เช่น `/ไฟ\s*ฉุกเฉิน|ไฟ\s*ส่องสว่าง|โคม\s*ไฟ\s*ฉุกเฉิน|emergency\s*light/i`
    * เพิ่มการจัดหมวดหมู่กลุ่มถังสีเขียว (CO2, Clean Agent) และถังสีแดง (Dry Chemical, ผงเคมีแห้ง) แบบ Case-insensitive
    * มี Safe Fallback มาตรฐานป้องกันระบบ Crash

---

### 5. 🧼 การกำจัด Inline Code และจัดระเบียบ HTML (Spaghetti Clean-up)
* **กำจัด `onclick="..."` ฝังสด 92 จุดใน [index.html](index.html) เหลือ 0 จุด:**
  * สร้างโมดูล [js/events.js](js/events.js) เพื่อทำ **Event Delegation** ผ่านแอตทริบิวต์ `data-action="..."` และ `data-param="..."`
  * รวมศูนย์การดักจับคลิกของปุ่มทั้งหมด (สลับแท็บ, ปิด-เปิด Modal, ใช้งานแผนที่, เมนูลายเซ็น, เครื่องมือบันทึกข้อความ) ไว้ในจุดเดียว ง่ายต่อการติดตามและแก้ไข
  * รองรับ Backdrop Dismissal (คลิกที่พื้นที่ว่างรอบกล่อง Modal เพื่อปิด) โดยไม่ต้องฝัง JavaScript ใน HTML
* **จัดระเบียบ CSS Utility Classes:**
  * สร้าง [js/ui-utilities.css](js/ui-utilities.css) เพื่อลดความซ้ำซ้อนของ Inline Styles (`style="..."`) ในหน้า [index.html](index.html)

---

### 6. 🗄️ การจัดการ State และ LocalStorage (StorageService Architecture)
* **สร้าง [js/storage-service.js](js/storage-service.js):**
  * ออกแบบคลาส `StorageService` ทำหน้าที่เป็น Single Source of Truth
  * **In-Memory Cache Layer:** เก็บข้อมูลในหน่วยความจำเพื่อลดการเรียก Disk I/O ของ LocalStorage ซ้ำซาก ทำให้อ่านข้อมูลได้รวดเร็วทันที
  * **Safe Serialization:** จัดการแปลง Object เป็น JSON และ Safe Parse อัตโนมัติ พร้อมทั้งครอบคลุม `try-catch` เมื่อ Storage เต็มหรือถูกบล็อก
* **Refactor การเรียกใช้ LocalStorage ทั้งระบบ:**
  * ปรับปรุง [app.js](app.js), [js/auth.js](js/auth.js), และ [js/report-module.js](js/report-module.js) จากการเรียก `localStorage.getItem/setItem` โดยตรงกว่า 50 จุด มาเรียกผ่าน `storageService.get()`, `storageService.set()`, `storageService.remove()`

### 7. 📦 การยกระดับสู่ Progressive Web App & Build Tooling (Modern Tooling & Offline Capability)
* **สร้าง [package.json](package.json):**
  * กำหนด Metadata โปรเจกต์, ECMAScript Modules (`"type": "module"`)
  * เพิ่ม Scripts มาตรฐาน:
    * `npm start`: รัน Local HTTP Web Server โดยตรง
    * `npm run check`: ตรวจสอบ Syntax ของทุกโมดูลในระบบพร้อมกัน
* **ระบบทำงานแบบออฟไลน์ด้วย Service Worker ([sw.js](sw.js)):**
  * รองรับการทำงานแบบ Offline-First ในจุดอับสัญญาณของโรงพยาบาล (เช่น ห้องใต้ดิน, จุดติดตั้งในคลังยา)
  * Pre-cache ทรัพยากรหลักทั้งหมด: HTML, CSS, JS และภาพผังอาคารทั้ง 9 โซน
  * นำกลยุทธ์ Stale-While-Revalidate มาใช้ ทำให้โหลดหน้าเว็บได้ทันทีแม้ไม่ได้เชื่อมต่ออินเทอร์เน็ต
* **สร้าง [manifest.json](manifest.json):**
  * ยกระดับเว็บแอปพลิเคชันสู่ **PWA (Progressive Web App)**
  * เจ้าหน้าที่สามารถกดปุ่ม "Install App" หรือ "เพิ่มลงในหน้าจอหลัก" บนสมาร์ตโฟน/แท็บเล็ต เพื่อเปิดใช้งานได้เสมือนแอป Native เต็มจอ

### 8. 🐛 การแก้ไขข้อผิดพลาดหลังการสกัดโมดูล (Runtime Bug Fixes & Resilient Data Parsing)
* **แก้ปัญหา `assetsList is not defined` ใน [js/register-controller.js](js/register-controller.js):**
  * ผูกตัวแปร `assetsList` ผ่าน Context Getter/Setter `_appContext.getAssetsList()` และประกาศ Global Getter บน `window.assetsList` ตั้งแต่ต้นไฟล์ [app.js](app.js)
* **แก้ปัญหา `JSON.parse` ล้มเหลวจาก `[object Object]` ใน [app.js](app.js):**
  * ตรวจสอบชนิดข้อมูลก่อน parse ด้วย `typeof localSaved === 'string' ? JSON.parse(localSaved) : localSaved` เพื่อรองรับทั้ง Plain JSON และ In-Memory Objects จาก `storageService`
* **แก้ปัญหา `renderHistoryTable is not defined`:**
  * ยกฟังก์ชัน (Hoisting) `renderHistoryTable()` ขึ้นไปไว้ส่วนต้นของ [app.js](app.js) ก่อนการเรียกใช้งานใน `initAssets()` และ Snapshot Listener
* **แก้ปัญหา `initRegisterForm is not defined` ใน [js/register-controller.js](js/register-controller.js):**
  * ประกาศฟังก์ชัน `initRegisterForm()` เพื่อควบคุม Event Listener ของฟอร์มลงทะเบียนอุปกรณ์ใหม่ให้ผูกอย่างถูกต้องและป้องกันการลงทะเบียน Listener ซ้ำซ้อน
* **ปรับปรุง Web Manifest Icons ใน [manifest.json](manifest.json):**
  * เพิ่มไฟล์ [garuda.svg](garuda.svg) สำหรับขนาด `"any"` Vector Icon และปรับ [garuda.png](garuda.png) ขนาด `56x61` ทำให้เบราว์เซอร์ไม่แสดง Error Resource size อีกต่อไป

---

## 📂 แผนผังโครงสร้างระบบปัจจุบัน (Project Structure)

```text
safety-system-main/
│
├── CHANGELOG_ARCHITECTURE.md    # 📄 [ไฟล์นี้] บันทึกประวัติการปรับปรุงระบบและสถาปัตยกรรมอย่างละเอียด
├── package.json                 # 📦 การตั้งค่าแพ็กเกจและสคริปต์คำสั่งรัน/ตรวจสอบระบบ
├── sw.js                        # ⚡ Service Worker สำหรับแคชออฟไลน์ (Offline-first PWA)
├── manifest.json                # 📱 การตั้งค่า Web App Manifest (ติดตั้งลงหน้าจอมือถือ)
├── firestore.rules              # 🛡️ กฎความปลอดภัย Firestore ฉบับปรับปรุงใหม่
├── firebase-config.js           # 🔥 จุดเชื่อมต่อและตั้งค่า Firebase SDK
├── index.html                   # 🖥️ โครงสร้างหน้าเว็บหลัก (Event Delegation & Clean HTML)
├── style.css                    # 🎨 สไตล์ชีตหลักของระบบ
├── app.js                       # ⚙️ แกนหลักของแอปพลิเคชัน (Controller กลาง)
│
├── js/                          # 📦 โมดูลระบบที่สกัดและจัดระเบียบใหม่
│   ├── auth.js                  # 🔑 โมดูลยืนยันตัวตน, สิทธิ์การใช้งาน และ Session Guard
│   ├── constants.js             # 🗺️ ข้อมูลผังอาคาร, หมวดหมู่อุปกรณ์ และค่าคงที่ระบบ
│   ├── report-constants.js      # 🏢 ข้อมูลโครงสร้างอาคารสำหรับระบบงานสารบรรณ
│   ├── report-module.js         # 📝 ระบบออกบันทึกข้อความราชการและลายเซ็นดิจิทัลผู้บริหาร
│   ├── scanner-controller.js    # 📷 ระบบกล้องและสแกนเนอร์ QR Code (Html5Qrcode)
│   ├── register-controller.js   # ➕ ระบบลงทะเบียนอุปกรณ์ใหม่และสร้างพิกัดบนแผนที่
│   ├── events.js                # 🖱️ ศูนย์รวมการดักจับ Event คลิก (กำจัด inline onclick)
│   ├── storage-service.js       # 💾 บริการจัดการหน่วยความจำและ Storage กลาง
│   └── ui-utilities.css         # 🎨 คลาสอเนกประสงค์สำหรับจัดแต่ง UI Layout
│
└── maps/                        # 🗺️ ไฟล์ภาพผังอาคารความละเอียดสูงทั้ง 9 อาคาร
```

---

## 📌 คำแนะนำสำหรับการส่งต่องานหรือพัฒนาต่อยอด (Future Roadmap)
1. **Firebase Console Deployment:** ตรวจสอบให้แน่ใจว่าได้คัดลอกเนื้อหาใน `firestore.rules` ไปกด **Publish** ใน Firebase Console แล้ว
2. **การแยก Logic เพิ่มเติม:** หากต้องการลดขนาด `app.js` ลงอีก สามารถแยกตรรกะของ `leaflet-map-controller.js` (การวาด Marker บนแผนที่) และ `qr-scanner-controller.js` ออกเป็นโมดูลอิสระเพิ่มเติมได้
3. **การตรวจสอบสิทธิ์บนฝั่ง Server (Server-Side Auth Enforcement):** ปัจจุบันการควบคุมสิทธิ์ Role ทำงานร่วมกับ `firestore.rules` ได้ดี หากมีการนำ Firebase Custom Claims มาประยุกต์ใช้กับ Auth Token ในอนาคต จะช่วยเพิ่มความปลอดภัยในระดับสูงสุด (Zero Trust)
