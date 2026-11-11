import { storageService } from './js/storage-service.js';
// app.js
// ระบบตรวจสอบความปลอดภัยถังดับเพลิงและไฟฉุกเฉิน โรงพยาบาลพยุหะคีรี (Pyuha Safety System)

import {
  db, storage, auth, isFirebaseReady,
  collection, addDoc, getDocs, doc, setDoc, getDoc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp, ref, uploadBytes, getDownloadURL,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut
} from './firebase-config.js';
import { floorConfigs, getCleanName, cleanAssetType, getAssetDirectUrl, extractAssetIdFromScan } from './js/constants.js';
import { reportBuildingMetadata } from './js/report-constants.js';
import { getSession, setSession, clearSession, updateSessionActivity, initActivityTracker } from './js/auth.js';
import { initGlobalEvents } from './js/events.js';
import { initScannerController } from './js/scanner-controller.js';
import { initRegisterController } from './js/register-controller.js';
import { renderDynamicChecklist, collectDynamicChecklistResults } from './js/checklist-config.js';
import { initOfflineSync, enqueueOfflineInspection, updateNetworkStatusUI } from './js/offline-sync.js';

// ลงทะเบียน Service Worker รองรับการทำงาน Offline PWA
if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('⚡ [PWA] Service Worker registered:', reg.scope))
      .catch((err) => console.warn('⚠️ [PWA] Service Worker registration failed:', err));
  });
}

// เริ่มต้นระบบผูก Event Delegation ส่วนกลาง (กำจัด inline onclick)
initGlobalEvents();

// เริ่มต้นระบบ Offline Sync คิวออฟไลน์ & สถานะเครือข่าย
initOfflineSync({
  isFirebaseReady,
  db,
  storage,
  addDoc,
  collection,
  doc,
  updateDoc,
  serverTimestamp,
  ref,
  uploadBytes,
  getDownloadURL,
  onSyncComplete: () => {
    updateDashboardUI();
    renderMapPins();
    renderHistoryTable();
  }
});

// เริ่มต้นระบบ Scanner
initScannerController({
  onScanned: (id) => handleScanned(id)
});

// ฟังก์ชันแปลงวันที่ให้เป็นรูปแบบภาษาไทยทางการ เช่น "8 กันยายน พ.ศ. 2569"
export function formatThaiFullDate(dateObj = new Date()) {
  const thaiMonths = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
  ];
  const d = dateObj.getDate();
  const m = thaiMonths[dateObj.getMonth()];
  const y = dateObj.getFullYear() + 543;
  return `วันที่ ${d} ${m} พ.ศ. ${y}`;
}
window.formatThaiFullDate = formatThaiFullDate;

// ล้างค่าเก่าใน localStorage ที่อาจมีตำแหน่งติดมาในวงเล็บโดยอัตโนมัติ
try {
  if (storageService.get('pyh_officer')) {
    storageService.set('pyh_officer', getCleanName(storageService.get('pyh_officer')));
  }
  const rawTech = storageService.get('pyh_tech_certification');
  if (rawTech) {
    const obj = JSON.parse(rawTech);
    if (obj && obj.officer) {
      obj.officer = getCleanName(obj.officer);
      storageService.set('pyh_tech_certification', obj);
    }
  }
  const rawChef = storageService.get('pyh_chef_certification');
  if (rawChef) {
    const obj = JSON.parse(rawChef);
    if (obj && obj.officer) {
      obj.officer = getCleanName(obj.officer);
      storageService.set('pyh_chef_certification', obj);
    }
  }

  // ปรับปรุงฐานข้อมูลอุปกรณ์ในเครื่อง (localStorage) ให้เป็นชื่อมาตรฐานใหม่ทันที
  const rawAssets = storageService.get('pyh_assets_data');
  if (rawAssets) {
    const arr = typeof rawAssets === 'string' ? JSON.parse(rawAssets) : rawAssets;
    if (Array.isArray(arr)) {
      let changed = false;
      arr.forEach(a => {
        if (a && a.type) {
          const nType = cleanAssetType(a.type);
          if (nType !== a.type) {
            a.type = nType;
            changed = true;
          }
        }
      });
      if (changed) {
        storageService.set('pyh_assets_data', arr);
      }
    }
  }
} catch (e) { }

let currentOfficer = getCleanName(storageService.get('pyh_officer')) || "นายสุวิทย์ พวงสมบัติ";
let currentUserRole = storageService.get('pyh_role') || "inspector";
let assetsList = [];
let inspectionLogs = [];

// ===================================================
// CUSTOM APP MODAL & ALERT REPLACEMENT
// ===================================================
let _modalResolveCallback = null;

export function showAppModal(title, message, type = 'info') {
  return new Promise((resolve) => {
    _modalResolveCallback = resolve;
    const overlay = document.getElementById('custom-app-modal');
    const titleEl = document.getElementById('app-modal-title');
    const msgEl = document.getElementById('app-modal-msg');
    const iconEl = document.getElementById('app-modal-icon');

    if (!overlay || !titleEl || !msgEl || !iconEl) {
      window._nativeAlert(`${title}\n\n${message}`);
      resolve();
      return;
    }

    titleEl.textContent = title;
    msgEl.textContent = message;

    // ไอคอนตามประเภท
    iconEl.className = `app-modal-icon ${type}`;
    if (type === 'success') iconEl.innerHTML = '✓';
    else if (type === 'error') iconEl.innerHTML = '✕';
    else if (type === 'warning') iconEl.innerHTML = '⚠️';
    else iconEl.innerHTML = 'ℹ️';

    overlay.classList.add('active');
  });
}

window.showAppModal = showAppModal;

window.closeAppModal = function () {
  const overlay = document.getElementById('custom-app-modal');
  if (overlay) overlay.classList.remove('active');
  if (typeof _modalResolveCallback === 'function') {
    const cb = _modalResolveCallback;
    _modalResolveCallback = null;
    cb();
  }
};

// ดักจับการคลิกพื้นที่พื้นหลัง modal เพื่อปิด
document.addEventListener('click', (e) => {
  const overlay = document.getElementById('custom-app-modal');
  if (overlay && e.target === overlay) {
    window.closeAppModal();
  }
});

// บันทึก alert ดั้งเดิม และ Override window.alert ให้แสดง Custom Modal อัตโนมัติ
window._nativeAlert = window.alert;
window.alert = function (message) {
  let title = "แจ้งเตือนจากระบบ";
  let type = "info";
  const str = String(message || '');

  if (str.includes("สำเร็จ") || str.includes("เรียบร้อย") || str.includes("✅") || str.includes("🎉")) {
    title = "ดำเนินการสำเร็จ";
    type = "success";
  } else if (str.includes("ผิดพลาด") || str.includes("ไม่สำเร็จ") || str.includes("ล้มเหลว") || str.includes("❌") || str.includes("ไม่ถูกต้อง")) {
    title = "เกิดข้อผิดพลาด";
    type = "error";
  } else if (str.includes("คำเตือน") || str.includes("⚠️") || str.includes("กรุณา") || str.includes("🔒") || str.includes("⏰")) {
    title = "ข้อความแจ้งเตือน";
    type = "warning";
  }

  return showAppModal(title, str, type);
};

// ฟังก์ชันช่วยจัดการ Inline Form Validation
export function validateForm(formElement) {
  if (!formElement) return true;
  let isValid = true;

  // 1. ล้างสถานะ Error เดิม
  formElement.querySelectorAll('.field-error-msg').forEach(el => el.textContent = '');
  formElement.querySelectorAll('input, select, textarea').forEach(el => {
    el.classList.remove('input-error-border');
  });

  // 2. ตรวจสอบช่องบังคับกรอก (data-required)
  const requiredInputs = formElement.querySelectorAll('[data-required]');
  requiredInputs.forEach(input => {
    const errorEl = document.getElementById(`${input.id}-error`);
    const val = input.value.trim();

    if (!val) {
      isValid = false;
      input.classList.add('input-error-border');
      if (errorEl) errorEl.textContent = input.getAttribute('data-required') || 'กรุณากรอกข้อมูลในช่องนี้';
      return;
    }

    // 3. ตรวจสอบ Pattern เพิ่มเติม (data-pattern)
    const pattern = input.getAttribute('data-pattern');
    if (pattern) {
      const regex = new RegExp(pattern);
      if (!regex.test(val)) {
        isValid = false;
        input.classList.add('input-error-border');
        if (errorEl) {
          errorEl.textContent = input.getAttribute('data-pattern-msg') || 'รูปแบบข้อมูลไม่ถูกต้อง';
        }
      }
    }
  });

  // 4. ลบขอบแดงทันทีเมื่อผู้ใช้เริ่มพิมพ์แก้ไข
  requiredInputs.forEach(input => {
    if (!input.dataset.validationBound) {
      input.dataset.validationBound = 'true';
      input.addEventListener('input', () => {
        input.classList.remove('input-error-border');
        const err = document.getElementById(`${input.id}-error`);
        if (err) err.textContent = '';
      });
    }
  });

  return isValid;
}
window.validateForm = validateForm;

// ประกาศบน window ทันทีตั้งแต่ต้นไฟล์ เพื่อให้โมดูลอื่นเข้าถึงได้ตลอดเวลา
Object.defineProperty(window, 'assetsList', {
  get: () => assetsList,
  set: (val) => { assetsList = val; },
  configurable: true
});
Object.defineProperty(window, 'currentOfficer', {
  get: () => currentOfficer,
  set: (val) => { currentOfficer = val; },
  configurable: true
});
Object.defineProperty(window, 'currentUserRole', {
  get: () => currentUserRole,
  set: (val) => { currentUserRole = val; },
  configurable: true
});
Object.defineProperty(window, 'inspectionLogs', {
  get: () => inspectionLogs,
  set: (val) => { inspectionLogs = val; },
  configurable: true
});

export function renderHistoryTable() {
  const tbody = document.getElementById('history-rows');
  if (!tbody) return;
  tbody.innerHTML = "";

  const filterStatus = document.getElementById('history-filter-status')?.value || '';
  const keyword = (document.getElementById('history-search')?.value || '').toLowerCase();

  let logs = [...inspectionLogs];

  // กรองตามสถานะ
  if (filterStatus) logs = logs.filter(l => l.status === filterStatus);
  // กรองตามรหัสอุปกรณ์
  if (keyword) logs = logs.filter(l => l.assetId?.toLowerCase().includes(keyword));

  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#64748b; padding:20px;">ไม่พบรายการที่ตรงกัน</td></tr>`;
    return;
  }

  logs.slice(0, 100).forEach((log, index) => {
    const isPass = log.status === 'READY';
    const tr = document.createElement('tr');
    const logId = log.id || '';
    tr.innerHTML = `
      <td style="text-align:center; color:#94a3b8; font-size:0.8rem; width:40px;">${index + 1}</td>
      <td style="font-size:0.82rem;">${log.timestampStr || log.timestampISO || '-'}</td>
      <td><b>${log.assetId}</b></td>
      <td style="font-size:0.82rem;">${log.inspector || '-'}</td>
      <td><span class="badge ${isPass ? 'badge-ready' : 'badge-issue'}">${isPass ? '✅ ปกติ' : '⚠️ ชำรุด'}</span></td>
      <td>${log.photoURL ? `<a href="${log.photoURL}" target="_blank"><img class="img-thumb" src="${log.photoURL}" alt="ภาพหลักฐาน"></a>` : '-'}</td>
      <td style="font-size:0.82rem;">${log.notes || '-'}</td>
      <td style="text-align:center;">
        <button type="button" class="btn-sm" style="background:#f0fdfa; color:#0f766e; border:1px solid #99f6e4; border-radius:6px; padding:4px 8px; font-size:0.78rem; cursor:pointer; font-weight:600; display:inline-flex; align-items:center; gap:2px;" onclick="openEditInspectionNoteModal('${logId}')" title="แก้ไขหมายเหตุ">
          ✏️ แก้ไข
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ==========================================
let map = null;
let currentTileLayer = null;
let currentOverlayLayer = null;
let markers = [];
let html5QrCode = null;
let currentMapMode = 'building_er_lower'; // เริ่มต้นที่อาคารอุบัติเหตุชั้นล่าง หรือ campus


// ==========================================
// 0. Auth Guard — บังคับ Login ก่อนเข้าใช้ (เชื่อมต่อโมดูล js/auth.js)
// ==========================================

initActivityTracker(() => {
  console.warn("Session expired! Logging out automatically.");
  currentOfficer = '';
  currentUserRole = '';
  if (typeof applyUserSession === 'function') {
    applyUserSession('ผู้เยี่ยมชม (Guest)', 'guest');
  }
  alert("⏰ เซสชันของคุณหมดอายุเนื่องจากไม่มีการใช้งานเกิน 1 ชั่วโมง\nระบบได้ออกจากระบบเพื่อความปลอดภัย กรุณาเข้าสู่ระบบใหม่อีกครั้ง");
  showLoginScreen();
});

function showLoginScreen() {
  const screen = document.getElementById('login-screen');
  if (screen) screen.style.display = 'flex';
}

function hideLoginScreen() {
  const screen = document.getElementById('login-screen');
  if (screen) {
    screen.style.opacity = '0';
    screen.style.transition = 'opacity 0.4s ease';
    setTimeout(() => screen.style.display = 'none', 400);
  }
}

// เรียกเมื่อ login สำเร็จ — ซ่อน login screen แล้วเริ่ม app
async function onLoginSuccess(officer, role) {
  setSession(officer, role);
  currentOfficer = officer;
  currentUserRole = role;

  if (typeof applyUserSession === 'function') {
    applyUserSession(officer, role);
  } else {
    const nameEl = document.getElementById('display-user-name');
    const roleEl = document.getElementById('display-user-role');
    if (nameEl) nameEl.innerText = officer;
    if (roleEl) roleEl.innerText = role === 'admin' ? 'ผู้ดูแลระบบ (Admin)' :
      role === 'executive' ? 'ผู้บริหาร' : 'เจ้าหน้าที่ผู้ตรวจ';
  }

  hideLoginScreen();
  await initAssets(); // โหลดข้อมูลหลัง login เท่านั้น

  // หากมีรายการที่ตั้งใจจะตรวจค้างไว้ (Pending Inspect Asset) ให้พาเข้าแบบฟอร์มตรวจต่อทันที
  if (window._pendingInspectAssetId) {
    const target = window._pendingInspectAssetId;
    window._pendingInspectAssetId = null;
    setTimeout(() => {
      window.openInspectionForm(target);
    }, 250);
  }
}

// ฟังก์ชัน login จากหน้า Login Screen (ไม่ใช่ modal)
window.loginScreenSubmit = async function () {
  const emailInput = document.getElementById('ls-email');
  const pwdInput = document.getElementById('ls-pwd');
  const errBox = document.getElementById('login-screen-error');
  const btn = document.getElementById('ls-submit-btn');
  const email = emailInput ? emailInput.value.trim() : '';
  const pwd = pwdInput ? pwdInput.value : '';

  if (!email || !pwd) {
    if (errBox) { errBox.textContent = 'กรุณากรอกอีเมลและรหัสผ่าน'; errBox.style.display = 'block'; }
    return;
  }
  if (errBox) errBox.style.display = 'none';
  if (btn) { btn.textContent = 'กำลังเข้าสู่ระบบ...'; btn.disabled = true; }

  // โหลด users จาก Firestore ก่อนเสมอ
  const users = await loadUsersFromFirestore();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());

  if (user) {
    if (user.password !== pwd) {
      if (errBox) { errBox.textContent = '❌ รหัสผ่านไม่ถูกต้อง'; errBox.style.display = 'block'; }
      if (btn) { btn.textContent = '🔑 เข้าสู่ระบบ'; btn.disabled = false; }
      return;
    }
    if (!user.verified) {
      if (errBox) { errBox.textContent = '❌ บัญชียังไม่ได้รับการยืนยันจาก Admin'; errBox.style.display = 'block'; }
      if (btn) { btn.textContent = '🔑 เข้าสู่ระบบ'; btn.disabled = false; }
      return;
    }
    const officer = user.name + ' (' + user.dept + ')';
    await onLoginSuccess(officer, user.role);
    if (emailInput) emailInput.value = '';
    if (pwdInput) pwdInput.value = '';
    return;
  }

  // ถ้าไม่มีใน local ลองผ่าน Firebase Auth
  if (isFirebaseReady() && auth) {
    try {
      const cred = await signInWithEmailAndPassword(auth, email, pwd);
      const officer = cred.user.email;
      await onLoginSuccess(officer, 'inspector');
      if (emailInput) emailInput.value = '';
      if (pwdInput) pwdInput.value = '';
    } catch (err) {
      const msg = err.code === 'auth/invalid-credential' ? '❌ อีเมลหรือรหัสผ่านไม่ถูกต้อง' : '❌ ' + err.message;
      if (errBox) { errBox.textContent = msg; errBox.style.display = 'block'; }
      if (btn) { btn.textContent = '🔑 เข้าสู่ระบบ'; btn.disabled = false; }
    }
    return;
  }

  if (errBox) { errBox.textContent = '❌ ไม่พบบัญชีผู้ใช้นี้ในระบบ'; errBox.style.display = 'block'; }
  if (btn) { btn.textContent = '🔑 เข้าสู่ระบบ'; btn.disabled = false; }
};

// กด Enter ใน input ก็ submit ได้
document.addEventListener('DOMContentLoaded', () => {
  ['ls-email', 'ls-pwd'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') window.loginScreenSubmit(); });
  });

  // โหมด Guest — เปิดให้ดูได้ทันทีโดยไม่ต้อง login
  // ถ้ามี session เดิมอยู่ ให้ใช้ต่อ (ไม่ต้องพิมพ์ใหม่แม้จะกด F5)
  const session = getSession();
  if (session && session.officer) {
    currentOfficer = session.officer;
    currentUserRole = session.role;
    applyUserSession(session.officer, session.role);
  } else {
    // Guest — กำหนดสิทธิ์และซ่อนปุ่มการกระทำทั้งหมด
    currentOfficer = '';
    currentUserRole = 'guest';
    applyUserSession('ผู้เยี่ยมชม (Guest)', 'guest');
  }

  // โหลดข้อมูลและแสดงแอปทันที (ไม่บังคับ login)
  initAssets();

  // เรนเดอร์คู่มือขั้นตอนการตรวจ
  if (typeof window.renderInspectionGuideUI === 'function') {
    window.renderInspectionGuideUI();
  }

  // โหลดคู่มือฉบับอัปเดตจาก Firestore (ถ้ามี)
  if (isFirebaseReady() && db) {
    try {
      getDoc(doc(db, "system_configs", "inspection_guide")).then(docSnap => {
        if (docSnap.exists()) {
          const cloudGuide = docSnap.data();
          if (cloudGuide && cloudGuide.feSteps && cloudGuide.emSteps) {
            storageService.set('pyh_inspection_guide', cloudGuide);
            if (typeof window.renderInspectionGuideUI === 'function') {
              window.renderInspectionGuideUI();
            }
          }
        }
      }).catch(() => {});
    } catch (e) {}
  }
});

// ออกจากระบบ — ล้าง session แล้วแสดงหน้า Login ใหม่
window.logoutUser = async function () {
  if (!confirm('ต้องการออกจากระบบใช่ไหม?')) return;
  clearSession();
  currentOfficer = '';
  currentUserRole = '';
  if (isFirebaseReady() && auth) {
    try { await signOut(auth); } catch (e) { }
  }
  // กลับเป็น Guest Mode อย่างสมบูรณ์
  if (typeof applyUserSession === 'function') {
    applyUserSession('ผู้เยี่ยมชม (Guest)', 'guest');
  } else {
    const nameEl = document.getElementById('display-user-name');
    const roleEl = document.getElementById('display-user-role');
    if (nameEl) nameEl.innerText = 'ผู้เยี่ยมชม (Guest)';
    if (roleEl) roleEl.innerText = 'ดูข้อมูลเท่านั้น';
  }
};

// ==========================================
// Guard: เช็คก่อนทำ action ที่ต้องการ login
// ใช้งาน: if (!requireLogin('บันทึกข้อมูล')) return;
// ==========================================
export function requireLogin(actionName = 'ดำเนินการนี้') {
  const session = getSession();
  if (session && session.officer) return true; // login อยู่แล้ว ✅

  // ยังไม่ login — แสดง login screen พร้อมข้อความแจ้ง
  const errBox = document.getElementById('login-screen-error');
  const screen = document.getElementById('login-screen');
  if (errBox) {
    errBox.textContent = `🔒 กรุณาเข้าสู่ระบบก่อน${actionName}`;
    errBox.style.display = 'block';
  }
  if (screen) {
    screen.style.display = 'flex';
    screen.style.opacity = '1';
    screen.style.transition = 'none';
  }
  return false;
}
window.requireLogin = requireLogin;

// ==========================================
// 1. การสลับแท็บเมนู
// ==========================================
window.switchTab = function (tabId) {
  // Block Guest from switching to tabs other than Dashboard and History
  if ((currentUserRole === 'guest' || !currentUserRole) && !['dashboard','history'].includes(tabId)) {
    tabId = 'dashboard';
  }

  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

  const targetTab = document.getElementById(`tab-${tabId}`);
  if (targetTab) targetTab.classList.add('active');

  const activeBtn = document.getElementById(`tab-nav-${tabId}`) || Array.from(document.querySelectorAll('.tab-btn'))
    .find(b => b.getAttribute('onclick') && b.getAttribute('onclick').includes(tabId));
  if (activeBtn) activeBtn.classList.add('active');

  if (tabId === 'dashboard') {
    if (map) setTimeout(() => map.invalidateSize(), 200);
  }
  if (tabId === 'scanner') {
    startScanner();
  } else {
    stopScanner();
  }
  if (tabId === 'register') {
    setTimeout(() => {
      if (typeof window.initRegisterMap === 'function') window.initRegisterMap();
      if (typeof window.autoSuggestRegisterId === 'function') window.autoSuggestRegisterId();
    }, 150);
  }
  if (tabId === 'assets') {
    if (typeof window.renderAssetListTable === 'function') window.renderAssetListTable();
  }
  if (tabId === 'history') {
    if (typeof renderHistoryTable === 'function') renderHistoryTable();
  }
  if (tabId === 'report') {
    if (typeof window.autoLoadExecutiveFullReport === 'function') {
      window.autoLoadExecutiveFullReport();
    }
  }
  if (tabId === 'admin') {
    if (typeof window.renderAdminUserList === 'function') {
      window.renderAdminUserList();
    }
  }
};

// ==========================================
// ฟังก์ชันคัดกรองข้อมูลอุปกรณ์ที่ซ้ำซ้อน และปรับปรุงชื่อประเภทให้อยู่ในมาตรฐานเดียวกัน
function deduplicateAssets(list) {
  if (!Array.isArray(list)) return [];
  const map = new Map();
  for (const item of list) {
    if (!item || !item.assetId) continue;
    // ปรับประเภทอุปกรณ์ให้เป็นชื่อมาตรฐานทางการ
    if (item.type) {
      item.type = cleanAssetType(item.type);
    }
    const key = item.assetId.trim().toUpperCase();
    if (!map.has(key)) {
      map.set(key, item);
    } else {
      // หากพบซ้ำ ให้เลือกล่าสุดหรือที่มีข้อมูลสมบูรณ์กว่า
      const existing = map.get(key);
      const chosen = (item.lastChecked && (!existing.lastChecked || item.lastChecked > existing.lastChecked)) ? item : existing;
      map.set(key, chosen);
    }
  }
  return Array.from(map.values());
}

// 2. จัดการข้อมูลอุปกรณ์ (Assets Initialization)
// ==========================================
export async function initAssets() {
  const localSaved = storageService.get('pyh_assets_data');
  if (localSaved) {
    try {
      const parsed = typeof localSaved === 'string' ? JSON.parse(localSaved) : localSaved;
      if (Array.isArray(parsed)) {
        assetsList = deduplicateAssets(parsed);
        storageService.set('pyh_assets_data', assetsList);
      }
    } catch (e) {
      console.warn("Failed to parse local assets", e);
    }
  }

  // หากไม่มีข้อมูลและยังไม่เคยเริ่มระบบ ให้โหลดจาก initial_assets.json เป็นค่าเริ่มต้นครั้งแรก
  const hasInitialized = storageService.get('pyh_has_initialized');
  if (!hasInitialized && (!assetsList || assetsList.length === 0)) {
    try {
      const resp = await fetch('initial_assets.json');
      const data = await resp.json();
      assetsList = deduplicateAssets(data.assets || []);
      storageService.set('pyh_assets_data', assetsList);
      storageService.set('pyh_has_initialized', 'true');
    } catch (e) {
      console.error("Could not load initial_assets.json", e);
    }
  } else if (!hasInitialized && assetsList && assetsList.length > 0) {
    storageService.set('pyh_has_initialized', 'true');
  }

  // โหลดประวัติการตรวจที่มีในเครื่อง
  const localLogs = storageService.get('pyh_inspection_logs');
  if (localLogs) {
    try {
      inspectionLogs = JSON.parse(localLogs);
    } catch (e) { }
  }

  // หากเปิดใช้ Firebase จริง ให้ซิงก์จาก Firestore
  if (isFirebaseReady() && db) {
    try {
      const q = collection(db, "assets");
      onSnapshot(q, (snapshot) => {
        if (!snapshot.empty) {
          const rawAssets = [];
          snapshot.forEach(d => {
            const data = d.data();
            const originalType = data.type || '';
            const normalizedType = cleanAssetType(originalType);
            // หากใน Firestore ยังเป็นประเภทรูปแบบเก่า ให้อัปเดตเป็นชื่อทางการใหม่เฉพาะเมื่อมีล็อกอินมีสิทธิ์เขียน
            const canWrite = auth && auth.currentUser && (currentUserRole === 'admin' || currentUserRole === 'inspector');
            if (canWrite && originalType !== normalizedType && d.id) {
              updateDoc(doc(db, "assets", d.id), { type: normalizedType }).catch(() => {});
            }
            rawAssets.push({ firestoreId: d.id, ...data, type: normalizedType });
          });
          assetsList = deduplicateAssets(rawAssets);
          storageService.set('pyh_assets_data', assetsList);
        } else {
          // หากบน Cloud ว่างเปล่า (ถูกลบออกหมดแล้ว) ให้เคลียร์ข้อมูลในเครื่องด้วย
          assetsList = [];
          storageService.set('pyh_assets_data', []);
        }
        updateDashboardUI();
        renderMapPins();
        if (typeof renderAssetListTable === 'function') renderAssetListTable();
        if (typeof autoSuggestRegisterId === 'function') autoSuggestRegisterId();
      });

      const qLogs = query(collection(db, "inspection_logs"), orderBy("timestamp", "desc"));
      onSnapshot(qLogs, (snapshot) => {
        inspectionLogs = [];
        snapshot.forEach(d => inspectionLogs.push({ id: d.id, ...d.data() }));
        renderHistoryTable();
      });

      // ซิงก์สถานะตราประทับและคำสั่งการดิจิทัล (Digital Signatures) ทั้ง 3 ฝ่ายจาก Firestore แบบ Realtime
      const certDocRef = doc(db, "system_state", "report_certifications");
      onSnapshot(certDocRef, (docSnap) => {
        if (docSnap.exists()) {
          const cloudCert = docSnap.data();
          if (cloudCert.tech_cert) {
            storageService.set('pyh_tech_certification', cloudCert.tech_cert);
          } else if (cloudCert.tech_cert === null) {
            storageService.remove('pyh_tech_certification');
          }

          if (cloudCert.chef_cert) {
            storageService.set('pyh_chef_certification', cloudCert.chef_cert);
          } else if (cloudCert.chef_cert === null) {
            storageService.remove('pyh_chef_certification');
          }

          if (cloudCert.exec_cert) {
            storageService.set('pyh_exec_certification', cloudCert.exec_cert);
          } else if (cloudCert.exec_cert === null) {
            storageService.remove('pyh_exec_certification');
          }

          if (cloudCert.exec_decision) {
            storageService.set('pyh_executive_decision', cloudCert.exec_decision);
          } else if (cloudCert.exec_decision === null) {
            storageService.remove('pyh_executive_decision');
          }

          // อัปเดต UI ที่แสดงผลทันทีทุกเครื่องที่เปิดอยู่
          if (typeof window.renderTechCertificationUI === 'function') window.renderTechCertificationUI();
          if (typeof window.renderChefCertificationUI === 'function') window.renderChefCertificationUI();
          if (typeof window.renderExecutiveCertificationUI === 'function') window.renderExecutiveCertificationUI();
          // อัปเดตมุมมอง decision ในหน้าจอรายงาน (ถ้าเปิดอยู่) โดยไม่ sync ซ้ำ
          if (cloudCert.exec_decision && cloudCert.exec_decision.decision) {
            const dec = cloudCert.exec_decision.decision;
            const isAck = (dec === 'acknowledge');
            const radAck = document.getElementById('rad-appr-ack');
            const radRepair = document.getElementById('rad-appr-repair');
            if (radAck) radAck.checked = isAck;
            if (radRepair) radRepair.checked = !isAck;
            const printAck = document.getElementById('print-appr-ack');
            const printRepair = document.getElementById('print-appr-repair');
            if (printAck) printAck.innerHTML = isAck ? '<b>[ ✓ ] รับทราบ</b>' : '[ &nbsp; ] รับทราบ';
            if (printRepair) printRepair.innerHTML = !isAck ? '<b>[ ✓ ] อนุมัติซ่อมแซม</b>' : '[ &nbsp; ] อนุมัติซ่อมแซม';
            const screenAck = document.getElementById('screen-view-ack');
            const screenRepair = document.getElementById('screen-view-repair');
            if (screenAck) screenAck.innerHTML = isAck ? '<b style="color:#0284c7;">[ ✓ ] รับทราบ</b>' : '[ &nbsp; ] รับทราบ';
            if (screenRepair) screenRepair.innerHTML = !isAck ? '<b style="color:#059669;">[ ✓ ] อนุมัติซ่อมแซม</b>' : '[ &nbsp; ] อนุมัติซ่อมแซม';
          }
        }
      });
    } catch (e) {
      console.warn("Firebase sync error, using local fallback", e);
    }
  }

  updateDashboardUI();
  renderHistoryTable();
  initMap();
  if (typeof window.autoSuggestRegisterId === 'function') {
    window.autoSuggestRegisterId();
  }

  // ตรวจสอบ URL พารามิเตอร์ ?scan= เพื่อเปิดแบบฟอร์มตรวจเช็กอุปกรณ์อัตโนมัติ (เช่น จาก LINE / Google Lens)
  checkUrlScanParam();
}

// ฟังก์ชันตรวจสอบ ?scan= จาก URL และเปิดหน้าตรวจเช็กอัตโนมัติ
let _hasCheckedUrlScan = false;
function checkUrlScanParam() {
  if (_hasCheckedUrlScan) return;
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const rawScan = urlParams.get('scan') || urlParams.get('id') || urlParams.get('assetId');
    if (!rawScan) return;

    const targetId = extractAssetIdFromScan(rawScan);
    if (!targetId) return;

    _hasCheckedUrlScan = true;
    setTimeout(() => {
      window.handleScanned(targetId);
    }, 300);
  } catch (e) {
    console.warn("checkUrlScanParam error:", e);
  }
}

// อัปเดตข้อมูลสรุป Dashboard & KPIs
export function updateDashboardUI() {
  const total = assetsList.length;
  const ready = assetsList.filter(a => a.status === 'READY').length;
  const repairing = assetsList.filter(a => a.status === 'REPAIRING').length;
  const issue = assetsList.filter(a => a.status === 'ISSUE').length;
  const checkedThisMonth = assetsList.filter(a => a.lastChecked).length;
  const coverageRate = total > 0 ? Math.round((checkedThisMonth / total) * 100) : 0;

  const totalEl = document.getElementById('total-count');
  const readyEl = document.getElementById('ready-count');
  const repairEl = document.getElementById('repair-count');
  const issueEl = document.getElementById('issue-count');
  const rateEl = document.getElementById('coverage-rate');

  if (totalEl) totalEl.innerText = total;
  if (readyEl) readyEl.innerText = ready;
  if (repairEl) repairEl.innerText = repairing;
  if (issueEl) issueEl.innerText = issue;
  if (rateEl) rateEl.innerText = `${coverageRate}%`;
}

// ==========================================
// 3. แผนที่ Leaflet (Campus + 6 Floor Plans)
// ==========================================
function initMap() {
  const mapElem = document.getElementById('floor-map');
  if (!mapElem) return;
  if (map) return; // ป้องกัน initialize ซ้ำ

  // สร้าง Map Instance เริ่มต้น (ตั้งค่า Zoom ให้คมชัดและนุ่มนวล)
  map = L.map('floor-map', {
    crs: L.CRS.Simple,
    minZoom: -1,
    maxZoom: 2,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 120
  });

  changeMapLevel();
}

window.selectBuildingFloor = function (buildingId) {
  const select = document.getElementById('map-mode-select');
  if (select) {
    select.value = buildingId;
    window.changeMapLevel();
  }
};

function updateBuildingButtonStates(activeMode) {
  const buttons = document.querySelectorAll('.bldg-nav-btn');
  buttons.forEach(btn => {
    const isCampus = btn.getAttribute('onclick')?.includes(`'campus'`);
    const isActive = btn.getAttribute('onclick')?.includes(`'${activeMode}'`);
    if (isActive) {
      btn.style.background = '#0284c7';
      btn.style.color = '#ffffff';
      btn.style.borderColor = '#0284c7';
      btn.style.boxShadow = '0 2px 5px rgba(2,132,199,0.35)';
    } else {
      btn.style.background = '#ffffff';
      btn.style.color = '#0f766e';
      btn.style.borderColor = '#cbd5e1';
      btn.style.boxShadow = 'none';
    }
  });
}

window.changeMapLevel = function () {
  const selectedMode = document.getElementById('map-mode-select').value;
  currentMapMode = selectedMode;
  updateBuildingButtonStates(selectedMode);

  const targetCRS = (selectedMode === 'campus') ? L.CRS.EPSG3857 : L.CRS.Simple;

  // Leaflet ไม่รองรับการเปลี่ยน map.options.crs ในอินสแตนซ์เดิมแบบไดนามิก (จะทำให้พิกัดและการแปลง Projection พัง/กลายเป็นสีว่างเปล่า)
  // หากมีการสลับระหว่าง Campus (พิกัดดาวเทียมจริง EPSG3857) กับ ผังอาคาร (พิกัดพิกเซลราบ Simple) จำเป็นต้อง re-create map instance ใหม่
  if (map && map.options.crs !== targetCRS) {
    if (currentTileLayer && map.hasLayer(currentTileLayer)) map.removeLayer(currentTileLayer);
    if (currentOverlayLayer && map.hasLayer(currentOverlayLayer)) map.removeLayer(currentOverlayLayer);
    markers.forEach(m => { if (map.hasLayer(m)) map.removeLayer(m); });
    markers = [];
    map.remove();
    map = null;
  }

  if (!map) {
    const isCampus = (selectedMode === 'campus');
    map = L.map('floor-map', {
      crs: targetCRS,
      minZoom: isCampus ? 16 : -1,
      maxZoom: isCampus ? 20 : 4,
      zoomSnap: isCampus ? 1 : 0.25,
      zoomDelta: isCampus ? 1 : 0.5,
      wheelPxPerZoomLevel: 120
    });
  } else {
    // ปลดล็อคขอบเขตเดิมก่อนเปลี่ยนโหมด เพื่อไม่ให้ถูกตีกรอบหลุด
    map.setMaxBounds(null);
    if (currentTileLayer && map.hasLayer(currentTileLayer)) map.removeLayer(currentTileLayer);
    if (currentOverlayLayer && map.hasLayer(currentOverlayLayer)) map.removeLayer(currentOverlayLayer);
    markers.forEach(m => { if (map.hasLayer(m)) map.removeLayer(m); });
    markers = [];
  }

  if (selectedMode === 'campus') {
    map.options.maxBoundsViscosity = 0.8;
    
    // ขอบเขตพิกัดจริงของโรงพยาบาลพยุหะคีรีตามที่ระบุ:
    // จุดอ้างอิง: [15.4765487, 100.1371425] ถึง [15.4776960, 100.1384024]
    const hospitalBounds = L.latLngBounds(
      [15.4750, 100.1355], // ทิศตะวันตกเฉียงใต้ (ครอบคลุมทางเข้า-ออก)
      [15.4795, 100.1400]  // ทิศตะวันออกเฉียงเหนือ (ครอบคลุมอาคารทั้งหมด)
    );

    map.setMaxBounds(hospitalBounds);
    map.setMinZoom(16); // ซูมออกได้พอดีกับขอบเขตพื้นที่โรงพยาบาล
    map.setMaxZoom(20); // ซูมเข้าได้ถึงระดับ 20 เห็นหลังคาตึกชัดเจน
    
    // แผนที่ภาพถ่ายดาวเทียมความคมชัดสูงเฉพาะบริเวณโรงพยาบาลพยุหะคีรี
    currentTileLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'],
      minZoom: 16,
      maxZoom: 20,
      bounds: hospitalBounds,
      attribution: '© Google Maps Satellite - โรงพยาบาลพยุหะคีรี'
    }).addTo(map);

    // เล็งจุดกึ่งกลางพื้นที่โรงพยาบาลพยุหะคีรี
    map.setView([15.47712, 100.13777], 18);
  } else {
    const cfg = floorConfigs[selectedMode];
    if (!cfg) return;

    currentOverlayLayer = L.imageOverlay(cfg.imageUrl, cfg.bounds).addTo(map);
    
    // ล็อคขอบเขตไม่ให้เลื่อนหลุดผัง และคำนวณการย่อสุดให้พอดีจอพอดี
    map.options.maxBoundsViscosity = 1.0;
    map.setMaxBounds(cfg.bounds);
    map.setMaxZoom(4); // ขยายได้เต็มที่ระดับ 4 เพื่อส่องดูรายละเอียดชัดเจน
    
    map.fitBounds(cfg.bounds);
    const fitZoom = map.getBoundsZoom(cfg.bounds);
    map.setMinZoom(fitZoom); // ล็อคระดับย่อสุดให้หยุดที่พอดีกับหน้าจอ ไม่หลุดขอบ
  }

  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 100);

  renderMapPins();
};

function showMapToast(msg) {
  let toast = document.getElementById('map-toast-notification');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'map-toast-notification';
    toast.className = 'map-toast';
    document.body.appendChild(toast);
  }
  toast.innerText = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}

let activeRelocateAssetId = null;

window.startRelocatePin = function (assetId) {
  const item = assetsList.find(a => a.assetId === assetId);
  if (!item) return;

  activeRelocateAssetId = assetId;
  if (map) map.closePopup();

  let relocateBanner = document.getElementById('map-relocate-banner');
  if (!relocateBanner) {
    relocateBanner = document.createElement('div');
    relocateBanner.id = 'map-relocate-banner';
    relocateBanner.style.cssText = 'background:#0284c7; color:white; padding:10px 16px; border-radius:8px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; font-weight:600; font-size:13px; box-shadow:0 2px 8px rgba(0,0,0,0.2);';
    const floorMapElem = document.getElementById('floor-map');
    if (floorMapElem && floorMapElem.parentNode) {
      floorMapElem.parentNode.insertBefore(relocateBanner, floorMapElem);
    }
  }

  relocateBanner.innerHTML = `
    <div>📍 <b>กำลังย้ายจุด [${item.assetId}]:</b> กรุณาคลิกบนแผนที่ ณ จุดติดตั้งใหม่ที่ต้องการ</div>
    <button onclick="cancelRelocatePin()" class="btn-sm" style="background:#ffffff; color:#0284c7; border:none; padding:4px 12px; font-weight:700; border-radius:6px; cursor:pointer;">✕ ยกเลิก</button>
  `;
  relocateBanner.style.display = 'flex';

  if (map) {
    map.getContainer().style.cursor = 'crosshair';
    map.once('click', function (e) {
      if (!activeRelocateAssetId) return;

      if (currentMapMode === 'campus') {
        item.campusCoord = { lat: e.latlng.lat, lng: e.latlng.lng };
      } else {
        const newY = Math.round(e.latlng.lat);
        const newX = Math.round(e.latlng.lng);
        item.floorCoord = [newY, newX];
      }

      storageService.set('pyh_assets_data', assetsList);
      if (isFirebaseReady() && db && item.firestoreId) {
        const updateData = (currentMapMode === 'campus') ? { campusCoord: item.campusCoord } : { floorCoord: item.floorCoord };
        updateDoc(doc(db, "assets", item.firestoreId), updateData).catch(err => console.warn(err));
      }

      window.cancelRelocatePin();
      renderMapPins();
      showMapToast('📍 ย้ายตำแหน่ง [' + item.assetId + '] เรียบร้อยแล้ว');
    });
  }
};

window.cancelRelocatePin = function () {
  activeRelocateAssetId = null;
  const relocateBanner = document.getElementById('map-relocate-banner');
  if (relocateBanner) relocateBanner.style.display = 'none';
  if (map) map.getContainer().style.cursor = '';
};

// ==========================================
// การเพิ่มจุดติดตั้งใหม่บนแดชบอร์ดโดย Admin (Quick Add on Dashboard)
// ==========================================
let isAddingAssetOnDashboard = false;
let quickAddFloorCoord = [280, 500];
let quickAddCampusCoord = { lat: 15.4544, lng: 100.1347 };

window.startAddAssetOnDashboard = function () {
  if (currentUserRole !== 'admin') {
    alert("ขออภัย: ฟังก์ชันนี้เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น");
    return;
  }

  isAddingAssetOnDashboard = true;
  if (map) map.closePopup();

  let addBanner = document.getElementById('map-add-asset-banner');
  if (!addBanner) {
    addBanner = document.createElement('div');
    addBanner.id = 'map-add-asset-banner';
    const floorMapElem = document.getElementById('floor-map');
    if (floorMapElem && floorMapElem.parentNode) {
      floorMapElem.parentNode.insertBefore(addBanner, floorMapElem);
    }
  }

  const currentBuildingName = (currentMapMode === 'campus')
    ? 'ภาพรวมวิทยาเขต (GPS)'
    : (floorConfigs[currentMapMode]?.name || 'ผังอาคารปัจจุบัน');

  addBanner.style.cssText = 'background:linear-gradient(135deg, #059669, #10b981); color:white; padding:12px 16px; border-radius:8px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; font-weight:600; font-size:13px; box-shadow:0 3px 10px rgba(0,0,0,0.2);';
  addBanner.innerHTML = `
    <div>➕ <b>โหมดเพิ่มอุปกรณ์ [${currentBuildingName}]:</b> กรุณาคลิกบนตำแหน่งที่ต้องการติดตั้งบนผัง</div>
    <button onclick="cancelAddAssetOnDashboard()" class="btn-sm" style="background:#ffffff; color:#059669; border:none; padding:4px 12px; font-weight:700; border-radius:6px; cursor:pointer;">✕ ยกเลิก</button>
  `;
  addBanner.style.display = 'flex';

  if (map) {
    map.getContainer().style.cursor = 'crosshair';
    map.once('click', function (e) {
      if (!isAddingAssetOnDashboard) return;

      if (currentMapMode === 'campus') {
        quickAddCampusCoord = { lat: e.latlng.lat, lng: e.latlng.lng };
        quickAddFloorCoord = [280, 500];
      } else {
        const newY = Math.round(e.latlng.lat);
        const newX = Math.round(e.latlng.lng);
        quickAddFloorCoord = [newY, newX];
        quickAddCampusCoord = { lat: 15.47712, lng: 100.13777 };
      }

      window.cancelAddAssetOnDashboard();
      window.openQuickAddModal();
    });
  }
};

window.cancelAddAssetOnDashboard = function () {
  isAddingAssetOnDashboard = false;
  const addBanner = document.getElementById('map-add-asset-banner');
  if (addBanner) addBanner.style.display = 'none';
  if (map) map.getContainer().style.cursor = '';
};

window.openQuickAddModal = function () {
  const modal = document.getElementById('quick-add-modal');
  if (!modal) return;

  const currentBuildingName = (currentMapMode === 'campus')
    ? 'อาคารอุบัติเหตุ (ชั้นล่าง)'
    : (floorConfigs[currentMapMode]?.name || 'อาคารอุบัติเหตุ (ชั้นล่าง)');

  const buildingLabel = document.getElementById('quick-add-building-label');
  if (buildingLabel) buildingLabel.innerText = currentBuildingName;

  const coordLabel = document.getElementById('quick-add-coord-label');
  if (coordLabel) {
    if (currentMapMode === 'campus') {
      coordLabel.innerText = `GPS: ${quickAddCampusCoord.lat.toFixed(5)}, ${quickAddCampusCoord.lng.toFixed(5)}`;
    } else {
      coordLabel.innerText = `ผังชั้น: Y: ${quickAddFloorCoord[0]}, X: ${quickAddFloorCoord[1]}`;
    }
  }

  window.autoSuggestQuickAddId();
  modal.classList.remove('hidden');
};

window.closeQuickAddModal = function () {
  const modal = document.getElementById('quick-add-modal');
  if (modal) modal.classList.add('hidden');
  isAddingAssetOnDashboard = false;
};

const buildingZoneMap = {
  building_er_lower: 'ER1',
  building_er_upper: 'ER2',
  building_hpc: 'HPC',
  building_ipd: 'IPD',
  building_nisit: 'NSK',
  building_opd_dm: 'OPD',
  building_pharma_rehab: 'PRC',
  building_thai_med: 'TTM',
  building_canteen: 'CAN'
};

window.getNextAssetId = function (buildingId, typeName) {
  const zone = buildingZoneMap[buildingId] || 'ER1';
  const typeStr = (typeName || '').toLowerCase();
  const isFE = typeStr.includes('ถังดับเพลิง') || typeStr.includes('clean') || typeStr.includes('co2') || typeStr.includes('dry') || typeStr.includes('fe') || typeStr.includes('เคมี');
  const typeCode = isFE ? 'FE' : 'EM';
  const prefix = `PYH-${typeCode}-${zone}-`;

  let maxNum = 0;
  if (Array.isArray(assetsList)) {
    assetsList.forEach(a => {
      if (!a.assetId) return;
      const id = a.assetId.trim().toUpperCase();
      if (id.startsWith(prefix)) {
        const numPart = id.slice(prefix.length);
        const n = parseInt(numPart, 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
    });
  }

  const nextSeq = String(maxNum + 1).padStart(2, '0');
  return `${prefix}${nextSeq}`;
};

window.autoSuggestQuickAddId = function () {
  const typeSelect = document.getElementById('quick-add-type');
  const idInput = document.getElementById('quick-add-id');
  if (!idInput) return;

  const targetBuildingId = (currentMapMode === 'campus') ? 'building_er_lower' : currentMapMode;
  const type = typeSelect ? typeSelect.value : '';
  const nextId = window.getNextAssetId(targetBuildingId, type);
  idInput.value = nextId;

  const quickBadge = document.getElementById('quick-add-id-auto-badge');
  if (quickBadge) {
    quickBadge.innerText = `⚡ รันต่ออัตโนมัติ: ${nextId}`;
  }
};

window.autoSuggestRegisterId = function () {
  const regIdInput = document.getElementById('reg-id');
  const buildingSelect = document.getElementById('reg-building-select');
  const typeSelect = document.getElementById('reg-type');
  if (!regIdInput || !buildingSelect || !typeSelect) return;

  const buildingId = buildingSelect.value;
  const type = typeSelect.value;
  const nextId = window.getNextAssetId(buildingId, type);
  regIdInput.value = nextId;

  const autoBadge = document.getElementById('reg-id-auto-badge');
  if (autoBadge) {
    autoBadge.innerText = `⚡ รันต่ออัตโนมัติ: ${nextId}`;
  }
};

window.submitQuickAddAsset = async function () {
  if (!requireLogin('เพิ่มอุปกรณ์ใหม่')) return;
  const idInput = document.getElementById('quick-add-id');
  const typeSelect = document.getElementById('quick-add-type');
  const locationInput = document.getElementById('quick-add-location');

  const assetId = idInput ? idInput.value.trim() : '';
  const type = typeSelect ? typeSelect.value : 'ถังดับเพลิง ผงเคมีแห้ง (Dry Chemical)';
  const location = locationInput ? locationInput.value.trim() : 'บริเวณจุดติดตั้งใหม่';

  if (!assetId) {
    alert('กรุณาระบุรหัสประจำอุปกรณ์');
    return;
  }

  if (assetsList.some(a => a.assetId.toUpperCase() === assetId.toUpperCase())) {
    alert(`ขออภัย: รหัสอุปกรณ์ "${assetId}" มีอยู่ในระบบแล้ว กรุณาใช้รหัสอื่น`);
    return;
  }

  const targetBuildingId = (currentMapMode === 'campus') ? 'building_er_lower' : currentMapMode;
  const targetBuildingName = floorConfigs[targetBuildingId]?.name || 'อาคารอุบัติเหตุ (ชั้นล่าง)';

  const newAsset = {
    assetId: assetId,
    type: type,
    building: targetBuildingName,
    buildingId: targetBuildingId,
    floor: 1,
    location: location,
    status: 'READY',
    lastChecked: new Date().toISOString(),
    lastInspector: currentOfficer,
    notes: 'ติดตั้งใหม่โดยผู้ดูแลระบบ',
    floorCoord: [quickAddFloorCoord[0], quickAddFloorCoord[1]],
    campusCoord: { lat: quickAddCampusCoord.lat, lng: quickAddCampusCoord.lng }
  };

  assetsList.push(newAsset);
  assetsList = deduplicateAssets(assetsList);
  storageService.set('pyh_assets_data', assetsList);

  if (isFirebaseReady() && db) {
    try {
      const docId = assetId.replace(/[^a-zA-Z0-9]/g, '_');
      await setDoc(doc(db, "assets", docId), {
        ...newAsset,
        createdAt: serverTimestamp()
      });
      newAsset.firestoreId = docId;
    } catch (err) {
      console.warn("Firestore save asset error:", err);
    }
  }

  window.closeQuickAddModal();
  updateDashboardUI();
  renderMapPins();
  showMapToast(`✅ บันทึกอุปกรณ์ [${assetId}] บนผังเรียบร้อยแล้ว!`);
};

export function renderMapPins() {
  if (!map) return;
  markers.forEach(m => { if (map.hasLayer(m)) map.removeLayer(m); });
  markers = [];

  const isAdmin = currentUserRole === 'admin';
  const isGuest = (!currentUserRole || currentUserRole === 'guest');

  if (currentMapMode === 'campus') {
    // โหลดตำแหน่งแลนด์มาร์กอาคารจาก localStorage (หรือค่าเริ่มต้น) เพื่อให้ปรับย้ายตำแหน่งได้
    const defaultLandmarks = [
      { id: 'building_er_lower', name: '🏢 ตึกอุบัติเหตุ (ชั้นล่าง)', sub: 'ER 1', lat: 15.47715, lng: 100.13780 },
      { id: 'building_er_upper', name: '🏢 ตึกอุบัติเหตุ (ชั้นบน)', sub: 'ห้องบริหารทั่วไป', lat: 15.47732, lng: 100.13780 },
      { id: 'building_hpc', name: '🏥 ส่งเสริมสุขภาพ (HPC)', sub: 'ตรวจสุขภาพ & ทันตกรรม', lat: 15.47675, lng: 100.13735 },
      { id: 'building_ipd', name: '🛏️ ผู้ป่วยใน (IPD)', sub: 'หอผู้ป่วยใน', lat: 15.47738, lng: 100.13825 },
      { id: 'building_nisit', name: '🩺 ตึกนิสิตคุณากร', sub: 'Covid-19 / ARI Clinic', lat: 15.47648, lng: 100.13752 },
      { id: 'building_opd_dm', name: '🏥 ตึกแก้วกัลยา (OPD)', sub: 'อาคารผู้ป่วยนอก', lat: 15.47762, lng: 100.13798 },
      { id: 'building_pharma_rehab', name: '💊 เวชศาสตร์ฯ-โภชนาการ-คลังยา', sub: 'เวชศาสตร์ฟื้นฟู-คลังยา-จ่ายกลาง', lat: 15.47690, lng: 100.13845 },
      { id: 'building_thai_med', name: '🌿 อาคารแพทย์แผนไทย', sub: 'แพทย์แผนไทยและแพทย์ทางเลือก', lat: 15.47660, lng: 100.13815 },
      { id: 'building_canteen', name: '🍲 อาคารโรงอาหาร', sub: 'ศูนย์อาหารและร้านค้า', lat: 15.47635, lng: 100.13785 }
    ];

    let campusLandmarks = defaultLandmarks;
    try {
      const savedLandmarks = storageService.get('pyh_campus_landmarks');
      if (savedLandmarks) {
        const parsed = JSON.parse(savedLandmarks);
        campusLandmarks = defaultLandmarks.map(def => {
          const found = parsed.find(p => p.id === def.id);
          return found ? { ...def, lat: found.lat, lng: found.lng } : def;
        });
      }
    } catch (e) { }

    window.saveCampusLandmarkCoord = function(bldgId, newLat, newLng) {
      let saved = [];
      try {
        const raw = storageService.get('pyh_campus_landmarks');
        if (raw) saved = JSON.parse(raw);
      } catch (e) { }
      const idx = saved.findIndex(s => s.id === bldgId);
      if (idx >= 0) {
        saved[idx].lat = newLat;
        saved[idx].lng = newLng;
      } else {
        saved.push({ id: bldgId, lat: newLat, lng: newLng });
      }
      storageService.set('pyh_campus_landmarks', saved);
      if (isFirebaseReady() && db) {
        setDoc(doc(db, "system_settings", "campus_landmarks"), { landmarks: saved }, { merge: true }).catch(err => console.warn(err));
      }
    };

    campusLandmarks.forEach(bldg => {
      const bldgIcon = L.divIcon({
        html: `
          <div style="background:linear-gradient(135deg, #0284c7, #0369a1); color:white; padding:4px 8px; border-radius:14px; font-size:11px; font-weight:bold; white-space:nowrap; border:2px solid #ffffff; box-shadow:0 3px 8px rgba(0,0,0,0.4); display:flex; align-items:center; gap:4px; cursor:${isAdmin ? 'grab' : 'pointer'};">
            ${isAdmin ? '<span style="opacity:0.8;">⠿</span>' : ''}<span>${bldg.name}</span>
          </div>
        `,
        className: 'campus-building-label',
        iconAnchor: [50, 15]
      });

      const bldgMarker = L.marker([bldg.lat, bldg.lng], {
        icon: bldgIcon,
        zIndexOffset: 500,
        draggable: isAdmin
      }).addTo(map);

      if (isAdmin) {
        bldgMarker.on('dragstart', function () {
          bldgMarker.closePopup();
          if (map) map.dragging.disable();
        });

        bldgMarker.on('dragend', function (e) {
          if (map) map.dragging.enable();
          const newPos = e.target.getLatLng();
          bldg.lat = newPos.lat;
          bldg.lng = newPos.lng;
          window.saveCampusLandmarkCoord(bldg.id, newPos.lat, newPos.lng);
          showMapToast(`📍 ย้ายตำแหน่งป้าย [${bldg.name}] เรียบร้อยแล้ว`);
        });
      }

      bldgMarker.bindPopup(`
        <div style="font-size:13px; text-align:center; min-width:180px; padding:4px;">
          <b style="color:#0284c7; font-size:14px;">${bldg.name}</b><br>
          <span style="color:#64748b; font-size:11.5px;">${bldg.sub}</span>
          ${isAdmin ? `
            <div style="margin-top:6px; font-size:10.5px; color:#16a34a; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:4px; padding:3px 6px;">
              🛠️ <b>สิทธิ์แอดมิน:</b> คลิกลากป้ายเพื่อขยับจุดได้ทันที
            </div>
          ` : ''}
          <div style="margin-top:8px;">
            <button onclick="selectBuildingFloor('${bldg.id}')" class="btn-sm" style="width:100%; background:#0284c7; color:white; border:none; padding:8px 12px; font-weight:700; border-radius:6px; cursor:pointer;">
              🗺️ คลิกเปิดดูผังอาคารนี้
            </button>
          </div>
        </div>
      `);
      markers.push(bldgMarker);
    });

    const campusAssets = assetsList.filter(a => a.campusCoord);
    campusAssets.forEach((item, index) => {
      const isReady = item.status === 'READY';
      const color = isReady ? '#16a34a' : '#dc2626';

      let marker;
      if (isAdmin) {
        const pinIcon = L.divIcon({
          html: '<div class="admin-draggable-pin" style="background:' + color + '; border:2.5px solid #ffffff; box-shadow:0 0 10px rgba(0,0,0,0.6); width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-size:12px; font-weight:bold; cursor:grab;"><span style="pointer-events:none;">⠿</span></div>',
          className: 'custom-pin-container',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });

        marker = L.marker([item.campusCoord.lat, item.campusCoord.lng], {
          icon: pinIcon,
          draggable: true,
          title: '[แอดมิน] คลิกลากเพื่อย้าย ' + item.assetId
        }).addTo(map);

        marker.on('dragstart', function () {
          marker.closePopup();
          if (map) map.dragging.disable();
        });

        marker.on('dragend', function (e) {
          if (map) map.dragging.enable();
          const newLatLng = e.target.getLatLng();
          item.campusCoord = { lat: newLatLng.lat, lng: newLatLng.lng };
          storageService.set('pyh_assets_data', assetsList);
          if (isFirebaseReady() && db && item.firestoreId) {
            updateDoc(doc(db, "assets", item.firestoreId), { campusCoord: item.campusCoord }).catch(err => console.warn(err));
          }
          showMapToast('📍 ย้ายพิกัดดาวเทียมของ [' + item.assetId + '] เรียบร้อยแล้ว');
        });
      } else {
        marker = L.circleMarker([item.campusCoord.lat, item.campusCoord.lng], {
          color: '#ffffff',
          fillColor: color,
          fillOpacity: 0.9,
          weight: 2,
          radius: 8
        }).addTo(map);
      }

      const adminPopupHtml = isAdmin ? `
        <div style="margin:8px 0; padding:8px 10px; background:#f0fdf4; border:1px solid #86efac; border-radius:6px; text-align:left;">
          <div style="font-size:12px; color:#166534; font-weight:700; margin-bottom:3px;">🛠️ สิทธิ์แอดมิน: ย้ายจุดติดตั้ง</div>
          <div style="font-size:11px; color:#15803d; line-height:1.3;">• คลิกลากหมุด <b>⠿</b> บนแผนที่ หรือ</div>
          <button onclick="startRelocatePin('${item.assetId}')" class="btn-sm" style="margin-top:5px; width:100%; background:#0284c7; color:white; font-size:11.5px; padding:6px 10px; font-weight:600; border:none; border-radius:5px; cursor:pointer;">
            📍 คลิกที่นี่เพื่อย้ายตำแหน่งจุดนี้
          </button>
        </div>
      ` : '';

      marker.bindPopup(`
        <div style="font-size:13px;">
          <div style="display:inline-block; background:#e0f2fe; color:#0369a1; font-weight:bold; padding:2px 8px; border-radius:4px; font-size:11px; margin-bottom:4px;">ลำดับที่ ${index + 1}</div><br>
          <b>${item.assetId}</b><br>
          ${item.type}<br>
          ${item.building} (${item.location})<br>
          สถานะ: <b style="color:${color}">${isReady ? '✅ พร้อมใช้งาน' : item.status === 'REPAIRING' ? '🛠️ อยู่ระหว่างส่งซ่อม' : '⚠️ ชำรุด/แจ้งซ่อม'}</b><br>
          ${adminPopupHtml}
          ${(!isGuest && item.status === 'ISSUE') ? `<button onclick="markAssetRepairing('${item.assetId}')" class="btn-sm" style="margin-top:6px; width:100%; background:#f59e0b; color:white;">🔧 ส่งซ่อมบำรุง</button>` : ''}
          ${(!isGuest && item.status === 'REPAIRING') ? `<button onclick="openRepairCompleteModal('${item.assetId}')" class="btn-sm" style="margin-top:6px; width:100%; background:#10b981; color:white;">✅ ซ่อมเสร็จแล้ว</button>` : ''}
          ${!isGuest ? `<button onclick="handleScanned('${item.assetId}')" class="btn-sm" style="margin-top:6px; width:100%; background:#00695c; color:white;">ตรวจเช็กจุดนี้</button>` : ''}
          <button onclick="showAssetHistoryModal('${item.assetId}')" class="btn-sm" style="margin-top:6px; width:100%; background:#2563eb; color:white;">📜 ดูประวัติ</button>
        </div>
      `);
      markers.push(marker);
    });
  } else {
    // ปักหมุดบนผังอาคาร
    const buildingAssets = assetsList.filter(a => a.buildingId === currentMapMode);
    buildingAssets.forEach((item, index) => {
      if (!item.floorCoord) return;
      const isReady = item.status === 'READY';
      const pinColor = isReady ? '#16a34a' : '#dc2626';

      let marker;
      if (isAdmin) {
        const pinIcon = L.divIcon({
          html: '<div class="admin-draggable-pin" style="background:' + pinColor + '; border:2.5px solid #ffffff; box-shadow:0 0 10px rgba(0,0,0,0.6); width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-size:12px; font-weight:bold; cursor:grab;"><span style="pointer-events:none;">⠿</span></div>',
          className: 'custom-pin-container',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });

        marker = L.marker(item.floorCoord, {
          icon: pinIcon,
          draggable: true,
          title: '[แอดมิน] คลิกลากเพื่อย้าย ' + item.assetId
        }).addTo(map);

        marker.on('dragstart', function () {
          marker.closePopup();
          if (map) map.dragging.disable();
        });

        marker.on('dragend', function (e) {
          if (map) map.dragging.enable();
          const newLatLng = e.target.getLatLng();
          const newY = Math.round(newLatLng.lat);
          const newX = Math.round(newLatLng.lng);
          item.floorCoord = [newY, newX];
          storageService.set('pyh_assets_data', assetsList);
          if (isFirebaseReady() && db && item.firestoreId) {
            updateDoc(doc(db, "assets", item.firestoreId), { floorCoord: [newY, newX] }).catch(err => console.warn(err));
          }
          showMapToast('📍 ย้ายตำแหน่ง [' + item.assetId + '] ไปยังพิกัด [Y: ' + newY + ', X: ' + newX + '] เรียบร้อยแล้ว');
        });
      } else {
        marker = L.circleMarker(item.floorCoord, {
          radius: 9,
          fillColor: pinColor,
          color: '#ffffff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.95
        }).addTo(map);
      }

      const adminPopupHtml = isAdmin ? `
        <div style="margin:8px 0; padding:8px 10px; background:#f0fdf4; border:1px solid #86efac; border-radius:6px; text-align:left;">
          <div style="font-size:12px; color:#166534; font-weight:700; margin-bottom:3px;">🛠️ สิทธิ์แอดมิน: ย้ายจุดติดตั้ง</div>
          <div style="font-size:11px; color:#15803d; line-height:1.3;">• คลิกลากหมุด <b>⠿</b> บนแผนที่ หรือ</div>
          <button onclick="startRelocatePin('${item.assetId}')" class="btn-sm" style="margin-top:5px; width:100%; background:#0284c7; color:white; font-size:11.5px; padding:6px 10px; font-weight:600; border:none; border-radius:5px; cursor:pointer;">
            📍 คลิกที่นี่เพื่อย้ายตำแหน่งจุดนี้
          </button>
        </div>
      ` : '';

      marker.bindPopup(`
        <div style="font-size: 13px;">
          <div style="display:inline-block; background:#e0f2fe; color:#0369a1; font-weight:bold; padding:2px 8px; border-radius:4px; font-size:11px; margin-bottom:4px;">ลำดับที่ ${index + 1}</div><br>
          <strong style="color: #0284c7;">${item.assetId}</strong><br>
          <b>ประเภท:</b> ${item.type}<br>
          <b>จุดติดตั้ง:</b> ${item.location}<br>
          <b>สถานะ:</b> <span style="color:${pinColor}; font-weight:bold;">
            ${isReady ? '✅ พร้อมใช้งาน' : item.status === 'REPAIRING' ? '🛠️ อยู่ระหว่างส่งซ่อม' : '⚠️ ชำรุด/แจ้งซ่อม'}
          </span><br>
          ${adminPopupHtml}
          ${(!isGuest && item.status === 'ISSUE') ? `<button onclick="markAssetRepairing('${item.assetId}')" class="btn-sm" style="margin-top:6px; width:100%; background:#f59e0b; color:white;">🔧 ส่งซ่อมบำรุง</button>` : ''}
          ${(!isGuest && item.status === 'REPAIRING') ? `<button onclick="openRepairCompleteModal('${item.assetId}')" class="btn-sm" style="margin-top:6px; width:100%; background:#10b981; color:white;">✅ ซ่อมเสร็จแล้ว (คืนสถานะปกติ)</button>` : ''}
          ${!isGuest ? `
          <button onclick="handleScanned('${item.assetId}')" class="btn-sm" style="margin-top:6px; width:100%; background: #00695c; color: white;">
            บันทึกตรวจเช็กจุดนี้
          </button>
          ` : ''}
          <button onclick="showAssetHistoryModal('${item.assetId}')" class="btn-sm" style="margin-top:6px; width:100%; background:#2563eb; color:white;">📜 ดูประวัติ</button>
        </div>
      `);
      markers.push(marker);
    });
  }

  // อัปเดตการ์ดลำดับจุดติดตั้งด้านล่างแผนที่ (Dashboard Asset Quick Chips)
  renderDashboardAssetChips();
  renderTechRoutingList();
}

let _currentDashboardView = 'map'; // 'map' | 'list'

window.switchMapViewMode = function (mode) {
  _currentDashboardView = mode;
  const btnMap = document.getElementById('btn-view-map');
  const btnList = document.getElementById('btn-view-list');
  const mapEl = document.getElementById('floor-map');
  const hintEl = document.getElementById('map-legend-hint');
  const chipsEl = document.getElementById('dashboard-asset-quicklist-container');
  const listEl = document.getElementById('tech-routing-list');

  if (mode === 'list') {
    if (btnMap) { btnMap.style.background = 'transparent'; btnMap.style.color = '#475569'; }
    if (btnList) { btnList.style.background = '#00695c'; btnList.style.color = '#fff'; }
    if (mapEl) mapEl.style.display = 'none';
    if (hintEl) hintEl.style.display = 'none';
    if (chipsEl) chipsEl.style.display = 'none';
    if (listEl) {
      listEl.style.display = 'block';
      renderTechRoutingList();
    }
  } else {
    if (btnMap) { btnMap.style.background = '#00695c'; btnMap.style.color = '#fff'; }
    if (btnList) { btnList.style.background = 'transparent'; btnList.style.color = '#475569'; }
    if (mapEl) {
      mapEl.style.display = 'block';
      if (map) map.invalidateSize();
    }
    if (hintEl) hintEl.style.display = 'block';
    if (chipsEl) chipsEl.style.display = 'block';
    if (listEl) listEl.style.display = 'none';
  }
};

function renderTechRoutingList() {
  const listEl = document.getElementById('tech-routing-list');
  if (!listEl) return;

  const currentAssets = currentMapMode === 'campus'
    ? assetsList.filter(a => a.campusCoord)
    : assetsList.filter(a => a.buildingId === currentMapMode);

  if (currentAssets.length === 0) {
    listEl.innerHTML = `
      <div style="text-align:center; padding:32px; color:#94a3b8; font-size:0.9rem; background:#f8fafc; border-radius:10px; border:1px dashed #cbd5e1;">
        📭 ยังไม่มีจุดตรวจเช็กที่บันทึกพิกัดในโซนนี้
      </div>`;
    return;
  }

  const bldgName = floorConfigs[currentMapMode]?.name || 'ภาพรวมโรงพยาบาล';
  let html = `
    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
      <div style="font-size:0.86rem; font-weight:700; color:#0f766e;">
        📋 เส้นทางเดินตรวจแนะนำ: ${bldgName} (${currentAssets.length} จุด)
      </div>
      <div style="font-size:0.75rem; color:#64748b;">
        เรียงลำดับจากจุดใกล้เคียง
      </div>
    </div>
    <div style="display:flex; flex-direction:column; gap:8px;">
  `;

  currentAssets.forEach((item, idx) => {
    const isReady = item.status === 'READY';
    const statusBadge = isReady 
      ? '<span style="background:#dcfce7; color:#15803d; border:1px solid #86efac; font-size:0.72rem; font-weight:700; padding:2px 8px; border-radius:12px;">✅ ปกติ</span>'
      : '<span style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; font-size:0.72rem; font-weight:700; padding:2px 8px; border-radius:12px;">⚠️ ชำรุด/รอตรวจ</span>';
    
    const lastCheckedStr = item.lastChecked 
      ? new Date(item.lastChecked).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
      : 'ยังไม่เคยตรวจ';

    html += `
      <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; box-shadow:0 1px 3px rgba(0,0,0,0.03);">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="background:#0f766e; color:#fff; font-size:0.78rem; font-weight:800; padding:3px 8px; border-radius:6px; min-width:24px; text-align:center;">
            #${idx + 1}
          </span>
          <div>
            <div style="font-size:0.9rem; font-weight:700; color:#0f172a; display:flex; align-items:center; gap:6px;">
              ${item.assetId} ${statusBadge}
            </div>
            <div style="font-size:0.78rem; color:#475569; margin-top:2px;">
              ${item.type || ''} • 📍 ${item.location || '-'}
            </div>
            <div style="font-size:0.72rem; color:#94a3b8; margin-top:1px;">
              ตรวจล่าสุด: ${lastCheckedStr} ${item.lastInspector ? 'โดย ' + item.lastInspector : ''}
            </div>
          </div>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          <button type="button" class="btn-sm" onclick="showAssetHistoryModal('${item.assetId}')"
            style="background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; border-radius:6px; padding:5px 10px; font-size:0.78rem; cursor:pointer;">
            📜 ดูประวัติ
          </button>
          <button type="button" class="btn-sm" onclick="openInspectionForm('${item.assetId}')"
            style="background:#00695c; color:#fff; border:none; border-radius:6px; padding:5px 12px; font-size:0.78rem; font-weight:700; cursor:pointer;">
            📝 ตรวจเช็ก
          </button>
        </div>
      </div>
    `;
  });

  html += '</div>';
  listEl.innerHTML = html;
}

// ฟังก์ชันแสดงการ์ดลำดับอุปกรณ์ประจำโซน/อาคารปัจจุบัน
function renderDashboardAssetChips() {
  const chipsContainer = document.getElementById('dashboard-asset-chips');
  const countEl = document.getElementById('dashboard-zone-count');
  if (!chipsContainer) return;

  const currentAssets = currentMapMode === 'campus'
    ? assetsList.filter(a => a.campusCoord)
    : assetsList.filter(a => a.buildingId === currentMapMode);

  if (countEl) countEl.innerText = currentAssets.length;
  chipsContainer.innerHTML = '';

  if (currentAssets.length === 0) {
    chipsContainer.innerHTML = '<span style="font-size:0.82rem; color:#94a3b8;">ยังไม่มีอุปกรณ์ที่ระบุพิกัดในอาคารนี้</span>';
    return;
  }

  currentAssets.forEach((item, idx) => {
    const isReady = item.status === 'READY';
    const chip = document.createElement('div');
    chip.style.cssText = `
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 10px; border-radius: 6px; font-size: 0.8rem;
      background: ${isReady ? '#f0fdf4' : '#fef2f2'};
      border: 1px solid ${isReady ? '#bbf7d0' : '#fecaca'};
      color: #1e293b; cursor: pointer; transition: all 0.2s;
    `;
    chip.title = `คลิกเพื่อซูมดู [${item.assetId}] ${item.location || ''}`;
    chip.innerHTML = `
      <span style="background:${isReady ? '#16a34a' : '#dc2626'}; color:white; font-size:0.7rem; font-weight:700; padding:1px 6px; border-radius:4px;">#${idx + 1}</span>
      <b>${item.assetId}</b>
      <span style="color:#64748b; font-size:0.75rem;">(${item.location || '-'})</span>
    `;

    chip.onmouseenter = () => chip.style.transform = 'translateY(-2px)';
    chip.onmouseleave = () => chip.style.transform = 'translateY(0)';
    chip.onclick = () => {
      // ซูมและเปิด popup ของหมุดตัวนี้
      const marker = markers[idx];
      if (marker && map) {
        if (currentMapMode === 'campus' && item.campusCoord) {
          map.setView([item.campusCoord.lat, item.campusCoord.lng], 19);
        } else if (item.floorCoord) {
          map.setView(item.floorCoord, 1);
        }
        marker.openPopup();
      }
    };
    chipsContainer.appendChild(chip);
  });
}

window.locateUserGPS = function () {
  if (currentMapMode !== 'campus') {
    alert("ระบบ GPS ระบุพิกัดดาวเทียมจะใช้งานในมุมมอง 'ภาพรวมโรงพยาบาล'");
    document.getElementById('map-mode-select').value = 'campus';
    changeMapLevel();
  }
  map.locate({ setView: true, maxZoom: 19 });
};

// ==========================================
// 4. สแกน QR Code (Html5Qrcode)
// ==========================================
window.startScanner = async function () {
  const qrBox = document.getElementById("qr-reader");
  if (!qrBox) return;

  if (!html5QrCode) {
    html5QrCode = new Html5Qrcode("qr-reader");
  }

  // ตรวจสอบว่าเครื่องมีกล้องหรือไม่ก่อนเรียก start เพื่อไม่ให้เกิด error unhandled
  try {
    const devices = await Html5Qrcode.getCameras();
    if (!devices || devices.length === 0) {
      showNoCameraUI();
      return;
    }

    // มีกล้อง — เริ่มการสแกน
    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decodedText) => {
        stopScanner();
        handleScanned(decodedText.trim());
      },
      () => { }
    );
  } catch (err) {
    const isNotFound = err && (
      err.name === 'NotFoundError' ||
      err.name === 'NotAllowedError' ||
      err.name === 'DevicesNotFoundError' ||
      String(err).includes('not found') ||
      String(err).includes('Requested device')
    );
    if (isNotFound) {
      showNoCameraUI();
    } else {
      console.warn('Scanner warning:', err);
    }
  }
};

function showNoCameraUI() {
  const qrBox = document.getElementById('qr-reader');
  if (qrBox) {
    qrBox.innerHTML = `
      <div style="padding:28px 16px; text-align:center; color:#64748b; background:rgba(255,255,255,0.7); border-radius:14px; border:2px dashed #cbd5e1;">
        <div style="font-size:2.8rem; margin-bottom:6px;">📵</div>
        <b style="color:#1e293b; font-size:1rem;">ไม่พบอุปกรณ์กล้องบนเครื่องนี้</b><br>
        <span style="font-size:0.86rem; color:#64748b; display:inline-block; margin-top:4px;">
          ระบบกำลังเปิดใช้งานบนคอมพิวเตอร์ที่ไม่มีเว็บแคม หรือยังไม่อนุญาตสิทธิ์การเข้าถึงกล้อง
        </span><br>
        <div style="margin-top:12px; font-size:0.84rem; color:#00695c; font-weight:600;">
          👉 คุณสามารถพิมพ์รหัสอุปกรณ์ในช่องด้านล่างเพื่อเปิดตรวจเช็กได้ทันที
        </div>
      </div>`;
  }
}

window.submitManualScanId = function () {
  const input = document.getElementById('manual-scan-asset-id');
  if (!input) return;
  const assetId = input.value.trim();
  if (!assetId) {
    alert("กรุณากรอกรหัสอุปกรณ์");
    return;
  }
  handleScanned(assetId);
};

const DEFAULT_INSPECTION_GUIDE = {
  feSteps: [
    "<b>ตรวจสอบสภาพภายนอก:</b> ตัวถังต้องไม่บุบ ไม่ผุกร่อน ไม่เป็นสนิม คันบีบและด้ามจับมั่นคง",
    "<b>ตรวจสอบสลักล็อก & ซีลรัด:</b> สลักนิรภัย (Pull Pin) และซีลล็อกพลาสติกต้องอยู่ในสภาพสมบูรณ์ ไม่หลุดหาย",
    "<b>ตรวจสอบสายฉีด & หัวฉีด:</b> สายยางไม่แตกกรอบ ไม่ฉีกขาด และไม่มีเศษขยะหรือแมลงอุดตันในปากกระบอกฉีด",
    "<b>ตรวจเกจวัดแรงดัน:</b> เข็มวัดแรงดันต้องชี้อยู่ใน <b>\"แถบสีเขียว\" (ปกติ)</b> หากตกแถบแดงแสดงว่าแรงดันรั่วซึม",
    "<b>ตรวจพื้นที่การติดตั้ง:</b> ไม่มีสิ่งของตั้งวางกีดขวาง ต้องสามารถเข้าถึงและหยิบใช้งานได้ทันทีใน 5 วินาที"
  ],
  emSteps: [
    "<b>ตรวจสอบตัวเครื่อง & แหล่งจ่ายไฟ:</b> โครงสร้างโคมไฟไม่แตกร้าว เสียบปลั๊กแน่นหนา สายไฟไม่มีรอยหนูกัดแทะ",
    "<b>ตรวจสอบไฟแสดงผล (AC / On):</b> หลอดไฟสัญญาณสีเขียว/แดง (AC Indicator) ต้องติดสว่าง บ่งบอกว่ามีกระแสไฟเข้าชาร์จแบตเตอรี่",
    "<b>ทดสอบระบบสำรองไฟ (Push to Test):</b> กดปุ่ม <b>\"TEST\"</b> ค้างไว้ประมาณ 5-10 วินาที เพื่อจำลองสถานการณ์ไฟดับ",
    "<b>ประเมินความสว่าง:</b> หลอดไฟ LED ต้อง <b>ติดสว่างพร้อมกันทั้ง 2 ดวง</b> แสงไฟไม่กะพริบหรือริบหรี่",
    "<b>ปรับทิศทางโคมไฟ:</b> ปรับหน้าโคมให้ส่องสว่างไปยังเส้นทางหนีไฟ ป้ายทางออก หรือโถงบันไดหนีไฟอย่างชัดเจน"
  ],
  updatedAt: new Date().toISOString()
};

function getStoredInspectionGuide() {
  try {
    const raw = storageService.get('pyh_inspection_guide');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.feSteps && parsed.emSteps) return parsed;
    }
  } catch (e) { }
  return DEFAULT_INSPECTION_GUIDE;
}

window.renderInspectionGuideUI = function () {
  const container = document.getElementById('inspection-guide-content');
  if (!container) return;

  const guide = getStoredInspectionGuide();
  const feHtml = guide.feSteps.map(step => `<li>${step}</li>`).join('');
  const emHtml = guide.emSteps.map(step => `<li>${step}</li>`).join('');

  container.innerHTML = `
    <!-- 1. ขั้นตอนตรวจถังดับเพลิง -->
    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; box-shadow:0 1px 4px rgba(0,0,0,0.02);">
      <div style="font-weight:700; color:#b91c1c; font-size:0.92rem; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
        <span>🧯 ขั้นตอนการตรวจถังดับเพลิง (Fire Extinguisher)</span>
      </div>
      <ol style="margin:0; padding-left:20px; font-size:0.84rem; color:#334155; line-height:1.65;">
        ${feHtml}
      </ol>
    </div>

    <!-- 2. ขั้นตอนตรวจโคมไฟฉุกเฉิน -->
    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; box-shadow:0 1px 4px rgba(0,0,0,0.02);">
      <div style="font-weight:700; color:#0284c7; font-size:0.92rem; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
        <span>💡 ขั้นตอนการตรวจไฟฉุกเฉิน (Emergency Light)</span>
      </div>
      <ol style="margin:0; padding-left:20px; font-size:0.84rem; color:#334155; line-height:1.65;">
        ${emHtml}
      </ol>
    </div>
  `;
};

window.openEditGuideModal = function () {
  if (!requireLogin('แก้ไขคู่มือขั้นตอนการตรวจ')) return;
  const guide = getStoredInspectionGuide();
  const feArea = document.getElementById('edit-guide-fe');
  const emArea = document.getElementById('edit-guide-em');
  const modal = document.getElementById('edit-guide-modal');

  // แปลง array กลับเป็น text ทีละบรรทัด (ตัด tag HTML หยาบๆ ให้แก้ไขง่าย)
  if (feArea) {
    feArea.value = guide.feSteps.map(s => s.replace(/<[^>]*>/g, '')).join('\n');
  }
  if (emArea) {
    emArea.value = guide.emSteps.map(s => s.replace(/<[^>]*>/g, '')).join('\n');
  }
  if (modal) modal.style.display = 'flex';
};

window.closeEditGuideModal = function () {
  const modal = document.getElementById('edit-guide-modal');
  if (modal) modal.style.display = 'none';
};

window.submitEditGuide = async function () {
  if (!requireLogin('แก้ไขคู่มือขั้นตอนการตรวจ')) return;
  const feArea = document.getElementById('edit-guide-fe');
  const emArea = document.getElementById('edit-guide-em');
  const submitBtn = document.getElementById('edit-guide-submit-btn');

  const feLines = (feArea ? feArea.value : '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const emLines = (emArea ? emArea.value : '').split('\n').map(l => l.trim()).filter(l => l.length > 0);

  if (feLines.length === 0 || emLines.length === 0) {
    alert("กรุณาระบุขั้นตอนการตรวจอย่างน้อยประเภทละ 1 ข้อ");
    return;
  }

  // แปลงข้อความให้มีตัวหนาในคำแรก (ก่อนเครื่องหมายโคลอน :)
  const formatStep = (line) => {
    if (line.includes(':')) {
      const parts = line.split(':');
      return `<b>${parts[0].trim()}:</b> ${parts.slice(1).join(':').trim()}`;
    }
    return line;
  };

  const newGuide = {
    feSteps: feLines.map(formatStep),
    emSteps: emLines.map(formatStep),
    updatedAt: new Date().toISOString(),
    updatedBy: currentOfficer || 'เจ้าหน้าที่'
  };

  try {
    if (submitBtn) {
      submitBtn.innerText = "กำลังบันทึก...";
      submitBtn.disabled = true;
    }

    storageService.set('pyh_inspection_guide', newGuide);

    // ซิงก์ขึ้น Firestore (ถ้าพร้อมใช้งาน)
    if (isFirebaseReady() && db) {
      try {
        await setDoc(doc(db, "system_configs", "inspection_guide"), {
          ...newGuide,
          timestamp: serverTimestamp()
        });
      } catch (cloudErr) {
        console.warn("Firestore sync guide warning:", cloudErr);
      }
    }

    renderInspectionGuideUI();
    closeEditGuideModal();
    alert("✅ บันทึกและอัปเดตคู่มือขั้นตอนวิธีการตรวจเช็กเรียบร้อยแล้ว");

  } catch (err) {
    alert("เกิดข้อผิดพลาดในการบันทึก: " + err.message);
  } finally {
    if (submitBtn) {
      submitBtn.innerText = "💾 บันทึกคู่มือ";
      submitBtn.disabled = false;
    }
  }
};

window.resetGuideToDefault = function () {
  if (!confirm("ต้องการรีเซ็ตขั้นตอนและคู่มือตรวจเช็กกลับเป็นค่าเริ่มต้นใช่หรือไม่?")) return;
  const feArea = document.getElementById('edit-guide-fe');
  const emArea = document.getElementById('edit-guide-em');
  if (feArea) {
    feArea.value = DEFAULT_INSPECTION_GUIDE.feSteps.map(s => s.replace(/<[^>]*>/g, '')).join('\n');
  }
  if (emArea) {
    emArea.value = DEFAULT_INSPECTION_GUIDE.emSteps.map(s => s.replace(/<[^>]*>/g, '')).join('\n');
  }
};

window.toggleInspectionGuide = function () {
  const content = document.getElementById('inspection-guide-content');
  const txt = document.getElementById('guide-toggle-text');
  const icon = document.getElementById('guide-toggle-icon');
  if (!content) return;

  if (content.style.display === 'none') {
    content.style.display = 'grid';
    if (txt) txt.innerText = 'ซ่อนคู่มือ';
    if (icon) icon.innerText = '▲';
  } else {
    content.style.display = 'none';
    if (txt) txt.innerText = 'แสดงขั้นตอนวิธีตรวจ';
    if (icon) icon.innerText = '▼';
  }
};

window.stopScanner = function () {
  if (html5QrCode && html5QrCode.isScanning) {
    html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => { });
  }
};

// ==========================================
// 5. จัดการแบบฟอร์มตรวจสอบ (Dynamic Checklist)
// ==========================================
// เปิดหน้าแบบฟอร์มตรวจเช็ก (สำหรับเจ้าหน้าที่ที่ผ่านการ Login แล้ว)
window.openInspectionForm = function (assetId) {
  if (!requireLogin('บันทึกผลการตรวจ')) return;
  const asset = assetsList.find(a => a.assetId && a.assetId.toLowerCase() === assetId.toLowerCase());
  if (!asset) {
    alert(`ไม่พบอุปกรณ์รหัส "${assetId}" ในระบบ กรุณาตรวจสอบหรือลงทะเบียนใหม่`);
    return;
  }

  switchTab('scanner');

  document.getElementById('inspect-id').value = asset.assetId;
  document.getElementById('inspect-title').innerText = `ตรวจเช็ก: ${asset.assetId}`;
  document.getElementById('inspect-desc').innerText = `ประเภท: ${asset.type} | ตำแหน่ง: ${asset.building} - ${asset.location}`;

  // เติมชื่อและตำแหน่งช่างผู้ตรวจเช็กอัตโนมัติ (สามารถแก้ไขได้)
  const nameInput = document.getElementById('inspect-inspector-name');
  const roleInput = document.getElementById('inspect-inspector-role');
  if (nameInput && roleInput) {
    if (!nameInput.value) {
      nameInput.value = getCleanName(currentOfficer) || 'นายสุวิทย์ พวงสมบัติ';
      roleInput.value = 'นายช่างเทคนิค';
    }
  }

  // เรนเดอร์ฟอร์มตรวจเช็กตามประเภทอุปกรณ์แบบ Dynamic Checklist
  renderDynamicChecklist(asset, 'dynamic-checklist-container');

  document.getElementById('inspection-form-card').classList.remove('hidden');
  document.getElementById('inspection-form-card').scrollIntoView({ behavior: 'smooth' });
};

// จุดรับผลการสแกน (ฉลาดแยกแยะ: ถ้า Login อยู่แล้ว -> เปิดฟอร์มตรวจทันที, ถ้าเป็น Guest/คนนอก -> แสดงหน้ารายงานประวัติก่อน)
window.handleScanned = function (rawInput) {
  if (!rawInput) return;
  const assetId = extractAssetIdFromScan(rawInput);
  const asset = assetsList.find(a => a.assetId && a.assetId.toLowerCase() === assetId.toLowerCase());
  if (!asset) {
    alert(`ไม่พบอุปกรณ์รหัส "${assetId}" ในระบบ กรุณาตรวจสอบหรือลงทะเบียนใหม่`);
    return;
  }

  const session = getSession();
  const isLoggedIn = (session && session.officer && currentUserRole !== 'guest');

  if (isLoggedIn) {
    // เจ้าหน้าที่เข้าสู่ระบบแล้ว -> เปิดหน้าบันทึกตรวจเช็กทันที
    window.openInspectionForm(assetId);
  } else {
    // คนนอก / ยังไม่ล็อกอิน -> แสดงการ์ดข้อมูลประวัติและการรับรองก่อน พร้อมปุ่มกดเข้าตรวจเช็ก
    window.showAssetHistoryModal(asset.assetId);
  }
};

// บันทึกผลการตรวจเช็ก (รองรับทั้ง Offline Queue และ Online Cloud Firestore)
const inspectForm = document.getElementById('inspection-form');
if (inspectForm) {
  inspectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!requireLogin('บันทึกผลการตรวจเช็ก')) return;
    const btn = document.getElementById('btn-save-inspect');
    btn.innerText = "กำลังบันทึกข้อมูล...";
    btn.disabled = true;

    try {
      const assetId = document.getElementById('inspect-id').value;
      const assetIndex = assetsList.findIndex(a => a.assetId === assetId);
      if (assetIndex === -1) throw new Error("ไม่พบข้อมูลอุปกรณ์");

      // รวบรวมผลการตรวจจากฟอร์ม Dynamic Checklist
      const checkResult = collectDynamicChecklistResults('dynamic-checklist-container');
      const isPass = checkResult.isPass;
      const checkDetails = checkResult.details;
      const urgency = checkResult.urgency || (isPass ? 'NORMAL' : 'MEDIUM');

      const notes = document.getElementById('inspect-notes').value || "-";
      const photoFile = document.getElementById('inspect-photo').files[0];
      let photoURL = "";

      // จัดการภาพถ่าย: บีบอัดภาพก่อนเพื่อป้องกันไฟล์ใหญ่
      let optimizedFile = null;
      if (photoFile) {
        btn.innerText = "กำลังประมวลผลรูปภาพ...";
        optimizedFile = await compressImageFile(photoFile, 1024, 0.75);

        if (navigator.onLine && isFirebaseReady() && storage) {
          try {
            btn.innerText = "กำลังอัปโหลดรูปภาพขึ้น Cloud Storage...";
            const storageRef = ref(storage, `inspections/${assetId}_${Date.now()}.jpg`);
            const uploadRes = await uploadBytes(storageRef, optimizedFile);
            photoURL = await getDownloadURL(uploadRes.ref);
          } catch (storageErr) {
            console.warn("Firebase Storage upload failed, falling back to local compressed data URL:", storageErr);
            photoURL = await readFileAsDataURL(optimizedFile);
          }
        } else {
          photoURL = await readFileAsDataURL(optimizedFile);
        }
      }

      // ดึงชื่อช่างที่กรอกจากแบบฟอร์ม
      const inspectorName = getCleanName(document.getElementById('inspect-inspector-name')?.value.trim() || 'นายสุวิทย์ พวงสมบัติ');
      const inspectorRole = document.getElementById('inspect-inspector-role')?.value.trim() || 'นายช่างเทคนิค';
      currentOfficer = inspectorName;
      saveUserSession(currentOfficer, currentUserRole);

      const now = new Date();
      const logEntry = {
        id: `LOG_${Date.now()}`,
        assetId: assetId,
        inspector: inspectorName,
        status: isPass ? "READY" : "ISSUE",
        urgency: urgency,
        details: checkDetails,
        notes: notes,
        photoURL: photoURL,
        timestampStr: now.toLocaleString('th-TH'),
        timestampISO: now.toISOString()
      };

      // 1. เพิ่มเข้า Inspection Logs ในเครื่องทันที
      inspectionLogs.unshift(logEntry);
      storageService.set('pyh_inspection_logs', inspectionLogs);

      // 2. อัปเดตสถานะใน Assets List ในเครื่องทันที
      assetsList[assetIndex].status = isPass ? "READY" : "ISSUE";
      assetsList[assetIndex].lastChecked = now.toISOString();
      assetsList[assetIndex].lastInspector = inspectorName;
      assetsList[assetIndex].lastPhoto = photoURL;
      assetsList[assetIndex].urgency = urgency;
      storageService.set('pyh_assets_data', assetsList);

      // 3. จัดการบันทึกขึ้นคลาวด์ หรือเข้าคิวออฟไลน์ (Offline-First)
      const isOnline = navigator.onLine && isFirebaseReady() && db;
      if (isOnline) {
        try {
          await addDoc(collection(db, "inspection_logs"), {
            ...logEntry,
            timestamp: serverTimestamp()
          });

          if (assetsList[assetIndex].firestoreId) {
            await updateDoc(doc(db, "assets", assetsList[assetIndex].firestoreId), {
              status: isPass ? "READY" : "ISSUE",
              lastChecked: serverTimestamp(),
              lastInspector: inspectorName,
              lastPhoto: photoURL,
              urgency: urgency
            });
          }
        } catch (cloudErr) {
          console.warn("Cloud save failed, queueing offline task:", cloudErr);
          enqueueOfflineInspection({
            logEntry,
            assetFirestoreId: assetsList[assetIndex].firestoreId,
            assetUpdate: {
              status: isPass ? "READY" : "ISSUE",
              lastCheckedISO: now.toISOString(),
              lastInspector: inspectorName,
              lastPhoto: photoURL,
              urgency: urgency
            }
          });
        }
      } else {
        // ออฟไลน์อยู่ -> บันทึกลง Offline Queue
        enqueueOfflineInspection({
          logEntry,
          assetFirestoreId: assetsList[assetIndex].firestoreId,
          assetUpdate: {
            status: isPass ? "READY" : "ISSUE",
            lastCheckedISO: now.toISOString(),
            lastInspector: inspectorName,
            lastPhoto: photoURL,
            urgency: urgency
          }
        });
      }

      const statusMsg = isPass ? "✅ บันทึกผลการตรวจเช็กเรียบร้อย อุปกรณ์พร้อมใช้งาน" : "⚠️ อุปกรณ์ชำรุด บันทึกแจ้งซ่อมเข้าสู่ระบบเรียบร้อย";
      const offlineMsg = !isOnline ? "\n(💾 บันทึกในเครื่องแบบออฟไลน์แล้ว ระบบจะซิงก์ขึ้นคลาวด์อัตโนมัติเมื่อต่อเน็ต)" : "";
      alert(statusMsg + offlineMsg);

      inspectForm.reset();
      document.getElementById('inspection-form-card').classList.add('hidden');
      updateDashboardUI();
      renderMapPins();
      renderHistoryTable();
      switchTab('dashboard');

    } catch (err) {
      alert("เกิดข้อผิดพลาดในการบันทึก: " + err.message);
    } finally {
      btn.innerText = "บันทึกผลการตรวจสอบ";
      btn.disabled = false;
    }
  });
}

// บีบอัดภาพก่อนจัดเก็บ เพื่อความรวดเร็วและป้องกัน LocalStorage / Memory ล้น
function compressImageFile(file, maxWidth = 1024, quality = 0.75) {
  return new Promise((resolve) => {
    // ถ้าไม่ใช่รูปภาพ ให้คืนกลับตามเดิม
    if (!file || !file.type.startsWith('image/')) {
      resolve(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
                type: 'image/jpeg',
                lastModified: Date.now()
              });
              resolve(compressedFile);
            } else {
              resolve(file);
            }
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => resolve(file);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.readAsDataURL(file);
  });
}

// ==========================================
// ========================================== //
// 6. ลงทะเบียนอุปกรณ์ใหม่ (แยกไปที่ js/register-controller.js)
// ========================================== //
initRegisterController({
  getAssetsList: () => assetsList,
  setAssetsList: (val) => { assetsList = val; },
  requireLogin: (act) => requireLogin(act),
  updateDashboardUI: () => updateDashboardUI(),
  renderMapPins: () => renderMapPins(),
  isFirebaseReady: () => isFirebaseReady(),
  db: db
});

// 7. ประวัติการตรวจ (Audit Trail)
// ==========================================
// 7.5 ตารางรายการอุปกรณ์ + QR Code
// ==========================================
let _qrModalAsset = null; // เก็บ asset ที่เปิด QR modal อยู่

window.renderAssetListTable = function () {
  const tbody = document.getElementById('asset-list-rows');
  if (!tbody) return;

  const keyword = (document.getElementById('asset-search')?.value || '').toLowerCase();
  const sortMode = document.getElementById('asset-sort')?.value || 'default';

  let filtered = assetsList.filter(a =>
    !keyword ||
    a.assetId?.toLowerCase().includes(keyword) ||
    a.type?.toLowerCase().includes(keyword) ||
    a.location?.toLowerCase().includes(keyword) ||
    a.building?.toLowerCase().includes(keyword)
  );

  // เรียงลำดับ
  if (sortMode === 'issue-first') {
    filtered = [...filtered].sort((a, b) => {
      if (a.status === 'ISSUE' && b.status !== 'ISSUE') return -1;
      if (a.status !== 'ISSUE' && b.status === 'ISSUE') return 1;
      return 0;
    });
  } else if (sortMode === 'building') {
    filtered = [...filtered].sort((a, b) => (a.building || '').localeCompare(b.building || ''));
  } else if (sortMode === 'id') {
    filtered = [...filtered].sort((a, b) => (a.assetId || '').localeCompare(b.assetId || ''));
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#64748b; padding:20px;">ไม่พบอุปกรณ์</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((a, idx) => {
    const statusBadge = a.status === 'READY'
      ? `<span class="badge badge-ready">✅ พร้อมใช้</span>`
      : a.status === 'REPAIRING'
        ? `<span class="badge badge-repair">🛠️ ส่งซ่อม</span>`
        : a.status === 'ISSUE'
          ? `<span class="badge badge-issue">⚠️ แจ้งซ่อม</span>`
          : `<span style="color:#94a3b8;">-</span>`;

    // นับจำนวนครั้งที่เคยตรวจอุปกรณ์ชิ้นนี้
    const checkCount = inspectionLogs.filter(l => l.assetId?.toLowerCase() === a.assetId?.toLowerCase()).length;

    // ปุ่มส่งซ่อม / บันทึกซ่อมเสร็จ (สำหรับช่างและแอดมิน)
    let repairBtnHtml = '';
    if (currentUserRole !== 'guest' && currentUserRole !== 'executive') {
      if (a.status === 'ISSUE') {
        repairBtnHtml = `
          <button onclick="markAssetRepairing('${a.assetId}')"
            title="กดส่งซ่อมบำรุง"
            style="background:#f59e0b; color:white; border:none; border-radius:6px;
                   padding:4px 9px; font-size:0.75rem; cursor:pointer; font-weight:600; white-space:nowrap; margin-bottom:4px;">
            🔧 ส่งซ่อม
          </button>
        `;
      } else if (a.status === 'REPAIRING') {
        repairBtnHtml = `
          <button onclick="openRepairCompleteModal('${a.assetId}')"
            title="กดบันทึกเมื่อซ่อมเสร็จสิ้น"
            style="background:#10b981; color:white; border:none; border-radius:6px;
                   padding:4px 9px; font-size:0.75rem; cursor:pointer; font-weight:600; white-space:nowrap; margin-bottom:4px;">
            ✅ ซ่อมเสร็จแล้ว
          </button>
        `;
      }
    }

    // ปุ่มแก้ไขข้อมูลอุปกรณ์ (สำหรับช่าง, ผู้ตรวจ, และแอดมิน)
    let editBtnHtml = '';
    if (currentUserRole !== 'guest' && currentUserRole !== 'executive') {
      editBtnHtml = `
        <button onclick="openEditAssetModal('${a.assetId}')"
          title="แก้ไขข้อมูลอุปกรณ์ชิ้นนี้"
          style="background:#f0fdf4; color:#166534; border:1px solid #bbf7d0; border-radius:6px;
                 padding:4px 9px; font-size:0.75rem; cursor:pointer; font-weight:600; white-space:nowrap; transition:all 0.15s;"
          onmouseenter="this.style.background='#dcfce7'"
          onmouseleave="this.style.background='#f0fdf4'">
          ✏️ แก้ไข
        </button>
      `;
    }

    // ปุ่มลบอุปกรณ์ (เฉพาะสิทธิ์ Admin เท่านั้น)
    const deleteBtnHtml = (currentUserRole === 'admin')
      ? `<button onclick="adminDeleteAsset('${a.assetId}')"
           title="ลบอุปกรณ์ชิ้นนี้ (สิทธิ์แอดมิน)"
           style="background:#fee2e2; color:#dc2626; border:1px solid #fca5a5; border-radius:6px;
                  padding:4px 8px; font-size:0.75rem; cursor:pointer; font-weight:600; white-space:nowrap; transition:all 0.15s;"
           onmouseenter="this.style.background='#fecaca'"
           onmouseleave="this.style.background='#fee2e2'">
           🗑️ ลบ
         </button>`
      : '';

    return `<tr>
      <td style="text-align:center; color:#94a3b8; font-size:0.8rem; width:40px;">${idx + 1}</td>
      <td><b>${a.assetId}</b></td>
      <td style="font-size:0.82rem;">${a.type || '-'}</td>
      <td style="font-size:0.82rem;">${a.building || ''} ${a.location ? '— ' + a.location : ''}</td>
      <td>${statusBadge}</td>
      <td style="text-align:center;">
        <button onclick="showAssetHistoryModal('${a.assetId}')"
          style="background:#f1f5f9; color:#0f172a; border:1px solid #cbd5e1; border-radius:6px;
                 padding:4px 10px; font-size:0.8rem; cursor:pointer; font-weight:600; transition:all 0.2s;"
          onmouseenter="this.style.background='#e2e8f0'"
          onmouseleave="this.style.background='#f1f5f9'">
          📜 ดูประวัติ (${checkCount})
        </button>
      </td>
      <td style="text-align:center;">
        <div id="qr-mini-${a.assetId.replace(/[^a-zA-Z0-9]/g, '-')}"
          style="display:inline-block; cursor:pointer;"
          onclick="showQRModal('${a.assetId}')">
        </div>
      </td>
      <td style="text-align:center;">
        <div style="display:flex; flex-direction:column; gap:4px; align-items:center;">
          <button onclick="showQRModal('${a.assetId}')"
            style="background:#00695c; color:white; border:none; border-radius:6px;
                   padding:4px 10px; font-size:0.78rem; cursor:pointer; white-space:nowrap;">
            ${(currentUserRole === 'guest' || !currentUserRole) ? '🔍 ดู QR' : '🖨️ ดู / พิมพ์'}
          </button>
          ${editBtnHtml}
          ${repairBtnHtml}
          ${deleteBtnHtml}
        </div>
      </td>
    </tr>`;
  }).join('');

  // สร้าง QR เล็กๆ ในแต่ละแถว (สร้างด้วย Direct URL ให้สแกนเปิดได้ทันที)
  filtered.forEach(a => {
    const containerId = `qr-mini-${a.assetId.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const el = document.getElementById(containerId);
    if (el && el.innerHTML === '') {
      try { new QRCode(el, { text: getAssetDirectUrl(a.assetId), width: 48, height: 48 }); } catch (e) { }
    }
  });
};

// ==========================================
// การส่งซ่อมบำรุง & บันทึกซ่อมเสร็จสิ้น (Technician Repair Flow)
// ==========================================
window.markAssetRepairing = async function (assetId) {
  const asset = assetsList.find(a => a.assetId?.toLowerCase() === assetId?.toLowerCase());
  if (!asset) return;

  if (!confirm(`ต้องการส่งซ่อมอุปกรณ์ [${assetId}] ใช่ไหม?\nสถานะจะเปลี่ยนเป็น "🛠️ อยู่ระหว่างส่งซ่อม"`)) {
    return;
  }

  const now = new Date();
  asset.status = 'REPAIRING';
  asset.repairSentAt = now.toISOString();
  asset.repairSentBy = currentOfficer || 'ช่างเทคนิค';

  // บันทึกประวัติการส่งซ่อมเข้า inspectionLogs
  const repairLog = {
    id: `REPAIR_LOG_${Date.now()}`,
    assetId: assetId,
    inspector: currentOfficer || 'ช่างเทคนิค',
    status: 'REPAIRING',
    details: 'ส่งซ่อมบำรุง / นำส่งแก้ไข',
    notes: 'ส่งซ่อมบำรุงอุปกรณ์เนื่องจากมีรายงานข้อบกพร่อง',
    photoURL: '',
    timestampStr: now.toLocaleString('th-TH'),
    timestampISO: now.toISOString()
  };

  inspectionLogs.unshift(repairLog);
  storageService.set('pyh_inspection_logs', inspectionLogs);
  storageService.set('pyh_assets_data', assetsList);

  if (isFirebaseReady() && db) {
    try {
      if (asset.firestoreId) {
        await updateDoc(doc(db, "assets", asset.firestoreId), {
          status: 'REPAIRING',
          repairSentAt: serverTimestamp(),
          repairSentBy: asset.repairSentBy
        });
      }
      await addDoc(collection(db, "inspection_logs"), {
        ...repairLog,
        timestamp: serverTimestamp()
      });
    } catch (err) {
      console.warn("Firestore update error on markAssetRepairing", err);
    }
  }

  alert(`🛠️ นำส่งซ่อมอุปกรณ์ [${assetId}] เรียบร้อยแล้ว`);
  renderAssetListTable();
  updateDashboardUI();
  renderMapPins();
  renderHistoryTable();
};

window.openRepairCompleteModal = function (assetId) {
  const asset = assetsList.find(a => a.assetId?.toLowerCase() === assetId?.toLowerCase());
  if (!asset) return;

  const modal = document.getElementById('repair-complete-modal');
  const targetIdInput = document.getElementById('repair-target-asset-id');
  const modalTitle = document.getElementById('repair-modal-title');
  const techNameInput = document.getElementById('repair-technician-name');
  const notesInput = document.getElementById('repair-notes-input');

  if (targetIdInput) targetIdInput.value = assetId;
  if (modalTitle) modalTitle.innerText = `✅ รายงานผลการซ่อม: ${assetId}`;
  if (techNameInput) techNameInput.value = currentOfficer || '';
  if (notesInput) notesInput.value = '';

  if (modal) modal.style.display = 'flex';
};

window.closeRepairCompleteModal = function () {
  const modal = document.getElementById('repair-complete-modal');
  if (modal) modal.style.display = 'none';
};

window.submitAssetRepaired = async function () {
  const assetId = document.getElementById('repair-target-asset-id')?.value;
  const techName = document.getElementById('repair-technician-name')?.value.trim();
  const notes = document.getElementById('repair-notes-input')?.value.trim();
  const submitBtn = document.getElementById('repair-submit-btn');

  if (!assetId || !techName || !notes) {
    alert("กรุณากรอกข้อมูลช่างผู้ซ่อมและรายละเอียดการแก้ไขให้ครบถ้วน");
    return;
  }

  const asset = assetsList.find(a => a.assetId?.toLowerCase() === assetId?.toLowerCase());
  if (!asset) return;

  if (submitBtn) {
    submitBtn.innerText = "กำลังบันทึก...";
    submitBtn.disabled = true;
  }

  try {
    const now = new Date();
    asset.status = 'READY';
    asset.lastRepairedAt = now.toISOString();
    asset.lastRepairedBy = techName;
    asset.lastRepairedNotes = notes;
    asset.lastChecked = now.toISOString();
    asset.lastInspector = techName;

    // บันทึก log เข้า inspectionLogs
    const logEntry = {
      id: `REPAIRED_LOG_${Date.now()}`,
      assetId: assetId,
      inspector: techName + ' (บันทึกซ่อมเสร็จ)',
      status: 'READY',
      details: `ซ่อมแซมเสร็จสิ้น: ${notes}`,
      notes: `[การซ่อมบำรุง] ${notes}`,
      photoURL: '',
      timestampStr: now.toLocaleString('th-TH'),
      timestampISO: now.toISOString()
    };

    inspectionLogs.unshift(logEntry);
    storageService.set('pyh_inspection_logs', inspectionLogs);
    storageService.set('pyh_assets_data', assetsList);

    if (isFirebaseReady() && db) {
      if (asset.firestoreId) {
        await updateDoc(doc(db, "assets", asset.firestoreId), {
          status: 'READY',
          lastRepairedAt: serverTimestamp(),
          lastRepairedBy: techName,
          lastRepairedNotes: notes,
          lastChecked: serverTimestamp(),
          lastInspector: techName
        });
      }
      await addDoc(collection(db, "inspection_logs"), {
        ...logEntry,
        timestamp: serverTimestamp()
      });
    }

    alert(`🎉 ซ่อมแซมอุปกรณ์ [${assetId}] เสร็จสมบูรณ์แล้ว!\nสถานะอุปกรณ์กลับมาเป็น: ✅ พร้อมใช้งาน`);
    closeRepairCompleteModal();
    renderAssetListTable();
    updateDashboardUI();
    renderMapPins();
    renderHistoryTable();

  } catch (err) {
    alert("เกิดข้อผิดพลาดในการบันทึก: " + err.message);
  } finally {
    if (submitBtn) {
      submitBtn.innerText = "✅ ยืนยันซ่อมเสร็จ & คืนสถานะปกติ";
      submitBtn.disabled = false;
    }
  }
};

// ==========================================
// แก้ไขข้อมูลอุปกรณ์ (Edit Asset)
// ==========================================
window.openEditAssetModal = function (assetId) {
  const asset = assetsList.find(a => a.assetId?.toLowerCase() === assetId?.toLowerCase());
  if (!asset) {
    alert("ไม่พบข้อมูลอุปกรณ์");
    return;
  }

  const modal = document.getElementById('edit-asset-modal');
  const origIdInput = document.getElementById('edit-asset-orig-id');
  const idInput = document.getElementById('edit-asset-id');
  const typeSelect = document.getElementById('edit-asset-type');
  const statusSelect = document.getElementById('edit-asset-status');
  const bldgSelect = document.getElementById('edit-asset-building');
  const floorInput = document.getElementById('edit-asset-floor');
  const locInput = document.getElementById('edit-asset-location');

  if (origIdInput) origIdInput.value = asset.assetId;
  if (idInput) idInput.value = asset.assetId;
  if (typeSelect) typeSelect.value = asset.type || 'ถังดับเพลิงสีแดง';
  if (statusSelect) statusSelect.value = asset.status || 'READY';
  if (bldgSelect) {
    if (asset.buildingId && bldgSelect.querySelector(`option[value="${asset.buildingId}"]`)) {
      bldgSelect.value = asset.buildingId;
    } else {
      // ค้นหาจากชื่ออาคาร
      const opt = Array.from(bldgSelect.options).find(o => o.text.includes(asset.building || '') || (asset.building || '').includes(o.text));
      if (opt) bldgSelect.value = opt.value;
    }
  }
  if (floorInput) floorInput.value = asset.floor || 1;
  if (locInput) locInput.value = asset.location || '';

  const modalTitle = document.getElementById('edit-asset-modal-title');
  if (modalTitle) modalTitle.innerText = `✏️ แก้ไขข้อมูล: ${asset.assetId}`;

  if (modal) modal.style.display = 'flex';
};

window.closeEditAssetModal = function () {
  const modal = document.getElementById('edit-asset-modal');
  if (modal) modal.style.display = 'none';
};

window.submitEditAsset = async function () {
  const origAssetId = document.getElementById('edit-asset-orig-id')?.value;
  const newAssetId = document.getElementById('edit-asset-id')?.value.trim();
  const type = document.getElementById('edit-asset-type')?.value;
  const status = document.getElementById('edit-asset-status')?.value;
  const bldgSelect = document.getElementById('edit-asset-building');
  const buildingId = bldgSelect?.value;
  const buildingName = bldgSelect?.options[bldgSelect.selectedIndex]?.text || '';
  const floor = parseInt(document.getElementById('edit-asset-floor')?.value) || 1;
  const location = document.getElementById('edit-asset-location')?.value.trim();
  const submitBtn = document.getElementById('edit-asset-submit-btn');

  if (!newAssetId || !location) {
    alert("กรุณากรอกรหัสอุปกรณ์และตำแหน่งติดตั้งให้ครบถ้วน");
    return;
  }

  // หากเปลี่ยนรหัส ตรวจสอบว่าไม่ไปซ้ำกับตัวอื่น
  if (newAssetId.toUpperCase() !== origAssetId.toUpperCase()) {
    const isDuplicate = assetsList.some(a =>
      a.assetId?.toUpperCase() === newAssetId.toUpperCase() &&
      a.assetId?.toUpperCase() !== origAssetId.toUpperCase()
    );
    if (isDuplicate) {
      alert(`⚠️ รหัสอุปกรณ์ "${newAssetId}" มีอยู่ในระบบแล้ว กรุณาใช้รหัสอื่น`);
      return;
    }
  }

  const assetIndex = assetsList.findIndex(a => a.assetId?.toLowerCase() === origAssetId?.toLowerCase());
  if (assetIndex === -1) {
    alert("ไม่พบข้อมูลอุปกรณ์เดิมในระบบ");
    return;
  }

  const asset = assetsList[assetIndex];

  try {
    if (submitBtn) {
      submitBtn.innerText = "⏳ กำลังบันทึก...";
      submitBtn.disabled = true;
    }

    const oldAssetId = asset.assetId;
    const oldBuildingId = asset.buildingId;

    // อัปเดตข้อมูลใน object
    asset.assetId = newAssetId;
    asset.type = type;
    asset.status = status;
    asset.building = buildingName;
    asset.buildingId = buildingId;
    asset.floor = floor;
    asset.location = location;
    asset.updatedAt = new Date().toISOString();

    // บันทึกลง LocalStorage
    storageService.set('pyh_assets_data', assetsList);

    // หากมีการเปลี่ยนรหัสอุปกรณ์ ให้อัปเดตรหัสในประวัติการตรวจ (inspectionLogs) ด้วย เพื่อไม่ให้ประวัติหลุด
    if (oldAssetId.toUpperCase() !== newAssetId.toUpperCase()) {
      inspectionLogs.forEach(l => {
        if (l.assetId?.toLowerCase() === oldAssetId.toLowerCase()) {
          l.assetId = newAssetId;
        }
      });
      storageService.set('pyh_inspection_logs', inspectionLogs);
    }

    // ซิงค์ Cloud Database (Firestore) หากเปิดใช้งานอยู่
    if (isFirebaseReady() && db) {
      try {
        if (asset.firestoreId) {
          await updateDoc(doc(db, "assets", asset.firestoreId), {
            assetId: newAssetId,
            type,
            status,
            building: buildingName,
            buildingId,
            floor,
            location,
            updatedAt: serverTimestamp()
          });
        }
      } catch (cloudErr) {
        console.warn("Firestore update error in submitEditAsset:", cloudErr);
      }
    }

    alert(`💾 แก้ไขข้อมูลอุปกรณ์ [${newAssetId}] เรียบร้อยแล้ว`);
    closeEditAssetModal();

    // อัปเดต UI ทั่วทั้งระบบ
    renderAssetListTable();
    updateDashboardUI();
    renderMapPins();
    if (typeof window.renderRegisterExistingMarkers === 'function') {
      window.renderRegisterExistingMarkers();
    }
    renderHistoryTable();

  } catch (err) {
    alert("เกิดข้อผิดพลาดในการบันทึก: " + err.message);
  } finally {
    if (submitBtn) {
      submitBtn.innerText = "💾 บันทึกการแก้ไข";
      submitBtn.disabled = false;
    }
  }
};

// ==========================================
// แก้ไขหมายเหตุการตรวจเช็ก (Edit Inspection Note)
// ==========================================
window.openEditInspectionNoteModal = function (logId) {
  if (currentUserRole === 'guest') {
    alert("🔒 โหมดผู้เยี่ยมชม (Guest) ดูข้อมูลได้อย่างเดียวเท่านั้น\nกรุณาเข้าสู่ระบบด้วยบัญชีเจ้าหน้าที่เพื่อดำเนินการนี้");
    return;
  }
  const log = inspectionLogs.find(l => l.id === logId);
  if (!log) {
    alert("ไม่พบข้อมูลบันทึกการตรวจเช็กนี้");
    return;
  }

  const modal = document.getElementById('edit-inspection-note-modal');
  const logIdInput = document.getElementById('edit-note-log-id');
  const assetIdInput = document.getElementById('edit-note-asset-id');
  const displayAssetId = document.getElementById('edit-note-display-asset-id');
  const displayTime = document.getElementById('edit-note-display-time');
  const displayInspector = document.getElementById('edit-note-display-inspector');
  const noteTextarea = document.getElementById('edit-note-textarea');

  if (logIdInput) logIdInput.value = log.id;
  if (assetIdInput) assetIdInput.value = log.assetId || '';
  if (displayAssetId) displayAssetId.textContent = log.assetId || '-';
  if (displayTime) displayTime.textContent = log.timestampStr || log.timestampISO || '-';
  if (displayInspector) displayInspector.textContent = log.inspector || '-';
  if (noteTextarea) noteTextarea.value = (log.notes && log.notes !== '-') ? log.notes : '';

  if (modal) modal.style.display = 'flex';
};

window.closeEditInspectionNoteModal = function () {
  const modal = document.getElementById('edit-inspection-note-modal');
  if (modal) modal.style.display = 'none';
};

window.submitEditInspectionNote = async function () {
  const logId = document.getElementById('edit-note-log-id')?.value;
  const assetId = document.getElementById('edit-note-asset-id')?.value;
  const newNote = document.getElementById('edit-note-textarea')?.value.trim();
  const submitBtn = document.getElementById('edit-note-submit-btn');

  if (!logId) {
    alert("ไม่พบรหัสบันทึกการตรวจ");
    return;
  }

  const logIndex = inspectionLogs.findIndex(l => l.id === logId);
  if (logIndex === -1) {
    alert("ไม่พบบันทึกการตรวจในระบบ");
    return;
  }

  if (submitBtn) {
    submitBtn.innerText = "⏳ กำลังบันทึก...";
    submitBtn.disabled = true;
  }

  try {
    const updatedNote = newNote || "-";
    // อัปเดตใน Local State
    inspectionLogs[logIndex].notes = updatedNote;
    storageService.set('pyh_inspection_logs', inspectionLogs);

    // อัปเดตใน Firebase Cloud Firestore
    if (isFirebaseReady() && db) {
      try {
        const logDocRef = doc(db, "inspection_logs", logId);
        await updateDoc(logDocRef, {
          notes: updatedNote
        });
        console.log(`🔥 Updated notes for inspection log [${logId}] in Firestore`);

        // หากบันทึกนี้เป็นผลตรวจล่าสุดของอุปกรณ์ ให้อัปเดตหมายเหตุใน assets ด้วย (ถ้ามีฟิลด์)
        const assetIndex = assetsList.findIndex(a => a.assetId?.toLowerCase() === assetId?.toLowerCase());
        if (assetIndex !== -1 && assetsList[assetIndex].firestoreId) {
          await updateDoc(doc(db, "assets", assetsList[assetIndex].firestoreId), {
            lastNotes: updatedNote
          });
        }
      } catch (cloudErr) {
        console.warn("Firestore update error in submitEditInspectionNote:", cloudErr);
      }
    }

    alert(`💾 แก้ไขหมายเหตุการตรวจเช็กเรียบร้อยแล้ว`);
    closeEditInspectionNoteModal();
    renderHistoryTable();

  } catch (err) {
    alert("เกิดข้อผิดพลาดในการบันทึก: " + err.message);
  } finally {
    if (submitBtn) {
      submitBtn.innerText = "💾 บันทึกหมายเหตุ";
      submitBtn.disabled = false;
    }
  }
};

// ==========================================
// สิทธิ์ Admin: ลบอุปกรณ์ (Admin Delete Asset)
// ==========================================
window.adminDeleteAsset = async function (assetId) {
  if (currentUserRole !== 'admin') {
    alert("❌ คุณไม่มีสิทธิ์เข้าถึงฟังก์ชันนี้ (สำหรับแอดมินเท่านั้น)");
    return;
  }

  const assetIndex = assetsList.findIndex(a => a.assetId?.toLowerCase() === assetId?.toLowerCase());
  if (assetIndex === -1) {
    alert("ไม่พบข้อมูลอุปกรณ์");
    return;
  }

  const asset = assetsList[assetIndex];
  const confirmMsg = `⚠️ ยืนยันการลบอุปกรณ์ [${asset.assetId}] หรือไม่?\n\n• ประเภท: ${asset.type || '-'}\n• อาคาร/จุดติดตั้ง: ${asset.building || ''} (${asset.location || '-'})\n\nการลบนี้จะลบออกจากระบบและ Cloud Database ทันที`;
  if (!confirm(confirmMsg)) return;

  try {
    // ลบจาก Firestore หากเชื่อมต่ออยู่
    if (isFirebaseReady() && db && asset.firestoreId) {
      try {
        await deleteDoc(doc(db, "assets", asset.firestoreId));
      } catch (err) {
        console.warn("Firestore deleteDoc error:", err);
      }
    }

    // ลบจาก Local Array
    assetsList.splice(assetIndex, 1);
    storageService.set('pyh_assets_data', assetsList);

    alert(`🗑️ ลบอุปกรณ์ [${assetId}] ออกจากระบบเรียบร้อยแล้ว`);
    renderAssetListTable();
    updateDashboardUI();
    renderMapPins();
  } catch (e) {
    alert("เกิดข้อผิดพลาดในการลบอุปกรณ์: " + e.message);
  }
};

// ==========================================
// สิทธิ์ Admin: ลบอุปกรณ์ทั้งหมด (Admin Delete All Assets)
// ==========================================
window.adminDeleteAllAssets = async function () {
  if (currentUserRole !== 'admin') {
    alert("❌ คุณไม่มีสิทธิ์เข้าถึงฟังก์ชันนี้ (สำหรับแอดมินเท่านั้น)");
    return;
  }

  const currentCount = assetsList.length;
  if (currentCount === 0) {
    alert("⚠️ ขณะนี้ไม่มีรายการอุปกรณ์ในระบบ");
    return;
  }

  const confirmFirst = confirm(`🚨 คำเตือนสำคัญมาก! (ลบอุปกรณ์ทั้งหมด)\n\nคุณกำลังจะลบอุปกรณ์ทั้งหมด ${currentCount} จุด ออกจากระบบและฐานข้อมูล Cloud อย่างถาวร!\n\nคุณแน่ใจหรือไม่ว่าต้องการดำเนินการต่อ?`);
  if (!confirmFirst) return;

  const confirmText = prompt(`⚠️ เพื่อยืนยันการลบอุปกรณ์ทั้งหมด ${currentCount} จุด\nกรุณาพิมพ์คำว่า "DELETE ALL" หรือ "ลบทั้งหมด" ในช่องด้านล่าง:`);
  if (confirmText !== 'DELETE ALL' && confirmText !== 'ลบทั้งหมด') {
    alert("❌ การยืนยันไม่ถูกต้อง ยกเลิกคำสั่งลบอุปกรณ์ทั้งหมดแล้ว");
    return;
  }

  try {
    let cloudDeleted = 0;

    // 1. ลบข้อมูลจาก Firestore Cloud
    if (isFirebaseReady() && db) {
      const snap = await getDocs(collection(db, "assets"));
      for (const docSnap of snap.docs) {
        try {
          await deleteDoc(doc(db, "assets", docSnap.id));
          cloudDeleted++;
        } catch (err) {
          console.warn("Error deleting cloud asset doc:", docSnap.id, err);
        }
      }
    }

    // 2. เคลียร์ข้อมูลอุปกรณ์ใน LocalStorage และ Array
    assetsList = [];
    storageService.set('pyh_assets_data', []);

    // 3. อัปเดต UI ทั้งระบบ
    updateDashboardUI();
    renderMapPins();
    if (typeof renderAssetListTable === 'function') renderAssetListTable();
    if (typeof autoSuggestRegisterId === 'function') autoSuggestRegisterId();

    alert(`🗑️ ดำเนินการลบอุปกรณ์ทั้งหมดเรียบร้อยแล้ว!\n- ลบออกจากเครื่อง: ${currentCount} จุด\n- ลบออกจาก Firestore Cloud: ${cloudDeleted} รายการ\n\n(หากต้องการข้อมูลเริ่มต้นกลับมา สามารถกด 'นำเข้าข้อมูลสู่ระบบใหม่' หรือ 'โหลดข้อมูลเริ่มต้น' ได้เสมอ)`);
  } catch (err) {
    alert("❌ เกิดข้อผิดพลาดในการลบอุปกรณ์ทั้งหมด: " + err.message);
  }
};

// ฟังก์ชันเปิดดูประวัติการตรวจเฉพาะอุปกรณ์ชิ้นนี้ (Public Tag & History)
let _currentModalAssetId = null;
window.showAssetHistoryModal = function (assetId) {
  const asset = assetsList.find(a => a.assetId?.toLowerCase() === assetId?.toLowerCase());
  const modal = document.getElementById('asset-history-modal');
  const titleEl = document.getElementById('asset-modal-title');
  const subEl = document.getElementById('asset-modal-subtitle');
  const rowsEl = document.getElementById('asset-history-modal-rows');
  const statusBadge = document.getElementById('asset-modal-status-badge');
  const lastCheckEl = document.getElementById('asset-modal-last-check');

  if (!modal || !rowsEl) return;
  _currentModalAssetId = asset ? asset.assetId : assetId;

  const logs = inspectionLogs.filter(l => l.assetId?.toLowerCase() === assetId?.toLowerCase());

  titleEl.innerText = `📋 ข้อมูลอุปกรณ์: ${asset ? asset.assetId : assetId}`;
  subEl.innerText = `${asset?.type || 'อุปกรณ์ความปลอดภัย'} • ${asset?.building || ''} (${asset?.location || '-'})`;

  // อัปเดตสถานะปัจจุบัน
  if (statusBadge && asset) {
    if (asset.status === 'READY') {
      statusBadge.innerHTML = '<span style="color:#16a34a;">🟢 ปกติ พร้อมใช้งาน (READY)</span>';
    } else if (asset.status === 'REPAIRING') {
      statusBadge.innerHTML = '<span style="color:#d97706;">🔧 อยู่ระหว่างส่งซ่อม (REPAIRING)</span>';
    } else {
      statusBadge.innerHTML = '<span style="color:#dc2626;">⚠️ พบปัญหา ชำรุด (ISSUE)</span>';
    }
  }

  if (lastCheckEl) {
    const latestLog = logs[0];
    if (latestLog) {
      lastCheckEl.innerText = `${latestLog.timestampStr || latestLog.timestampISO || '-'} (${latestLog.inspector || 'ช่างเทคนิค'})`;
    } else if (asset && asset.lastChecked) {
      lastCheckEl.innerText = asset.lastChecked;
    } else {
      lastCheckEl.innerText = 'ยังไม่มีประวัติการตรวจ';
    }
  }

  if (logs.length === 0) {
    rowsEl.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; color:#64748b; padding:28px 16px;">
          ยังไม่เคยมีบันทึกการตรวจเช็กสำหรับอุปกรณ์ <b>${assetId}</b>
        </td>
      </tr>
    `;
  } else {
    rowsEl.innerHTML = logs.map((log, i) => {
      const isPass = log.status === 'READY';
      return `
        <tr>
          <td style="text-align:center; color:#94a3b8; font-size:0.8rem;">${i + 1}</td>
          <td style="font-size:0.82rem; white-space:nowrap;">${log.timestampStr || log.timestampISO || '-'}</td>
          <td style="font-size:0.82rem;">${log.inspector || '-'}</td>
          <td><span class="badge ${isPass ? 'badge-ready' : 'badge-issue'}">${isPass ? '✅ ปกติ' : '⚠️ ชำรุด'}</span></td>
          <td>${log.photoURL ? `<a href="${log.photoURL}" target="_blank"><img class="img-thumb" src="${log.photoURL}" alt="หลักฐาน"></a>` : '-'}</td>
          <td style="font-size:0.82rem;">${log.notes || '-'}</td>
        </tr>
      `;
    }).join('');
  }

  modal.style.display = 'flex';
};

// นำทางจาก Modal สู่แบบฟอร์มตรวจเช็ก (ถ้ายังไม่ล็อกอิน requireLogin จะเด้งเข้าหน้า login ก่อน แล้วกลับมาทำต่อ)
window.goToInspectFromModal = function () {
  const assetId = _currentModalAssetId;
  closeAssetHistoryModal();
  if (assetId) {
    // บันทึกเป้าหมายไว้ เพื่อหลัง login สำเร็จจะได้เด้งมาเปิดฟอร์มจุดนี้ต่อทันที
    window._pendingInspectAssetId = assetId;
    window.openInspectionForm(assetId);
  }
};

window.closeAssetHistoryModal = function () {
  const modal = document.getElementById('asset-history-modal');
  if (modal) modal.style.display = 'none';
};

window.showQRModal = function (assetId) {
  const asset = assetsList.find(a => a.assetId === assetId);
  if (!asset) return;
  _qrModalAsset = asset;

  const modal = document.getElementById('qr-modal');
  const title = document.getElementById('qr-modal-title');
  const canvas = document.getElementById('qr-modal-canvas');
  const label = document.getElementById('qr-modal-label');

  title.textContent = `QR Code — ${asset.assetId}`;
  label.innerHTML = `<b>${asset.assetId}</b><br>${asset.type || ''}<br>${asset.building || ''} ${asset.location ? '— ' + asset.location : ''}`;
  canvas.innerHTML = '';

  new QRCode(canvas, {
    text: getAssetDirectUrl(asset.assetId),
    width: 200,
    height: 200,
    colorDark: '#000000',
    colorLight: '#ffffff'
  });

  // ซ่อนปุ่มพิมพ์และบันทึกภาพสำหรับ Guest
  const isGuest = (!currentUserRole || currentUserRole === 'guest');
  const printBtn = document.getElementById('qr-modal-print-btn');
  const downloadBtn = document.getElementById('qr-modal-download-btn');
  if (printBtn) printBtn.style.display = isGuest ? 'none' : 'inline-block';
  if (downloadBtn) downloadBtn.style.display = isGuest ? 'none' : 'inline-block';

  modal.style.display = 'flex';
};

window.closeQRModal = function () {
  document.getElementById('qr-modal').style.display = 'none';
  _qrModalAsset = null;
};

window.downloadQR = async function () {
  if (!_qrModalAsset) return;
  const cardEl = document.getElementById('qr-tag-card-preview');
  
  // หากมี html2canvas ให้จับภาพทั้งป้ายสติ๊กเกอร์ (Sticker Tag Card)
  if (typeof window.html2canvas === 'function' && cardEl) {
    try {
      const origCanvasInTag = cardEl.querySelector('#qr-modal-canvas canvas');
      const origImgInTag = cardEl.querySelector('#qr-modal-canvas img');
      // ซ่อน duplicate canvas ให้เหลือเฉพาะรูป img เพื่อความคมชัด
      if (origCanvasInTag && origImgInTag) {
        origCanvasInTag.style.display = 'none';
      }
      const renderedCanvas = await window.html2canvas(cardEl, {
        scale: 2, // ความคมชัดสูง 2 เท่า
        useCORS: true,
        backgroundColor: '#ffffff'
      });
      if (origCanvasInTag && origImgInTag) {
        origCanvasInTag.style.display = '';
      }
      const link = document.createElement('a');
      link.download = `TAG-${_qrModalAsset.assetId}.png`;
      link.href = renderedCanvas.toDataURL('image/png');
      link.click();
      return;
    } catch (err) {
      console.warn('html2canvas capture failed, fallback to raw QR code image', err);
    }
  }

  // Fallback กรณีไม่มี html2canvas
  const canvas = document.querySelector('#qr-modal-canvas canvas') || document.querySelector('#qr-modal-canvas img');
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = `QR-${_qrModalAsset.assetId}.png`;
  link.href = (canvas.tagName.toLowerCase() === 'img') ? canvas.src : canvas.toDataURL('image/png');
  link.click();
};

window.printQRModal = function () {
  if (!requireLogin('สั่งพิมพ์ QR Code')) return;
  const canvas = document.querySelector('#qr-modal-canvas canvas');
  const imgEl = document.querySelector('#qr-modal-canvas img');
  if ((!canvas && !imgEl) || !_qrModalAsset) return;
  const a = _qrModalAsset;
  const qrDataUrl = canvas ? canvas.toDataURL() : (imgEl ? imgEl.src : '');

  const win = window.open('', '_blank');
  win.document.write(`
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8"><title>SAFETY TAG - ${a.assetId}</title>
    <style>
      @page {
        size: auto;
        margin: 4mm;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 4px;
        font-family: 'Sarabun', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: flex;
        justify-content: flex-start;
        align-items: flex-start;
        background: #fff;
      }
      .sticker-tag {
        width: 80mm;
        border: 2px solid #0f172a;
        border-radius: 6px;
        padding: 8px 10px;
        text-align: center;
        background: #fff;
        page-break-inside: avoid;
      }
      .tag-header {
        border-bottom: 2px solid #004d40;
        padding-bottom: 4px;
        margin-bottom: 6px;
      }
      .tag-title {
        font-size: 13px;
        font-weight: 700;
        color: #004d40;
        line-height: 1.2;
      }
      .tag-sub {
        font-size: 10px;
        color: #475569;
        font-weight: 600;
      }
      .tag-qr {
        margin: 6px auto;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .tag-qr img {
        width: 130px;
        height: 130px;
        display: block;
      }
      .tag-id {
        font-size: 15px;
        font-weight: 800;
        color: #0f172a;
        margin: 4px 0 2px;
        letter-spacing: 0.5px;
      }
      .tag-type {
        font-size: 11px;
        font-weight: 600;
        color: #004d40;
        margin-bottom: 2px;
      }
      .tag-loc {
        font-size: 10px;
        color: #334155;
        line-height: 1.3;
      }
      .tag-footer {
        border-top: 1px dashed #94a3b8;
        margin-top: 6px;
        padding-top: 4px;
        font-size: 9px;
        color: #64748b;
      }
      @media print {
        body { padding: 0; }
        .sticker-tag { box-shadow: none; }
      }
    </style></head><body>
      <div class="sticker-tag">
        <div class="tag-header">
          <div class="tag-title">🏥 โรงพยาบาลพยุหะคีรี</div>
          <div class="tag-sub">FIRE & SAFETY INSPECTION TAG</div>
        </div>
        <div class="tag-qr">
          <img src="${qrDataUrl}">
        </div>
        <div class="tag-id">${a.assetId}</div>
        <div class="tag-type">${a.type || 'อุปกรณ์ความปลอดภัย'}</div>
        <div class="tag-loc">${a.building || ''} ${a.location ? '— ' + a.location : ''}</div>
        <div class="tag-footer">📷 สแกนผ่าน LINE / กล้องมือถือ เพื่อตรวจ & ดูประวัติ</div>
      </div>
      <script>
        window.onload = () => {
          setTimeout(() => {
            window.print();
            window.close();
          }, 300);
        };
      <\/script>
    </body></html>`);
  win.document.close();
};

window.printAllQR = function () {
  if (!requireLogin('สั่งพิมพ์ QR Code')) return;
  const keyword = (document.getElementById('asset-search')?.value || '').toLowerCase();
  const filtered = assetsList.filter(a =>
    !keyword ||
    a.assetId?.toLowerCase().includes(keyword) ||
    a.type?.toLowerCase().includes(keyword) ||
    a.location?.toLowerCase().includes(keyword)
  );
  if (filtered.length === 0) { alert('ไม่พบอุปกรณ์ในรายการ'); return; }

  const win = window.open('', '_blank');
  const items = filtered.map(a => `
    <div class="qr-item">
      <div class="tag-header">
        <div class="tag-title">🏥 รพ.พยุหะคีรี</div>
        <div class="tag-sub">SAFETY TAG</div>
      </div>
      <div class="qr-canvas-holder" id="qr-${a.assetId.replace(/[^a-zA-Z0-9]/g, '-')}"></div>
      <b class="tag-id">${a.assetId}</b>
      <div class="tag-type">${a.type || ''}</div>
      <div class="tag-loc">${a.building || ''} ${a.location ? '— ' + a.location : ''}</div>
      <div class="tag-footer">📷 สแกนผ่าน LINE / กล้อง เพื่อตรวจ</div>
    </div>`).join('');

  win.document.write(`
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8"><title>SAFETY TAGS ทั้งหมด (${filtered.length} รายการ)</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
    <style>
      @page {
        size: A4;
        margin: 8mm;
      }
      * { box-sizing: border-box; }
      body {
        font-family: 'Sarabun', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        margin: 0;
        padding: 4px;
        background: #fff;
      }
      .grid {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-start;
      }
      .qr-item {
        border: 1.5px solid #0f172a;
        border-radius: 6px;
        padding: 6px;
        text-align: center;
        width: 175px;
        font-size: 0.72rem;
        break-inside: avoid;
        background: #fff;
      }
      .tag-header {
        border-bottom: 1.5px solid #004d40;
        padding-bottom: 2px;
        margin-bottom: 4px;
      }
      .tag-title {
        font-size: 11px;
        font-weight: 700;
        color: #004d40;
        line-height: 1.2;
      }
      .tag-sub {
        font-size: 8px;
        color: #64748b;
        font-weight: 600;
      }
      /* ซ่อน Canvas ที่ duplicate จาก qrcodejs ให้แสดงเฉพาะภาพ img */
      .qr-canvas-holder canvas {
        display: none !important;
      }
      .qr-canvas-holder img {
        margin: 4px auto !important;
        display: block !important;
        width: 100px !important;
        height: 100px !important;
      }
      .tag-id {
        font-size: 12px;
        font-weight: 800;
        display: block;
        margin: 4px 0 1px;
        color: #0f172a;
      }
      .tag-type {
        font-size: 9.5px;
        font-weight: 600;
        color: #004d40;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .tag-loc {
        font-size: 8.5px;
        color: #475569;
        line-height: 1.2;
        height: 22px;
        overflow: hidden;
      }
      .tag-footer {
        border-top: 1px dashed #cbd5e1;
        margin-top: 4px;
        padding-top: 3px;
        font-size: 7.5px;
        color: #64748b;
      }
      @media print {
        body { margin: 0; padding: 0; }
        .grid { gap: 6px; }
      }
    </style></head>
    <body>
      <div class="grid">${items}</div>
      <script>
        const assets = ${JSON.stringify(filtered)};
        const baseUrl = ${JSON.stringify(getAssetDirectUrl('__ID__'))};
        assets.forEach(a => {
          const el = document.getElementById('qr-' + a.assetId.replace(/[^a-zA-Z0-9]/g,'-'));
          const directUrl = baseUrl.replace('__ID__', encodeURIComponent(a.assetId));
          if (el) {
            new QRCode(el, {
              text: directUrl,
              width: 100,
              height: 100,
              correctLevel: QRCode.CorrectLevel.M
            });
          }
        });
        setTimeout(() => {
          window.print();
        }, 1200);
      <\/script>
    </body></html>`);
  win.document.close();
};

// เรียก render เมื่อเข้า tab history
const _origSwitchTab = window.switchTab;

// ==========================================
// 8. การสำรองข้อมูลและการโอนย้าย (Backup & Migration)
// ==========================================
// ฟังก์ชันอัปโหลดข้อมูลอุปกรณ์ทั้งหมด 48-56 จุด และผู้ใช้เริ่มต้นขึ้น Firebase Firestore ทันที
window.syncAllAssetsToFirestore = async function () {
  if (!isFirebaseReady() || !db) {
    alert("⚠️ ระบบยังไม่ได้เชื่อมต่อกับ Firebase หรือการตั้งค่า Config ไม่ถูกต้อง");
    return;
  }

  if (!confirm("ต้องการอัปโหลดข้อมูลอุปกรณ์ทั้งหมดและบัญชีผู้ใช้งานขึ้น Firebase Firestore ใช่หรือไม่?")) return;

  try {
    let count = 0;
    // 1. อัปโหลดอุปกรณ์
    for (const asset of assetsList) {
      const docId = asset.assetId.replace(/[^a-zA-Z0-9]/g, '_');
      const cleanAsset = { ...asset };
      delete cleanAsset.firestoreId;
      await setDoc(doc(db, "assets", docId), cleanAsset);
      count++;
    }

    // 2. อัปโหลดผู้ใช้เริ่มต้น
    const defaultUsers = [
      {
        name: "ผู้ดูแลระบบไอทีและอาคาร",
        dept: "ศูนย์สารสนเทศและเทคโนโลยี รพ.พยุหะคีรี",
        email: "admin@pyuhahospital.go.th",
        password: "Admin@Pyuha2026!",
        role: "admin",
        verified: true,
        createdAt: new Date().toISOString()
      },
      {
        name: "นายสุวิทย์ พวงสมบัติ",
        dept: "นายช่างเทคนิค",
        email: "suwit@pyuhahospital.go.th",
        password: "Suwit@2026!",
        role: "inspector",
        verified: true,
        createdAt: new Date().toISOString()
      },
      {
        name: "นายคมสันต์ ศรีสิงห์",
        dept: "นักเทคนิคการแพทย์ปฏิบัติการ รักษาราชการแทน <br>หัวหน้าฝ่ายบริหารทั่วไป",
        email: "komsan@pyuhahospital.go.th",
        password: "Komsan@2026!",
        role: "chef_inspector",
        verified: true,
        createdAt: new Date().toISOString()
      },
      {
        name: "นางสาวศิริพรรณ ชมพูภู่",
        dept: "ผู้อำนวยการโรงพยาบาลพยุหะคีรี",
        email: "director@pyuhahospital.go.th",
        password: "Director@2026!",
        role: "executive",
        verified: true,
        createdAt: new Date().toISOString()
      }
    ];

    for (const u of defaultUsers) {
      const docId = u.email.replace(/[^a-zA-Z0-9]/g, '_');
      await setDoc(doc(db, "system_users", docId), u);
    }

    alert(`✅ อัปโหลดข้อมูลสำเร็จเรียบร้อย!\n- อุปกรณ์ขึ้น Firestore: ${count} จุด\n- บัญชีผู้ใช้งานระบบ: 4 บัญชี\n\nสามารถเปิดดูใน Firebase Console ได้ทันที`);
  } catch (err) {
    alert("❌ เกิดข้อผิดพลาดในการอัปโหลด: " + err.message);
  }
};

// ฟังก์ชันทำความสะอาดข้อมูลอุปกรณ์ที่ซ้ำซ้อนใน Firestore และ LocalStorage (Clean Duplicate Assets)
window.cleanDuplicateAssetsFromCloud = async function () {
  if (currentUserRole !== 'admin') {
    alert("❌ ฟังก์ชันนี้สงวนไว้สำหรับผู้ดูแลระบบ (Admin) เท่านั้น");
    return;
  }

  if (!confirm("ต้องการสแกนและลบรายการอุปกรณ์ที่ซ้ำซ้อนกันในฐานข้อมูลทั้งหมดใช่หรือไม่?\n(ระบบจะเก็บเฉพาะรายการล่าสุดไว้เพียง 1 จุดต่อ 1 รหัสอุปกรณ์)")) {
    return;
  }

  try {
    let deletedCount = 0;

    // 1. ตรวจสอบและลบใน Firestore (ถ้าเชื่อมต่ออยู่)
    if (isFirebaseReady() && db) {
      const snap = await getDocs(collection(db, "assets"));
      const seen = new Map();

      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const assetId = (data.assetId || '').trim().toUpperCase();
        if (!assetId) continue;

        if (!seen.has(assetId)) {
          seen.set(assetId, { docId: docSnap.id, data: data });
        } else {
          // พบตัวซ้ำ! เลือกลบตัวที่เก่ากว่าหรือตัวที่ซ้ำ
          const prev = seen.get(assetId);
          let toDeleteId = docSnap.id;
          // ถ้าตัวใหม่มี lastChecked ใหม่กว่า ให้ลบตัวเดิมแล้วเก็บตัวใหม่แทน
          if (data.lastChecked && (!prev.data.lastChecked || data.lastChecked > prev.data.lastChecked)) {
            toDeleteId = prev.docId;
            seen.set(assetId, { docId: docSnap.id, data: data });
          }
          await deleteDoc(doc(db, "assets", toDeleteId));
          deletedCount++;
        }
      }
    }

    // 2. เคลียร์ใน LocalStorage
    const beforeCount = assetsList.length;
    assetsList = deduplicateAssets(assetsList);
    storageService.set('pyh_assets_data', assetsList);
    const localRemoved = beforeCount - assetsList.length;

    updateDashboardUI();
    renderMapPins();
    if (typeof renderAssetListTable === 'function') renderAssetListTable();

    alert(`✨ ล้างรายการซ้ำเรียบร้อยแล้ว!\n- ลบข้อมูลซ้ำใน Firestore Cloud: ${deletedCount} รายการ\n- ลบข้อมูลซ้ำในเครื่องนี้: ${localRemoved} รายการ\n\nปัจจุบันมีอุปกรณ์พร้อมใช้งานทั้งหมด: ${assetsList.length} จุด`);
  } catch (err) {
    alert("❌ เกิดข้อผิดพลาดในการลบรายการซ้ำ: " + err.message);
  }
};

window.exportSystemData = function () {
  try {
    const backupData = {
      hospital: "โรงพยาบาลพยุหะคีรี",
      system: "Pyuha Smart Fire & Safety Cloud",
      exportedAt: new Date().toISOString(),
      assets: assetsList,
      inspection_logs: inspectionLogs
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_pyuha_safety_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    alert("ดาวน์โหลดไฟล์สำรองข้อมูล (JSON) สำเร็จแล้ว สามารถนำไปใช้ในระบบของโรงพยาบาลได้ทันที");
  } catch (e) {
    alert("เกิดข้อผิดพลาดในการส่งออกข้อมูล: " + e.message);
  }
};

window.importSystemData = function (event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.assets) throw new Error("รูปแบบไฟล์ JSON ไม่ถูกต้อง");

      if (!confirm(`พบข้อมูลอุปกรณ์ ${data.assets.length} จุด ยืนยันการนำเข้าข้อมูลหรือไม่?`)) return;

      assetsList = deduplicateAssets(data.assets);
      storageService.set('pyh_assets_data', assetsList);

      if (data.inspection_logs) {
        inspectionLogs = data.inspection_logs;
        storageService.set('pyh_inspection_logs', inspectionLogs);
      }

      // หากมี Firebase พร้อม ให้บันทึกลง Cloud
      if (isFirebaseReady() && db) {
        for (const item of assetsList) {
          const { firestoreId, ...cleanAsset } = item;
          const docId = cleanAsset.assetId ? cleanAsset.assetId.replace(/[^a-zA-Z0-9]/g, '_') : null;
          if (docId) {
            await setDoc(doc(db, "assets", docId), cleanAsset);
          }
        }
      }

      alert("นำเข้าข้อมูลสำเร็จครบถ้วน!");
      location.reload();
    } catch (err) {
      alert("นำเข้าข้อมูลไม่สำเร็จ: " + err.message);
    }
  };
  reader.readAsText(file);
};

// ==========================================
// 9. ระบบจัดการผู้ใช้และระดับสิทธิ์ (RBAC) — ดึงจาก Firestore
// ==========================================

const DEFAULT_SYSTEM_USERS = [
  {
    name: "ผู้ดูแลระบบไอทีและอาคาร",
    dept: "ศูนย์สารสนเทศและเทคโนโลยี รพ.พยุหะคีรี",
    email: "admin@pyuhahospital.go.th",
    password: "Admin@Pyuha2026!",
    role: "admin",
    verified: true,
    createdAt: "2026-01-01T00:00:00.000Z"
  },
  {
    name: "นายสุวิทย์ พวงสมบัติ",
    dept: "นายช่างเทคนิค",
    email: "suwit@pyuhahospital.go.th",
    password: "Suwit@2026!",
    role: "inspector",
    verified: true,
    createdAt: "2026-01-01T00:00:00.000Z"
  },
  {
    name: "นายคมสันต์ ศรีสิงห์",
    dept: "นักเทคนิคการแพทย์ปฏิบัติการ รักษาราชการแทน <br>หัวหน้าฝ่ายบริหารทั่วไป",
    email: "komsan@pyuhahospital.go.th",
    password: "Komsan@2026!",
    role: "chef_inspector",
    verified: true,
    createdAt: "2026-01-01T00:00:00.000Z"
  },
  {
    name: "นางสาวศิริพรรณ ชมพูภู่",
    dept: "ผู้อำนวยการโรงพยาบาลพยุหะคีรี",
    email: "director@pyuhahospital.go.th",
    password: "Director@2026!",
    role: "executive",
    verified: true,
    createdAt: "2026-01-01T00:00:00.000Z"
  }
];

// cache users ที่โหลดมาจาก Firestore ไว้ใน memory (เริ่มต้นด้วยผู้ใช้มาตรฐาน 4 ท่าน)
let _cachedUsers = [...DEFAULT_SYSTEM_USERS];

// โหลด users จาก Firestore (เรียกครั้งแรก หรือเมื่อต้องการ refresh)
async function loadUsersFromFirestore() {
  if (!isFirebaseReady() || !db) return _cachedUsers;
  try {
    const snapshot = await getDocs(collection(db, "system_users"));
    const users = [];
    snapshot.forEach(d => users.push({ id: d.id, ...d.data() }));
    if (users.length > 0) {
      _cachedUsers = users;
    }
    return _cachedUsers;
  } catch (e) {
    console.warn("Cannot load users from Firestore:", e.message);
    return _cachedUsers;
  }
}

// ดึง users (จาก cache ถ้ามีแล้ว, ถ้าไม่มีให้ return DEFAULT_SYSTEM_USERS และโหลด async)
function getStoredUsers() {
  if (_cachedUsers && _cachedUsers.length > 0) return _cachedUsers;
  loadUsersFromFirestore().then(users => { _cachedUsers = users; });
  return DEFAULT_SYSTEM_USERS;
}

// บันทึก users กลับขึ้น Firestore
async function saveStoredUsers(users) {
  _cachedUsers = users; // อัปเดต cache ทันที
  if (!isFirebaseReady() || !db) return;
  // เขียนทีละ doc ด้วย email เป็น ID
  for (const u of users) {
    try {
      const docId = u.email.replace(/[^a-zA-Z0-9]/g, '_');
      await setDoc(doc(db, "system_users", docId), u);
    } catch (e) {
      console.warn("Failed to save user to Firestore:", e.message);
    }
  }
}


window.openAuthModal = function () {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.remove('hidden');
};

window.closeAuthModal = function () {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.add('hidden');
};

window.toggleAuthMode = function (mode) {
  const loginSec = document.getElementById('login-section');
  const regSec = document.getElementById('register-section');
  const tabLogin = document.getElementById('tab-btn-login');
  const tabRegister = document.getElementById('tab-btn-register');

  if (mode === 'register') {
    if (loginSec) loginSec.classList.add('hidden');
    if (regSec) regSec.classList.remove('hidden');
    if (tabLogin) tabLogin.classList.remove('active');
    if (tabRegister) tabRegister.classList.add('active');
  } else {
    if (loginSec) loginSec.classList.remove('hidden');
    if (regSec) regSec.classList.add('hidden');
    if (tabLogin) tabLogin.classList.add('active');
    if (tabRegister) tabRegister.classList.remove('active');
  }
};

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    window.closeAuthModal();
  }
});

window.loginWithEmail = async function () {
  const emailInput = document.getElementById('login-email');
  const pwdInput = document.getElementById('login-pwd');
  const email = emailInput ? emailInput.value.trim() : "";
  const pwd = pwdInput ? pwdInput.value : "";

  if (!email || !pwd) {
    alert("กรุณากรอกอีเมลและรหัสผ่าน");
    return;
  }

  // 1. ตรวจสอบในฐานข้อมูลระบบ Local Users (Admin, ช่างสุวิทย์, ผอ.ศิริพรรณ และบัญชีที่แอดมินสร้าง)
  const users = getStoredUsers();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());

  if (user) {
    if (user.password !== pwd) {
      alert("รหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง");
      return;
    }
    if (!user.verified) {
      alert("❌ บัญชีนี้ยังไม่ได้รับการยืนยันตัวตนจากผู้ดูแลระบบ (Admin)\nกรุณาติดต่อผู้ดูแลระบบเพื่อทำการยืนยันสิทธิ์ก่อนเริ่มใช้งาน");
      return;
    }

    currentOfficer = getCleanName(user.name);
    currentUserRole = user.role;
    saveUserSession(currentOfficer, currentUserRole);
    window.closeAuthModal();

    if (emailInput) emailInput.value = "";
    if (pwdInput) pwdInput.value = "";

    if (currentUserRole === 'admin') {
      window.switchTab('admin');
      alert("เข้าสู่ระบบสำเร็จในฐานะ: " + user.name + "\nระดับสิทธิ์: ผู้ดูแลระบบ (System Admin)");
    } else if (currentUserRole === 'executive') {
      window.switchTab('report');
      alert("เข้าสู่ระบบสำเร็จในฐานะ: " + user.name + "\nระดับสิทธิ์: ผู้บริหาร (Executive)");
    } else if (currentUserRole === 'chef_inspector' || currentUserRole === 'chef inspector') {
      window.switchTab('report');
      alert("เข้าสู่ระบบสำเร็จในฐานะ: " + user.name + "\nระดับสิทธิ์: หัวหน้าผู้ตรวจสอบ (Chef Inspector)");
    } else {
      window.switchTab('scanner');
      alert("เข้าสู่ระบบสำเร็จในฐานะ: " + user.name + "\nระดับสิทธิ์: เจ้าหน้าที่ผู้ตรวจเช็ก (Inspector)");
    }
    return;
  }

  // 2. หากเชื่อมต่อกับ Firebase Cloud Auth
  if (isFirebaseReady() && auth) {
    try {
      await signInWithEmailAndPassword(auth, email, pwd);
      window.closeAuthModal();
    } catch (err) {
      alert("เข้าสู่ระบบไม่สำเร็จ: " + err.message);
    }
  } else {
    alert("ไม่พบบัญชีผู้ใช้งานนี้ในระบบ\nหากเพิ่งลงทะเบียน กรุณาติดต่อผู้ดูแลระบบ (Admin) เพื่อยืนยันตัวตน");
  }
};

window.registerUser = async function () {
  const nameInput = document.getElementById('reg-name');
  const deptInput = document.getElementById('reg-dept');
  const roleInput = document.getElementById('reg-role');
  const emailInput = document.getElementById('reg-email');
  const pwdInput = document.getElementById('reg-pwd');

  const name = nameInput ? nameInput.value.trim() : "";
  const dept = deptInput ? deptInput.value.trim() : "";
  const role = roleInput ? roleInput.value : "inspector";
  const email = emailInput ? emailInput.value.trim() : "";
  const pwd = pwdInput ? pwdInput.value : "";

  if (!name || !email || pwd.length < 6) {
    alert("กรุณากรอกข้อมูลให้ครบถ้วน และรหัสผ่านอย่างน้อย 6 ตัวอักษร");
    return;
  }

  const users = getStoredUsers();
  if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    alert("อีเมลนี้มีอยู่ในระบบแล้ว กรุณาใช้อีเมลอื่น หรือติดต่อผู้ดูแลระบบ");
    return;
  }

  const newUser = {
    name: name,
    dept: dept || "หน่วยงาน รพ.พยุหะคีรี",
    email: email,
    password: pwd,
    role: role,
    verified: false,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  saveStoredUsers(users);

  if (isFirebaseReady() && auth && db) {
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pwd);
      await setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        name: name,
        department: dept,
        role: role,
        email: email,
        verified: false,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      console.warn("Firebase create user warning:", err.message);
    }
  }

  if (nameInput) nameInput.value = "";
  if (deptInput) deptInput.value = "";
  if (emailInput) emailInput.value = "";
  if (pwdInput) pwdInput.value = "";

  window.toggleAuthMode('login');
  alert("ลงทะเบียนเจ้าหน้าที่เรียบร้อยแล้ว!\n\n🛡️ เนื่องจากเป็นระบบความปลอดภัยของโรงพยาบาล บัญชีของคุณอยู่ในสถานะ 'รอการยืนยันตัวตนจากผู้ดูแลระบบ (Admin)'\nกรุณาแจ้งผู้ดูแลระบบเพื่อกดยืนยันสิทธิ์ก่อนจึงจะสามารถล็อกอินได้");

  if (currentUserRole === 'admin') {
    window.renderAdminUserList();
  }
};

// ฟังก์ชันสำหรับแอดมิน: สร้างช่างคนใหม่ พร้อมเปิดใช้งานทันที
window.adminCreateTechnician = function () {
  if (!requireLogin('จัดการบัญชีผู้ใช้')) return;
  const nameEl = document.getElementById('admin-tech-name');
  const deptEl = document.getElementById('admin-tech-dept');
  const emailEl = document.getElementById('admin-tech-email');
  const pwdEl = document.getElementById('admin-tech-pwd');

  const name = nameEl ? nameEl.value.trim() : "";
  const dept = deptEl ? deptEl.value.trim() : "";
  const email = emailEl ? emailEl.value.trim() : "";
  const pwd = pwdEl ? pwdEl.value : "";

  if (!name || !dept || !email || pwd.length < 6) {
    alert("กรุณากรอกข้อมูลช่างให้ครบถ้วน และรหัสผ่านอย่างน้อย 6 ตัวอักษร");
    return;
  }

  const users = getStoredUsers();
  if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    alert("อีเมลนี้มีอยู่ในระบบแล้ว กรุณาใช้อีเมลอื่น");
    return;
  }

  const newTech = {
    name: name,
    dept: dept,
    email: email,
    password: pwd,
    role: "inspector",
    verified: true,
    createdAt: new Date().toISOString()
  };

  users.push(newTech);
  saveStoredUsers(users);

  if (nameEl) nameEl.value = "";
  if (deptEl) deptEl.value = "";
  if (emailEl) emailEl.value = "";
  if (pwdEl) pwdEl.value = "";

  window.renderAdminUserList();
  alert("สร้างบัญชีช่างเทคนิค: " + name + "\nอีเมล: " + email + "\nสถานะ: ได้รับการยืนยันตัวตนเรียบร้อย พร้อมใช้งานทันที!");
};

// ฟังก์ชันสำหรับแอดมิน: ยืนยันตัวตนผู้ใช้
window.adminVerifyUser = function (userEmail) {
  const users = getStoredUsers();
  const user = users.find(u => u.email.toLowerCase() === userEmail.toLowerCase());
  if (!user) return;

  user.verified = true;
  saveStoredUsers(users);
  window.renderAdminUserList();
  alert("ยืนยันตัวตนและอนุมัติสิทธิ์ให้: " + user.name + " เรียบร้อยแล้ว");
};

// ฟังก์ชันสำหรับแอดมิน: รีเซ็ตรหัสผ่าน
window.adminResetPassword = function (userEmail) {
  const users = getStoredUsers();
  const user = users.find(u => u.email.toLowerCase() === userEmail.toLowerCase());
  if (!user) return;

  const newPwd = prompt("กำหนดรหัสผ่านใหม่สำหรับ: " + user.name + " " + String.fromCharCode(40) + user.email + String.fromCharCode(41) + "\n(อย่างน้อย 6 ตัวอักษร)");
  if (newPwd && newPwd.trim().length >= 6) {
    user.password = newPwd.trim();
    saveStoredUsers(users);
    window.renderAdminUserList();
    alert("รีเซ็ตรหัสผ่านสำหรับ " + user.name + " สำเร็จเรียบร้อย");
  } else if (newPwd !== null) {
    alert("รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร");
  }
};

// ฟังก์ชันสำหรับแอดมิน: ลบบัญชี
window.adminDeleteUser = function (userEmail) {
  if (userEmail.toLowerCase() === 'admin@pyuhahospital.go.th') {
    alert("ไม่สามารถลบบัญชีผู้ดูแลระบบหลักได้");
    return;
  }

  if (confirm("คุณต้องการลบหรือยกเลิกสิทธิ์บัญชี: " + userEmail + " ใช่หรือไม่?")) {
    let users = getStoredUsers();
    users = users.filter(u => u.email.toLowerCase() !== userEmail.toLowerCase());
    saveStoredUsers(users);
    window.renderAdminUserList();
    alert("ลบบัญชีผู้ใช้งานเรียบร้อยแล้ว");
  }
};

// ฟังก์ชันสำหรับแอดมิน: แก้ไขข้อมูลผู้ใช้ (เปิด Modal)
window.adminEditUserDept = function (userEmail) {
  const users = getStoredUsers();
  const user = users.find(u => u.email.toLowerCase() === userEmail.toLowerCase());
  if (!user) return;

  document.getElementById('edit-user-email-hidden').value = user.email;
  document.getElementById('edit-user-email-label').innerText = user.email;
  document.getElementById('edit-user-name').value = user.name || '';
  document.getElementById('edit-user-dept').value = user.dept || '';
  document.getElementById('edit-user-pwd').value = '';
  document.getElementById('edit-user-email-new').value = '';

  document.getElementById('admin-edit-user-modal').classList.remove('hidden');
};

window.closeAdminEditUserModal = function () {
  document.getElementById('admin-edit-user-modal').classList.add('hidden');
};

window.submitAdminEditUser = function () {
  const oldEmail = document.getElementById('edit-user-email-hidden').value;
  const newName = document.getElementById('edit-user-name').value.trim();
  const newDept = document.getElementById('edit-user-dept').value.trim();
  const newPwd = document.getElementById('edit-user-pwd').value.trim();
  let newEmail = document.getElementById('edit-user-email-new').value.trim();

  let users = getStoredUsers();
  const userIndex = users.findIndex(u => u.email.toLowerCase() === oldEmail.toLowerCase());
  if (userIndex === -1) return;
  
  if (newEmail && newEmail.toLowerCase() !== oldEmail.toLowerCase()) {
    if (users.some(u => u.email.toLowerCase() === newEmail.toLowerCase())) {
      alert("อีเมลใหม่นี้มีในระบบแล้ว โปรดใช้อีเมลอื่น");
      return;
    }
  } else {
    newEmail = oldEmail;
  }

  users[userIndex].name = newName;
  users[userIndex].dept = newDept;
  users[userIndex].email = newEmail;
  if (newPwd) {
    users[userIndex].password = newPwd;
  }

  saveStoredUsers(users);
  window.renderAdminUserList();
  closeAdminEditUserModal();
  alert("บันทึกการแก้ไขข้อมูลเรียบร้อยแล้ว");
};

// ฟังก์ชันสำหรับแอดมิน: เรนเดอร์ตารางผู้ใช้งาน
window.renderAdminUserList = function () {
  const tbody = document.getElementById('admin-users-table-body');
  if (!tbody) return;

  const users = getStoredUsers();
  let html = '';

  users.forEach(u => {
    const roleLabel = u.role === 'admin'
      ? '👨‍💼 ผู้ดูแลระบบ'
      : u.role === 'executive'
        ? '👩‍⚕️ ผู้บริหาร / ผอ.'
        : (u.role === 'chef_inspector' || u.role === 'chef inspector')
          ? '📋 หัวหน้าผู้ตรวจสอบ (Chef Inspector)'
          : '👷‍♂️ ช่างผู้ตรวจเช็ก';

    const statusBadge = u.verified
      ? '<span class="badge badge-verified">✓ อนุมัติแล้ว</span>'
      : '<span class="badge badge-pending">⏳ รอแอดมินยืนยัน</span>';

    const verifyBtn = !u.verified
      ? `<button class="btn-action-verify" onclick="adminVerifyUser('${u.email}')" title="ยืนยันตัวตน">✓ ยืนยัน</button>`
      : '';

    const resetBtn = `<button class="btn-action-reset" onclick="adminResetPassword('${u.email}')" title="ตั้งรหัสผ่านใหม่">🔑 รีเซ็ตรหัส</button>`;

    const editDeptBtn = `<button class="btn-action-edit" onclick="adminEditUserDept('${u.email}')" title="แก้ไขข้อมูล">✏️ แก้ไข</button>`;

    const deleteBtn = u.role !== 'admin'
      ? `<button class="btn-action-delete" onclick="adminDeleteUser('${u.email}')" title="ลบบัญชี">🗑️ ลบ</button>`
      : '';

    html += `
      <tr>
        <td><b>${u.name}</b></td>
        <td><code>${u.email}</code></td>
        <td>${u.dept}</td>
        <td>${roleLabel}</td>
        <td>${statusBadge}</td>
        <td style="text-align:center;">
          <div class="admin-actions-cell">
            ${verifyBtn}
            ${editDeptBtn}
            ${resetBtn}
            ${deleteBtn}
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
};

function saveUserSession(name, role) {
  setSession(name, role);
  applyUserSession(name, role);
}

function applyUserSession(name, role) {
  const userBar = document.getElementById('user-bar');
  if (userBar) userBar.style.display = 'flex';

  const nameEl = document.getElementById('display-user-name');
  const roleEl = document.getElementById('display-user-role');
  const badgeOfficer = document.getElementById('current-officer-name');

  if (nameEl) nameEl.innerText = name;
  if (roleEl) {
    if (role === 'guest' || !role) roleEl.innerText = 'ดูข้อมูลเท่านั้น';
    else if (role === 'admin') roleEl.innerText = 'ผู้ดูแลระบบ (Admin)';
    else if (role === 'executive') roleEl.innerText = 'ผู้อำนวยการ / ผู้บริหาร รพ.';
    else if (role === 'chef_inspector' || role === 'chef inspector') roleEl.innerText = 'หัวหน้าผู้ตรวจสอบ (Chef Inspector)';
    else if (role === 'inspector') roleEl.innerText = 'เจ้าหน้าที่ผู้ตรวจเช็ก (Inspector)';
    else roleEl.innerText = role;
  }
  if (badgeOfficer) {
    badgeOfficer.innerText = (role === 'guest' || !role) ? 'โหมดดูข้อมูล (ยังไม่ได้เข้าสู่ระบบ)' : name;
  }

  // ควบคุมแท็บเมนูตามสิทธิ์การใช้งาน (RBAC)
  const navDashboard = document.getElementById('tab-nav-dashboard');
  const navScanner = document.getElementById('tab-nav-scanner');
  const navRegister = document.getElementById('tab-nav-register');
  const navAssets = document.getElementById('tab-nav-assets');
  const navHistory = document.getElementById('tab-nav-history');
  const navReport = document.getElementById('tab-nav-report');
  const navBackup = document.getElementById('tab-nav-backup');
  const navAdmin = document.getElementById('tab-nav-admin');

  const btnChangeOfficer = document.getElementById('btn-change-officer');
  const btnSimulateFull = document.getElementById('btn-simulate-full');
  const reportControlsCard = document.getElementById('report-controls-card');
  const execToolbar = document.getElementById('executive-report-toolbar');
  const adminNotice = document.getElementById('admin-map-drag-notice');
  const adminAddAssetBtn = document.getElementById('admin-add-asset-btn');

  currentUserRole = role;
  document.body.classList.remove('role-admin', 'role-executive', 'role-inspector', 'role-chef_inspector', 'role-chef-inspector', 'role-guest');
  const normalizedRole = (role || '').replace(/[\s-]+/g, '_');
  document.body.classList.add('role-' + normalizedRole);
  if (normalizedRole === 'chef_inspector') {
    document.body.classList.add('role-chef-inspector');
  }

  // แถบเครื่องมือรายงานแบบคลีน แสดงผลสำหรับทุกสิทธิ์
  if (execToolbar) execToolbar.style.display = 'block';
  if (reportControlsCard) reportControlsCard.style.display = 'none';

  if (role === 'executive') {
    // 1. ผอ.: แสดงแค่ แดชบอร์ด, ประวัติการตรวจ, และรายงาน
    if (navDashboard) navDashboard.style.display = 'inline-block';
    if (navHistory) navHistory.style.display = 'inline-block';
    if (navReport) navReport.style.display = 'inline-block';

    if (navScanner) navScanner.style.display = 'none';
    if (navRegister) navRegister.style.display = 'none';
    if (navBackup) navBackup.style.display = 'none';
    if (navAdmin) navAdmin.style.display = 'none';

    if (adminNotice) adminNotice.classList.add('hidden');
    if (adminAddAssetBtn) adminAddAssetBtn.style.display = 'none';

    // ตรวจสอบแท็บปัจจุบัน ถ้าเป็นแท็บที่ไม่มีสิทธิ์ให้สลับไป dashboard
    const currentActiveTab = document.querySelector('.tab-content.active');
    if (currentActiveTab && ['tab-scanner', 'tab-register', 'tab-backup', 'tab-admin'].includes(currentActiveTab.id)) {
      window.switchTab('dashboard');
    }

    // เรียกรายงานทั้งหมดอัตโนมัติ ไม่ต้องระบุอะไรเลย
    if (typeof window.autoLoadExecutiveFullReport === 'function') {
      window.autoLoadExecutiveFullReport();
    }

  } else if (role === 'chef_inspector' || role === 'chef inspector') {
    // 2. หัวหน้าผู้ตรวจสอบ: แสดง แดชบอร์ด, สแกนตรวจ, ลงทะเบียน, ประวัติการตรวจ, และรายงาน
    if (navDashboard) navDashboard.style.display = 'inline-block';
    if (navScanner) navScanner.style.display = 'inline-block';
    if (navRegister) navRegister.style.display = 'inline-block';
    if (navHistory) navHistory.style.display = 'inline-block';
    if (navReport) navReport.style.display = 'inline-block';

    if (navBackup) navBackup.style.display = 'none';
    if (navAdmin) navAdmin.style.display = 'none';

    if (adminNotice) adminNotice.classList.add('hidden');
    if (adminAddAssetBtn) adminAddAssetBtn.style.display = 'none';

    const currentActiveTab = document.querySelector('.tab-content.active');
    if (currentActiveTab && ['tab-backup', 'tab-admin'].includes(currentActiveTab.id)) {
      window.switchTab('report');
    }

    if (typeof window.autoLoadExecutiveFullReport === 'function') {
      window.autoLoadExecutiveFullReport();
    }

  } else if (role === 'inspector') {
    // 2. ช่างตรวจ: แสดง แดชบอร์ด, สแกนตรวจ, ลงทะเบียน, ประวัติการตรวจ (และรายงาน)
    // แต่ไม่มี สำรองและย้ายข้อมูล และไม่มี Admin
    if (navDashboard) navDashboard.style.display = 'inline-block';
    if (navScanner) navScanner.style.display = 'inline-block';
    if (navRegister) navRegister.style.display = 'inline-block';
    if (navHistory) navHistory.style.display = 'inline-block';
    if (navReport) navReport.style.display = 'inline-block';

    if (navBackup) navBackup.style.display = 'none';
    if (navAdmin) navAdmin.style.display = 'none';

    if (adminNotice) adminNotice.classList.add('hidden');
    if (adminAddAssetBtn) adminAddAssetBtn.style.display = 'none';

    const currentActiveTab = document.querySelector('.tab-content.active');
    if (currentActiveTab && ['tab-backup', 'tab-admin'].includes(currentActiveTab.id)) {
      window.switchTab('dashboard');
    }

  } else if (role === 'guest' || !role) {
    // 0. Guest Mode: ดูได้เฉพาะหน้าแดชบอร์ด & แผนผังเท่านั้น ซ่อนแท็บและฟังก์ชันอื่นทั้งหมด
    if (navDashboard) navDashboard.style.display = 'inline-block';

    if (navScanner) navScanner.style.display = 'none';
    if (navRegister) navRegister.style.display = 'none';
    if (navAssets) navAssets.style.display = 'none';
    if (navHistory) navHistory.style.display = 'none';
    if (navReport) navReport.style.display = 'none';
    if (navBackup) navBackup.style.display = 'none';
    if (navAdmin) navAdmin.style.display = 'none';

    if (adminNotice) adminNotice.classList.add('hidden');
    if (adminAddAssetBtn) adminAddAssetBtn.style.display = 'none';

    const currentActiveTab = document.querySelector('.tab-content.active');
    if (currentActiveTab && currentActiveTab.id !== 'tab-dashboard') {
      window.switchTab('dashboard');
    }
  } else {
    // 3. แอดมิน (admin): แสดงครบทุกแท็บ และเปิดโหมดขยับจุดติดตั้ง + ปุ่มเพิ่มจุดติดตั้งบนผัง
    if (navDashboard) navDashboard.style.display = 'inline-block';
    if (navScanner) navScanner.style.display = 'inline-block';
    if (navRegister) navRegister.style.display = 'inline-block';
    if (navAssets) navAssets.style.display = 'inline-block';
    if (navHistory) navHistory.style.display = 'inline-block';
    if (navReport) navReport.style.display = 'inline-block';
    if (navBackup) navBackup.style.display = 'inline-block';
    if (navAdmin) navAdmin.style.display = 'inline-block';

    if (adminNotice) adminNotice.classList.remove('hidden');
    if (adminAddAssetBtn) adminAddAssetBtn.style.display = 'inline-block';
  }

  // ควบคุมการแสดงปุ่ม 'ลบอุปกรณ์ทั้งหมด' เฉพาะสิทธิ์แอดมิน
  const adminDeleteAllBtn = document.getElementById('admin-delete-all-btn');
  if (adminDeleteAllBtn) {
    adminDeleteAllBtn.style.display = (role === 'admin') ? 'inline-block' : 'none';
  }

  // ควบคุมการแสดงปุ่มพิมพ์รายงาน, จำลองผลตรวจ, พิมพ์ QR, เปลี่ยนชื่อผู้ตรวจ สำหรับเจ้าหน้าที่ที่ล็อกอินแล้วเท่านั้น (Guest ดูได้อย่างเดียว)
  const isGuest = (!role || role === 'guest');
  if (btnChangeOfficer) {
    btnChangeOfficer.style.display = isGuest ? 'none' : 'inline-block';
  }
  if (btnSimulateFull) {
    btnSimulateFull.style.display = isGuest ? 'none' : 'inline-block';
  }
  const btnPrintReport = document.getElementById('btn-print-executive-report');
  if (btnPrintReport) {
    btnPrintReport.style.display = isGuest ? 'none' : 'inline-block';
  }
  const btnPrintAllQR = document.getElementById('btn-print-all-qr');
  if (btnPrintAllQR) {
    btnPrintAllQR.style.display = isGuest ? 'none' : 'inline-block';
  }
  const btnEditGuide = document.getElementById('btn-edit-guide');
  if (btnEditGuide) {
    btnEditGuide.style.display = isGuest ? 'none' : 'inline-flex';
  }

  // อัปเดตหมุดบนแผนที่ตามสิทธิ์ (Admin สามารถลากได้)
  if (typeof renderMapPins === 'function') {
    renderMapPins();
  }
}

window.setOfficerProfile = function () {
  if (currentUserRole === 'guest' || !currentUserRole) {
    alert("🔒 โหมดผู้เยี่ยมชม (Guest) ดูข้อมูลได้อย่างเดียวเท่านั้น\nกรุณาเข้าสู่ระบบเพื่อเปลี่ยนชื่อผู้ตรวจ");
    return;
  }
  const newName = prompt("กรุณาระบุชื่อและนามสกุลผู้ตรวจเช็ก:", getCleanName(currentOfficer));
  if (newName && newName.trim()) {
    currentOfficer = getCleanName(newName.trim());
    saveUserSession(currentOfficer, currentUserRole);
  }
};

// ==========================================
// 10. เริ่มต้นการทำงาน (Window Load)
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  getStoredUsers();
  if (currentUserRole === 'admin' && typeof window.renderAdminUserList === 'function') {
    window.renderAdminUserList();
  }

  if (isFirebaseReady() && auth) {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        // ตรวจสอบข้อมูลสิทธิ์จริงจาก system_users บน Firestore (Server-Validated)
        const docId = user.email ? user.email.replace(/[^a-zA-Z0-9]/g, '_') : user.uid;
        let profile = null;
        try {
          const userDoc = await getDoc(doc(db, "system_users", docId));
          if (userDoc.exists()) {
            profile = userDoc.data();
          }
        } catch (e) {
          console.warn("Could not fetch server profile:", e.message);
        }

        if (profile) {
          currentOfficer = getCleanName(profile.name || user.displayName || user.email);
          currentUserRole = profile.role || 'inspector';
        } else {
          currentOfficer = user.email;
          currentUserRole = 'inspector';
        }
        saveUserSession(currentOfficer, currentUserRole);
        document.getElementById('auth-modal')?.classList.add('hidden');
      } else {
        // ถ้า Firebase Auth แจ้งว่าไม่ได้ Login แต่เครื่องมี session ปลอม ให้เคลียร์ทิ้งทันที
        const session = getSession();
        if (session && isFirebaseReady()) {
          console.warn("Security check: Firebase session is inactive. Reverting to Guest mode.");
          clearSession();
          currentOfficer = '';
          currentUserRole = 'guest';
          applyUserSession('ผู้เยี่ยมชม (Guest)', 'guest');
        }
      }
    });
  }
});


// ==========================================
// 11. ระบบสร้างรายงานการตรวจสอบเพื่อเสนอผู้บริหาร (แยกไปไว้ที่ js/report-module.js)
// ==========================================
import { initReportModule } from './js/report-module.js';

window.initAssets = initAssets;
window.updateDashboardUI = updateDashboardUI;
window.renderMapPins = renderMapPins;
window.renderHistoryTable = renderHistoryTable;

initReportModule({
  getAssetsList: () => assetsList,
  getCurrentOfficer: () => currentOfficer,
  getCurrentUserRole: () => currentUserRole,
  updateDashboardUI,
  renderMapPins,
  renderHistoryTable,
  initAssets
});

// Sync ตัวแปรไปยัง window เพื่อความเข้ากันได้
Object.defineProperty(window, 'assetsList', {
  get: () => assetsList,
  set: (val) => { assetsList = val; }
});
Object.defineProperty(window, 'currentOfficer', {
  get: () => currentOfficer,
  set: (val) => { currentOfficer = val; }
});
Object.defineProperty(window, 'currentUserRole', {
  get: () => currentUserRole,
  set: (val) => { currentUserRole = val; }
});
