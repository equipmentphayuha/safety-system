// js/scanner-controller.js
// ระบบสแกน QR Code ตรวจสอบอุปกรณ์ (Html5Qrcode Scanner Controller)

import { extractAssetIdFromScan } from './constants.js';

let html5QrCode = null;

export function initScannerController(options = {}) {
  const { onScanned, onStop } = options;

  window.startScanner = async function () {
    const qrBox = document.getElementById("qr-reader");
    if (!qrBox) return;

    if (!html5QrCode && window.Html5Qrcode) {
      html5QrCode = new window.Html5Qrcode("qr-reader");
    }

    try {
      if (!window.Html5Qrcode) {
        showNoCameraUI();
        return;
      }
      const devices = await window.Html5Qrcode.getCameras();
      if (!devices || devices.length === 0) {
        showNoCameraUI();
        return;
      }

      await html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          window.stopScanner();
          const cleanAssetId = extractAssetIdFromScan(decodedText.trim());
          if (typeof onScanned === 'function') {
            onScanned(cleanAssetId);
          } else if (typeof window.handleScanned === 'function') {
            window.handleScanned(cleanAssetId);
          }
        },
        () => {} // Ignored frame errors
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

  window.stopScanner = function () {
    if (html5QrCode && html5QrCode.isScanning) {
      html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => {});
    }
    if (typeof onStop === 'function') onStop();
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
}

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
