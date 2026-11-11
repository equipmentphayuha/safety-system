// js/register-controller.js
// ระบบลงทะเบียนอุปกรณ์ใหม่ & พิมพ์ QR Code (พร้อมแผนที่เลือกพิกัด)
import { storageService } from './storage-service.js';
import { floorConfigs, cleanAssetType, getAssetDirectUrl } from './constants.js';

let _appContext = {
  getAssetsList: () => (window.assetsList || []),
  setAssetsList: (val) => { window.assetsList = val; },
  requireLogin: (act) => (typeof window.requireLogin === 'function' ? window.requireLogin(act) : true),
  updateDashboardUI: () => (typeof window.updateDashboardUI === 'function' && window.updateDashboardUI()),
  renderMapPins: () => (typeof window.renderMapPins === 'function' && window.renderMapPins()),
  isFirebaseReady: () => false,
  db: null
};

export function initRegisterController(context = {}) {
  Object.assign(_appContext, context);
  initRegisterMap();
  initRegisterForm();
}

function initRegisterForm() {
  const regForm = document.getElementById('reg-form');
  if (regForm && !regForm.dataset.initialized) {
    regForm.dataset.initialized = 'true';
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      // ตรวจสอบข้อมูลด้วย Inline Form Validation
      if (typeof window.validateForm === 'function') {
        const isFormValid = window.validateForm(regForm);
        if (!isFormValid) {
          if (typeof window.showAppModal === 'function') {
            window.showAppModal('ข้อมูลไม่ถูกต้อง', 'กรุณาตรวจสอบช่องข้อความสีแดงและแก้ไขข้อมูลให้ถูกต้องก่อนบันทึก', 'warning');
          }
          return;
        }
      }

      const assetId = document.getElementById('reg-id').value.trim();
      if (!assetId) {
        alert("กรุณาระบุรหัสประจำอุปกรณ์");
        return;
      }

      const list = _appContext.getAssetsList();
      if (list.some(a => a.assetId?.trim().toUpperCase() === assetId.toUpperCase())) {
        const idInput = document.getElementById('reg-id');
        const idErr = document.getElementById('reg-id-error');
        if (idInput) idInput.classList.add('input-error-border');
        if (idErr) idErr.textContent = `รหัสอุปกรณ์ "${assetId}" มีอยู่ในระบบแล้ว กรุณาใช้รหัสอื่น`;
        alert(`⚠️ ขออภัย: รหัสอุปกรณ์ "${assetId}" มีอยู่ในระบบแล้ว กรุณาใช้รหัสอื่น`);
        return;
      }

      const submitBtn = document.getElementById('reg-submit-btn');
      const spinner = document.getElementById('reg-loading-spinner');
      const btnText = document.getElementById('reg-btn-text');

      // ฟังก์ชันควบคุมสถานะ Loading
      const setRegisterLoading = (isLoading) => {
        if (!submitBtn) return;
        if (isLoading) {
          submitBtn.disabled = true;
          submitBtn.classList.add('btn-disabled-loading');
          if (spinner) spinner.style.display = 'inline-block';
          if (btnText) btnText.textContent = 'กำลังลงทะเบียน...';
        } else {
          submitBtn.disabled = false;
          submitBtn.classList.remove('btn-disabled-loading');
          if (spinner) spinner.style.display = 'none';
          if (btnText) btnText.textContent = '✨ บันทึกลงทะเบียน & สร้าง QR Code';
        }
      };

      setRegisterLoading(true);

      try {
        const type = document.getElementById('reg-type').value;
        const buildingSelect = document.getElementById('reg-building-select');
        const buildingId = buildingSelect.value;
        const buildingName = buildingSelect.options[buildingSelect.selectedIndex].text;
        const location = document.getElementById('reg-location').value.trim();
        const floor = parseInt(document.getElementById('reg-floor').value) || 1;

        // คำนวณพิกัดจากหมุดที่กำหนดไว้บนแผนที่
        const coordY = parseInt(document.getElementById('reg-coord-y').value) || 280;
        const coordX = parseInt(document.getElementById('reg-coord-x').value) || 500;
        const floorCoord = [coordY, coordX];
        const campusCoord = { lat: 15.47712, lng: 100.13777 };

        const newAsset = {
          assetId,
          type,
          building: buildingName,
          buildingId,
          floor,
          location,
          status: "READY",
          floorCoord,
          campusCoord,
          createdAt: new Date().toISOString()
        };

        if (_appContext.isFirebaseReady() && _appContext.db) {
          try {
            const docId = assetId.replace(/[^a-zA-Z0-9]/g, '_');
            await setDoc(doc(_appContext.db, "assets", docId), {
              ...newAsset,
              serverCreated: serverTimestamp()
            });
            newAsset.firestoreId = docId;
          } catch (err) {
            console.warn("Firestore add error:", err);
          }
        }

        list.push(newAsset);
        _appContext.setAssetsList(list);
        storageService.set('pyh_assets_data', list);

        // แสดง QR Code (ลิงก์ตรงสำหรับเปิดผ่าน LINE / กล้องมือถือ / Google Lens)
        const qrContainer = document.getElementById('qrcode');
        qrContainer.innerHTML = "";
        new QRCode(qrContainer, {
          text: getAssetDirectUrl(assetId),
          width: 150,
          height: 150,
          colorDark: "#000000",
          colorLight: "#ffffff"
        });

        document.getElementById('qr-label').innerHTML = `
          <b>${assetId}</b><br>
          ${type}<br>
          ${buildingName} - ${location}
        `;
        document.getElementById('qr-output').classList.remove('hidden');

        _appContext.updateDashboardUI();
        _appContext.renderMapPins();
        if (typeof window.renderRegisterExistingMarkers === 'function') {
          window.renderRegisterExistingMarkers();
        }
        alert(`ลงทะเบียนอุปกรณ์ ${assetId} สำเร็จ! พร้อมพิมพ์สติกเกอร์`);

        document.getElementById('reg-location').value = '';
        if (typeof window.autoSuggestRegisterId === 'function') {
          window.autoSuggestRegisterId();
        }
      } catch (err) {
        alert("เกิดข้อผิดพลาดในการลงทะเบียน: " + err.message);
      } finally {
        setRegisterLoading(false);
      }
    });
  }
}

// 6. ลงทะเบียนอุปกรณ์ใหม่ & พิมพ์ QR Code (พร้อมแผนที่เลือกพิกัด)
// ==========================================
let registerMap = null;
let registerMarker = null;
let registerOverlayLayer = null;
let registerExistingMarkers = [];

window.initRegisterMap = function () {
  const regMapElem = document.getElementById('register-map');
  if (!regMapElem) return;

  if (!registerMap) {
    registerMap = L.map('register-map', {
      crs: L.CRS.Simple,
      minZoom: -1,
      maxZoom: 1
    });

    registerMap.on('click', function (e) {
      const y = Math.round(e.latlng.lat);
      const x = Math.round(e.latlng.lng);
      setRegisterCoords(y, x);
    });
  }

  window.updateRegisterMapFloor();
};

window.renderRegisterExistingMarkers = function () {
  if (!registerMap) return;

  // ล้างหมุดอุปกรณ์เดิมออกก่อน
  registerExistingMarkers.forEach(m => {
    if (registerMap.hasLayer(m)) registerMap.removeLayer(m);
  });
  registerExistingMarkers = [];

  const buildingSelect = document.getElementById('reg-building-select');
  if (!buildingSelect) return;
  const buildingId = buildingSelect.value;

  // กรองอุปกรณ์เดิมที่อยู่ในอาคารนี้และมี floorCoord
  const existingAssets = ((_appContext.getAssetsList()) || []).filter(a => a.buildingId === buildingId && a.floorCoord && Array.isArray(a.floorCoord));

  // อัปเดตข้อความสถิติอุปกรณ์เดิม
  const countBadge = document.getElementById('reg-existing-count-badge');
  if (countBadge) {
    countBadge.innerText = `📦 มีอุปกรณ์เดิมในอาคารนี้ ${existingAssets.length} จุด`;
  }

  existingAssets.forEach(item => {
    const isReady = item.status === 'READY';
    const statusColor = isReady ? '#16a34a' : '#dc2626';

    const existingIcon = L.divIcon({
      html: `
        <div style="background:${statusColor}; border:2px solid #ffffff; box-shadow:0 0 6px rgba(0,0,0,0.45); width:14px; height:14px; border-radius:50%; opacity:0.88;" title="[อุปกรณ์เดิม] ${item.assetId} - ${item.location}"></div>
      `,
      className: 'existing-asset-pin-container',
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });

    const m = L.marker(item.floorCoord, {
      icon: existingIcon,
      interactive: true,
      zIndexOffset: 10
    }).addTo(registerMap);

    m.bindPopup(`
      <div style="font-size:12px; line-height:1.4;">
        <span style="display:inline-block; background:#f1f5f9; color:#475569; font-size:10px; font-weight:700; padding:1px 6px; border-radius:4px; border:1px solid #cbd5e1; margin-bottom:4px;">📌 อุปกรณ์เดิมในระบบ</span><br>
        <b style="color:#0f172a;">${item.assetId}</b><br>
        <span style="color:#334155;">${item.type || 'อุปกรณ์ความปลอดภัย'}</span><br>
        <span style="color:#64748b; font-size:11px;">จุดติดตั้ง: ${item.location || '-'} (ชั้น ${item.floor || 1})</span><br>
        <span style="color:${statusColor}; font-weight:600; font-size:11px;">สถานะ: ${isReady ? 'พร้อมใช้งาน' : 'ต้องตรวจสอบ/ชำรุด'}</span>
      </div>
    `);

    registerExistingMarkers.push(m);
  });
};

window.updateRegisterMapFloor = function () {
  if (!registerMap) return;
  const buildingSelect = document.getElementById('reg-building-select');
  if (!buildingSelect) return;
  const buildingId = buildingSelect.value;
  const cfg = floorConfigs[buildingId];
  if (!cfg) return;

  if (registerOverlayLayer && registerMap.hasLayer(registerOverlayLayer)) {
    registerMap.removeLayer(registerOverlayLayer);
  }

  registerOverlayLayer = L.imageOverlay(cfg.imageUrl, cfg.bounds).addTo(registerMap);
  registerMap.options.maxBoundsViscosity = 1.0;
  registerMap.setMaxBounds(cfg.bounds);
  registerMap.setMaxZoom(3);
  registerMap.fitBounds(cfg.bounds);
  const regFitZoom = registerMap.getBoundsZoom(cfg.bounds);
  registerMap.setMinZoom(regFitZoom);

  // แสดงหมุดอุปกรณ์เดิมที่มีอยู่ในอาคารนี้
  window.renderRegisterExistingMarkers();

  const curY = parseInt(document.getElementById('reg-coord-y').value) || 280;
  const curX = parseInt(document.getElementById('reg-coord-x').value) || 500;
  setRegisterCoords(curY, curX);
  setTimeout(() => {
    registerMap.invalidateSize();
    const updatedZoom = registerMap.getBoundsZoom(cfg.bounds);
    registerMap.setMinZoom(updatedZoom);
  }, 250);
};

function setRegisterCoords(y, x) {
  const yInput = document.getElementById('reg-coord-y');
  const xInput = document.getElementById('reg-coord-x');
  const badge = document.getElementById('reg-coord-badge');

  if (yInput) yInput.value = y;
  if (xInput) xInput.value = x;
  if (badge) badge.innerText = 'พิกัดผัง: Y: ' + y + ', X: ' + x;

  if (registerMarker && registerMap && registerMap.hasLayer(registerMarker)) {
    registerMap.removeLayer(registerMarker);
  }

  if (registerMap) {
    const pinIcon = L.divIcon({
      html: '<div class="admin-draggable-pin" style="background:#0284c7; border:2.5px solid #ffffff; box-shadow:0 0 10px rgba(2,132,199,0.7); width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-size:11px; font-weight:bold; cursor:grab;">★</div>',
      className: 'custom-pin-container',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    registerMarker = L.marker([y, x], {
      icon: pinIcon,
      draggable: true,
      zIndexOffset: 1000,
      title: 'หมุดอุปกรณ์ใหม่ (คลิกลากเพื่อกำหนดตำแหน่งติดตั้ง)'
    }).addTo(registerMap);

    registerMarker.on('dragend', function (e) {
      const latlng = e.target.getLatLng();
      const newY = Math.round(latlng.lat);
      const newX = Math.round(latlng.lng);
      if (yInput) yInput.value = newY;
      if (xInput) xInput.value = newX;
      if (badge) badge.innerText = 'พิกัดผัง: Y: ' + newY + ', X: ' + newX;
    });
  }
}



// ==========================================