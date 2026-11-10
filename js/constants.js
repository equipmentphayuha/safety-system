// js/constants.js
// การตั้งค่าผังอาคารและ Metadata ประจำโรงพยาบาลพยุหะคีรี

export const floorConfigs = {
  building_hpc: {
    name: 'อาคารส่งเสริมสุขภาพ',
    imageUrl: 'maps/hpc_floorplan.webp?v=1.0.0',
    bounds: [[0, 0], [724, 1024]]
  },
  building_ipd: {
    name: 'อาคารผู้ป่วยใน (IPD)',
    imageUrl: 'maps/ipd_floorplan.webp?v=1.0.0',
    bounds: [[0, 0], [576, 1024]]
  },
  building_nisit: {
    name: 'อาคารนิสิตคุณากร (Covid 19)',
    imageUrl: 'maps/nisit_floorplan.webp?v=1.0.0',
    bounds: [[0, 0], [576, 1024]]
  },
  building_er_upper: {
    name: 'อาคารอุบัติเหตุ (ชั้นบน)',
    imageUrl: 'maps/er_upper_floorplan.webp?v=1.0.0',
    bounds: [[0, 0], [576, 1024]]
  },
  building_er_lower: {
    name: 'อาคารอุบัติเหตุ (ชั้นล่าง)',
    imageUrl: 'maps/er_lower_floorplan.webp?v=1.0.0',
    bounds: [[0, 0], [576, 1024]]
  },
  building_opd_dm: {
    name: 'ตึกแก้วกัลยา (ผู้ป่วยนอก OPD)',
    imageUrl: 'maps/opd_dm_floorplan.webp?v=1.0.0',
    bounds: [[0, 0], [723, 1024]]
  },
  building_pharma_rehab: {
    name: 'อาคารเวชศาสตร์ฟื้นฟู-โภชนาการ-คลังยา-จ่ายกลาง',
    imageUrl: 'maps/pharma_rehab_floorplan.webp?v=1.0.0',
    bounds: [[0, 0], [724, 1024]]
  },
  building_thai_med: {
    name: 'อาคารแพทย์แผนไทย',
    imageUrl: 'maps/thai_med_floorplan.webp?v=1.0.0',
    bounds: [[0, 0], [576, 1024]]
  },
  building_canteen: {
    name: 'อาคารโรงอาหาร',
    imageUrl: 'maps/canteen_floorplan.webp?v=1.0.0',
    bounds: [[0, 0], [723, 1024]]
  }
};

export const buildingMetadata = {
  building_opd_dm: { name: 'ตึกแก้วกัลยา (OPD / บริหาร / แล็ป)', color: '#004d40' },
  building_er_upper: { name: 'อาคารอุบัติเหตุ-ฉุกเฉิน (ชั้นบน / ห้องผ่าตัด)', color: '#b71c1c' },
  building_er_lower: { name: 'อาคารอุบัติเหตุ-ฉุกเฉิน (ชั้นล่าง / ER)', color: '#c62828' },
  building_ipd: { name: 'อาคารผู้ป่วยใน (IPD 30 เตียง)', color: '#1565c0' },
  building_hpc: { name: 'อาคารส่งเสริมสุขภาพและอเนกประสงค์', color: '#2e7d32' },
  building_pharma_rehab: { name: 'อาคารเวชศาสตร์ฟื้นฟู-โภชนาการ-คลังยา', color: '#e65100' },
  building_nisit: { name: 'อาคารนิสิตคุณากร (หอพักแพทย์/พยาบาล)', color: '#4a148c' },
  building_canteen: { name: 'อาคารโรงอาหารและบริการ', color: '#ad1457' },
  building_thai_med: { name: 'อาคารการแพทย์แผนไทยและแพทย์ทางเลือก', color: '#00695c' }
};

export function getCleanName(str) {
  if (typeof str !== 'string' || !str.trim()) return '';
  return str.replace(/\s*\([^)]*\)/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * แปลงและจัดหมวดหมู่ประเภทอุปกรณ์ตามมาตรฐานระบบ
 * มาตรฐานประเภท:
 * 1. ถังดับเพลิงสีเขียว (CO2 / Clean Agent)
 * 2. ถังดับเพลิงสีแดง (Dry Chemical / ผงเคมีแห้ง)
 * 3. ไฟฉุกเฉิน (Emergency Light)
 */
export function cleanAssetType(typeStr) {
  if (typeof typeStr !== 'string' || !typeStr.trim()) {
    return 'ถังดับเพลิงสีแดง'; // Default fallback ปลอดภัย
  }

  const str = typeStr.trim();

  // 1. ตรวจสอบกลุ่มถังดับเพลิงสีเขียว (CO2, Clean Agent, ก๊าซระเหย)
  if (
    /เขียว|CO2|co2|คาร์บอน|clean\s*agent|สารสะอาด/i.test(str)
  ) {
    return 'ถังดับเพลิงสีเขียว';
  }

  // 2. ตรวจสอบกลุ่มไฟฉุกเฉิน (ไฟฉุกเฉิน, ไฟส่องสว่างฉุกเฉิน, Emergency Light)
  // ใช้ Regular Expression ที่เจาะจง ไม่ตรวจคำว่า "ไฟ" โดดๆ เพื่อป้องกัน False Positives
  if (
    /ไฟ\s*ฉุกเฉิน|ไฟ\s*ส่องสว่าง|โคม\s*ไฟ\s*ฉุกเฉิน|emergency\s*light/i.test(str)
  ) {
    return 'ไฟฉุกเฉิน';
  }

  // 3. ตรวจสอบกลุ่มถังดับเพลิงสีแดง (ผงเคมีแห้ง, Dry Chemical, ถังแดง)
  if (
    /แดง|ผงเคมี|dry\s*chemical|foam|โฟม|ถังดับเพลิง/i.test(str)
  ) {
    return 'ถังดับเพลิงสีแดง';
  }

  // หากเป็นชื่อเดิมที่ผ่านการทำความสะอาดแล้ว หรือกรณีอื่นๆ ให้ส่งค่าเดิมที่ clean วงเล็บออก
  const cleaned = str.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  return cleaned || 'ถังดับเพลิงสีแดง';
}

/**
 * สร้าง URL ลิงก์ตรงสำหรับเปิดหน้าตรวจเช็กอุปกรณ์เมื่อสแกนด้วย LINE / Google Lens / กล้องมือถือ
 */
export function getAssetDirectUrl(assetId) {
  if (!assetId) return '';
  const cleanId = String(assetId).trim();
  if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null') {
    // ใช้ URL ปัจจุบันของระบบ เช่น https://equipmentphayuha.github.io/safety-system/
    const base = window.location.origin + window.location.pathname;
    return `${base}?scan=${encodeURIComponent(cleanId)}`;
  }
  return `https://equipmentphayuha.github.io/safety-system/?scan=${encodeURIComponent(cleanId)}`;
}

/**
 * ถอดรหัส assetId จากข้อความที่สแกนได้ รองรับทั้ง URL และรหัสตรง
 */
export function extractAssetIdFromScan(scannedText) {
  if (!scannedText) return '';
  const text = String(scannedText).trim();

  // 1. กรณีเป็น URL (เช่น https://.../?scan=PYH-FE-ER1-01 หรือ ...#scan=...)
  if (text.startsWith('http://') || text.startsWith('https://')) {
    try {
      const url = new URL(text);
      const scanParam = url.searchParams.get('scan') || url.searchParams.get('id') || url.searchParams.get('assetId');
      if (scanParam) return scanParam.trim();

      // กรณีส่ง path ท้ายสุด เช่น /scan/PYH-FE-ER1-01
      const parts = url.pathname.split('/').filter(Boolean);
      const last = parts[parts.length - 1];
      if (last && (last.startsWith('PYH-') || parts.includes('scan'))) {
        return last.trim();
      }
    } catch (e) {
      // fallback regex
      const match = text.match(/[?&]scan=([^&#]+)/i);
      if (match && match[1]) return decodeURIComponent(match[1]).trim();
    }
  }

  // 2. กรณีเป็นรหัสอุปกรณ์โดยตรง
  return text;
}
