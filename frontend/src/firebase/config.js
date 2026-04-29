// Firebase configuration — eager init (background, never blocks rendering)
import { initializeApp, getApps } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getAuth, connectAuthEmulator } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyA-4cTJN8zpfefmmgulE_XavMZ9jsd0b_w",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "jtsb-natural-live.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "jtsb-natural-live",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "jtsb-natural-live.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "103883989218",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:103883989218:web:5bad1f05fe48e686337ebb"
};

// Initialize Firebase app only if not already initialized
let app;
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

// Initialize Analytics lazily (doesn't block rendering)
let analytics = null;
if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
      console.log('Firebase Analytics initialized');
    }
  }).catch((e) => {
    console.error('Analytics init failed:', e);
  });
}

// Initialize Firestore
let db;
try {
  db = getFirestore(app);
  const EMULATE = import.meta.env.VITE_FIREBASE_EMULATE === 'true';
  const FIREBASE_EMULATOR_HOST = import.meta.env.VITE_FIREBASE_EMULATOR_HOST || 'localhost';
  if (EMULATE) {
    connectFirestoreEmulator(db, FIREBASE_EMULATOR_HOST, 8080);
  }
} catch (e) {
  console.error('Firestore init failed:', e);
  db = null;
}

// Initialize Storage
let storage;
try {
  storage = getStorage(app);
  const EMULATE = import.meta.env.VITE_FIREBASE_EMULATE === 'true';
  const FIREBASE_EMULATOR_HOST = import.meta.env.VITE_FIREBASE_EMULATOR_HOST || 'localhost';
  if (EMULATE) {
    connectStorageEmulator(storage, FIREBASE_EMULATOR_HOST, 9199);
  }
} catch (e) {
  console.error('Storage init failed:', e);
  storage = null;
}

// Initialize Auth
let auth;
try {
  auth = getAuth(app);
  const EMULATE = import.meta.env.VITE_FIREBASE_EMULATE === 'true';
  const FIREBASE_EMULATOR_HOST = import.meta.env.VITE_FIREBASE_EMULATOR_HOST || 'localhost';
  if (EMULATE) {
    connectAuthEmulator(auth, `http://${FIREBASE_EMULATOR_HOST}:9099`);
  }
} catch (e) {
  console.error('Auth init failed:', e);
  auth = null;
}

function getDb() {
  if (!db) {
    throw new Error('Firestore not available. Check Firebase Console → Firestore Database → Enable it.');
  }
  return db;
}

function getStorageRef() {
  if (!storage) {
    throw new Error('Storage not available. Check Firebase Console → Storage → Enable it.');
  }
  return storage;
}

function getAuthRef() {
  if (!auth) {
    throw new Error('Auth not available. Check Firebase Console → Authentication → Enable it.');
  }
  return auth;
}

export { app, analytics, db, storage, auth, getDb, getStorageRef, getAuthRef };
export default app;
