import { storageService } from './storage-service.js';
// js/report-module.js
// ระบบสร้างรายงานการตรวจสอบเพื่อเสนอผู้บริหาร (Executive Inspection Report & Certification)

import {
  db, storage, auth, isFirebaseReady,
  doc, setDoc, getDoc, collection, getDocs, updateDoc, addDoc,
  ref, uploadBytes, getDownloadURL
} from '../firebase-config.js';
import { reportBuildingMetadata } from './report-constants.js';
import { getCleanName, cleanAssetType } from './constants.js';

// Fallback helpers for standalone module access
function formatThaiFullDate(dateObj = new Date()) {
  if (typeof window.formatThaiFullDate === 'function') {
    return window.formatThaiFullDate(dateObj);
  }
  const thaiMonths = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
  ];
  const d = dateObj.getDate();
  const m = thaiMonths[dateObj.getMonth()];
  const y = dateObj.getFullYear() + 543;
  return `วันที่ ${d} ${m} พ.ศ. ${y}`;
}

function requireLogin(actionName = 'ดำเนินการนี้') {
  if (typeof window.requireLogin === 'function') {
    return window.requireLogin(actionName);
  }
  return true;
}

let _appContext = {
  getAssetsList: () => (window.assetsList || []),
  getCurrentOfficer: () => (window.currentOfficer || ''),
  getCurrentUserRole: () => (window.currentUserRole || 'guest'),
  updateDashboardUI: () => (typeof window.updateDashboardUI === 'function' ? window.updateDashboardUI() : null),
  renderMapPins: () => (typeof window.renderMapPins === 'function' ? window.renderMapPins() : null),
  renderHistoryTable: () => (typeof window.renderHistoryTable === 'function' ? window.renderHistoryTable() : null),
  initAssets: () => (typeof window.initAssets === 'function' ? window.initAssets() : null)
};

function updateDashboardUI() {
  if (typeof _appContext.updateDashboardUI === 'function') _appContext.updateDashboardUI();
  else if (typeof window.updateDashboardUI === 'function') window.updateDashboardUI();
}

function renderMapPins() {
  if (typeof _appContext.renderMapPins === 'function') _appContext.renderMapPins();
  else if (typeof window.renderMapPins === 'function') window.renderMapPins();
}

function renderHistoryTable() {
  if (typeof _appContext.renderHistoryTable === 'function') _appContext.renderHistoryTable();
  else if (typeof window.renderHistoryTable === 'function') window.renderHistoryTable();
}

function initAssets() {
  if (typeof _appContext.initAssets === 'function') _appContext.initAssets();
  else if (typeof window.initAssets === 'function') window.initAssets();
}

export function initReportModule(context) {
  if (context) {
    _appContext = Object.assign(_appContext, context);
  }
}

// ==========================================
// 11. ระบบสร้างรายงานการตรวจสอบเพื่อเสนอผู้บริหาร (Executive Inspection Report)
// ==========================================

const buildingMetadata = reportBuildingMetadata;

// สถานะการจัดรูปแบบรายงานและเอกสาร
let currentReportFormat = 'memo'; // 'memo' = บันทึกข้อความราชการ, 'detailed' = รายงานสถิติละเอียด
let memoLineSpacing = 1.25; // ระยะห่างบรรทัด
// ระยะขอบ 4 ทิศทางตามระเบียบงานสารบรรณ (แบบที่ ๒ ท้ายระเบียบ): บน 1.5 ซม., ซ้าย (กั้นหน้า) 3.0 ซม., ขวา (กั้นหลัง) 2.0 ซม., ล่าง 2.0 ซม.
let memoMargins = {
  top: 1.5,
  bottom: 2.0,
  left: 3.0,
  right: 2.0
};
let memoMarginCm = 3.0; // fallback compat
let memoExecBoxPosition = 'left'; // 'left' = ซ้ายล่าง, 'right' = ขวาล่าง
let memoExecBoxOffset = { x: 0, y: 0 }; // ลากอิสระด้วยเมาส์
let memoExecBoxMarginTop = 16; // px
let memoChefBoxOffset = { x: 0, y: 0 }; // ลากอิสระสำหรับกล่องหัวหน้ากลุ่มงาน

// การปรับขนาดตัวอักษรแยกเฉพาะส่วน (ตามระเบียบ: บันทึกข้อความ 29pt ตัวหนา, ส่วนราชการ/ที่/วันที่/เรื่อง 20pt ตัวหนา, คำขึ้นต้น/เนื้อหา 16pt)
let memoFontConfig = {
  title: 29,  // ข้อความ "บันทึกข้อความ" ตัวหนา ขนาด 29 พอยท์
  header: 20, // หัวหนังสือ: ส่วนราชการ, ที่, วันที่, เรื่อง (ตัวหนา ขนาด 20 พอยท์)
  body: 16,   // คำขึ้นต้นและเนื้อหา (ขนาด 16 พอยท์)
  sign: 16    // ส่วนลงนามและตำแหน่ง (ขนาด 16 พอยท์)
};

// ฟังก์ชันปรับขนาดฟอนต์แบบตรงตามค่าตัวเลข (พิมพ์เลขได้เหมือน MS Word)
window.setMemoFontExact = function(val) {
  const target = document.getElementById('memo-font-target')?.value || 'all';
  const size = Math.max(8, Math.min(48, parseFloat(val) || 16));

  if (target === 'all') {
    memoFontConfig.header = size;
    memoFontConfig.body = size;
    memoFontConfig.sign = Math.max(8, size - 1);
  } else {
    memoFontConfig[target] = size;
  }

  window.updateMemoFontDisplay();
  window.applyMemoStyles();
};

// ฟังก์ชันปรับระยะขอบ 4 ด้านแบบระบุตัวเลขโดยตรง (Top / Bottom / Left / Right)
window.setMemoMarginExact = function(side, val) {
  const num = Math.max(0.5, Math.min(5.0, parseFloat(val) || 2.0));
  if (memoMargins[side] !== undefined) {
    memoMargins[side] = parseFloat(num.toFixed(1));
  }
  window.applyMemoStyles();
};

// คืนค่าระยะขอบเป็นมาตรฐานหนังสือราชการไทย (บน 2.0, ล่าง 2.0, ซ้าย 2.5, ขวา 2.0 ซม.)
window.setMemoMarginPresetStandard = function() {
  memoMargins = {
    top: 2.0,
    bottom: 2.0,
    left: 2.5,
    right: 2.0
  };
  window.applyMemoStyles();
};

// จัดการตำแหน่งกล่องคำสั่งการของ ผอ.
window.setExecBoxPosition = function(pos) {
  memoExecBoxPosition = pos;
  memoExecBoxOffset = { x: 0, y: 0 }; // รีเซ็ตการลากเมื่อกดสลับฝั่ง
  const btnLeft = document.getElementById('btn-exec-pos-left');
  const btnRight = document.getElementById('btn-exec-pos-right');
  if (btnLeft && btnRight) {
    if (pos === 'left') {
      btnLeft.style.background = '#ffffff';
      btnLeft.style.color = '#004d40';
      btnLeft.style.fontWeight = '700';
      btnRight.style.background = 'rgba(255,255,255,0.2)';
      btnRight.style.color = '#ffffff';
      btnRight.style.fontWeight = '600';
    } else {
      btnRight.style.background = '#ffffff';
      btnRight.style.color = '#004d40';
      btnRight.style.fontWeight = '700';
      btnLeft.style.background = 'rgba(255,255,255,0.2)';
      btnLeft.style.color = '#ffffff';
      btnLeft.style.fontWeight = '600';
    }
  }
  window.renderOfficialMemo();
};

window.adjustExecBoxMarginTop = function(delta) {
  memoExecBoxMarginTop = Math.max(-20, Math.min(80, memoExecBoxMarginTop + delta));
  const box = document.getElementById('memo-exec-box-card');
  if (box) box.style.marginTop = `${memoExecBoxMarginTop}px`;
};

// ระบบลากย้ายกล่องคำสั่งการ ผอ. ด้วยเมาส์ / สัมผัส (Drag & Drop)
let isDraggingExecBox = false;
let dragStartX = 0;
let dragStartY = 0;
let boxStartOffsetX = 0;
let boxStartOffsetY = 0;

window.initExecBoxDraggable = function() {
  const box = document.getElementById('memo-exec-box-card');
  const handle = document.getElementById('memo-exec-box-drag-handle');
  if (!box) return;

  const targetEl = handle || box;

  const onStart = (e) => {
    // ไม่ลากเมื่อคลิกที่ปุ่ม, input หรือข้อความที่คลิกได้
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('span[onclick]')) {
      return;
    }
    isDraggingExecBox = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    dragStartX = clientX;
    dragStartY = clientY;
    boxStartOffsetX = memoExecBoxOffset.x || 0;
    boxStartOffsetY = memoExecBoxOffset.y || 0;

    box.style.cursor = 'grabbing';
    box.style.zIndex = '30';
    box.style.opacity = '0.92';
    box.style.boxShadow = '0 10px 25px rgba(0,0,0,0.15)';
    e.preventDefault();
  };

  const onMove = (e) => {
    if (!isDraggingExecBox) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = clientX - dragStartX;
    const dy = clientY - dragStartY;

    memoExecBoxOffset.x = Math.round(boxStartOffsetX + dx);
    memoExecBoxOffset.y = Math.round(boxStartOffsetY + dy);

    box.style.transform = `translate(${memoExecBoxOffset.x}px, ${memoExecBoxOffset.y}px)`;
  };

  const onEnd = () => {
    if (!isDraggingExecBox) return;
    isDraggingExecBox = false;
    box.style.cursor = 'grab';
    box.style.zIndex = '1';
    box.style.opacity = '1';
    box.style.boxShadow = 'none';

    // บันทึกตำแหน่งกล่อง ผอ. ลงใน localStorage
    try {
      storageService.set('pyh_memo_exec_box_offset', memoExecBoxOffset);
    } catch(e) {}
  };

  targetEl.onmousedown = onStart;
  targetEl.ontouchstart = onStart;

  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('mouseup', onEnd);
  window.addEventListener('touchend', onEnd);
};

// ระบบลากย้ายกล่องเสนอ ผอ. (หน.กลุ่มงาน) ด้วยเมาส์ / สัมผัส (Drag & Drop)
let isDraggingChefBox = false;
let chefDragStartX = 0;
let chefDragStartY = 0;
let chefBoxStartOffsetX = 0;
let chefBoxStartOffsetY = 0;

window.initChefBoxDraggable = function() {
  const box = document.getElementById('memo-chef-box-card');
  const handle = document.getElementById('memo-chef-box-drag-handle');
  if (!box) return;

  const targetEl = handle || box;

  const onStart = (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('span[onclick]')) {
      return;
    }
    isDraggingChefBox = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    chefDragStartX = clientX;
    chefDragStartY = clientY;
    chefBoxStartOffsetX = memoChefBoxOffset.x || 0;
    chefBoxStartOffsetY = memoChefBoxOffset.y || 0;

    box.style.cursor = 'grabbing';
    box.style.zIndex = '30';
    box.style.opacity = '0.92';
    box.style.boxShadow = '0 10px 25px rgba(0,0,0,0.15)';
    e.preventDefault();
  };

  const onMove = (e) => {
    if (!isDraggingChefBox) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = clientX - chefDragStartX;
    const dy = clientY - chefDragStartY;

    memoChefBoxOffset.x = Math.round(chefBoxStartOffsetX + dx);
    memoChefBoxOffset.y = Math.round(chefBoxStartOffsetY + dy);

    box.style.transform = `translate(${memoChefBoxOffset.x}px, ${memoChefBoxOffset.y}px)`;
  };

  const onEnd = () => {
    if (!isDraggingChefBox) return;
    isDraggingChefBox = false;
    box.style.cursor = 'grab';
    box.style.zIndex = '1';
    box.style.opacity = '1';
    box.style.boxShadow = 'none';

    try {
      storageService.set('pyh_memo_chef_box_offset', memoChefBoxOffset);
    } catch(e) {}
  };

  targetEl.onmousedown = onStart;
  targetEl.ontouchstart = onStart;

  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('mouseup', onEnd);
  window.addEventListener('touchend', onEnd);
};

// ==============================================
// ระบบบันทึกลายมือชื่อเจ้าหน้าที่ (Signature Pad)
// ==============================================
let sigCanvas = null;
let sigCtx = null;
let isDrawingSig = false;
let currentSigDataUrl = null;
let sigTargetRole = 'inspector'; // 'inspector' or 'executive'

window.openSignatureModal = function(target = 'inspector') {
  sigTargetRole = target;
  currentSigDataUrl = null;
  const modal = document.getElementById('signature-modal');
  if (!modal) return;

  const modalTitle = document.getElementById('signature-modal-title');
  const modalSubtitle = document.getElementById('signature-modal-subtitle');
  if (modalTitle) {
    if (target === 'executive') {
      modalTitle.innerText = 'บันทึกลายมือชื่อผู้อำนวยการ';
    } else if (target === 'chef') {
      modalTitle.innerText = 'บันทึกลายมือชื่อหัวหน้ากลุ่มงานบริหารทั่วไป';
    } else {
      modalTitle.innerText = 'บันทึกลายมือชื่อเจ้าหน้าที่ช่าง';
    }
  }
  if (modalSubtitle) {
    if (target === 'executive') {
      modalSubtitle.innerText = 'วาดลายเซ็นหรืออัปโหลดรูปภาพลายเซ็น ผอ. เพื่อใส่ลงในเอกสาร';
    } else if (target === 'chef') {
      modalSubtitle.innerText = 'วาดลายเซ็นหรืออัปโหลดรูปภาพลายเซ็นของหัวหน้ากลุ่มงาน เพื่อเสนอ ผอ.';
    } else {
      modalSubtitle.innerText = 'วาดลายเซ็นหรืออัปโหลดรูปภาพลายเซ็นเพื่อใส่ลงในเอกสาร';
    }
  }

  // เคลียร์พรีวิวรูปถ้ามี
  const previewWrapper = document.getElementById('sig-preview-wrapper');
  const previewImg = document.getElementById('sig-preview-img');
  const fileInput = document.getElementById('sig-file-input');
  if (previewWrapper) previewWrapper.style.display = 'none';
  if (previewImg) previewImg.src = '';
  if (fileInput) fileInput.value = '';

  modal.classList.remove('hidden');

  setTimeout(() => {
    initSignatureCanvas();
  }, 100);
};

window.closeSignatureModal = function() {
  const modal = document.getElementById('signature-modal');
  if (modal) modal.classList.add('hidden');
};

function initSignatureCanvas() {
  sigCanvas = document.getElementById('signature-canvas');
  if (!sigCanvas) return;
  sigCtx = sigCanvas.getContext('2d');

  // ปรับความละเอียด Retina / High DPI
  const rect = sigCanvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  sigCanvas.width = (rect.width || 380) * scale;
  sigCanvas.height = 150 * scale;
  sigCtx.scale(scale, scale);

  sigCtx.strokeStyle = "#0f172a";
  sigCtx.lineWidth = 2.5;
  sigCtx.lineCap = "round";
  sigCtx.lineJoin = "round";

  // Event Listeners สำหรับเมาส์และทัชสกรีน
  const getPos = (e) => {
    const cRect = sigCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - cRect.left,
      y: clientY - cRect.top
    };
  };

  const startDraw = (e) => {
    e.preventDefault();
    isDrawingSig = true;
    const pos = getPos(e);
    sigCtx.beginPath();
    sigCtx.moveTo(pos.x, pos.y);
  };

  const draw = (e) => {
    if (!isDrawingSig) return;
    e.preventDefault();
    const pos = getPos(e);
    sigCtx.lineTo(pos.x, pos.y);
    sigCtx.stroke();
  };

  const stopDraw = (e) => {
    if (!isDrawingSig) return;
    isDrawingSig = false;
  };

  sigCanvas.onmousedown = startDraw;
  sigCanvas.onmousemove = draw;
  window.onmouseup = stopDraw;

  sigCanvas.ontouchstart = startDraw;
  sigCanvas.ontouchmove = draw;
  sigCanvas.ontouchend = stopDraw;

  window.clearSignature();
}

window.clearSignature = function() {
  if (!sigCanvas || !sigCtx) return;
  const rect = sigCanvas.getBoundingClientRect();
  sigCtx.clearRect(0, 0, rect.width || 380, 150);
  currentSigDataUrl = null;
};

window.switchSigTab = function(mode) {
  const drawTab = document.getElementById('sig-draw-container');
  const uploadTab = document.getElementById('sig-upload-container');
  const drawBtn = document.getElementById('tab-sig-draw');
  const uploadBtn = document.getElementById('tab-sig-upload');

  if (mode === 'draw') {
    if (drawTab) drawTab.style.display = 'block';
    if (uploadTab) uploadTab.style.display = 'none';
    if (drawBtn) { drawBtn.style.background = 'white'; drawBtn.style.color = '#0284c7'; drawBtn.style.fontWeight = '700'; }
    if (uploadBtn) { uploadBtn.style.background = 'transparent'; uploadBtn.style.color = '#64748b'; uploadBtn.style.fontWeight = '600'; }
    setTimeout(initSignatureCanvas, 50);
  } else {
    if (drawTab) drawTab.style.display = 'none';
    if (uploadTab) uploadTab.style.display = 'block';
    if (uploadBtn) { uploadBtn.style.background = 'white'; uploadBtn.style.color = '#0284c7'; uploadBtn.style.fontWeight = '700'; }
    if (drawBtn) { drawBtn.style.background = 'transparent'; drawBtn.style.color = '#64748b'; drawBtn.style.fontWeight = '600'; }
  }
};

window.handleSigFileUpload = function(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    currentSigDataUrl = e.target.result;
    const previewWrapper = document.getElementById('sig-preview-wrapper');
    const previewImg = document.getElementById('sig-preview-img');
    if (previewImg && previewWrapper) {
      previewImg.src = currentSigDataUrl;
      previewWrapper.style.display = 'block';
    }
  };
  reader.readAsDataURL(file);
};

window.saveSignature = async function() {
  const uploadTab = document.getElementById('sig-upload-container');
  const isUploadMode = uploadTab && uploadTab.style.display !== 'none';

  let finalSigUrl = null;
  if (isUploadMode) {
    finalSigUrl = currentSigDataUrl;
  } else if (sigCanvas) {
    finalSigUrl = sigCanvas.toDataURL("image/png");
  }

  if (!finalSigUrl) {
    alert("กรุณาวาดลายเซ็นหรืออัปโหลดรูปภาพก่อนบันทึก");
    return;
  }

  const now = new Date();
  const fullThaiDateStr = formatThaiFullDate(now);

  if (sigTargetRole === 'executive') {
    // บันทึกลายเซ็นผู้อำนวยการ
    const defaultApprover = getCleanName(document.getElementById('report-approver-name')?.value.trim() || ((_appContext.getCurrentUserRole()) === 'executive' ? (_appContext.getCurrentOfficer()) : "นางสาวศิริพรรณ ชมพูภู่"));
    
    // ดึง decision ที่เคยเลือกไว้ หรือตั้งเป็น acknowledge
    let prevDecision = 'acknowledge';
    try {
      const rawDec = storageService.get('pyh_executive_decision');
      if (rawDec) {
        const d = JSON.parse(rawDec);
        if (d && d.decision) prevDecision = d.decision;
      }
    } catch(e) {}

    const certData = {
      approver: defaultApprover,
      decision: prevDecision,
      decisionLabel: (prevDecision === 'acknowledge') ? 'รับทราบ' : 'อนุมัติซ่อมแซม',
      signatureImg: finalSigUrl,
      certifiedAt: now.toISOString(),
      certifiedDateStr: fullThaiDateStr,
      certifiedTimeStr: now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
    };

    storageService.set('pyh_exec_certification', certData);
    storageService.set('pyh_executive_decision', JSON.stringify({
      decision: prevDecision,
      savedAt: now.toISOString()
    }));

    if (isFirebaseReady() && db) {
      try {
        await setDoc(doc(db, "system_state", "report_certifications"), {
          exec_cert: certData,
          exec_decision: { decision: prevDecision, savedAt: now.toISOString() },
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (e) {
        console.warn("Firestore sync exec_cert error:", e);
      }
    }

    closeSignatureModal();
    renderExecutiveCertificationUI();
    alert("✍️ บันทึกลายมือชื่อของผู้อำนวยการลงในเอกสารเรียบร้อยแล้ว!");
  } else if (sigTargetRole === 'chef') {
    // บันทึกลายเซ็นหัวหน้ากลุ่มงานบริหารทั่วไป (นายคมสัน ศรีสิงห์)
    const defaultChef = getCleanName(document.getElementById('report-reviewer-name')?.value.trim() || "นายคมสัน ศรีสิงห์");
    const certData = {
      officer: defaultChef,
      role: 'chef_inspector',
      signatureImg: finalSigUrl,
      certifiedAt: now.toISOString(),
      certifiedDateStr: fullThaiDateStr,
      certifiedTimeStr: now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
    };

    storageService.set('pyh_chef_certification', certData);

    if (isFirebaseReady() && db) {
      try {
        await setDoc(doc(db, "system_state", "report_certifications"), {
          chef_cert: certData,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (e) {
        console.warn("Firestore sync chef_cert error:", e);
      }
    }

    closeSignatureModal();
    renderChefCertificationUI();
    alert("✍️ บันทึกลายมือชื่อของหัวหน้ากลุ่มงานบริหารทั่วไปลงในเอกสารเรียบร้อยแล้ว!");
  } else {
    // บันทึกลายเซ็นของช่างผู้ตรวจลง localStorage
    const cleanName = getCleanName((_appContext.getCurrentOfficer())) || "นายสุวิทย์ พวงสมบัติ";
    const certData = {
      officer: cleanName,
      role: 'inspector',
      signatureImg: finalSigUrl,
      certifiedAt: now.toISOString(),
      certifiedDateStr: fullThaiDateStr,
      certifiedTimeStr: now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
    };

    storageService.set('pyh_tech_certification', certData);

    if (isFirebaseReady() && db) {
      try {
        await setDoc(doc(db, "system_state", "report_certifications"), {
          tech_cert: certData,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (e) {
        console.warn("Firestore sync tech_cert error:", e);
      }
    }

    closeSignatureModal();
    renderTechCertificationUI();
    alert("✍️ บันทึกลายมือชื่อของเจ้าหน้าที่ช่างลงในเอกสารเรียบร้อยแล้ว!");
  }
};

// แปลงเลขอารบิกเป็นเลขไทยสำหรับหนังสือราชการ
function toThaiNumerals(num) {
  if (num === null || num === undefined) return '';
  const thaiDigits = ['๐', '๑', '๒', '๓', '๔', '๕', '๖', '๗', '๘', '๙'];
  return String(num).replace(/[0-9]/g, d => thaiDigits[d]);
}

window.setReportFormat = function (mode) {
  currentReportFormat = mode;
  const btnMemo = document.getElementById('btn-mode-memo');
  const btnDetailed = document.getElementById('btn-mode-detailed');
  const editToolbar = document.getElementById('memo-edit-toolbar');

  if (btnMemo && btnDetailed) {
    if (mode === 'memo') {
      btnMemo.style.background = '#ffffff';
      btnMemo.style.color = '#004d40';
      btnMemo.style.fontWeight = '700';

      btnDetailed.style.background = 'transparent';
      btnDetailed.style.color = '#ffffff';
      btnDetailed.style.fontWeight = '600';

      if (editToolbar) editToolbar.style.display = 'flex';
      const btnToggle = document.getElementById('btn-toggle-memo-toolbar');
      if (btnToggle) btnToggle.style.display = 'inline-flex';
    } else {
      btnDetailed.style.background = '#ffffff';
      btnDetailed.style.color = '#004d40';
      btnDetailed.style.fontWeight = '700';

      btnMemo.style.background = 'transparent';
      btnMemo.style.color = '#ffffff';
      btnMemo.style.fontWeight = '600';

      if (editToolbar) editToolbar.style.display = 'none';
      const btnToggle = document.getElementById('btn-toggle-memo-toolbar');
      if (btnToggle) btnToggle.style.display = 'none';
    }
  }

  window.renderSelectedReport();
};

window.toggleMemoEditToolbar = function () {
  const editToolbar = document.getElementById('memo-edit-toolbar');
  if (!editToolbar) return;
  const isHidden = (window.getComputedStyle(editToolbar).display === 'none');
  editToolbar.style.display = isHidden ? 'flex' : 'none';
};

// ฟังก์ชันปรับขนาดตัวอักษรเฉพาะส่วนที่เลือก หรือ ทั้งเอกสาร
window.adjustTargetMemoFont = function (delta) {
  const target = document.getElementById('memo-font-target')?.value || 'all';

  if (target === 'all') {
    memoFontConfig.header = Math.max(12, Math.min(22, memoFontConfig.header + delta));
    memoFontConfig.body = Math.max(12, Math.min(22, memoFontConfig.body + delta));
    memoFontConfig.sign = Math.max(11, Math.min(20, memoFontConfig.sign + delta));
  } else if (target === 'title') {
    memoFontConfig.title = Math.max(18, Math.min(48, (memoFontConfig.title || 29) + delta));
  } else if (target === 'header') {
    memoFontConfig.header = Math.max(12, Math.min(22, memoFontConfig.header + delta));
  } else if (target === 'body') {
    memoFontConfig.body = Math.max(12, Math.min(22, memoFontConfig.body + delta));
  } else if (target === 'sign') {
    memoFontConfig.sign = Math.max(11, Math.min(20, memoFontConfig.sign + delta));
  }

  window.updateMemoFontDisplay();
  window.applyMemoStyles();
};

window.updateMemoFontDisplay = function () {
  const target = document.getElementById('memo-font-target')?.value || 'all';
  const input = document.getElementById('memo-font-size-input');
  const disp = document.getElementById('memo-font-size-display');
  const currentVal = (target === 'all') ? memoFontConfig.body : (memoFontConfig[target] || 16);
  if (input) input.value = currentVal;
  if (disp) disp.innerText = `${currentVal}pt`;
};

window.applyMemoStyles = function () {
  const memoPaper = document.querySelector('.memo-paper');
  if (!memoPaper) return;

  // ระยะขอบ 4 ทิศทาง (มาตรฐาน: บน 2cm, ล่าง 2cm, ซ้าย 2.5cm, ขวา 2cm)
  memoPaper.style.paddingTop = `${memoMargins.top}cm`;
  memoPaper.style.paddingBottom = `${memoMargins.bottom}cm`;
  memoPaper.style.paddingLeft = `${memoMargins.left}cm`;
  memoPaper.style.paddingRight = `${memoMargins.right}cm`;

  // อัปเดตช่องตัวเลขขอบ 4 ด้านในแถบเครื่องมือ
  const inTop = document.getElementById('margin-in-top');
  const inBottom = document.getElementById('margin-in-bottom');
  const inLeft = document.getElementById('margin-in-left');
  const inRight = document.getElementById('margin-in-right');
  if (inTop) inTop.value = memoMargins.top;
  if (inBottom) inBottom.value = memoMargins.bottom;
  if (inLeft) inLeft.value = memoMargins.left;
  if (inRight) inRight.value = memoMargins.right;

  // ระยะบรรทัด
  memoPaper.style.lineHeight = memoLineSpacing;

  // ปรับขนาดฟอนต์หัวกระดาษ "บันทึกข้อความ"
  memoPaper.querySelectorAll('.memo-title-banner h1').forEach(el => {
    el.style.fontSize = `${memoFontConfig.title || 29}pt`;
  });

  // ปรับขนาดฟอนต์หัวหนังสือ
  memoPaper.querySelectorAll('.memo-info-table td, .memo-info-table td *').forEach(el => {
    el.style.fontSize = `${memoFontConfig.header}pt`;
  });

  // ปรับขนาดฟอนต์เนื้อหา
  memoPaper.querySelectorAll('.memo-section-heading, .memo-para').forEach(el => {
    el.style.fontSize = `${memoFontConfig.body}pt`;
  });

  // ปรับขนาดฟอนต์ส่วนลงนาม & กล่องเสนอ/อนุมัติ
  memoPaper.querySelectorAll('.memo-sign-table, .memo-sign-table td, .memo-sign-table td *, #memo-chef-box-card, #memo-chef-box-card *, #memo-exec-box-card, #memo-exec-box-card *').forEach(el => {
    if (!el.classList.contains('no-print') && !el.closest('.no-print')) {
      el.style.fontSize = `${memoFontConfig.sign}pt`;
    }
  });

  // บันทึกการตั้งค่าลง localStorage
  try {
    storageService.set('pyh_memo_margins', memoMargins);
    storageService.set('pyh_memo_fonts', memoFontConfig);
  } catch(e) {}
};

// ฟังก์ชันปรับระยะกั้นหน้า-กั้นหลัง (Margin ซ้าย-ขวา แบบปุ่มกด)
window.adjustMemoMargin = function (deltaMm) {
  const newLeft = parseFloat((memoMargins.left + (deltaMm / 10)).toFixed(1));
  const newRight = parseFloat((memoMargins.right + (deltaMm / 10)).toFixed(1));
  if (newLeft < 1.0 || newLeft > 4.5) return;
  memoMargins.left = newLeft;
  memoMargins.right = Math.max(1.0, newRight);
  window.applyMemoStyles();
};

window.adjustMemoSpacing = function (delta) {
  memoLineSpacing = Math.max(1.15, Math.min(1.85, parseFloat((memoLineSpacing + delta).toFixed(2))));
  window.applyMemoStyles();
};

window.resetMemoContent = function () {
  if (confirm("ต้องการคืนค่าข้อความและการจัดหน้าตามระเบียบงานสารบรรณเริ่มต้นใช่ไหม?")) {
    storageService.remove('pyh_custom_memo_data');
    storageService.remove('pyh_memo_exec_box_offset');
    storageService.remove('pyh_memo_chef_box_offset');
    storageService.remove('pyh_memo_margins');
    storageService.remove('pyh_memo_fonts');
    memoFontConfig = { title: 29, header: 20, body: 16, sign: 16 };
    memoMargins = { top: 1.5, bottom: 2.0, left: 3.0, right: 2.0 };
    memoLineSpacing = 1.25;
    memoExecBoxOffset = { x: 0, y: 0 };
    memoChefBoxOffset = { x: 0, y: 0 };
    memoExecBoxPosition = 'left';
    window.updateMemoFontDisplay();
    renderOfficialMemo();
  }
};

// บันทึกข้อความที่ผู้ใช้พิมพ์แก้ไขลงใน localStorage อัตโนมัติ
window.saveMemoEdits = function () {
  const paper = document.querySelector('.memo-paper');
  if (!paper) return;

  const data = {
    dept: document.getElementById('memo-dept')?.innerText || '',
    tel: document.getElementById('memo-tel')?.innerText || '',
    docNo: document.getElementById('memo-doc-no')?.innerText || '',
    docDate: document.getElementById('memo-doc-date')?.innerText || '',
    subject: document.getElementById('memo-subject')?.innerText || '',
    to: document.getElementById('memo-to')?.innerText || '',
    authorName: document.getElementById('report-display-tech-name')?.innerText || '',
    authorPos: document.getElementById('report-display-tech-pos')?.innerText || '',
    bgText: document.getElementById('memo-para-bg')?.innerText || '',
    considerText: document.getElementById('memo-para-consider')?.innerText || '',
    proposeText: document.getElementById('memo-para-propose')?.innerText || '',
    savedAt: new Date().toISOString()
  };

  try {
    storageService.set('pyh_custom_memo_data', data);
  } catch (e) { }
};

window.renderSelectedReport = function () {
  if (currentReportFormat === 'memo') {
    window.renderOfficialMemo();
  } else {
    window.generateExecutiveReport();
  }
};

// เรนเดอร์เอกสาร "แบบบันทึกข้อความราชการ" (Official Memo)
window.renderOfficialMemo = function () {
  const container = document.getElementById('report-content-body');
  if (!container) return;

  // คำนวณยอดสถิติจริงของอุปกรณ์ในระบบ
  const totalAssets = (_appContext.getAssetsList()).length;
  const checkedAssets = (_appContext.getAssetsList()).filter(a => a.lastChecked);
  const checkedCount = checkedAssets.length;
  const readyCount = (_appContext.getAssetsList()).filter(a => a.status === 'READY' && a.lastChecked).length;
  const issueAssets = (_appContext.getAssetsList()).filter(a => a.status === 'ISSUE');
  const issueCount = issueAssets.length;

  const feTotal = (_appContext.getAssetsList()).filter(a => a.assetId.startsWith('PYH-FE') || a.type.includes('ถังดับเพลิง')).length;
  const emTotal = (_appContext.getAssetsList()).filter(a => a.assetId.startsWith('PYH-EM') || a.type.includes('ไฟฉุกเฉิน')).length;

  // ดึงข้อมูลที่เคยแก้ไขไว้ (ถ้ามี)
  let saved = null;
  try {
    const raw = storageService.get('pyh_custom_memo_data');
    if (raw) saved = JSON.parse(raw);
  } catch (e) { }

  // ดึงการตั้งค่าขอบและฟอนต์ที่เคยบันทึกไว้ (ถ้ามี)
  try {
    const rawMarg = storageService.get('pyh_memo_margins');
    if (rawMarg) memoMargins = Object.assign(memoMargins, JSON.parse(rawMarg));
    const rawFonts = storageService.get('pyh_memo_fonts');
    if (rawFonts) memoFontConfig = Object.assign(memoFontConfig, JSON.parse(rawFonts));
  } catch(e) {}

  // ผู้จัดทำและเสนอรายงานในหน้าบันทึกข้อความราชการ (แยกต่างหากจากช่างที่ตรวจหน้างาน)
  const memoReporterName = saved?.authorName || "นายพิรุฬห์ บุญเพ็ชร์";
  const memoReporterPos = saved?.authorPos || "พนักงานทั่วไป";

  // ผู้จัดทำและผู้บริหาร
  const authorName = memoReporterName;
  const authorPos = memoReporterPos;
  const chefReviewerName = getCleanName(document.getElementById('report-reviewer-name')?.value.trim() || "นายคมสัน ศรีสิงห์");
  const chefReviewerPos1 = "นักเทคนิคการแพทย์ปฏิบัติการ รักษาการในตำแหน่ง";
  const chefReviewerPos2 = "หัวหน้ากลุ่มงานบริหารทั่วไป";
  const approverName = "นางสาวศิริพรรณ ชมพูภู่";
  const approverPos = "ผู้อำนวยการโรงพยาบาลพยุหะคีรี";

  // วันที่ปัจจุบันแบบไทย
  const now = new Date();
  const thaiDay = toThaiNumerals(24);
  const thaiMonth = 'ตุลาคม';
  const thaiYear = toThaiNumerals(2569);
  const thaiDateFormatted = `๒๔   ตุลาคม   ๒๕๖๙`;

  const deptVal = (saved?.dept && !saved.dept.includes('และงานซ่อมบำรุง') && !saved.dept.includes('อำเภอพยุหะคีรี'))
    ? saved.dept
    : "กลุ่มงานบริหารทั่วไป โรงพยาบาลพยุหะคีรี";
  const docNoVal = saved?.docNo || `นว ๐๐๓๓.๓/พิเศษ`;
  const docDateVal = saved?.docDate || `๒๔   ตุลาคม   ๒๕๖๙`;
  const subjectVal = saved?.subject || `รายงานผลการตรวจสอบความพร้อมอุปกรณ์ความปลอดภัยอัคคีภัยและโคมไฟฉุกเฉิน ประจำเดือนตุลาคม ๒๕๖๙`;
  const toVal = saved?.to || "ผู้อำนวยการโรงพยาบาลพยุหะคีรี";

  const defaultBgText = `ด้วย งานอาคารสถานที่และซ่อมบำรุง กลุ่มงานบริหารทั่วไป โรงพยาบาลพยุหะคีรี มีภารกิจในการดูแล บำรุงรักษา และกำกับความพร้อมใช้งานของระบบความปลอดภัยด้านกายภาพและสิ่งแวดล้อม ตามเกณฑ์ MOIT ๒ ข้อ ๒ (๒.๒) และมาตรฐาน HA ตอนที่ II (ENV 1-4) เพื่อประโยชน์และความปลอดภัยสูงสุดต่อผู้ป่วย ญาติ และบุคลากรผู้ปฏิบัติงาน ให้เป็นไปตามพระราชบัญญัติควบคุมอาคาร และมาตรฐานความปลอดภัยด้านอัคคีภัยในสถานพยาบาลอย่างเคร่งครัด`;

  let defectSummaryThai = "";
  if (issueCount > 0) {
    const issueIds = issueAssets.map(a => a.assetId).join(', ');
    defectSummaryThai = ` ทั้งนี้ ตรวจพบอุปกรณ์ที่มีข้อบกพร่อง/ชำรุดจำนวน ${toThaiNumerals(issueCount)} จุด ได้แก่ ${issueIds} ซึ่งได้ดำเนินการจัดเตรียมถังสำรองเปลี่ยนทดแทน และประสานงานส่งซ่อมแซม/อัดบรรจุสารเคมีใหม่เรียบร้อยแล้ว`;
  } else {
    defectSummaryThai = ` โดยไม่พบความชำรุดเสียหาย อุปกรณ์ทั้งหมดอยู่ในเกณฑ์พร้อมใช้งานตามมาตรฐานความปลอดภัยอย่างครบถ้วน`;
  }

  const defaultConsiderText = `งานอาคารสถานที่และซ่อมบำรุง ขอรายงานผลการตรวจสอบความพร้อมใช้งานของถังดับเพลิงมือถือและโคมไฟส่องสว่างฉุกเฉินทั่วทั้งโรงพยาบาลพยุหะคีรี ครอบคลุมทั้งสิ้น ๖ อาคาร รวม ${toThaiNumerals(totalAssets)} จุดตรวจ (ถังดับเพลิง ${toThaiNumerals(feTotal)} จุด และโคมไฟฉุกเฉิน ${toThaiNumerals(emTotal)} จุด) ได้ดำเนินการตรวจเช็กสภาพความสมบูรณ์ แรงดันเกจ์ สลักนิรภัย และแบตเตอรี่สำรองแล้วเสร็จจำนวน ${toThaiNumerals(checkedCount)} จุด (${toThaiNumerals(Math.round((checkedCount / (totalAssets || 1)) * 100))}%) พบอุปกรณ์พร้อมใช้งานสมบูรณ์ ${toThaiNumerals(readyCount)} จุด${defectSummaryThai} เพื่อให้ระบบความปลอดภัยของโรงพยาบาลพยุหะคีรีมีมาตรฐานและความพร้อมใช้งานในระดับสูงสุดตลอด ๒๔ ชั่วโมง`;

  const defaultProposeText = `จึงเรียนมาเพื่อโปรดทราบ และพิจารณาอนุมัติดำเนินการตามมาตรการบำรุงรักษาอุปกรณ์ความปลอดภัยดังกล่าวต่อไป`;

  let bgText = saved?.bgText || defaultBgText;
  if (bgText && bgText.includes('(Environmental and Safety: HA ENV)')) {
    bgText = defaultBgText;
  }
  const considerText = saved?.considerText || defaultConsiderText;
  const proposeText = saved?.proposeText || defaultProposeText;

  const memoHtml = `
    <div class="memo-paper" style="padding-top:${memoMargins.top}cm; padding-bottom:${memoMargins.bottom}cm; padding-left:${memoMargins.left}cm; padding-right:${memoMargins.right}cm; line-height:${memoLineSpacing};" oninput="saveMemoEdits()">
      
      <!-- ส่วนหัวตราครุฑและคำว่า บันทึกข้อความ -->
      <div class="memo-header-top">
        <img src="garuda.svg" alt="ตราครุฑ" class="memo-garuda-img">
        <div class="memo-title-banner">
          <h1 style="font-size:${memoFontConfig.title || 29}pt;">บันทึกข้อความ</h1>
        </div>
      </div>

      <!-- ส่วนหัวหนังสือราชการ (ระเบียบ: ส่วนราชการ, ที่, วันที่, เรื่อง ตัวหนา 20pt) -->
      <table class="memo-info-table" style="font-size:${memoFontConfig.header}pt; border-collapse:collapse; width:100%; margin-bottom:8px;">
        <tr>
          <td colspan="2" style="padding-bottom:4px;">
            <div style="display:flex; align-items:flex-start;">
              <span class="memo-label" style="font-size:${memoFontConfig.header}pt; font-weight:700; min-width:95px; flex-shrink:0;">ส่วนราชการ</span>
              <div style="flex:1; line-height:1.25; font-size:16pt; font-weight:normal; margin-left:8px;">
                <span id="memo-dept" class="memo-editable" contenteditable="true" style="font-size:16pt;">${deptVal}</span>
              </div>
            </div>
          </td>
        </tr>
        <tr>
          <td style="width:50%; padding-bottom:4px;">
            <div style="display:flex; align-items:center;">
              <span class="memo-label" style="font-size:${memoFontConfig.header}pt; font-weight:700; min-width:25px; flex-shrink:0;">ที่</span>
              <span id="memo-doc-no" class="memo-editable" contenteditable="true" style="margin-left:8px; min-width:140px; font-size:16pt; font-weight:normal;">${docNoVal}</span>
            </div>
          </td>
          <td style="width:50%; padding-bottom:4px;">
            <div style="display:flex; align-items:center;">
              <span class="memo-label" style="font-size:${memoFontConfig.header}pt; font-weight:700; min-width:45px; flex-shrink:0;">วันที่</span>
              <span id="memo-doc-date" class="memo-editable" contenteditable="true" style="margin-left:8px; min-width:140px; font-size:16pt; font-weight:normal;">${docDateVal}</span>
            </div>
          </td>
        </tr>
        <tr>
          <td colspan="2" style="padding-bottom:4px;">
            <div style="display:flex; align-items:flex-start;">
              <span class="memo-label" style="font-size:${memoFontConfig.header}pt; font-weight:700; min-width:45px; flex-shrink:0;">เรื่อง</span>
              <div style="flex:1; line-height:1.25; font-size:16pt; font-weight:normal; margin-left:8px;">
                <span id="memo-subject" class="memo-editable" contenteditable="true" style="font-size:16pt;">${subjectVal}</span>
              </div>
            </div>
          </td>
        </tr>
        <tr>
          <td colspan="2" style="padding-top:4px; padding-bottom:8px;">
            <div style="display:flex; align-items:center;">
              <span class="memo-label" style="font-size:16pt; font-weight:normal; min-width:45px; flex-shrink:0;">เรียน</span>
              <span id="memo-to" class="memo-editable" contenteditable="true" style="margin-left:8px; font-size:16pt; font-weight:normal;">${toVal}</span>
            </div>
          </td>
        </tr>
      </table>

      <!-- ย่อหน้าที่ 1: เรื่องเดิม / ความเป็นมา (ย่อหน้า 2.5 ซม.) -->
      <div id="memo-para-bg" class="memo-para memo-editable-block" contenteditable="true" style="font-size:${memoFontConfig.body}pt; text-indent:2.5cm; margin-bottom:8px; text-align:justify;">
        ${bgText}
      </div>

      <!-- ย่อหน้าที่ 2: ข้อเท็จจริง / รายงานผล (ย่อหน้า 2.5 ซม.) -->
      <div id="memo-para-consider" class="memo-para memo-editable-block" contenteditable="true" style="font-size:${memoFontConfig.body}pt; text-indent:2.5cm; margin-bottom:8px; text-align:justify;">
        ${considerText}
      </div>

      <!-- ย่อหน้าที่ 3: ข้อพิจารณา / ข้อเสนอ (ย่อหน้า 2.5 ซม.) -->
      <div id="memo-para-propose" class="memo-para memo-editable-block" contenteditable="true" style="font-size:${memoFontConfig.body}pt; text-indent:2.5cm; margin-top:8px; margin-bottom:18px; text-align:justify;">
        ${proposeText}
      </div>

      <!-- ส่วนลงนามผู้เสนอ/ผู้รายงาน (ตามแบบที่ ๒ ท้ายระเบียบงานสารบรรณ: ลงชื่อ, พิมพ์ชื่อเต็ม, ตำแหน่ง อยู่ฝั่งขวา) -->
      ${(() => {
        return `
          <table class="memo-sign-table" style="width:100%; font-size:${memoFontConfig.sign}pt; border-collapse:collapse; margin-top:24px;">
            <tr>
              <td style="width:50%;"></td>
              <td style="width:50%; vertical-align:top; text-align:center;">
                <!-- ช่องลายเซ็น (ลงชื่อ) -->
                <div style="font-size:${memoFontConfig.sign}pt; margin-bottom:4px;">(ลงชื่อ)</div>
                <div id="tech-cert-container" style="min-height:36px; display:flex; justify-content:center; align-items:center;">
                  <!-- เติมโดย renderTechCertificationUI() -->
                </div>
                <div style="font-weight:normal; font-size:${memoFontConfig.sign}pt; margin-top:4px;">( <span id="report-display-tech-name" class="memo-editable" contenteditable="true">${authorName}</span> )</div>
                <div style="font-size:${memoFontConfig.sign}pt; color:#000000; margin-top:2px;">ตำแหน่ง <span id="report-display-tech-pos" class="memo-editable" contenteditable="true">${authorPos}</span></div>
              </td>
            </tr>
          </table>
        `;
      })()}
    </div>
  `;

  container.innerHTML = memoHtml;

  // เปิดใช้งานฟังก์ชันลากย้ายกล่อง ผอ. และกล่อง หน.กลุ่มงาน ด้วยเมาส์
  if (typeof window.initExecBoxDraggable === 'function') {
    window.initExecBoxDraggable();
  }
  if (typeof window.initChefBoxDraggable === 'function') {
    window.initChefBoxDraggable();
  }

  // ซิงก์ลายเซ็นและคำสั่งการที่มีอยู่ในระบบ
  if (typeof window.renderTechCertificationUI === 'function') {
    window.renderTechCertificationUI();
  }
  if (typeof window.renderChefCertificationUI === 'function') {
    window.renderChefCertificationUI();
  }
  if (typeof window.renderExecutiveCertificationUI === 'function') {
    window.renderExecutiveCertificationUI();
  }
  if (typeof window.restoreExecutiveApproval === 'function') {
    window.restoreExecutiveApproval();
  }

  // อัปเดตการแสดงผลขนาดฟอนต์และขอบกระดาษให้ตรงกับค่าปัจจุบัน
  if (typeof window.applyMemoStyles === 'function') {
    window.applyMemoStyles();
  }
  if (typeof window.updateMemoFontDisplay === 'function') {
    window.updateMemoFontDisplay();
  }
};

window.generateExecutiveReport = function () {
  const container = document.getElementById('report-content-body');
  if (!container) return;

  const period = document.getElementById('report-period')?.value || "กันยายน 2569";
  const buildingFilter = document.getElementById('report-building-filter')?.value || "all";

  // ส่วนที่ 1: ผู้จัดทำและเสนอรายงาน
  const authorName = getCleanName(document.getElementById('report-author-name')?.value.trim() || "นายสุวิทย์ พวงสมบัติ");
  const authorPos = document.getElementById('report-author-pos')?.value.trim() || "นายช่างเทคนิค";
  const author = authorName;

  // ส่วนที่ 2: ผู้ตรวจสอบ (Chef Inspector)
  const reviewerName = getCleanName(document.getElementById('report-reviewer-name')?.value.trim() || "นายคมสันต์ ศรีสิงห์");
  const reviewerPos = document.getElementById('report-reviewer-pos')?.value.trim() || "นักเทคนิคการแพทย์ปฏิบัติการ รักษาราชการแทน หัวหน้าฝ่ายบริหารทั่วไป";
  const reviewer = reviewerName;

  // ส่วนที่ 3: ผู้บริหารผู้อนุมัติคำสั่งการ
  const approverName = getCleanName(document.getElementById('report-approver-name')?.value.trim() || "นางสาวศิริพรรณ ชมพูภู่");
  const approverPos = document.getElementById('report-approver-pos')?.value.trim() || "ผู้อำนวยการโรงพยาบาลพยุหะคีรี";
  const approver = approverName;

  const includeAllItems = document.getElementById('report-include-all-items')?.checked ?? true;

  // เรียงลำดับอุปกรณ์ตาม: 1. ตึก/อาคาร 2. ชั้น/ห้อง/จุดติดตั้ง 3. รหัสลำดับอุปกรณ์ (Natural sorting)
  const buildingOrder = [
    'building_er_lower',
    'building_er_upper',
    'building_hpc',
    'building_ipd',
    'building_nisit',
    'building_opd_dm'
  ];

  const rawTargetAssets = (buildingFilter === 'all')
    ? [...(_appContext.getAssetsList())]
    : (_appContext.getAssetsList()).filter(a => a.buildingId === buildingFilter);

  const targetAssets = rawTargetAssets.sort((a, b) => {
    // 1. เรียงตามลำดับตึก/อาคาร
    const bIdxA = buildingOrder.indexOf(a.buildingId);
    const bIdxB = buildingOrder.indexOf(b.buildingId);
    const orderA = bIdxA !== -1 ? bIdxA : 999;
    const orderB = bIdxB !== -1 ? bIdxB : 999;
    if (orderA !== orderB) return orderA - orderB;

    // 2. เรียงตามชั้น (ถ้ามี)
    const floorA = a.floor || 1;
    const floorB = b.floor || 1;
    if (floorA !== floorB) return floorA - floorB;

    // 3. เรียงตามรหัสอุปกรณ์ (Asset ID) ลำดับ 01, 02, 03... (Natural Numeric Sorting)
    const idComp = (a.assetId || '').localeCompare(b.assetId || '', undefined, { numeric: true, sensitivity: 'base' });
    if (idComp !== 0) return idComp;

    // 4. เรียงตามห้อง / จุดติดตั้ง
    return (a.location || '').localeCompare(b.location || '', 'th');
  });

  const totalAssets = targetAssets.length;
  const checkedAssets = targetAssets.filter(a => a.lastChecked);
  const checkedCount = checkedAssets.length;
  const readyCount = targetAssets.filter(a => a.status === 'READY' && a.lastChecked).length;
  const issueAssets = targetAssets.filter(a => a.status === 'ISSUE');
  const issueCount = issueAssets.length;
  const uninspectedCount = totalAssets - checkedCount;

  const coverageRate = totalAssets > 0 ? Math.round((checkedCount / totalAssets) * 100) : 0;
  const readinessRate = checkedCount > 0 ? Math.round((readyCount / checkedCount) * 100) : 0;

  // จำแนกตามประเภทอุปกรณ์
  const feAssets = targetAssets.filter(a => a.assetId.startsWith('PYH-FE') || a.type.includes('ถังดับเพลิง'));
  const feChecked = feAssets.filter(a => a.lastChecked).length;
  const feReady = feAssets.filter(a => a.status === 'READY' && a.lastChecked).length;
  const feIssue = feAssets.filter(a => a.status === 'ISSUE').length;

  const emAssets = targetAssets.filter(a => a.assetId.startsWith('PYH-EM') || a.type.includes('ไฟฉุกเฉิน'));
  const emChecked = emAssets.filter(a => a.lastChecked).length;
  const emReady = emAssets.filter(a => a.status === 'READY' && a.lastChecked).length;
  const emIssue = emAssets.filter(a => a.status === 'ISSUE').length;

  const filterName = (buildingFilter === 'all')
    ? 'ทุกอาคารทั่วทั้งโรงพยาบาลพยุหะคีรี (6 อาคาร 48 จุดตรวจ)'
    : (buildingMetadata[buildingFilter]?.name || buildingFilter);

  const reportDate = new Date().toLocaleDateString('th-TH', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  // สร้างแถวตารางวิเคราะห์รายอาคาร
  let buildingRowsHtml = '';
  const buildingKeys = (buildingFilter === 'all')
    ? Object.keys(buildingMetadata)
    : [buildingFilter];

  buildingKeys.forEach((bId, idx) => {
    const meta = buildingMetadata[bId] || { name: bId };
    const bAssets = (_appContext.getAssetsList()).filter(a => a.buildingId === bId);
    const bTotal = bAssets.length;
    const bChecked = bAssets.filter(a => a.lastChecked).length;
    const bReady = bAssets.filter(a => a.status === 'READY' && a.lastChecked).length;
    const bIssue = bAssets.filter(a => a.status === 'ISSUE').length;
    const bRate = bChecked > 0 ? Math.round((bReady / bChecked) * 100) : 0;

    let statusBadge = '';
    if (bIssue > 0) {
      statusBadge = `<span class="badge badge-issue">พบชำรุด ${bIssue} จุด</span>`;
    } else if (bChecked === bTotal && bTotal > 0) {
      statusBadge = `<span class="badge badge-ready">พร้อมใช้งาน 100%</span>`;
    } else {
      statusBadge = `<span style="color:#d97706; font-size:12px; font-weight:600;">ตรวจแล้ว ${bChecked}/${bTotal} จุด</span>`;
    }

    buildingRowsHtml += `
      <tr>
        <td style="text-align:center;">${idx + 1}</td>
        <td><b>${meta.name}</b></td>
        <td style="text-align:center;">${bTotal}</td>
        <td style="text-align:center;">${bChecked}</td>
        <td style="text-align:center; color:#15803d; font-weight:bold;">${bReady}</td>
        <td style="text-align:center; color:#dc2626; font-weight:bold;">${bIssue}</td>
        <td style="text-align:center;"><b>${bRate}%</b></td>
        <td style="text-align:center;">${statusBadge}</td>
      </tr>
    `;
  });

  // สร้างตารางรายการข้อบกพร่อง / แผนซ่อมบำรุง
  let defectHtml = '';
  if (issueAssets.length === 0) {
    defectHtml = `
      <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:14px; color:#166534; font-size:13px; margin-bottom:16px;">
        ✅ <b>ผลการประเมินความปลอดภัย:</b> ไม่พบอุปกรณ์ที่มีข้อบกพร่องหรือชำรุดในงวดนี้ อุปกรณ์ทั้งหมดที่ได้รับการตรวจเช็กอยู่ในเกณฑ์พร้อมใช้งาน 100% ตามมาตรฐาน HA ENV
      </div>
    `;
  } else {
    defectHtml = `
      <table class="report-table">
        <thead>
          <tr style="background:#fee2e2;">
            <th style="width:40px; text-align:center;">ที่</th>
            <th style="width:110px;">รหัสอุปกรณ์</th>
            <th style="width:140px;">ประเภท</th>
            <th>ตำแหน่งติดตั้ง / อาคาร</th>
            <th>อาการผิดปกติที่ตรวจพบ</th>
            <th style="width:120px;">ผู้ตรวจ</th>
            <th style="width:150px;">มาตรการแก้ไขเร่งด่วน</th>
            <th style="width:80px; text-align:center;">ระดับความเร่งด่วน</th>
          </tr>
        </thead>
        <tbody>
    `;

    issueAssets.forEach((item, index) => {
      const lastLog = inspectionLogs.find(l => l.assetId === item.assetId);
      const note = lastLog?.notes || "ตรวจพบความผิดปกติระหว่างการตรวจเช็ก";

      let actionPlan = "ส่งซ่อมบำรุง / ตรวจสภาพโดยช่างผู้ชำนาญการ";
      if (item.assetId.startsWith('PYH-FE')) {
        if (note.includes('แรงดัน') || note.includes('ขีดเขียว')) {
          actionPlan = "ส่งอัดบรรจุผงเคมี/ก๊าซใหม่ทันที และตรวจเช็กซีลวาล์ว";
        } else if (note.includes('สลัก') || note.includes('ซีล')) {
          actionPlan = "เปลี่ยนสลักนิรภัย (Safety Pin) และซีลล็อคใหม่";
        } else {
          actionPlan = "จัดหาถังสำรองเปลี่ยนทดแทน และส่งซ่อมบำรุง";
        }
      } else {
        actionPlan = "เปลี่ยนแบตเตอรี่สำรอง / หลอด LED โคมไฟฉุกเฉิน";
      }

      defectHtml += `
        <tr>
          <td style="text-align:center;">${index + 1}</td>
          <td><b style="color:#b91c1c;">${item.assetId}</b></td>
          <td>${cleanAssetType(item.type)}</td>
          <td><b>${item.building}</b><br><span style="color:#64748b; font-size:11.5px;">${item.location}</span></td>
          <td style="color:#b91c1c;">${note}</td>
          <td>${getCleanName(item.lastInspector) || '-'}</td>
          <td style="color:#00695c; font-weight:600;">${actionPlan}</td>
          <td style="text-align:center;"><span class="badge badge-issue" style="background:#ef4444; color:white;">เร่งด่วน</span></td>
        </tr>
      `;
    });

    defectHtml += `
        </tbody>
      </table>
    `;
  }

  // สร้างตารางรายการอุปกรณ์ทั้งหมด (Full Checklist Register)
  let allItemsRowsHtml = '';
  targetAssets.forEach((a, i) => {
    const isReady = a.status === 'READY';
    let checkedDate = 'ยังไม่ได้ตรวจ';
    if (a.lastChecked) {
      const dt = new Date(a.lastChecked);
      if (!isNaN(dt.getTime())) {
        checkedDate = dt.toLocaleDateString('th-TH');
      } else {
        checkedDate = new Date().toLocaleDateString('th-TH');
      }
    }
    const inspectorName = getCleanName(a.lastInspector) || '-';
    const cleanedType = cleanAssetType(a.type);
    allItemsRowsHtml += `
      <tr>
        <td style="text-align:center; font-size:11px;">${i + 1}</td>
        <td><b>${a.assetId}</b></td>
        <td>${cleanedType}</td>
        <td>${a.building} - ${a.location}</td>
        <td style="text-align:center; font-size:11.5px; font-weight:700; color:${isReady ? '#16a34a' : '#dc2626'};">
          ${isReady ? 'พร้อมใช้งาน' : 'ชำรุด/แจ้งซ่อม'}
        </td>
        <td style="text-align:center; font-size:11.5px;">${checkedDate}</td>
        <td style="font-size:11.5px;">${inspectorName}</td>
      </tr>
    `;
  });

  const fullReportHtml = `
    <div class="report-paper">
      
      <!-- ส่วนหัวเอกสารราชการ -->
      <div class="report-header-banner">
        <div>
          <div style="font-size:12px; font-weight:700; color:#00695c; letter-spacing:0.5px; text-transform:uppercase;">
            Pyuha Kiri Hospital • Environmental and Safety Committee (HA ENV)
          </div>
          <h2 class="report-title">รายงานสรุปผลการตรวจสอบความพร้อมใช้งานระบบความปลอดภัยและอัคคีภัย</h2>
          <p class="report-subtitle">
            ถังดับเพลิงมือถือ (Fire Extinguishers) และโคมไฟส่องสว่างฉุกเฉิน (Emergency Lights) • ประจำงวด ${period}
          </p>
        </div>
        <div style="text-align:right;">
          <span style="display:inline-block; border:1px solid #cbd5e1; padding:4px 8px; border-radius:4px; font-size:11px; background:#f8fafc; font-weight:600;">
            เลขที่เอกสาร: PYH-ENV-${new Date().getFullYear() + 543}-${String(new Date().getMonth() + 1).padStart(2, '0')}
          </span>
          <div style="font-size:11.5px; color:#64748b; margin-top:4px;">
            วันที่ออกรายงาน: ${reportDate}
          </div>
        </div>
      </div>

      <!-- กล่องข้อมูลการตรวจสอบ (แสดงบนหน้าจอ แต่ซ่อนอัตโนมัติเวลาสั่งพิมพ์เพื่อประหยัดพื้นที่กระดาษ) -->
      <div class="report-meta-box no-print">
        <div><b>📅 รอบการตรวจสอบ:</b> ประจำงวด ${period}</div>
        <div><b>🏢 ขอบเขตการประเมิน:</b> ${filterName}</div>
        <div><b>👤 ผู้จัดทำรายงาน:</b> ${author}</div>
        <div><b>🎯 เรียนเสนอ:</b> ${approver}</div>
        <div style="grid-column: 1 / -1; border-top: 1px dashed #cbd5e1; padding-top: 6px; color:#475569;">
          <b>📜 อ้างอิงเกณฑ์มาตรฐาน:</b> มาตรฐานโรงพยาบาลและบริการสุขภาพ (HA) ตอนที่ II ระบบกายภาพและความปลอดภัย (ENV 1-4), NFPA 10 (Portable Fire Extinguishers) และมาตรฐาน วสท. 022002-22
        </div>
      </div>

      <!-- สรุปดัชนีชี้วัดหลัก (Executive KPIs) -->
      <div class="report-section-title">1. สรุปดัชนีชี้วัดความพร้อมใช้งานตามมาตรฐาน HA (Executive Safety KPIs)</div>
      <div class="report-summary-cards">
        <div class="report-stat">
          <span class="report-stat-num" style="color:#0f172a;">${totalAssets}</span>
          <span class="report-stat-label">อุปกรณ์เป้าหมายทั้งหมด (จุด)</span>
        </div>
        <div class="report-stat">
          <span class="report-stat-num" style="color:#0284c7;">${coverageRate}%</span>
          <span class="report-stat-label">อัตราการตรวจเช็ก (${checkedCount}/${totalAssets})</span>
        </div>
        <div class="report-stat">
          <span class="report-stat-num" style="color:#16a34a;">${readinessRate}%</span>
          <span class="report-stat-label">อัตราความพร้อมใช้งาน (${readyCount}/${checkedCount || totalAssets})</span>
        </div>
        <div class="report-stat" style="background:${issueCount > 0 ? '#fef2f2' : '#f0fdf4'};">
          <span class="report-stat-num" style="color:${issueCount > 0 ? '#dc2626' : '#16a34a'};">${issueCount}</span>
          <span class="report-stat-label">รายการชำรุด / ต้องซ่อมบำรุง</span>
        </div>
      </div>

      <!-- แยกประเภทอุปกรณ์ -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
        <div style="border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px; background:#f8fafc;">
          <b style="color:#00695c; font-size:13px;">🧯 ระบบถังดับเพลิง (Fire Extinguishers)</b>
          <div style="display:flex; justify-content:space-between; margin-top:6px; font-size:12px;">
            <span>เป้าหมายทั้งหมด: <b>${feAssets.length} จุด</b></span>
            <span>ตรวจแล้ว: <b>${feChecked}</b></span>
            <span>พร้อมใช้งาน: <b style="color:#15803d;">${feReady}</b></span>
            <span>ชำรุด: <b style="color:#dc2626;">${feIssue}</b></span>
          </div>
        </div>
        <div style="border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px; background:#f8fafc;">
          <b style="color:#0284c7; font-size:13px;">💡 ระบบไฟฉุกเฉิน (Emergency Lights)</b>
          <div style="display:flex; justify-content:space-between; margin-top:6px; font-size:12px;">
            <span>เป้าหมายทั้งหมด: <b>${emAssets.length} จุด</b></span>
            <span>ตรวจแล้ว: <b>${emChecked}</b></span>
            <span>พร้อมใช้งาน: <b style="color:#15803d;">${emReady}</b></span>
            <span>ชำรุด: <b style="color:#dc2626;">${emIssue}</b></span>
          </div>
        </div>
      </div>

      <!-- ตารางวิเคราะห์รายอาคาร -->
      <div class="report-section-title">2. ตารางสรุปผลการตรวจสอบจำแนกตามอาคาร (Building Compliance Summary)</div>
      <table class="report-table">
        <thead>
          <tr>
            <th style="width:40px; text-align:center;">ลำดับ</th>
            <th>อาคาร / พื้นที่บริการ</th>
            <th style="width:70px; text-align:center;">ทั้งหมด</th>
            <th style="width:70px; text-align:center;">ตรวจแล้ว</th>
            <th style="width:70px; text-align:center;">ปกติ</th>
            <th style="width:70px; text-align:center;">ชำรุด</th>
            <th style="width:90px; text-align:center;">ความพร้อม (%)</th>
            <th style="width:140px; text-align:center;">สถานะประเมิน</th>
          </tr>
        </thead>
        <tbody>
          ${buildingRowsHtml}
        </tbody>
      </table>

      <!-- รายการข้อบกพร่องและแผนแก้ไข -->
      <div class="report-section-title">3. รายการข้อบกพร่องและแผนปฏิบัติการแก้ไขเร่งด่วน (Defect Log & Action Required)</div>
      ${defectHtml}

      <!-- สรุปเชิงนโยบายและข้อเสนอแนะ -->
      <div class="report-section-title">4. ข้อคิดเห็นและข้อเสนอแนะของคณะทำงานความปลอดภัย (ENV Committee Remarks)</div>
      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:12px 14px; font-size:12.5px; line-height:1.6; color:#334155;">
        <p style="margin:0 0 6px 0;">
          1. <b>ภาพรวมความพร้อมใช้งาน:</b> อุปกรณ์ความปลอดภัยในส่วนหอผู้ป่วยและแผนกบริการวิกฤต (ICU, ER, ห้องผ่าตัด) มีความพร้อมใช้งานอยู่ในเกณฑ์ปลอดภัยสูง สอดคล้องกับข้อกำหนดการรับรองมาตรฐาน HA
        </p>
        <p style="margin:0 0 6px 0;">
          2. <b>มาตรการแก้ไขเร่งด่วน:</b> สำหรับรายการที่พบข้อบกพร่อง (${issueCount} รายการ) งานอาคารสถานที่ได้ดำเนินการนำถังดับเพลิงสำรองไปติดตั้งสับเปลี่ยนในจุดที่ชำรุดเรียบร้อยแล้ว เพื่อมิให้เกิดช่องว่างความเสี่ยงในระหว่างรอส่งอัดบรรจุสารดับเพลิงและเปลี่ยนแบตเตอรี่
        </p>
        <p style="margin:0;">
          3. <b>การบริหารจัดการงบประมาณ:</b> ขอเสนอขออนุมัติงบประมาณหมวดค่าบำรุงรักษาและซ่อมแซมครุภัณฑ์ ประจำปีงบประมาณ เพื่อดำเนินการจัดซื้อแบตเตอรี่สำรองและค่าบริการอัดบรรจุสารเคมีดับเพลิงตามตารางข้างต้น
        </p>
      </div>

      <!-- 5. ส่วนลงนามผู้ตรวจเช็ก ผู้ตรวจสอบ และผู้อนุมัติสั่งการ (ต่อท้ายข้อ 4 ทันที) -->
      <div class="report-section-title" style="margin-top:16px;">5. การรับรองผลการตรวจสอบและคำสั่งการผู้บริหาร (Sign-Off & Approval)</div>
      <div style="margin-top:8px; padding:12px 14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; break-inside:avoid;">
        <table style="width:100%; border-collapse:collapse; border:none;">
          <tr>
            <!-- ลำดับที่ 1: ผู้จัดทำรายงาน / ช่างผู้ตรวจ -->
            <td style="width:33.33%; text-align:center; vertical-align:top; padding:0 8px;">
              <p style="margin:0 0 6px 0; font-size:12px; color:#334155; font-weight:600;">ผู้จัดทำรายงาน / ผู้ตรวจเช็ก</p>
              
              <!-- ลายเซ็น/สถานะการลงนามของช่างผู้ตรวจ -->
              <div id="tech-cert-container" style="margin-bottom:4px; min-height:26px;">
                <!-- จะถูกเติมแบบไดนามิกโดย renderTechCertificationUI() -->
              </div>

              <div style="border-bottom:1px dotted #64748b; width:75%; margin:0 auto 4px auto;"></div>
              <p style="margin:0; font-size:12px; font-weight:700; color:#0f172a;" id="report-display-tech-name">( ${authorName} )</p>
              <p style="margin:2px 0 0 0; font-size:11px; color:#64748b;" id="report-display-tech-pos">${authorPos}</p>
              <p style="margin:3px 0 0 0; font-size:11px; color:#64748b;" id="tech-sign-date-str">วันที่ ........ / ........ / ................</p>
            </td>

            <!-- ลำดับที่ 2: ผู้ตรวจสอบ / หัวหน้ากลุ่มงาน (Chef Inspector)  -->
            <td style="width:33.33%; text-align:center; vertical-align:top; padding:0 8px;">
              <p style="margin:0 0 6px 0; font-size:12px; color:#334155; font-weight:600;">ผู้ตรวจสอบ</p>

              <!-- ลายเซ็น/สถานะการลงนามของผู้ตรวจสอบ -->
              <div id="chef-cert-container" style="margin-bottom:4px; min-height:26px;">
                <!-- จะถูกเติมแบบไดนามิกโดย renderChefCertificationUI() -->
              </div>

              <div style="border-bottom:1px dotted #64748b; width:75%; margin:0 auto 4px auto;"></div>
              <p style="margin:0; font-size:12px; font-weight:700; color:#0f172a;" id="report-display-chef-name">( ${reviewerName} )</p>
              <p style="margin:2px 0 0 0; font-size:11px; color:#64748b;" id="report-display-chef-pos">${reviewerPos}</p>
              <p style="margin:3px 0 0 0; font-size:11px; color:#64748b;" id="chef-sign-date-str">วันที่ ........ / ........ / ................</p>
            </td>

            <!-- ลำดับที่ 3: ผู้อนุมัติ / ผู้อำนวยการโรงพยาบาล -->
            <td style="width:33.33%; text-align:center; vertical-align:top; padding:0 8px;">
              <p style="margin:0 0 4px 0; font-size:12px; color:#334155; font-weight:600;">คำสั่งการ / ผู้อนุมัติ</p>
              
              <!-- ปุ่มกดเลือกคำสั่งการบนหน้าจอ (สำหรับผู้บริหาร executive หรือ admin) -->
              ${((_appContext.getCurrentUserRole()) === 'executive' || (_appContext.getCurrentUserRole()) === 'admin') ? `
                <div class="no-print" style="display:inline-flex; gap:6px; margin-bottom:4px; background:#f1f5f9; padding:2px 6px; border-radius:9999px; border:1px solid #cbd5e1;">
                  <label style="display:flex; align-items:center; gap:4px; font-size:11px; font-weight:600; cursor:pointer; padding:2px 8px; border-radius:9999px; user-select:none; margin:0;"
                    id="lbl-appr-ack" onclick="setExecutiveApproval('acknowledge')">
                    <input type="radio" name="exec-decision" id="rad-appr-ack" value="acknowledge" style="cursor:pointer; accent-color:#0284c7; margin:0;" onchange="setExecutiveApproval('acknowledge')">
                    <span>รับทราบ</span>
                  </label>
                  <label style="display:flex; align-items:center; gap:4px; font-size:11px; font-weight:600; cursor:pointer; padding:2px 8px; border-radius:9999px; user-select:none; margin:0;"
                    id="lbl-appr-repair" onclick="setExecutiveApproval('repair')">
                    <input type="radio" name="exec-decision" id="rad-appr-repair" value="repair" style="cursor:pointer; accent-color:#059669; margin:0;" onchange="setExecutiveApproval('repair')">
                    <span>อนุมัติซ่อมแซม</span>
                  </label>
                </div>
              ` : `
                <div class="no-print" style="display:inline-flex; gap:8px; margin-bottom:4px; padding:2px 8px; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:6px; font-size:11px; color:#64748b;">
                  <span id="screen-view-ack">[ &nbsp; ] รับทราบ</span>
                  <span id="screen-view-repair">[ &nbsp; ] อนุมัติซ่อมแซม</span>
                </div>
              `}

              <!-- การแสดงผลคำสั่งการเวลาสั่งพิมพ์กระดาษ (Print View: ติ๊กถูกอัตโนมัติตามที่สั่งการ) -->
              <div class="only-print" style="margin-bottom:4px; font-size:11.5px; color:#1e293b;">
                <span style="margin-right:10px;" id="print-appr-ack">[ &nbsp; ] รับทราบ</span>
                <span id="print-appr-repair">[ &nbsp; ] อนุมัติซ่อมแซม</span>
              </div>

              <!-- ลายเซ็น/สถานะการลงนามคำสั่งการของผู้บริหาร -->
              <div id="exec-cert-container" style="margin-bottom:4px; min-height:26px;">
                <!-- จะถูกเติมแบบไดนามิกโดย renderExecutiveCertificationUI() -->
              </div>

              <div style="border-bottom:1px dotted #64748b; width:75%; margin:0 auto 4px auto;"></div>
              <p style="margin:0; font-size:12px; font-weight:700; color:#0f172a;" id="report-display-exec-name">( ${approverName} )</p>
              <p style="margin:2px 0 0 0; font-size:11px; color:#64748b;">${approverPos}</p>
              <p style="margin:3px 0 0 0; font-size:11px; color:#64748b;" id="exec-approval-date-str">วันที่ ........ / ........ / ................</p>
            </td>
          </tr>
        </table>
      </div>

      <!-- เอกสารแนบท้าย: บัญชีทะเบียนการตรวจสอบอุปกรณ์ทั้งหมดในงวด (ถ้ามี จะขึ้นหน้าใหม่ต่อจากส่วนลงนาม) -->
      ${includeAllItems ? `
        <div class="page-break"></div>
        <div class="report-section-title" style="margin-top:30px;">
          เอกสารแนบท้าย: บัญชีทะเบียนการตรวจสอบอุปกรณ์ทั้งหมดในงวด (${totalAssets} จุด)
        </div>
        <p style="font-size:12px; color:#475569; margin:0 0 10px 0;">
          รายละเอียดผลการประเมินสภาพความพร้อมใช้งานถังดับเพลิงและโคมไฟฉุกเฉินรายจุด ตามเกณฑ์มาตรฐาน HA (Part II: ENV)
        </p>
        <div class="report-table-scroll">
          <table class="report-table" style="margin:0;">
            <thead>
              <tr style="position:sticky; top:0; background:#f1f5f9; z-index:2;">
                <th style="width:35px; text-align:center;">#</th>
                <th style="width:110px;">รหัสอุปกรณ์</th>
                <th>ประเภท</th>
                <th>อาคาร / จุดติดตั้ง</th>
                <th style="width:90px; text-align:center;">สถานะ</th>
                <th style="width:90px; text-align:center;">วันที่ตรวจ</th>
                <th style="width:110px;">ผู้ตรวจ</th>
              </tr>
            </thead>
            <tbody>
              ${allItemsRowsHtml}
            </tbody>
          </table>
        </div>
      ` : `
        <div style="font-size:12px; color:#64748b; margin-top:20px; padding:10px 14px; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:6px; font-style:italic;">
          📌 <b>หมายเหตุ:</b> บัญชีทะเบียนผลการตรวจอุปกรณ์รายจุดครบทั้ง ${totalAssets} จุด ถูกบันทึกและจัดเก็บไว้ในฐานข้อมูลดิจิทัล (สามารถเลือกติ๊ก 'รวมบัญชีทะเบียนอุปกรณ์ทั้งหมด' ด้านบน หากต้องการพิมพ์เอกสารแนบท้ายฉบับสมบูรณ์)
        </div>
      `}

    </div>
  `;

  container.innerHTML = fullReportHtml;
  window.restoreExecutiveApproval();
  if (typeof window.renderTechCertificationUI === 'function') {
    window.renderTechCertificationUI();
  }
  if (typeof window.renderChefCertificationUI === 'function') {
    window.renderChefCertificationUI();
  }
  if (typeof window.renderExecutiveCertificationUI === 'function') {
    window.renderExecutiveCertificationUI();
  }
  container.scrollIntoView({ behavior: 'smooth' });
};

window.simulateFullInspection = async function () {
  if ((_appContext.getCurrentUserRole()) === 'guest' || !(_appContext.getCurrentUserRole())) {
    alert("🔒 โหมดผู้เยี่ยมชม (Guest) ดูข้อมูลได้อย่างเดียวเท่านั้น\nกรุณาเข้าสู่ระบบด้วยบัญชีเจ้าหน้าที่เพื่อดำเนินการนี้");
    return;
  }
  if (!(_appContext.getAssetsList()) || (_appContext.getAssetsList()).length === 0) {
    alert("ไม่พบข้อมูลอุปกรณ์ในระบบ กำลังโหลดข้อมูลเริ่มต้น...");
    initAssets();
    return;
  }

  // กำหนดช่วงวันตรวจจำลอง: 19 - 22 ตุลาคม 2569 (ค.ศ. 2026)
  const inspectionDays = [19, 20, 21, 22];
  const officer = getCleanName((_appContext.getCurrentOfficer())) || "นายสุวิทย์ พวงสมบัติ";

  // สร้าง simulated logs ใหม่
  const simLogs = [];

  (_appContext.getAssetsList()).forEach((asset, idx) => {
    let status = "READY";
    let notes = "ตรวจเช็กสภาพสมบูรณ์ แรงดันปกติ สลักนิรภัยแน่นหนา ทางเข้าถึงสะดวก พร้อมใช้งาน 100%";
    let details = {};

    const isFE = asset.assetId.startsWith('PYH-FE') || asset.type.includes('ถังดับเพลิง');

    // สุ่มวันตรวจกระจายในช่วง 19-22 ตุลาคม 2569
    const day = inspectionDays[idx % inspectionDays.length];
    const hour = 9 + (idx % 7); // 09:00 - 15:00 น.
    const minute = (idx * 13) % 60;
    // ค.ศ. 2026 คือ พ.ศ. 2569, เดือน 9 คือ ตุลาคม (0-indexed)
    const checkDate = new Date(2026, 9, day, hour, minute, 0);
    const checkIso = checkDate.toISOString();
    const checkStr = checkDate.toLocaleString('th-TH');

    // ตรวจผ่านพร้อมใช้งานสมบูรณ์ 100% ทุกจุด
    if (isFE) {
      details = { body: "PASS", pressure: "PASS", access: "PASS" };
    } else {
      details = { light: "PASS", test: "PASS", plug: "PASS" };
    }

    asset.status = status;
    asset.lastChecked = checkIso;
    asset.lastInspector = officer;

    simLogs.push({
      id: `SIM_LOG_${checkDate.getTime()}_${idx}`,
      assetId: asset.assetId,
      inspector: officer,
      status: status,
      details: details,
      notes: notes,
      photoURL: "",
      timestampStr: checkStr,
      timestampISO: checkIso
    });
  });

  inspectionLogs = simLogs;
  storageService.set('pyh_assets_data', (_appContext.getAssetsList()));
  storageService.set('pyh_inspection_logs', inspectionLogs);

  // ปรับบันทึกข้อความราชการให้ลงวันที่และช่วงตรวจ ตุลาคม 2569
  try {
    let memoData = storageService.get('pyh_custom_memo_data');
    if (memoData) {
      memoData = typeof memoData === 'string' ? JSON.parse(memoData) : memoData;
    } else {
      memoData = {};
    }
    memoData.docDate = "๒๔   ตุลาคม   ๒๕๖๙";
    memoData.dept = "กลุ่มงานบริหารทั่วไป โรงพยาบาลพยุหะคีรี";
    memoData.authorName = "นายพิรุฬห์ บุญเพ็ชร์";
    memoData.authorPos = "พนักงานทั่วไป";
    memoData.subject = "รายงานผลการตรวจสอบความพร้อมอุปกรณ์ความปลอดภัยอัคคีภัยและโคมไฟฉุกเฉิน ประจำเดือนตุลาคม ๒๕๖๙";
    storageService.set('pyh_custom_memo_data', memoData);
  } catch (e) {
    console.warn("Could not auto-set memoData date", e);
  }

  // ซิงก์ผลการตรวจทั้งหมดขึ้น Firebase Cloud ทันที (หากต่อเน็ตและเชื่อมต่อ Firebase สำเร็จ)
  let cloudSynced = false;
  if (isFirebaseReady() && db) {
    try {
      const assetPromises = (_appContext.getAssetsList()).map(async (asset) => {
        const docId = asset.firestoreId || asset.assetId.replace(/[^a-zA-Z0-9]/g, '_');
        return setDoc(doc(db, "assets", docId), {
          ...asset,
          status: "READY",
          lastChecked: asset.lastChecked,
          lastInspector: asset.lastInspector
        }, { merge: true });
      });

      const logPromises = simLogs.map(async (log) => {
        return addDoc(collection(db, "inspection_logs"), log);
      });

      await Promise.all([...assetPromises, ...logPromises]);
      cloudSynced = true;
      console.log("🔥 Successfully synced all simulated inspections to Firebase Cloud Firestore!");
    } catch (firebaseErr) {
      console.warn("⚠️ Firebase cloud sync error during simulation:", firebaseErr);
    }
  }

  updateDashboardUI();
  renderMapPins();
  renderHistoryTable();
  window.renderSelectedReport();

  const cloudNotice = cloudSynced ? "\n☁️ บันทึกซิงก์ขึ้นระบบ Firebase Cloud สำเร็จเรียบร้อย!" : "\n💾 บันทึกในระบบเครื่องเรียบร้อย";
  alert(`⚡ จำลองผลการตรวจเช็กประจำเดือนตุลาคม ๒๕๖๙ เสร็จสิ้นครบ 100% (${(_appContext.getAssetsList()).length} จุดตรวจ)\n• ช่วงวันที่ตรวจ: 19 - 22 ตุลาคม 2569\n• ผลการตรวจ: พร้อมใช้งานสมบูรณ์ครบ 100% ทั้งหมด ${(_appContext.getAssetsList()).length} จุด (ไม่มีชำรุด)${cloudNotice}`);
};

window.printExecutiveReport = function () {
  if (!requireLogin('สั่งพิมพ์รายงานสรุปผล')) return;
  const reportContainer = document.getElementById('report-content-body');
  if (!reportContainer || !reportContainer.innerHTML.trim()) {
    window.renderSelectedReport();
  }
  
  // ซ่อนแถบเครื่องมือด้วย JavaScript โดยตรงเพื่อหลีกเลี่ยงบั๊กจาก CSS Media Query
  const toolbar = document.getElementById('executive-report-toolbar');
  const header = document.querySelector('header');
  const userBar = document.querySelector('.user-bar');
  const navTabs = document.querySelector('.nav-tabs');
  
  // จำค่าเดิมไว้
  const origToolbarDisplay = toolbar ? toolbar.style.getPropertyValue('display') : '';
  const origHeaderDisplay = header ? header.style.getPropertyValue('display') : '';
  const origUserBarDisplay = userBar ? userBar.style.getPropertyValue('display') : '';
  const origNavTabsDisplay = navTabs ? navTabs.style.getPropertyValue('display') : '';

  if (toolbar) toolbar.style.setProperty('display', 'none', 'important');
  if (header) header.style.setProperty('display', 'none', 'important');
  if (userBar) userBar.style.setProperty('display', 'none', 'important');
  if (navTabs) navTabs.style.setProperty('display', 'none', 'important');

  // ให้เวลาบราวเซอร์อัปเดตหน้าจอก่อนสั่งพิมพ์
  setTimeout(() => {
    window.print();
    
    // คืนค่ากลับหลังพิมพ์เสร็จหรือยกเลิก
    if (toolbar) { if (origToolbarDisplay) toolbar.style.setProperty('display', origToolbarDisplay); else toolbar.style.removeProperty('display'); }
    if (header) { if (origHeaderDisplay) header.style.setProperty('display', origHeaderDisplay); else header.style.removeProperty('display'); }
    if (userBar) { if (origUserBarDisplay) userBar.style.setProperty('display', origUserBarDisplay); else userBar.style.removeProperty('display'); }
    if (navTabs) { if (origNavTabsDisplay) navTabs.style.setProperty('display', origNavTabsDisplay); else navTabs.style.removeProperty('display'); }
  }, 200);
};

window.setExecutiveApproval = async function (decision, syncCloud = true) {
  const radAck = document.getElementById('rad-appr-ack');
  const radRepair = document.getElementById('rad-appr-repair');
  const lblAck = document.getElementById('lbl-appr-ack');
  const lblRepair = document.getElementById('lbl-appr-repair');
  const printAck = document.getElementById('print-appr-ack');
  const printRepair = document.getElementById('print-appr-repair');
  const dateStrEl = document.getElementById('exec-approval-date-str');

  const isAck = (decision === 'acknowledge');

  if (radAck) radAck.checked = isAck;
  if (radRepair) radRepair.checked = !isAck;

  // ปรับสไตล์ปุ่มที่ถูกเลือกบนหน้าจอ
  if (lblAck) {
    if (isAck) {
      lblAck.style.background = '#0284c7';
      lblAck.style.color = '#ffffff';
      lblAck.style.boxShadow = '0 2px 6px rgba(2, 132, 199, 0.35)';
    } else {
      lblAck.style.background = 'transparent';
      lblAck.style.color = '#334155';
      lblAck.style.boxShadow = 'none';
    }
  }

  if (lblRepair) {
    if (!isAck) {
      lblRepair.style.background = '#059669';
      lblRepair.style.color = '#ffffff';
      lblRepair.style.boxShadow = '0 2px 6px rgba(5, 150, 105, 0.35)';
    } else {
      lblRepair.style.background = 'transparent';
      lblRepair.style.color = '#334155';
      lblRepair.style.boxShadow = 'none';
    }
  }

  // อัปเดตข้อความที่จะออกเวลาสั่งพิมพ์ลงกระดาษ A4
  if (printAck) {
    printAck.innerHTML = isAck ? '<b>[ ✓ ] รับทราบ</b>' : '[ &nbsp; ] รับทราบ';
  }
  if (printRepair) {
    printRepair.innerHTML = !isAck ? '<b>[ ✓ ] อนุมัติซ่อมแซม</b>' : '[ &nbsp; ] อนุมัติซ่อมแซม';
  }

  // อัปเดตมุมมองบนหน้าจอสำหรับผู้ใช้ทั่วไปที่ไม่ใช่ผู้บริหาร (Read-only)
  const screenAck = document.getElementById('screen-view-ack');
  const screenRepair = document.getElementById('screen-view-repair');
  if (screenAck) {
    screenAck.innerHTML = isAck ? '<b style="color:#0284c7;">[ ✓ ] รับทราบ</b>' : '[ &nbsp; ] รับทราบ';
  }
  if (screenRepair) {
    screenRepair.innerHTML = !isAck ? '<b style="color:#059669;">[ ✓ ] อนุมัติซ่อมแซม</b>' : '[ &nbsp; ] อนุมัติซ่อมแซม';
  }

  // บันทึกวันที่ปัจจุบัน (รูปแบบทางการ: วันที่ 8 กันยายน พ.ศ. 2569)
  const today = new Date();
  const fullThaiDateStr = formatThaiFullDate(today);
  if (dateStrEl) {
    dateStrEl.innerText = fullThaiDateStr;
  }

  // ลงนามดิจิทัลคำสั่งการของผู้บริหาร (ใช้เฉพาะชื่อ-นามสกุล)
  const approverName = getCleanName(document.getElementById('report-approver-name')?.value.trim() || ((_appContext.getCurrentUserRole()) === 'executive' ? (_appContext.getCurrentOfficer()) : "นางสาวศิริพรรณ ชมพูภู่"));
  const certData = {
    approver: approverName,
    decision: decision,
    decisionLabel: isAck ? 'รับทราบ' : 'อนุมัติซ่อมแซม',
    certifiedAt: today.toISOString(),
    certifiedDateStr: fullThaiDateStr,
    certifiedTimeStr: today.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
  };

  try {
    storageService.set('pyh_executive_decision', JSON.stringify({
      decision: decision,
      savedAt: today.toISOString()
    }));
    storageService.set('pyh_exec_certification', certData);
  } catch (e) { }

  // ซิงก์ขึ้น Firestore กลางทันที เฉพาะเมื่อ syncCloud เป็นจริง และผู้ใช้ได้ล็อกอินมีสิทธิ์เท่านั้น
  const isExecOrAdmin = ((_appContext.getCurrentUserRole()) === 'executive' || (_appContext.getCurrentUserRole()) === 'admin');
  if (syncCloud && isExecOrAdmin && isFirebaseReady() && db && auth && auth.currentUser) {
    try {
      await setDoc(doc(db, "system_state", "report_certifications"), {
        exec_cert: certData,
        exec_decision: { decision: decision, savedAt: today.toISOString() },
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.warn("Firestore sync exec_cert error:", e);
    }
  }

  renderExecutiveCertificationUI();
};

window.revokeExecutiveApproval = async function () {
  if (!confirm("ต้องการยกเลิกการลงนามคำสั่งการของผู้บริหารเพื่อแก้ไขใหม่ใช่ไหม?")) return;
  storageService.remove('pyh_exec_certification');
  storageService.remove('pyh_executive_decision');

  if (isFirebaseReady() && db) {
    try {
      await setDoc(doc(db, "system_state", "report_certifications"), {
        exec_cert: null,
        exec_decision: null,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.warn("Firestore revoke exec_cert error:", e);
    }
  }

  const printAck = document.getElementById('print-appr-ack');
  const printRepair = document.getElementById('print-appr-repair');
  if (printAck) printAck.innerHTML = '[ &nbsp; ] รับทราบ';
  if (printRepair) printRepair.innerHTML = '[ &nbsp; ] อนุมัติซ่อมแซม';
  const screenAck = document.getElementById('screen-view-ack');
  const screenRepair = document.getElementById('screen-view-repair');
  if (screenAck) screenAck.innerHTML = '[ &nbsp; ] รับทราบ';
  if (screenRepair) screenRepair.innerHTML = '[ &nbsp; ] อนุมัติซ่อมแซม';
  const dateStrEl = document.getElementById('exec-approval-date-str');
  if (dateStrEl) dateStrEl.innerText = 'วันที่ ........ / ........ / ................';
  renderExecutiveCertificationUI();
};

window.renderExecutiveCertificationUI = function () {
  const container = document.getElementById('exec-cert-container');
  const nameEl = document.getElementById('report-display-exec-name');
  const dateEl = document.getElementById('exec-approval-date-str');
  if (!container) return;

  let cert = null;
  try {
    const raw = storageService.get('pyh_exec_certification');
    if (raw) cert = JSON.parse(raw);
  } catch (e) { }

  const defaultApprover = getCleanName(document.getElementById('report-approver-name')?.value.trim() || "นางสาวศิริพรรณ ชมพูภู่");
  const canManage = ((_appContext.getCurrentUserRole()) === 'executive' || (_appContext.getCurrentUserRole()) === 'admin');

  if (cert && cert.approver) {
    const cleanName = getCleanName(cert.approver) || defaultApprover;
    if (nameEl) nameEl.innerHTML = `( ${cleanName} )`;
    
    // แปลงวันที่ให้เป็นรูปแบบ "วันที่ 8 กันยายน พ.ศ. 2569" เสมอ
    let displayDate = cert.certifiedDateStr;
    if (!displayDate || displayDate.includes('/')) {
      const dt = cert.certifiedAt ? new Date(cert.certifiedAt) : new Date();
      displayDate = formatThaiFullDate(isNaN(dt.getTime()) ? new Date() : dt);
    }
    if (dateEl) dateEl.innerText = displayDate;

    let sigVisualHtml = '';
    if (cert.signatureImg) {
      sigVisualHtml = `<img src="${cert.signatureImg}" alt="ลายมือชื่อ ผอ." style="max-height:48px; max-width:140px; object-fit:contain; display:block; margin:0 auto;">`;
    } else {
      sigVisualHtml = `
        <span style="font-family:'TH Sarabun New', 'Sarabun', 'Cordia New', sans-serif; font-size:16px; font-weight:700; color:#0f172a; letter-spacing:0.5px; font-style:italic; line-height:1.2;">
          ${cleanName}
        </span>
      `;
    }

    // แสดงเฉพาะลายมือชื่อ/รูปภาพลายเซ็นเหนือเส้นประ
    container.innerHTML = `
      <div style="min-height:36px; display:flex; flex-direction:column; align-items:center; justify-content:flex-end;">
        ${sigVisualHtml}
        ${canManage ? `
          <div class="no-print" style="display:flex; gap:6px; margin-top:2px;">
            <button onclick="openSignatureModal('executive')"
              style="background:none; border:none; color:#0284c7; font-size:9.5px; cursor:pointer; text-decoration:underline; padding:0;">
              (วาด/เปลี่ยนลายเซ็น)
            </button>
            <button onclick="revokeExecutiveApproval()"
              style="background:none; border:none; color:#dc2626; font-size:9.5px; cursor:pointer; text-decoration:underline; padding:0;">
              (ยกเลิก)
            </button>
          </div>
        ` : ''}
      </div>
    `;
  } else {
    if (nameEl) nameEl.innerHTML = `( ${defaultApprover} )`;
    if (canManage) {
      container.innerHTML = `
        <div class="no-print" style="margin-bottom:4px; display:flex; gap:4px; justify-content:center;">
          <button onclick="openSignatureModal('executive')" class="btn-sm"
            style="background:linear-gradient(135deg, #0284c7, #0369a1); color:white; font-size:10.5px; padding:3px 10px; font-weight:700; border:none; border-radius:9999px; cursor:pointer; box-shadow:0 2px 5px rgba(2,132,199,0.25);">
            ✍️ วาดลายเซ็น
          </button>
          <button onclick="setExecutiveApproval('acknowledge')" class="btn-sm"
            style="background:linear-gradient(135deg, #00897b, #004d40); color:white; font-size:10.5px; padding:3px 10px; font-weight:700; border:none; border-radius:9999px; cursor:pointer; box-shadow:0 2px 5px rgba(0,105,92,0.25);">
            ลงนามชื่อ
          </button>
        </div>
        <div class="only-print" style="height:20px;"></div>
      `;
    } else {
      container.innerHTML = `
        <div class="no-print" style="display:inline-block; padding:3px 8px; background:#fffbeb; border:1px dashed #f59e0b; border-radius:6px; font-size:10.5px; color:#b45309;">
          ⏳ รอผู้บริหารลงนามคำสั่งการ
        </div>
        <div class="only-print" style="height:20px;"></div>
      `;
    }
  }
};

// ฟังก์ชันดึงค่าที่เคยเลือกไว้กลับมาแสดง
window.restoreExecutiveApproval = function () {
  try {
    const rawCert = storageService.get('pyh_exec_certification');
    if (rawCert) {
      const data = JSON.parse(rawCert);
      if (data && data.decision) {
        window.setExecutiveApproval(data.decision, false);
        return;
      }
    }
    const raw = storageService.get('pyh_executive_decision');
    if (raw) {
      const data = JSON.parse(raw);
      if (data && data.decision) {
        window.setExecutiveApproval(data.decision, false);
        return;
      }
    }
  } catch (e) { }

  if ((_appContext.getCurrentUserRole()) === 'executive') {
    const hasIssue = (_appContext.getAssetsList()).some(a => a.status === 'ISSUE');
    window.setExecutiveApproval(hasIssue ? 'repair' : 'acknowledge', false);
  } else {
    renderExecutiveCertificationUI();
  }
};

window.autoLoadExecutiveFullReport = function () {
  const reportControlsCard = document.getElementById('report-controls-card');
  const execToolbar = document.getElementById('executive-report-toolbar');

  if (reportControlsCard) reportControlsCard.style.display = 'none';
  if (execToolbar) execToolbar.style.display = 'block';

  if (typeof window.renderSelectedReport === 'function') {
    window.renderSelectedReport();
  }
};

// ==========================================
// 12. การรับรองผลการตรวจเช็กโดยนายช่าง (Digital Technician Certification)
// ==========================================
window.certifyTechnicianInspection = async function () {
  if ((_appContext.getCurrentUserRole()) !== 'inspector' && (_appContext.getCurrentUserRole()) !== 'admin') {
    alert("❌ เฉพาะเจ้าหน้าที่ช่างตรวจเช็กหรือผู้ดูแลระบบเท่านั้นที่สามารถกดรับรองผลตรวจได้");
    return;
  }

  const cleanName = getCleanName((_appContext.getCurrentOfficer())) || "นายสุวิทย์ พวงสมบัติ";
  const now = new Date();
  const fullThaiDateStr = formatThaiFullDate(now);
  const certData = {
    officer: cleanName,
    role: (_appContext.getCurrentUserRole()),
    certifiedAt: now.toISOString(),
    certifiedDateStr: fullThaiDateStr,
    certifiedTimeStr: now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
  };

  storageService.set('pyh_tech_certification', certData);

  // ซิงก์ขึ้น Firestore กลางทันที เพื่อให้อุปกรณ์เครื่องอื่นเห็นตราประทับตรงกัน
  if (isFirebaseReady() && db) {
    try {
      await setDoc(doc(db, "system_state", "report_certifications"), {
        tech_cert: certData,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.warn("Firestore sync tech_cert error:", e);
    }
  }

  alert(`✍️ นายช่าง [${certData.officer}] ได้ลงนามรับรองผลการตรวจเช็กเรียบร้อยแล้ว!\nระบบได้ส่งข้อมูลนี้ไปยังรายงานของผู้บริหารแล้ว`);
  renderTechCertificationUI();
};

window.revokeTechnicianInspection = async function () {
  if (!confirm("ต้องการยกเลิกการลงนามรับรองผลตรวจเพื่อแก้ไขข้อมูลใหม่ใช่ไหม?")) return;
  storageService.remove('pyh_tech_certification');

  if (isFirebaseReady() && db) {
    try {
      await setDoc(doc(db, "system_state", "report_certifications"), {
        tech_cert: null,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.warn("Firestore revoke tech_cert error:", e);
    }
  }

  const dateEl = document.getElementById('tech-sign-date-str');
  if (dateEl) dateEl.innerText = 'วันที่ ........ / ........ / ................';
  renderTechCertificationUI();
};

window.renderTechCertificationUI = function () {
  const container = document.getElementById('tech-cert-container');
  const nameEl = document.getElementById('report-display-tech-name');
  const dateEl = document.getElementById('tech-sign-date-str');
  if (!container) return;

  let cert = null;
  try {
    const raw = storageService.get('pyh_tech_certification');
    if (raw) cert = JSON.parse(raw);
  } catch (e) { }

  const defaultTech = getCleanName(document.getElementById('report-author-name')?.value.trim() || "นายสุวิทย์ พวงสมบัติ");

  if (cert && cert.officer) {
    const cleanName = getCleanName(cert.officer) || defaultTech;
    if (nameEl) nameEl.innerHTML = `( ${cleanName} )`;

    // แปลงวันที่ให้เป็นรูปแบบ "วันที่ 8 กันยายน พ.ศ. 2569" เสมอ
    let displayDate = cert.certifiedDateStr;
    if (!displayDate || displayDate.includes('/')) {
      const dt = cert.certifiedAt ? new Date(cert.certifiedAt) : new Date();
      displayDate = formatThaiFullDate(isNaN(dt.getTime()) ? new Date() : dt);
    }
    if (dateEl) dateEl.innerText = displayDate;

    const canRevoke = ((_appContext.getCurrentUserRole()) === 'inspector' || (_appContext.getCurrentUserRole()) === 'admin');

    let sigVisualHtml = '';
    if (cert.signatureImg) {
      sigVisualHtml = `<img src="${cert.signatureImg}" alt="ลายมือชื่อ" style="max-height:48px; max-width:140px; object-fit:contain; display:block; margin:0 auto;">`;
    } else {
      sigVisualHtml = `
        <span style="font-family:'TH Sarabun New', 'Sarabun', 'Cordia New', sans-serif; font-size:16px; font-weight:700; color:#0f172a; letter-spacing:0.5px; font-style:italic; line-height:1.2;">
          ${cleanName}
        </span>
      `;
    }

    // แสดงเฉพาะลายมือชื่อ/ชื่อผู้ลงนามเหนือเส้นประ เหมือนลงนามในเอกสารราชการจริง (ไม่มีกรอบตราประทับ ไม่มีเวลา)
    container.innerHTML = `
      <div style="min-height:36px; display:flex; flex-direction:column; align-items:center; justify-content:flex-end;">
        ${sigVisualHtml}
        ${canRevoke ? `
          <div class="no-print" style="display:flex; gap:6px; margin-top:2px;">
            <button onclick="openSignatureModal('inspector')"
              style="background:none; border:none; color:#0284c7; font-size:9.5px; cursor:pointer; text-decoration:underline; padding:0;">
              (วาด/เปลี่ยนลายเซ็น)
            </button>
            <button onclick="revokeTechnicianInspection()"
              style="background:none; border:none; color:#dc2626; font-size:9.5px; cursor:pointer; text-decoration:underline; padding:0;">
              (ยกเลิก)
            </button>
          </div>
        ` : ''}
      </div>
    `;
  } else {
    if (nameEl) nameEl.innerHTML = `( ${defaultTech} )`;
    if ((_appContext.getCurrentUserRole()) === 'inspector' || (_appContext.getCurrentUserRole()) === 'admin') {
      container.innerHTML = `
        <div class="no-print" style="margin-bottom:4px; display:flex; gap:4px; justify-content:center;">
          <button onclick="openSignatureModal('inspector')" class="btn-sm"
            style="background:linear-gradient(135deg, #0284c7, #0369a1); color:white; font-size:10.5px; padding:3px 10px; font-weight:700; border:none; border-radius:9999px; cursor:pointer; box-shadow:0 2px 5px rgba(2,132,199,0.25);">
            ✍️ วาดลายเซ็น
          </button>
          <button onclick="certifyTechnicianInspection()" class="btn-sm"
            style="background:linear-gradient(135deg, #00897b, #004d40); color:white; font-size:10.5px; padding:3px 10px; font-weight:700; border:none; border-radius:9999px; cursor:pointer; box-shadow:0 2px 5px rgba(0,105,92,0.25);">
            รับรองชื่อ
          </button>
        </div>
        <div class="only-print" style="height:20px;"></div>
      `;
    } else {
      container.innerHTML = `
        <div class="no-print" style="display:inline-block; padding:3px 8px; background:#fffbeb; border:1px dashed #f59e0b; border-radius:6px; font-size:10.5px; color:#b45309;">
          ⏳ รอช่างเทคนิคลงนามรับรองผล
        </div>
        <div class="only-print" style="height:20px;"></div>
      `;
    }
  }
};

// ==========================================
// 13. การรับรองผลการตรวจสอบโดยหัวหน้าผู้ตรวจสอบ (Digital Reviewer / Chef Inspector Certification)
// ==========================================
window.certifyChefInspection = async function () {
  const isChefOrAdmin = ((_appContext.getCurrentUserRole()) === 'chef_inspector' || (_appContext.getCurrentUserRole()) === 'chef inspector' || (_appContext.getCurrentUserRole()) === 'admin');
  if (!isChefOrAdmin) {
    alert("❌ เฉพาะหัวหน้าผู้ตรวจสอบ (Chef Inspector) หรือผู้ดูแลระบบเท่านั้นที่สามารถกดรับรองผลการตรวจสอบได้");
    return;
  }

  const cleanName = getCleanName((_appContext.getCurrentOfficer())) || "นายคมสันต์ ศรีสิงห์";
  const now = new Date();
  const fullThaiDateStr = formatThaiFullDate(now);
  const certData = {
    officer: cleanName,
    role: (_appContext.getCurrentUserRole()),
    certifiedAt: now.toISOString(),
    certifiedDateStr: fullThaiDateStr,
    certifiedTimeStr: now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
  };

  storageService.set('pyh_chef_certification', certData);

  // ซิงก์ขึ้น Firestore กลางทันที เพื่อให้อุปกรณ์เครื่องอื่นเห็นตราประทับตรงกัน
  if (isFirebaseReady() && db) {
    try {
      await setDoc(doc(db, "system_state", "report_certifications"), {
        chef_cert: certData,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.warn("Firestore sync chef_cert error:", e);
    }
  }

  alert(`✍️ ผู้ตรวจสอบ [${certData.officer}] ได้ลงนามรับรองผลการตรวจสอบเรียบร้อยแล้ว!\nระบบได้ส่งข้อมูลนี้ไปยังรายงานของผู้บริหารแล้ว`);
  renderChefCertificationUI();
};

window.revokeChefInspection = async function () {
  if (!confirm("ต้องการยกเลิกการลงนามรับรองผลการตรวจสอบเพื่อแก้ไขข้อมูลใหม่ใช่ไหม?")) return;
  storageService.remove('pyh_chef_certification');

  if (isFirebaseReady() && db) {
    try {
      await setDoc(doc(db, "system_state", "report_certifications"), {
        chef_cert: null,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.warn("Firestore revoke chef_cert error:", e);
    }
  }

  const dateEl = document.getElementById('chef-sign-date-str');
  if (dateEl) dateEl.innerText = 'วันที่ ........ / ........ / ................';
  renderChefCertificationUI();
};

window.setChefApproval = function(choice) {
  let cert = null;
  try {
    const raw = storageService.get('pyh_chef_certification');
    if (raw) cert = JSON.parse(raw);
  } catch(e) {}

  const prevSig = cert?.signatureImg || null;
  const defaultChef = getCleanName(document.getElementById('report-reviewer-name')?.value.trim() || "นายคมสัน ศรีสิงห์");
  const now = new Date();
  const fullThaiDateStr = formatThaiFullDate(now);

  const certData = {
    officer: cert?.officer || defaultChef,
    role: 'chef_inspector',
    choice: choice, // 'ack' or 'approve'
    signatureImg: prevSig,
    certifiedAt: now.toISOString(),
    certifiedDateStr: fullThaiDateStr,
    certifiedTimeStr: now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
  };

  storageService.set('pyh_chef_certification', certData);
  window.renderChefCertificationUI();
};

window.renderChefCertificationUI = function () {
  const container = document.getElementById('chef-cert-container');
  const memoContainer = document.getElementById('memo-chef-cert-container');
  const nameEl = document.getElementById('report-display-chef-name');
  const dateEl = document.getElementById('chef-sign-date-str');

  let cert = null;
  try {
    const raw = storageService.get('pyh_chef_certification');
    if (raw) cert = JSON.parse(raw);
  } catch (e) { }

  const defaultChef = getCleanName(document.getElementById('report-reviewer-name')?.value.trim() || "นายคมสัน ศรีสิงห์");
  const isChefOrAdmin = ((_appContext.getCurrentUserRole()) === 'chef_inspector' || (_appContext.getCurrentUserRole()) === 'chef inspector' || (_appContext.getCurrentUserRole()) === 'admin');

  // อัปเดตตัวเลือกในกล่องบันทึกข้อความ [ ] โปรดรับทราบ [ ] โปรดพิจารณาอนุมัติ
  const choice = cert?.choice || 'ack';
  const memoAckEl = document.getElementById('memo-chef-opt-ack');
  const memoApproveEl = document.getElementById('memo-chef-opt-approve');
  if (memoAckEl) {
    memoAckEl.innerHTML = (choice === 'ack') ? '<b>[ ✓ ] โปรดรับทราบ</b>' : '[ &nbsp; ] โปรดรับทราบ';
  }
  if (memoApproveEl) {
    memoApproveEl.innerHTML = (choice === 'approve') ? '<b>[ ✓ ] โปรดพิจารณาอนุมัติ</b>' : '[ &nbsp; ] โปรดพิจารณาอนุมัติ';
  }

  const cleanName = cert?.officer ? getCleanName(cert.officer) : defaultChef;

  let sigVisualHtml = '';
  if (cert && cert.signatureImg) {
    sigVisualHtml = `<img src="${cert.signatureImg}" alt="ลายมือชื่อ หน.กลุ่มงาน" style="max-height:48px; max-width:140px; object-fit:contain; display:block; margin:0 auto;">`;
  } else if (cert && cert.officer) {
    sigVisualHtml = `
      <span style="font-family:'TH Sarabun New', 'Sarabun', 'Cordia New', sans-serif; font-size:16px; font-weight:700; color:#0f172a; letter-spacing:0.5px; font-style:italic; line-height:1.2;">
        ${cleanName}
      </span>
    `;
  }

  // เติมลง memoContainer ในบันทึกข้อความ
  if (memoContainer) {
    if (sigVisualHtml) {
      memoContainer.innerHTML = `
        <div style="min-height:36px; display:flex; flex-direction:column; align-items:center; justify-content:flex-end;">
          ${sigVisualHtml}
          ${isChefOrAdmin ? `
            <div class="no-print" style="display:flex; gap:6px; margin-top:2px;">
              <button onclick="openSignatureModal('chef')"
                style="background:none; border:none; color:#4338ca; font-size:9.5px; cursor:pointer; text-decoration:underline; padding:0;">
                (วาด/เปลี่ยนลายเซ็น)
              </button>
              <button onclick="revokeChefInspection()"
                style="background:none; border:none; color:#dc2626; font-size:9.5px; cursor:pointer; text-decoration:underline; padding:0;">
                (ยกเลิก)
              </button>
            </div>
          ` : ''}
        </div>
      `;
    } else {
      memoContainer.innerHTML = `
        <div class="no-print" style="margin-bottom:4px;">
          <button onclick="openSignatureModal('chef')" class="btn-sm"
            style="background:linear-gradient(135deg, #4338ca, #3730a3); color:white; font-size:11px; padding:3px 12px; font-weight:700; border:none; border-radius:9999px; cursor:pointer; box-shadow:0 2px 6px rgba(67,56,202,0.25);">
            ✍️ เซ็นชื่อ หน.กลุ่มงาน
          </button>
        </div>
        <div class="only-print" style="height:20px;"></div>
      `;
    }
  }

  // เติมลง container ของรายงานสถิติละเอียด (Detailed Report)
  if (container) {
    if (nameEl) nameEl.innerHTML = `( ${cleanName} )`;

    let displayDate = cert?.certifiedDateStr;
    if (!displayDate || displayDate.includes('/')) {
      const dt = cert?.certifiedAt ? new Date(cert.certifiedAt) : new Date();
      displayDate = formatThaiFullDate(isNaN(dt.getTime()) ? new Date() : dt);
    }
    if (dateEl) dateEl.innerText = displayDate;

    if (sigVisualHtml) {
      container.innerHTML = `
        <div style="min-height:24px; display:flex; flex-direction:column; align-items:center; justify-content:flex-end;">
          ${sigVisualHtml}
          ${isChefOrAdmin ? `
            <button onclick="revokeChefInspection()" class="no-print"
              style="background:none; border:none; color:#dc2626; font-size:9.5px; cursor:pointer; text-decoration:underline; margin-top:1px; padding:0;">
              (ยกเลิก/ลงนามใหม่)
            </button>
          ` : ''}
        </div>
      `;
    } else {
      if (isChefOrAdmin) {
        container.innerHTML = `
          <div class="no-print" style="margin-bottom:4px;">
            <button onclick="openSignatureModal('chef')" class="btn-sm"
              style="background:linear-gradient(135deg, #4338ca, #3730a3); color:white; font-size:11px; padding:4px 12px; font-weight:700; border:none; border-radius:9999px; cursor:pointer; box-shadow:0 2px 6px rgba(67,56,202,0.25);">
              ✍️ ลงนามรับรองผลตรวจ
            </button>
          </div>
          <div class="only-print" style="height:20px;"></div>
        `;
      } else {
        container.innerHTML = `
          <div class="no-print" style="display:inline-block; padding:3px 8px; background:#fffbeb; border:1px dashed #f59e0b; border-radius:6px; font-size:10.5px; color:#b45309;">
            ⏳ รอผู้ตรวจสอบรับรองผล
          </div>
          <div class="only-print" style="height:20px;"></div>
        `;
      }
    }
  }
};

