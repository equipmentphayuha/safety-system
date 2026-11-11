// js/events.js
// ระบบผูก Event Delegation ส่วนกลางสำหรับ Phayuha Hospital Safety
// กำจัด inline onclick ทั้งหมดใน index.html

export function initGlobalEvents() {
  document.addEventListener('click', (e) => {
    // 1. ตรวจสอบ data-action
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      const action = actionEl.getAttribute('data-action');
      const param = actionEl.getAttribute('data-param');
      handleAction(action, param, actionEl, e);
      return;
    }

    // 2. ตรวจสอบการคลิกที่พื้นหลัง Modal Overlay เพื่อปิด Modal (Dismiss on backdrop click)
    const modalOverlay = e.target.closest('.modal-overlay, .modal-backdrop, .modal');
    if (modalOverlay && e.target === modalOverlay) {
      if (typeof window.closeAuthModal === 'function' && modalOverlay.id === 'auth-modal') {
        window.closeAuthModal();
      } else if (typeof window.closeEditAssetModal === 'function' && modalOverlay.id === 'edit-asset-modal') {
        window.closeEditAssetModal();
      } else if (typeof window.closeEditGuideModal === 'function' && modalOverlay.id === 'edit-guide-modal') {
        window.closeEditGuideModal();
      } else if (typeof window.closeQuickAddModal === 'function' && modalOverlay.id === 'quick-add-modal') {
        window.closeQuickAddModal();
      } else if (typeof window.closeAdminEditUserModal === 'function' && modalOverlay.id === 'admin-edit-user-modal') {
        window.closeAdminEditUserModal();
      } else if (typeof window.closeSignatureModal === 'function' && modalOverlay.id === 'signature-modal') {
        window.closeSignatureModal();
      }
    }
  });
}

function handleAction(action, param, elem, event) {
  switch (action) {
    // Auth & Navigation
    case 'login-screen-submit':
      if (typeof window.loginScreenSubmit === 'function') window.loginScreenSubmit();
      break;
    case 'open-auth-modal':
      if (typeof window.openAuthModal === 'function') window.openAuthModal();
      break;
    case 'close-auth-modal':
      if (typeof window.closeAuthModal === 'function') window.closeAuthModal();
      break;
    case 'logout-user':
      if (typeof window.logoutUser === 'function') window.logoutUser();
      break;
    case 'set-officer-profile':
      if (typeof window.setOfficerProfile === 'function') window.setOfficerProfile();
      break;
    case 'switch-tab':
      if (typeof window.switchTab === 'function') window.switchTab(param);
      break;
    case 'select-building-floor':
      if (typeof window.selectBuildingFloor === 'function') window.selectBuildingFloor(param);
      break;
    case 'toggle-auth-mode':
      if (typeof window.toggleAuthMode === 'function') window.toggleAuthMode(param);
      break;

    // Map & Assets
    case 'locate-gps':
      if (typeof window.locateUserGPS === 'function') window.locateUserGPS();
      break;
    case 'start-add-asset':
      if (typeof window.startAddAssetOnDashboard === 'function') window.startAddAssetOnDashboard();
      break;
    case 'close-quick-add':
      if (typeof window.closeQuickAddModal === 'function') window.closeQuickAddModal();
      break;
    case 'close-edit-asset':
      if (typeof window.closeEditAssetModal === 'function') window.closeEditAssetModal();
      break;
    case 'admin-delete-all-assets':
      if (typeof window.adminDeleteAllAssets === 'function') window.adminDeleteAllAssets();
      break;
    case 'sync-all-assets':
      if (typeof window.syncAllAssetsToFirestore === 'function') window.syncAllAssetsToFirestore();
      break;
    case 'clean-duplicates':
      if (typeof window.cleanDuplicateAssetsFromCloud === 'function') window.cleanDuplicateAssetsFromCloud();
      break;
    case 'export-system-data':
      if (typeof window.exportSystemData === 'function') window.exportSystemData();
      break;

    // Scanner
    case 'start-scanner':
      if (typeof window.startScanner === 'function') window.startScanner();
      break;
    case 'stop-scanner':
      if (typeof window.stopScanner === 'function') window.stopScanner();
      break;

    // Inspection Guide
    case 'toggle-guide':
      if (typeof window.toggleInspectionGuide === 'function') window.toggleInspectionGuide();
      break;
    case 'open-edit-guide':
      if (typeof window.openEditGuideModal === 'function') window.openEditGuideModal();
      break;
    case 'close-edit-guide':
      if (typeof window.closeEditGuideModal === 'function') window.closeEditGuideModal();
      break;
    case 'reset-guide-default':
      if (typeof window.resetGuideToDefault === 'function') window.resetGuideToDefault();
      break;

    // QR & Printing
    case 'print-window':
      window.print();
      break;
    case 'print-all-qr':
      if (typeof window.printAllQR === 'function') window.printAllQR();
      break;
    case 'download-qr':
      if (typeof window.downloadQR === 'function') window.downloadQR();
      break;
    case 'print-qr-modal':
      if (typeof window.printQRModal === 'function') window.printQRModal();
      break;
    case 'close-qr-modal':
      if (typeof window.closeQRModal === 'function') window.closeQRModal();
      break;
    case 'close-asset-history':
      if (typeof window.closeAssetHistoryModal === 'function') window.closeAssetHistoryModal();
      break;
    case 'close-repair-modal':
      if (typeof window.closeRepairCompleteModal === 'function') window.closeRepairCompleteModal();
      break;

    // Report Module
    case 'set-report-format':
      if (typeof window.setReportFormat === 'function') window.setReportFormat(param);
      break;
    case 'simulate-inspection':
      if (typeof window.simulateFullInspection === 'function') window.simulateFullInspection();
      break;
    case 'render-selected-report':
      if (typeof window.renderSelectedReport === 'function') window.renderSelectedReport();
      break;
    case 'toggle-memo-toolbar':
      if (typeof window.toggleMemoEditToolbar === 'function') window.toggleMemoEditToolbar();
      break;
    case 'print-executive-report':
      if (typeof window.printExecutiveReport === 'function') window.printExecutiveReport();
      break;
    case 'adjust-memo-font':
      if (typeof window.adjustTargetMemoFont === 'function') window.adjustTargetMemoFont(parseFloat(param));
      break;
    case 'set-memo-margin-standard':
      if (typeof window.setMemoMarginPresetStandard === 'function') window.setMemoMarginPresetStandard();
      break;
    case 'adjust-memo-spacing':
      if (typeof window.adjustMemoSpacing === 'function') window.adjustMemoSpacing(parseFloat(param));
      break;
    case 'set-exec-box-position':
      if (typeof window.setExecBoxPosition === 'function') window.setExecBoxPosition(param);
      break;
    case 'adjust-exec-box-top':
      if (typeof window.adjustExecBoxMarginTop === 'function') window.adjustExecBoxMarginTop(parseFloat(param));
      break;
    case 'reset-memo-content':
      if (typeof window.resetMemoContent === 'function') window.resetMemoContent();
      break;

    // Signature Modal
    case 'open-signature-modal':
      if (typeof window.openSignatureModal === 'function') window.openSignatureModal(param);
      break;
    case 'close-signature-modal':
      if (typeof window.closeSignatureModal === 'function') window.closeSignatureModal();
      break;
    case 'switch-sig-tab':
      if (typeof window.switchSigTab === 'function') window.switchSigTab(param);
      break;
    case 'clear-signature-canvas':
      if (typeof window.clearSignatureCanvas === 'function') window.clearSignatureCanvas();
      break;
    case 'trigger-sig-upload':
      document.getElementById('sig-file-input')?.click();
      break;
    case 'save-signature':
      if (typeof window.saveSignature === 'function') window.saveSignature();
      break;

    // Admin
    case 'render-admin-users':
      if (typeof window.renderAdminUserList === 'function') window.renderAdminUserList();
      break;
    case 'close-admin-edit-user':
      if (typeof window.closeAdminEditUserModal === 'function') window.closeAdminEditUserModal();
      break;

    default:
      console.warn('Unhandled data-action:', action);
  }
}
