// sw.js
// Service Worker สำหรับ Phayuha Hospital Safety
// รองรับการทำงานแบบ Offline First (แคชภาพผังอาคาร, สไตล์ชีต, และสคริปต์หลัก)

const CACHE_NAME = 'phayuha-hospital-safety-v1.3.0';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css?v=1.0.0',
  './js/ui-utilities.css?v=1.0.0',
  './firebase-config.js',
  './app.js?v=1.0.0',
  './js/constants.js',
  './js/auth.js',
  './js/checklist-config.js',
  './js/offline-sync.js',
  './js/report-constants.js',
  './js/report-module.js',
  './js/scanner-controller.js',
  './js/register-controller.js',
  './js/events.js',
  './js/storage-service.js',
  './moph_logo.svg',
  './moph_192.png',
  './moph_512.png',
  './garuda.png',
  './initial_assets.json',
  // ผังอาคารทั้ง 9 โซน
  './maps/hpc_floorplan.webp?v=1.0.0',
  './maps/ipd_floorplan.webp?v=1.0.0',
  './maps/nisit_floorplan.webp?v=1.0.0',
  './maps/er_upper_floorplan.webp?v=1.0.0',
  './maps/er_lower_floorplan.webp?v=1.0.0',
  './maps/opd_dm_floorplan.webp?v=1.0.0',
  './maps/pharma_rehab_floorplan.webp?v=1.0.0',
  './maps/thai_med_floorplan.webp?v=1.0.0',
  './maps/canteen_floorplan.webp?v=1.0.0'
];

// ติดตั้ง Service Worker และบันทึก Pre-cache ทันที
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('📦 [Service Worker] Pre-caching offline assets...');
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('⚠️ [Service Worker] Pre-cache partial warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// เคลียร์แคชรุ่นเก่าเมื่อมีการอัปเดตเวอร์ชันใหม่
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('🧹 [Service Worker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// กลยุทธ์ Stale-While-Revalidate หรือ Network First สำหรับ Firestore/CDN
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ปล่อยคำขอ Firebase Auth / Firestore / Google APIs ไปที่ Network ปกติ
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('identitytoolkit')
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // พบในแคช ส่งกลับทันที และดึงอัปเดตเบื้องหลัง (Stale-while-revalidate)
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse.clone());
            });
          }
        }).catch(() => {});
        return cachedResponse;
      }

      // ถ้าไม่พบในแคช ให้ดึงจาก Network และบันทึกลงแคช
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        // กรณีออฟไลน์และเปิดหน้าแรก
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
