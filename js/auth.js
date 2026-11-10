// js/auth.js
// ระบบยืนยันตัวตนและการจัดการสิทธิ์ (Authentication & Session Guard)
import { storageService } from './storage-service.js';

const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 ชั่วโมง
let _lastActivityUpdate = 0;

export function getSession() {
  try {
    const session = storageService.get('pyh_active_session');
    if (!session || !session.officer) return null;

    const now = Date.now();
    if (session.lastActivity) {
      if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
        clearSession();
        return null;
      }
    }
    updateSessionActivity();
    return session;
  } catch (e) {
    return null;
  }
}

export function setSession(officer, role) {
  const now = Date.now();
  const sessionData = {
    officer,
    role,
    loginAt: now,
    lastActivity: now
  };
  storageService.set('pyh_active_session', sessionData);
  storageService.set('pyh_officer', officer);
  storageService.set('pyh_role', role);
}

export function clearSession() {
  storageService.remove('pyh_active_session');
  storageService.remove('pyh_officer');
  storageService.remove('pyh_role');
}

export function updateSessionActivity() {
  const now = Date.now();
  if (now - _lastActivityUpdate < 10000) return;
  _lastActivityUpdate = now;

  try {
    const session = storageService.get('pyh_active_session');
    if (session && session.officer) {
      session.lastActivity = now;
      storageService.set('pyh_active_session', session);
    }
  } catch (e) {}
}

export function checkSessionExpiration(onExpiredCallback) {
  try {
    const session = storageService.get('pyh_active_session');
    if (session && session.lastActivity) {
      if (Date.now() - session.lastActivity > SESSION_TIMEOUT_MS) {
        clearSession();
        if (typeof onExpiredCallback === 'function') {
          onExpiredCallback();
        }
      }
    }
  } catch (e) {}
}

export function initActivityTracker(onExpiredCallback) {
  setInterval(() => checkSessionExpiration(onExpiredCallback), 60 * 1000);
  ['click', 'keydown', 'touchstart', 'scroll'].forEach(eventType => {
    window.addEventListener(eventType, () => updateSessionActivity(), { passive: true });
  });
}
