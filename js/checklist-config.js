// js/checklist-config.js
// ระบบการจัดการแบบฟอร์มตรวจเช็กและเกณฑ์มาตรฐานแบบไดนามิก (Dynamic Inspection Checklists)
import { storageService } from './storage-service.js';

export const DEFAULT_CHECKLIST_TEMPLATES = {
  fire_extinguisher: {
    id: 'fire_extinguisher',
    name: 'ถังดับเพลิง (Fire Extinguisher)',
    matchTypes: ['ถังดับเพลิง', 'ถังดับเพลิงสีแดง', 'ถังดับเพลิงสีเขียว', 'co2', 'dry chemical'],
    matchPrefix: ['PYH-FE'],
    tips: '🧯 คำแนะนำ: ตรวจสอบสภาพภายนอก เกจวัดแรงดัน และทางเข้าถึงอุปกรณ์',
    items: [
      {
        id: 'fe_body',
        label: '1. สภาพภายนอก, คันบีบ, สายฉีด, ซีลและสลักล็อก',
        hint: 'ดูรอยบุบ/สนิม, ดึงสลักต้องแน่นหนา, ซีลพลาสติกไม่ขาด, สายยางไม่อุดตัน',
        critical: true
      },
      {
        id: 'fe_pressure',
        label: '2. เกจวัดแรงดัน (Pressure Gauge)',
        hint: 'สังเกตหน้าปัด เข็มวัดแรงดันต้องชี้อยู่ในแถบสีเขียวตรงกลาง',
        critical: true
      },
      {
        id: 'fe_access',
        label: '3. สภาพแวดล้อมและระยะการเข้าถึง',
        hint: 'รัศมี 1 เมตรต้องไม่มีสิ่งของตั้งวางกีดขวาง หยิบใช้งานได้ทันทีใน 5 วินาที',
        critical: false
      }
    ]
  },
  emergency_light: {
    id: 'emergency_light',
    name: 'ไฟฉุกเฉิน (Emergency Light)',
    matchTypes: ['ไฟฉุกเฉิน', 'โคมไฟฉุกเฉิน', 'emergency light'],
    matchPrefix: ['PYH-EM'],
    tips: '💡 คำแนะนำ: ตรวจไฟสถานะ AC เข้าเครื่อง และกดปุ่ม TEST จำลองไฟดับ',
    items: [
      {
        id: 'em_plug',
        label: '1. สภาพตัวเครื่อง, สายไฟ และปลั๊กไฟ',
        hint: 'ตัวเครื่องไม่แตกร้าว เสียบปลั๊กแน่นหนา สายไฟไม่มีรอยฉีกขาดหรือหนูกัดแทะ',
        critical: true
      },
      {
        id: 'em_ac',
        label: '2. ไฟแสดงสถานะไฟเข้า (AC Indicator LED)',
        hint: 'หลอดไฟ LED แสดงสถานะกระแสไฟฟ้าเข้าชาร์จแบตเตอรี่ต้องติดสว่าง',
        critical: true
      },
      {
        id: 'em_battery',
        label: '3. การทดสอบระบบสำรองไฟ (Push to Test 5 วินาที)',
        hint: 'กดปุ่ม TEST ค้าง 5 วินาที หลอดไฟ LED ต้องติดสว่างพร้อมกันทั้ง 2 ดวง แสงไม่ริบหรี่',
        critical: true
      }
    ]
  },
  fire_hose: {
    id: 'fire_hose',
    name: 'ตู้สายฉีดน้ำดับเพลิง (Fire Hose Reel / Cabinet)',
    matchTypes: ['ตู้สายฉีดน้ำ', 'สายฉีดน้ำดับเพลิง', 'fire hose', 'fhr'],
    matchPrefix: ['PYH-FH', 'PYH-FHR'],
    tips: '💧 คำแนะนำ: ตรวจสอบวาล์วน้ำ สภาพสายยาง และหัวฉีดปรับฝอย',
    items: [
      {
        id: 'fh_cabinet',
        label: '1. สภาพตู้ กระจก และกุญแจ/สลักเปิดตู้',
        hint: 'ตู้ไม่เป็นสนิม กระจกไม่แตกร้าว เปิดตู้ได้สะดวกไม่มีสิ่งของกีดขวาง',
        critical: false
      },
      {
        id: 'fh_hose',
        label: '2. สภาพสายยางและหัวฉีดน้ำ',
        hint: 'สายยางม้วนเรียบร้อย ไม่แตกกรอบ หัวฉีดทองเหลืองหมุนปรับได้ปกติ',
        critical: true
      },
      {
        id: 'fh_valve',
        label: '3. วาล์วควบคุมน้ำและการรั่วซึม',
        hint: 'วาล์วน้ำปิดสนิท ไม่มีน้ำหยดรั่วซึม แรงดันพร้อมใช้งาน',
        critical: true
      }
    ]
  },
  generic_safety: {
    id: 'generic_safety',
    name: 'อุปกรณ์ความปลอดภัยทั่วไป (Generic Safety Equipment)',
    matchTypes: [],
    matchPrefix: [],
    tips: '🛡️ คำแนะนำ: ตรวจสอบความสมบูรณ์ ความสะอาด และความพร้อมใช้งาน',
    items: [
      {
        id: 'gen_condition',
        label: '1. สภาพความสมบูรณ์และโครงสร้างอุปกรณ์',
        hint: 'อุปกรณ์อยู่ในสภาพดี ไม่ชำรุด แตกหัก หรือสูญหาย',
        critical: true
      },
      {
        id: 'gen_readiness',
        label: '2. ความพร้อมในการใช้งานทันที',
        hint: 'ทดสอบฟังก์ชันพื้นฐานแล้วทำงานได้ตามปกติ',
        critical: true
      },
      {
        id: 'gen_environment',
        label: '3. จุดติดตั้งและป้ายระบุสัญลักษณ์',
        hint: 'มองเห็นชัดเจน ป้ายสัญลักษณ์ไม่หลุดลอก ไม่มีสิ่งของบดบัง',
        critical: false
      }
    ]
  }
};

/**
 * ดึงเทมเพลต Checklist ที่ตรงกับอุปกรณ์นั้นๆ โดยอัตโนมัติ
 */
export function getChecklistTemplateForAsset(asset) {
  if (!asset) return DEFAULT_CHECKLIST_TEMPLATES.generic_safety;

  const id = (asset.assetId || '').toUpperCase();
  const type = (asset.type || '').toLowerCase();

  // 1. ค้นหาจาก Prefixes และ Types
  for (const key of Object.keys(DEFAULT_CHECKLIST_TEMPLATES)) {
    const tpl = DEFAULT_CHECKLIST_TEMPLATES[key];
    if (tpl.matchPrefix.some(p => id.startsWith(p))) return tpl;
    if (tpl.matchTypes.some(t => type.includes(t))) return tpl;
  }

  return DEFAULT_CHECKLIST_TEMPLATES.generic_safety;
}

/**
 * เรนเดอร์ฟอร์ม Checklist แบบไดนามิกตามเทมเพลตของอุปกรณ์นั้น
 */
export function renderDynamicChecklist(asset, containerId = 'dynamic-checklist-container') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const template = getChecklistTemplateForAsset(asset);

  let html = `
    <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:10px; padding:10px 14px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
      <div>
        <span style="font-size:0.75rem; color:#64748b; font-weight:700; text-transform:uppercase;">แบบฟอร์มตรวจสอบมาตรฐาน</span>
        <div style="font-size:0.92rem; font-weight:700; color:#0f172a;">${template.name}</div>
      </div>
      <div style="font-size:0.75rem; color:#0369a1; background:#e0f2fe; padding:3px 8px; border-radius:6px; font-weight:600;">
        ${template.items.length} รายการตรวจ
      </div>
    </div>
    <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:8px 12px; margin-bottom:12px; font-size:0.82rem; color:#166534;">
      ${template.tips}
    </div>
  `;

  template.items.forEach((item, index) => {
    html += `
      <div class="dynamic-check-item" data-item-id="${item.id}" data-item-label="${encodeURIComponent(item.label)}" style="margin-bottom:12px; background:#ffffff; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px;">
        <label style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
          <span style="font-weight:700; color:#1e293b; font-size:0.88rem;">${item.label}</span>
          ${item.critical ? '<span style="font-size:0.7rem; color:#b91c1c; background:#fee2e2; padding:2px 6px; border-radius:4px; font-weight:700; margin-left:6px;">จุดสำคัญวิกฤต</span>' : ''}
        </label>
        <p style="font-size:0.76rem; color:#64748b; margin:0 0 8px 0; line-height:1.3;">${item.hint}</p>
        
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <label style="display:flex; align-items:center; gap:6px; background:#f0fdf4; border:1.5px solid #86efac; border-radius:8px; padding:8px 10px; cursor:pointer; font-size:0.84rem; font-weight:600; color:#166534; margin:0;">
            <input type="radio" name="check_${item.id}" value="PASS" checked style="accent-color:#16a34a; width:16px; height:16px; margin:0;">
            ✅ ผ่าน / ปกติ
          </label>
          <label style="display:flex; align-items:center; gap:6px; background:#fef2f2; border:1.5px solid #fca5a5; border-radius:8px; padding:8px 10px; cursor:pointer; font-size:0.84rem; font-weight:600; color:#991b1b; margin:0;">
            <input type="radio" name="check_${item.id}" value="FAIL" style="accent-color:#dc2626; width:16px; height:16px; margin:0;">
            ❌ ไม่ผ่าน / ชำรุด
          </label>
        </div>
      </div>
    `;
  });

  // ช่องระบุระดับความเร่งด่วนในการแก้ไข (เมื่อพบความชำรุด)
  html += `
    <div id="urgency-level-box" style="margin-top:10px; margin-bottom:12px; padding:12px; background:#fffbeb; border:1px solid #fde68a; border-radius:10px;">
      <label style="font-size:0.84rem; font-weight:700; color:#92400e; margin-bottom:4px; display:block;">
        ⚡ ระดับความเร่งด่วนในการซ่อมแซม:
      </label>
      <select id="inspect-urgency" style="width:100%; padding:8px; border-radius:6px; border:1px solid #f59e0b; font-size:0.84rem; font-family:'Sarabun',sans-serif; background:#fff;">
        <option value="NORMAL">🟢 ปกติ (รอบบำรุงรักษาประจำเดือน)</option>
        <option value="MEDIUM">🟡 ปานกลาง (ควรซ่อมแซมภายใน 7 วัน)</option>
        <option value="CRITICAL">🔴 เร่งด่วนสูงสุด (ต้องเปลี่ยนหรือซ่อมทันทีใน 24 ชม.)</option>
      </select>
    </div>
  `;

  container.innerHTML = html;
}

/**
 * รวบรวมผลการตรวจจากฟอร์มไดนามิก
 */
export function collectDynamicChecklistResults(containerId = 'dynamic-checklist-container') {
  const container = document.getElementById(containerId);
  if (!container) return { isPass: true, details: {}, urgency: 'NORMAL' };

  const items = container.querySelectorAll('.dynamic-check-item');
  const details = {};
  let isPass = true;

  items.forEach(el => {
    const itemId = el.dataset.itemId;
    const label = decodeURIComponent(el.dataset.itemLabel || itemId);
    const selected = el.querySelector(`input[name="check_${itemId}"]:checked`);
    const val = selected ? selected.value : 'PASS';

    details[itemId] = {
      label: label,
      status: val
    };

    if (val === 'FAIL') {
      isPass = false;
    }
  });

  const urgencyEl = document.getElementById('inspect-urgency');
  const urgency = urgencyEl ? urgencyEl.value : (isPass ? 'NORMAL' : 'MEDIUM');

  return { isPass, details, urgency };
}
