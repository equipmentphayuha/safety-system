// js/offline-sync.js
// ระบบบันทึกข้อมูลออฟไลน์ & ซิงก์ขึ้นคลาวด์อัตโนมัติเมื่อต่อเน็ต (Offline Queue & Auto-Sync)
import { storageService } from './storage-service.js';

const OFFLINE_QUEUE_KEY = 'pyh_offline_inspection_queue';

let _syncContext = {
  isFirebaseReady: () => false,
  db: null,
  storage: null,
  addDoc: null,
  collection: null,
  doc: null,
  updateDoc: null,
  serverTimestamp: null,
  ref: null,
  uploadBytes: null,
  getDownloadURL: null,
  onSyncComplete: null
};

export function initOfflineSync(context = {}) {
  Object.assign(_syncContext, context);

  // ตรวจจับสถานะเครือข่ายอัตโนมัติ
  window.addEventListener('online', () => {
    updateNetworkStatusUI(true);
    triggerSyncQueue();
  });

  window.addEventListener('offline', () => {
    updateNetworkStatusUI(false);
  });

  // อัปเดตสถานะตอนเริ่มต้น
  updateNetworkStatusUI(navigator.onLine);

  // หากเปิดเว็บมาแล้วต่อเน็ตอยู่ ให้ตรวจคิวค้างทันที
  if (navigator.onLine) {
    setTimeout(triggerSyncQueue, 3000);
  }
}

export function updateNetworkStatusUI(isOnline) {
  let badge = document.getElementById('network-status-badge');
  if (!badge) {
    // สร้างแท็กแสดงสถานะเน็ตไว้ที่มุมบนของหน้าจอ
    badge = document.createElement('div');
    badge.id = 'network-status-badge';
    badge.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 0.78rem;
      font-weight: 600;
      transition: all 0.3s;
      cursor: pointer;
    `;
    const userBarRight = document.querySelector('.user-bar > div:last-child');
    if (userBarRight) {
      userBarRight.insertBefore(badge, userBarRight.firstChild);
    }
  }

  const pending = getPendingQueue();
  const pendingCount = pending.length;

  if (isOnline) {
    badge.style.background = pendingCount > 0 ? '#fef3c7' : '#dcfce7';
    badge.style.color = pendingCount > 0 ? '#b45309' : '#15803d';
    badge.style.border = pendingCount > 0 ? '1px solid #fde68a' : '1px solid #bbf7d0';
    badge.innerHTML = pendingCount > 0 
      ? `<span>🟡 ออนไลน์ (รอส่ง ${pendingCount} รายการ)</span>` 
      : `<span>🟢 ออนไลน์ (ซิงก์แล้ว)</span>`;
    badge.title = pendingCount > 0 ? 'คลิกเพื่อบังคับซิงก์ข้อมูลทันที' : 'ระบบเชื่อมต่อคลาวด์ปกติ';
    badge.onclick = () => { if (pendingCount > 0) triggerSyncQueue(true); };
  } else {
    badge.style.background = '#fee2e2';
    badge.style.color = '#b91c1c';
    badge.style.border = '1px solid #fca5a5';
    badge.innerHTML = `<span>🔴 ออฟไลน์ (บันทึกในเครื่อง${pendingCount > 0 ? ` ${pendingCount} รายการ` : ''})</span>`;
    badge.title = 'ไม่มีสัญญาณอินเทอร์เน็ต ระบบจะบันทึกในเครื่องและส่งขึ้นคลาวด์อัตโนมัติเมื่อมีเน็ต';
    badge.onclick = null;
  }
}

export function getPendingQueue() {
  const data = storageService.get(OFFLINE_QUEUE_KEY);
  if (!data) return [];
  try {
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) {
    return [];
  }
}

export function savePendingQueue(queue) {
  storageService.set(OFFLINE_QUEUE_KEY, queue);
  updateNetworkStatusUI(navigator.onLine);
}

export function enqueueOfflineInspection(task) {
  const queue = getPendingQueue();
  queue.push({
    ...task,
    enqueuedAt: new Date().toISOString()
  });
  savePendingQueue(queue);
  console.log('📥 [OfflineQueue] Enqueued inspection for sync later:', task.assetId);
}

let _isSyncing = false;
export async function triggerSyncQueue(manual = false) {
  if (_isSyncing || !navigator.onLine) return;
  const queue = getPendingQueue();
  if (queue.length === 0) return;

  if (!_syncContext.isFirebaseReady() || !_syncContext.db) {
    console.log('⏳ [OfflineQueue] Firebase not ready yet, skipping sync.');
    return;
  }

  _isSyncing = true;
  console.log(`🚀 [OfflineQueue] Starting auto-sync for ${queue.length} item(s)...`);

  const failedItems = [];
  let syncedCount = 0;

  for (const item of queue) {
    try {
      let finalPhotoURL = item.photoURL || '';

      // หากมีภาพที่เป็น Base64 (บันทึกออฟไลน์ไว้) ให้อัปขึ้น Storage ก่อน
      if (item.pendingPhotoBase64 && _syncContext.storage && _syncContext.ref && _syncContext.uploadBytes) {
        try {
          const res = await fetch(item.pendingPhotoBase64);
          const blob = await res.blob();
          const storageRef = _syncContext.ref(_syncContext.storage, `inspections/${item.assetId}_${Date.now()}.jpg`);
          const uploadRes = await _syncContext.uploadBytes(storageRef, blob);
          finalPhotoURL = await _syncContext.getDownloadURL(uploadRes.ref);
        } catch (imgErr) {
          console.warn('Could not upload pending image, keeping data URL:', imgErr);
        }
      }

      // บันทึกลง Firestore
      if (_syncContext.addDoc && _syncContext.collection) {
        await _syncContext.addDoc(_syncContext.collection(_syncContext.db, "inspection_logs"), {
          id: item.id,
          assetId: item.assetId,
          inspector: item.inspector,
          status: item.status,
          details: item.details,
          notes: item.notes,
          photoURL: finalPhotoURL,
          timestampStr: item.timestampStr,
          timestampISO: item.timestampISO,
          timestamp: _syncContext.serverTimestamp ? _syncContext.serverTimestamp() : new Date()
        });
      }

      // อัปเดตสถานะของ Asset
      if (_syncContext.updateDoc && _syncContext.doc && item.firestoreId) {
        await _syncContext.updateDoc(_syncContext.doc(_syncContext.db, "assets", item.firestoreId), {
          status: item.status,
          lastChecked: _syncContext.serverTimestamp ? _syncContext.serverTimestamp() : new Date(),
          lastInspector: item.inspector,
          lastPhoto: finalPhotoURL
        });
      }

      syncedCount++;
    } catch (err) {
      console.error(`❌ [OfflineQueue] Sync failed for asset ${item.assetId}:`, err);
      failedItems.push(item);
    }
  }

  savePendingQueue(failedItems);
  _isSyncing = false;

  if (syncedCount > 0) {
    console.log(`✅ [OfflineQueue] Successfully synced ${syncedCount} item(s)!`);
    if (typeof _syncContext.onSyncComplete === 'function') {
      _syncContext.onSyncComplete(syncedCount);
    }
    if (manual) {
      alert(`✅ ซิงก์ข้อมูลตรวจเช็กที่ค้างไว้ขึ้นเซิร์ฟเวอร์เรียบร้อย (${syncedCount} รายการ)`);
    }
  }
}
