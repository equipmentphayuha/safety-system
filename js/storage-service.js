// js/storage-service.js
// บริการจัดการ Storage และ Cache กลาง (Cloud-First with Resilient Local Fallback)
// ป้องกันปัญหา LocalStorage กระจัดกระจาย และสร้าง Single Source of Truth

class StorageService {
  constructor() {
    this._memoryCache = new Map();
  }

  // ดึงข้อมูล (Memory -> LocalStorage Fallback)
  get(key, defaultValue = null) {
    if (this._memoryCache.has(key)) {
      return this._memoryCache.get(key);
    }
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return defaultValue;
      const parsed = JSON.parse(raw);
      this._memoryCache.set(key, parsed);
      return parsed;
    } catch (e) {
      // กรณีค่าใน localStorage เป็น string ธรรมดาไม่ใช่ JSON
      try {
        const raw = localStorage.getItem(key);
        return raw !== null ? raw : defaultValue;
      } catch (err) {
        return defaultValue;
      }
    }
  }

  // บันทึกข้อมูลลงทั้ง Memory Cache และ LocalStorage
  set(key, value) {
    this._memoryCache.set(key, value);
    try {
      if (value === null || value === undefined) {
        localStorage.removeItem(key);
      } else if (typeof value === 'string') {
        localStorage.setItem(key, value);
      } else {
        localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (e) {
      console.warn(`[StorageService] Failed to persist key "${key}" to localStorage:`, e.message);
    }
  }

  // ลบข้อมูล
  remove(key) {
    this._memoryCache.delete(key);
    try {
      localStorage.removeItem(key);
    } catch (e) {}
  }

  // ล้างแคชทั้งหมด
  clearMemory() {
    this._memoryCache.clear();
  }
}

export const storageService = new StorageService();
