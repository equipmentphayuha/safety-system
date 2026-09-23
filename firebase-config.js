// firebase-config.js
// ระบบตรวจสอบความปลอดภัย - โรงพยาบาลพยุหะคีรี (Pyuha Safety System)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, collection, addDoc, getDocs, doc, setDoc, getDoc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
  getStorage, ref, uploadBytes, getDownloadURL 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { 
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, 
  onAuthStateChanged, signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// *** Firebase Config - safety-system-76b42 ***
const firebaseConfig = {
  apiKey: "AIzaSyD8jN6pkCyEkiUDyMCc73Nz_jj-kkJG2IY",
  authDomain: "safety-system-76b42.firebaseapp.com",
  projectId: "safety-system-76b42",
  storageBucket: "safety-system-76b42.firebasestorage.app",
  messagingSenderId: "816638612669",
  appId: "1:816638612669:web:e12ee92bce7cb27e1b93d4",
  measurementId: "G-RSYLFMDTEP"
};

// ฟังก์ชันตรวจสอบว่ามีการตั้งค่า Firebase จริงหรือยัง
export function isFirebaseReady() {
  return firebaseConfig.apiKey && 
         !firebaseConfig.apiKey.includes("YOUR_API_KEY") &&
         firebaseConfig.projectId &&
         firebaseConfig.projectId.length > 0;
}

let app = null;
let db = null;
let storage = null;
let auth = null;

try {
  if (isFirebaseReady()) {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    storage = getStorage(app);
    auth = getAuth(app);
    console.log("🔥 Connected to Firebase Services successfully");
  } else {
    console.warn("ℹ️ Running in Local / Demo mode. To connect to Cloud, update firebaseConfig in firebase-config.js");
  }
} catch (e) {
  console.warn("⚠️ Firebase init warning:", e.message);
}

export { 
  app,
  db, 
  storage, 
  auth,
  collection, 
  addDoc, 
  getDocs, 
  doc, 
  setDoc,
  getDoc,
  updateDoc, 
  deleteDoc,
  query, 
  orderBy, 
  onSnapshot, 
  serverTimestamp,
  ref, 
  uploadBytes, 
  getDownloadURL,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut
};
