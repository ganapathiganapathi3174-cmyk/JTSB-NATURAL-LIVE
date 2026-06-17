// Firebase Firestore database layer - NEW COLLECTIONS
import {
  collection,
  doc,
  addDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  deleteDoc,
  writeBatch,
  setDoc,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  runTransaction,
} from 'firebase/firestore';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { getDb, getPaymentsDb, getStorageRef, getAuthRef } from '../firebase/config.js';
import { ref, deleteObject } from 'firebase/storage';
import { AppwritePayment } from './appwrite-payment.js';

const COL_USERS = 'users_new';
const COL_REFERRALS = 'referrals_new';
const COL_TOPUPS = 'topups_new';
const COL_TOPUP_INCOME = 'topup_referral_income';
const COL_MESSAGES = 'notifications';
const COL_CHAT_MESSAGES = 'chat_messages';
const COL_CHAT_CONVOS = 'chat_conversations';
const STORAGE_FOLDER = 'new_payments';
const MAX_REFERRALS = 2;
const REFERRAL_EXPIRY_DAYS = 7;
const EXPECTED_AMOUNT = 120;
const EXPECTED_UPI_ID = 'jayarajj126-3@okicici';
const EXPECTED_RECEIVER_NAME = 'JEYARAJ ALAGAR';
const REQUIRED_PAYMENT_STATUS = 'Completed';
const UPI_SIMILARITY_THRESHOLD = 90;

async function hashData(data) {
  if (!data) return '';
  try {
    const encoder = new TextEncoder();
    const buf = encoder.encode(typeof data === 'string' ? data : JSON.stringify(data));
    const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

let _cryptoUnavailable = false;

async function hashPassword(password) {
  if (!password) return '';
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    _cryptoUnavailable = true;
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
      const char = password.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }
}

const _pwCache = new Map();
async function hashPasswordCached(password) {
  if (!password) return '';
  const cached = _pwCache.get(password);
  if (cached) return cached;
  const hash = await hashPassword(password);
  if (_pwCache.size > 50) _pwCache.clear();
  _pwCache.set(password, hash);
  return hash;
}

async function comparePassword(plaintext, storedHash) {
  if (!storedHash) return false;
  if (_cryptoUnavailable) return plaintext === storedHash;
  const hash = await hashPassword(plaintext);
  if (hash === storedHash) return true;
  if (plaintext === storedHash) return true;
  const hashLen = storedHash.length;
  if (hashLen === 64 && /^[0-9a-f]{64}$/i.test(storedHash)) return false;
  return false;
}

function normalizeUpi(upi) {
  let s = upi.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9@._-]/g, '');
  const corrections = { '1': 'l', 'l': '1', '0': 'o', 'o': '0', '5': 's', 's': '5', '8': 'b', 'b': '8' };
  return s.split('').map(c => corrections[c] || c).join('');
}

function stringSimilarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(dp[i], dp[i - 1], prev);
      prev = tmp;
    }
  }
  return Math.round((1 - dp[a.length] / maxLen) * 100);
}

function isUpiValid(ocrUpi) {
  if (!ocrUpi) return false;
  return stringSimilarity(normalizeUpi(ocrUpi), normalizeUpi(EXPECTED_UPI_ID)) >= UPI_SIMILARITY_THRESHOLD;
}

function computeReferralExpiryDate() {
  const date = new Date();
  date.setDate(date.getDate() + REFERRAL_EXPIRY_DAYS);
  return date.toISOString();
}

function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Ensure Firebase Auth has a signed-in user for Firestore security rules
let _authEnsured = false;
async function ensureFirebaseAuth() {
  if (_authEnsured) return;
  let auth;
  try {
    auth = getAuthRef();
  } catch (e) {
    console.error('[AUTH] Auth not available:', e.message);
    return;
  }
  if (auth.currentUser) {
    _authEnsured = true;
    console.error('[AUTH] Firebase user already signed in:', auth.currentUser.uid);
    return;
  }

  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL;
  const adminPassword = import.meta.env.VITE_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    console.error('[AUTH] Admin credentials not configured in env vars');
    return;
  }

  // Try creating the admin Firebase Auth user first (handles case where user doesn't exist yet)
  try {
    console.error('[AUTH] Creating admin Firebase Auth user...');
    await createUserWithEmailAndPassword(auth, adminEmail, adminPassword);
    console.error('[AUTH] Admin user created and signed in successfully');
    _authEnsured = true;
    return;
  } catch (e) {
    if (e.code === 'auth/email-already-in-use') {
      try {
        console.error('[AUTH] Admin user exists, signing in...');
        await signInWithEmailAndPassword(auth, adminEmail, adminPassword);
        console.error('[AUTH] Admin sign-in successful');
        _authEnsured = true;
        return;
      } catch (e2) {
        console.error('[AUTH] Admin sign-in failed:', e2.code, e2.message);
      }
    } else {
      console.error('[AUTH] Admin user creation failed:', e.code, e.message);
    }
  }

  // Fallback: anonymous auth
  try {
    console.error('[AUTH] Trying anonymous sign-in...');
    await signInAnonymously(auth);
    console.error('[AUTH] Anonymous sign-in successful');
    _authEnsured = true;
  } catch (e) {
    console.error('[AUTH] Anonymous sign-in also failed:', e.code, e.message);
    // Non-blocking — Firestore security rules now allow delete without auth
  }
}

export const FirebaseAuth = {
  async register(email, password) {
    const auth = getAuthRef();
    console.log('FirebaseAuth.register called with:', email);
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    console.log('FirebaseAuth.register success, user:', userCredential.user.email);
    return userCredential.user;
  },

  async login(email, password) {
    const auth = getAuthRef();
    const emailStr = String(email).trim().toLowerCase();
    const passwordStr = String(password);
    console.log('FirebaseAuth.login attempt:', { email: emailStr, passwordLen: passwordStr.length });
    try {
      const userCredential = await signInWithEmailAndPassword(auth, emailStr, passwordStr);
      console.log('Login success');
      return userCredential.user;
    } catch (err) {
      console.error('Login failed:', err.code, err.message);
      if (err.code === 'auth/invalid-api-key') {
        throw new Error('Firebase configuration error. Contact admin.');
      }
      throw err;
    }
  },

  async logout() {
    const auth = getAuthRef();
    await signOut(auth);
  },

  onAuthChange(callback) {
    const auth = getAuthRef();
    return onAuthStateChanged(auth, callback);
  },

  getCurrentUser() {
    const auth = getAuthRef();
    return auth.currentUser;
  },
};

async function retryFirestore(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const isRateLimit = e?.code === 'resource-exhausted' || e?.code === 'unavailable' ||
        (typeof e?.message === 'string' && (e.message.includes('429') || e.message.includes('Too Many Requests') || e.message.includes('RESOURCE_EXHAUSTED')));
      if (isRateLimit && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1) + Math.random() * 1000, 8000);
        console.warn(`Firestore rate limited (429), retrying in ${Math.round(delay)}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw e;
      }
    }
  }
}

async function batchDeleteDocs(db, docRefs) {
  const BATCH_LIMIT = 500;
  for (let i = 0; i < docRefs.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    const chunk = docRefs.slice(i, i + BATCH_LIMIT);
    for (const ref of chunk) batch.delete(ref);
    await retryFirestore(() => batch.commit());
  }
}

export const FirebaseUser = {
  async _claimUnique(db, field, value) {
    const docId = `${field}:${String(value).toLowerCase().trim()}`;
    const ref = doc(db, '_uniques', docId);
    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(ref);
        if (snap.exists()) throw new Error(field === 'email'
          ? 'This email is already registered. Please use another email or login.'
          : 'This mobile number is already registered.');
        transaction.set(ref, { field, value: String(value).toLowerCase().trim(), claimed_at: new Date().toISOString() });
      });
    } catch (e) {
      if (e.message === 'This email is already registered. Please use another email or login.' ||
          e.message === 'This mobile number is already registered.') {
        // Check if this uniqueness claim is stale (user doc deleted without cleaning _uniques)
        try {
          const userQuery = field === 'email'
            ? query(collection(db, COL_USERS), where('email', '==', String(value).toLowerCase().trim()))
            : query(collection(db, COL_USERS), where('phone', '==', String(value).trim()));
          const userSnap = await getDocs(userQuery);
          if (userSnap.empty) {
            // Stale claim — delete and re-create
            await deleteDoc(ref);
            await setDoc(ref, { field, value: String(value).toLowerCase().trim(), claimed_at: new Date().toISOString() });
            return;
          }
        } catch (_) { /* fall through to throw */ }
        throw e;
      }
      const existing = await getDoc(ref);
      if (existing.exists()) {
        throw new Error(field === 'email'
          ? 'This email is already registered. Please use another email or login.'
          : 'This mobile number is already registered.');
      }
      await setDoc(ref, { field, value: String(value).toLowerCase().trim(), claimed_at: new Date().toISOString() });
    }
  },

  async create(userData) {
    const db = getDb();
    const now = new Date().toISOString();
    
    let referralCode;
    for (let i = 0; i < 3; i++) {
      referralCode = generateReferralCode();
      const existing = await FirebaseUser.findByReferralCode(referralCode);
      if (!existing) break;
    }

    console.log('Creating user document with password:', userData.password ? 'YES' : 'NO');
    const hashedPw = await hashPasswordCached(userData.password || '');
    
    if (userData.referredBy) {
      const rc = userData.referredBy.toUpperCase();
      const referrer = await this.findByReferralCode(rc);
      if (referrer) {
        const isExpired = referrer.referral_expires_at && new Date(referrer.referral_expires_at) < new Date();
        const limitReached = (referrer.referrals_count || 0) >= MAX_REFERRALS;
        if (isExpired || limitReached) throw new Error('Invalid Referral Code');
      }
    }
    
    const userDoc = {
      name: userData.name,
      email: userData.email.toLowerCase(),
      phone: userData.phone || '',
      password: hashedPw,
      status: 'pending',
      payment_status: 'pending',
      upi_screenshot_url: null,
      utr_number: null,
      referral_code: referralCode,
      referred_by: userData.referredBy || null,
      referred_by_status: userData.referredBy ? 'pending' : null,
      referrals_count: 0,
      total_referral_count: 0,
      referral_limit_reached: false,
      referral_active: true,
      referral_cycle: 0,
      referral_view_count: 0,
      referral_view_cycle: 0,
      cycle_payment_status: null,
      cycle_payment_utr: null,
      cycle_upi_screenshot_url: null,
      account_status: 'inactive',
      admin_approval_status: 'PENDING',
      is_active: false,
      is_first_payment_done: false,
      joinedDate: null,
      approvedDate: null,
      lastActiveAt: null,
      created_at: now,
      referral_created_at: now,
      referral_expires_at: computeReferralExpiryDate(),
    };

    await retryFirestore(() => this._claimUnique(db, 'email', userData.email));
    if (userData.phone) await retryFirestore(() => this._claimUnique(db, 'phone', userData.phone));

    const ref = await retryFirestore(() => addDoc(collection(db, COL_USERS), userDoc));
    console.log('User created in Firestore with password:', userDoc.password ? 'YES' : 'NO');
    
    if (userData.referredBy) {
      try {
        const referrer = await this.findByReferralCode(userData.referredBy.toUpperCase());
        if (referrer) {
          const isExpired = referrer.referral_expires_at && new Date(referrer.referral_expires_at) < new Date();
          if (!isExpired && referrer.payment_status === 'approved' && referrer.account_status === 'active' && referrer.admin_status !== 'suspicious' && (referrer.referrals_count || 0) < 2) {
            console.log('Referral stored as pending:', userData.referredBy);
          }
        }
      } catch (e) {
        console.warn('Referral check failed:', e);
      }
    }
    return { id: ref.id, ...userDoc };
  },

  async createWithPassword(userData) {
    const db = getDb();
    const now = new Date().toISOString();
    const pass = userData.password || '';
    const hashedPass = await hashPasswordCached(pass);
    
    console.log('createWithPassword: creating user with password:', pass.substring(0, 2) + '***');
    console.log('Collection name:', COL_USERS);
    
    let referralCode;
    for (let i = 0; i < 3; i++) {
      referralCode = generateReferralCode();
      const existing = await FirebaseUser.findByReferralCode(referralCode);
      if (!existing) break;
    }
    
    if (userData.referredBy) {
      const rc = userData.referredBy.toUpperCase();
      const referrer = await this.findByReferralCode(rc);
      if (referrer) {
        const isExpired = referrer.referral_expires_at && new Date(referrer.referral_expires_at) < new Date();
        const limitReached = (referrer.referrals_count || 0) >= MAX_REFERRALS;
        if (isExpired || limitReached) throw new Error('Invalid Referral Code');
      }
    }
    
    const userDoc = {
      name: userData.name,
      email: userData.email.toLowerCase(),
      phone: userData.phone || '',
      password: hashedPass,
      status: 'pending',
      payment_status: 'pending',
      upi_screenshot_url: null,
      utr_number: null,
      referral_code: referralCode,
      referred_by: userData.referredBy || null,
      referred_by_status: userData.referredBy ? 'pending' : null,
      referrals_count: 0,
      total_referral_count: 0,
      referral_limit_reached: false,
      referral_active: true,
      referral_cycle: 0,
      referral_view_count: 0,
      referral_view_cycle: 0,
      cycle_payment_status: null,
      cycle_payment_utr: null,
      cycle_upi_screenshot_url: null,
      account_status: 'inactive',
      admin_approval_status: 'PENDING',
      is_active: false,
      is_first_payment_done: false,
      joinedDate: null,
      approvedDate: null,
      lastActiveAt: null,
      created_at: now,
      referral_created_at: now,
      referral_expires_at: computeReferralExpiryDate(),
    };

    await retryFirestore(() => this._claimUnique(db, 'email', userData.email));
    if (userData.phone) await retryFirestore(() => this._claimUnique(db, 'phone', userData.phone));

    const ref = await retryFirestore(() => addDoc(collection(db, COL_USERS), userDoc));
    const newId = ref.id;
    
    console.log('[REGISTRATION] User document created in:', COL_USERS);
    console.log('[REGISTRATION] User ID:', newId);
    console.log('[REGISTRATION] account_status:', userDoc.account_status, '→ PENDING (via admin_approval_status:', userDoc.admin_approval_status, ')');
    console.log('[REGISTRATION] payment_status:', userDoc.payment_status);
    console.log('[REGISTRATION] is_active:', userDoc.is_active);
    console.log('[REGISTRATION] admin_approval_status:', userDoc.admin_approval_status, '— user will be blocked from login until approved');
    console.log('[REGISTRATION] User data being saved:', JSON.stringify(userDoc));
    
    // Handle referral - when someone uses referral code, increment referrer's count
    if (userData.referredBy) {
      try {
        const referralCode = userData.referredBy.toUpperCase();
        const referrer = await this.findByReferralCode(referralCode);
        if (referrer) {
          const isExpired = referrer.referral_expires_at && new Date(referrer.referral_expires_at) < new Date();
          if (isExpired) {
            console.log('Referral code has expired:', referralCode);
            await updateDoc(ref, { referred_by: null });
          } else if (referrer.id !== newId) {
            const referrerLimit = referrer.referrals_count || 0;
            const isReferralActive = referrer.referral_active !== false;
            const isPaymentApproved = referrer.payment_status === 'approved';
            const isAccountActive = referrer.account_status === 'active';
            const isSuspicious = referrer.admin_status === 'suspicious';

            if (referrerLimit >= 2 || !isReferralActive || !isPaymentApproved || !isAccountActive || isSuspicious) {
              console.log('Referral code is no longer valid:', referralCode, 'limit:', referrerLimit, 'active:', isReferralActive, 'payment:', isPaymentApproved, 'account:', isAccountActive);
              await updateDoc(ref, { referred_by: null });
            } else {
              await updateDoc(ref, { referred_by: referralCode, referred_by_status: 'pending' });
              console.log('Referral stored as pending:', referralCode, '->', newId);
            }
          } else {
            console.log('Self-referral prevented');
          }
        } else {
          console.log('Referrer not found for code:', referralCode);
        }
      } catch (e) {
        console.warn('Failed to process referral:', e);
      }
    }
    
    return { id: newId, ...userDoc };
  },

  async findByEmail(email) {
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    const emailLower = email.toLowerCase();
    const q = query(colRef, where('email', '==', emailLower));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  },

  async findByPhone(phone) {
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    const phoneTrimmed = phone.trim();
    const q = query(colRef, where('phone', '==', phoneTrimmed));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  },

  async findByEmailAndPassword(email, password) {
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    const q = query(colRef, where('email', '==', email.toLowerCase()));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    const user = { id: d.id, ...d.data() };
    const match = await comparePassword(password, user.password);
    if (!match) return null;
    return user;
  },

  async findById(id) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  },

  async findByReferralCode(code) {
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    const q = query(colRef, where('referral_code', '==', code.toUpperCase()));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  },

  async findByUtr(utr) {
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    const q = query(colRef, where('utr_number', '==', utr));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  },

  async getReferralsByReferrerCode(referralCode) {
    if (!referralCode) return [];
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    const q = query(colRef, where('referred_by', '==', referralCode.toUpperCase()));
    const snap = await getDocs(q);
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return users.filter(u => u.referred_by_status === 'approved' || !u.referred_by_status);
  },

  async getAllReferralsByReferrerCode(referralCode) {
    if (!referralCode) return [];
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    const q = query(colRef, where('referred_by', '==', referralCode.toUpperCase()));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getReferredUsers(referralCode) {
    return this.getReferralsByReferrerCode(referralCode);
  },

  async getReferrerInfo(referralCode) {
    if (!referralCode) return null;
    const referrer = await this.findByReferralCode(referralCode);
    if (!referrer) return null;
    return { id: referrer.id, name: referrer.name, email: referrer.email };
  },

  async countReferralsUsed(referralCode) {
    if (!referralCode) return 0;
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    const q = query(colRef, where('referred_by', '==', referralCode.toUpperCase()));
    const snap = await getDocs(q);
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return users.filter(u => u.referred_by_status === 'approved' || !u.referred_by_status).length;
  },

  async updatePaymentStatus(id, payment_status) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    const user = await this.findById(id);
    if (!user) {
      console.log('User not found for payment status update:', id);
      return;
    }
    console.log('Updating payment status for:', id, 'to:', payment_status);
    const updateData = {
      payment_status,
      status: payment_status === 'approved' ? 'approved' : payment_status,
    };
    if (payment_status === 'approved') {
      updateData.account_status = 'active';
      updateData.is_first_payment_done = true;
      updateData.referrals_count = 0;
      updateData.referral_limit_reached = false;
      updateData.referral_active = true;
      updateData.is_qualified = false;
      updateData.auto_rejected = false;
      updateData.validation_status = 'passed';
      updateData.admin_approval_status = 'APPROVED';
      updateData.is_active = true;
    }
    await updateDoc(ref, updateData);
    console.log('[AUTO APPROVAL DEBUG] updatePaymentStatus wrote:', JSON.stringify({
      userId: id,
      payment_status: updateData.payment_status,
      account_status: updateData.account_status,
      status: updateData.status,
      admin_approval_status: updateData.admin_approval_status,
      is_active: updateData.is_active,
    }));
    
    // Activate pending referral for the referrer after admin approval
    if (payment_status === 'approved' && user.referred_by && user.referred_by_status === 'pending') {
      try {
        const referrer = await this.findByReferralCode(user.referred_by);
        if (referrer && referrer.id !== id) {
          const referrerLimit = referrer.referrals_count || 0;
          if (referrerLimit < 2) {
            const newCount = referrerLimit + 1;
            const isQualified = newCount >= 2;
            const referrerUpdate = {
              referrals_count: newCount,
              total_referral_count: (referrer.total_referral_count || 0) + 1,
              referral_limit_reached: isQualified,
              referral_active: !isQualified,
              is_qualified: isQualified,
              account_status: isQualified ? 'inactive' : (referrer.account_status || 'active'),
            };
            if (isQualified) {
              referrerUpdate.cycle_payment_status = null;
            }
            await updateDoc(doc(db, COL_USERS, referrer.id), referrerUpdate);
            
            await addDoc(collection(db, COL_REFERRALS), {
              user_id: referrer.id,
              name: user.name || 'Unknown',
              email: user.email || '',
              phone: user.phone || '',
              created_at: new Date().toISOString(),
            });
            
            // Only mark referred_by_status after all referrer updates succeed
            await updateDoc(ref, { referred_by_status: 'approved' });
            
            console.log('Referral activated for referrer:', referrer.id, 'count:', newCount);
          }
        }
      } catch (e) {
        console.warn('Failed to activate pending referral:', e);
      }
    }
  },

  async updatePassword(id, newPassword) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    const hashed = await hashPasswordCached(newPassword);
    try {
      await updateDoc(ref, { password: hashed });
      return true;
    } catch (err) {
      console.log('Update password error:', err);
      throw err;
    }
  },

  async updateReferralCode(id, refCode) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    try {
      const user = await this.findById(id);
      if (user?.referred_by) {
        console.log('User already has referral, skipping');
        return;
      }
      
      const referrer = await this.findByReferralCode(refCode);
      if (referrer && referrer.id !== id) {
        const isActive = referrer.referral_active !== false;
        const hasReachedLimit = (referrer.referrals_count || 0) >= 2;
        
        if (!isActive || hasReachedLimit) {
          console.log('Referral code is no longer valid:', refCode);
          throw new Error('Referral code is no longer valid');
        }
        
        await updateDoc(ref, { referred_by: refCode, referred_by_status: 'pending' });
        
        console.log('Referral code updated (pending):', refCode);
      } else {
        console.log('Referrer not found for code:', refCode);
      }
    } catch (err) {
      console.log('Update referral code error:', err);
      throw err;
    }
  },

  async setUserPassword(id, password) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    const hashed = await hashPasswordCached(password);
    await updateDoc(ref, { password: hashed });
  },

  async updatePayment(id, screenshotData, utr, userEnteredAmount = '120', userEnteredDate = '', screenshotHash = '') {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    const data = {
      utr_number: utr || null,
      payment_status: 'pending',
      user_entered_amount: userEnteredAmount,
      user_entered_date: userEnteredDate || new Date().toISOString().split('T')[0],
    };
    if (screenshotHash) data.screenshot_hash = screenshotHash;
    console.log('updatePayment: id:', id, 'utr:', utr, 'screenshotSize:', screenshotData ? Math.round(screenshotData.length / 1024) + 'KB' : 'none');
    if (screenshotData) {
      data.upi_screenshot_url = screenshotData;
    }
    await updateDoc(ref, data);
  },

  async updateUpiScreenshot(id, value1, value2) {
    const db = getDb();
    const userRef = doc(db, COL_USERS, id);

    // Defense-in-depth: block payment submission if referrals not completed
    if (value2 && !['pending', 'approved', 'rejected'].includes(value2)) {
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const userData = snap.data();
        const referralCount = userData.referrals_count || 0;
        if (referralCount < 2 && !userData.is_qualified) {
          throw new Error('Complete 2 referrals before making payment');
        }
      }
    }

    const data = {};
    
    // value1 could be screenshot URL, status string, or null
    // value2 could be UTR string or null
    
    // If value2 looks like a status (pending/approved/rejected)
    if (value2 && ['pending', 'approved', 'rejected'].includes(value2)) {
      data.payment_status = value2;
      if (value1) data.upi_screenshot_url = value1;
    } else {
      // value1 = screenshot URL, value2 = UTR
      data.upi_screenshot_url = value1 || null;
      data.utr_number = value2 || null;
      data.payment_status = 'pending';
    }
    
    console.log('Updating Firestore:', data);
    await updateDoc(userRef, data);
  },

  async addReferral(userId, referralData) {
    const db = getDb();
    const user = await FirebaseUser.findById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }

    const existingReferrals = await FirebaseUser.getReferrals(userId);
    if (existingReferrals.length >= MAX_REFERRALS) {
      throw new Error(`Maximum ${MAX_REFERRALS} referrals allowed`);
    }

    const referralDoc = {
      user_id: userId,
      name: referralData.name,
      email: referralData.email.toLowerCase(),
      phone: referralData.phone || '',
      created_at: new Date().toISOString(),
    };

    const ref = await addDoc(collection(db, COL_REFERRALS), referralDoc);
    
    await FirebaseUser.incrementReferralCount(userId);

    return { id: ref.id, ...referralDoc };
  },

  async removeReferral(userId, referralId) {
    const db = getDb();
    const referralRef = doc(db, COL_REFERRALS, referralId);
    const referralSnap = await getDoc(referralRef);
    
    if (!referralSnap.exists()) {
      throw new Error('Referral not found');
    }

    await deleteDoc(referralRef);
    
    await FirebaseUser.decrementReferralCount(userId);
  },

  async getReferrals(userId) {
    const db = getDb();
    const colRef = collection(db, COL_REFERRALS);
    const q = query(colRef, where('user_id', '==', userId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async deleteUser(id, { email, phone } = {}) {
    const OP_TIMEOUT = 8000;
    const db = getDb();

    const timeout = (promise, label) =>
      Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`"${label}" timed out`)), OP_TIMEOUT))
      ]);

    let user;
    try {
      user = await timeout(FirebaseUser.findById(id), 'findById');
    } catch (e) {
      console.error('[DELETE] findById failed:', e.message);
    }

    const allDeletions = [];

    // Fire-and-forget non-critical cleanup
    if (user?.referred_by && user?.referred_by_status === 'approved') {
      FirebaseUser.findByReferralCode(user.referred_by).then(r => {
        if (r) FirebaseUser.decrementReferralCount(r.id).catch(() => {});
      }).catch(() => {});
    }

    if (user?.upi_screenshot_url) {
      try { const s = getStorageRef(); deleteObject(ref(s, user.upi_screenshot_url)).catch(() => {}); }
      catch (e) { /* storage not configured */ }
    }
    if (user?.cycle_upi_screenshot_url) {
      try { const s = getStorageRef(); deleteObject(ref(s, user.cycle_upi_screenshot_url)).catch(() => {}); }
      catch (e) { /* storage not configured */ }
    }

    // Gather all document references to delete in parallel with timeout
    const refPromises = [
      timeout(FirebaseUser.getReferrals(id).then(r => r.map(rr => doc(db, COL_REFERRALS, rr.id))).catch(() => []), 'getReferrals'),
      timeout(getDocs(query(collection(db, COL_TOPUPS), where('userId', '==', id))).then(s => s.docs.map(d => doc(db, COL_TOPUPS, d.id))).catch(() => []), 'getTopups'),
      (async () => {
        try {
          const [d1, d2] = await Promise.all([
            timeout(getDocs(query(collection(db, COL_TOPUP_INCOME), where('userId', '==', id))), 'topupIncome1'),
            timeout(getDocs(query(collection(db, COL_TOPUP_INCOME), where('fromUserId', '==', id))), 'topupIncome2'),
          ]);
          return [...d1.docs.map(d => doc(db, COL_TOPUP_INCOME, d.id)), ...d2.docs.map(d => doc(db, COL_TOPUP_INCOME, d.id))];
        } catch { return []; }
      })(),
      (async () => {
        try {
          const [d1, d2] = await Promise.all([
            timeout(getDocs(query(collection(db, COL_MESSAGES), where('receiverId', '==', id))), 'notifs1'),
            timeout(getDocs(query(collection(db, COL_MESSAGES), where('senderId', '==', id))), 'notifs2'),
          ]);
          return [...d1.docs.map(d => doc(db, COL_MESSAGES, d.id)), ...d2.docs.map(d => doc(db, COL_MESSAGES, d.id))];
        } catch { return []; }
      })(),
      timeout(getDocs(query(collection(db, 'payment_images'), where('userId', '==', id))).then(s => s.docs.map(d => doc(db, 'payment_images', d.id))).catch(() => []), 'paymentImages'),
      timeout(FirebaseChat.deleteUserChatData(id).then(() => []).catch(() => []), 'chatData'),
    ];

    const results = await Promise.allSettled(refPromises);
    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) allDeletions.push(...r.value);
    }

    // Delete unique claims
    const ue = user?.email || email;
    const up = user?.phone || phone;
    if (ue) allDeletions.push(doc(db, '_uniques', `email:${ue.toLowerCase().trim()}`));
    if (up) allDeletions.push(doc(db, '_uniques', `phone:${up.trim()}`));

    if (allDeletions.length > 0) {
      await batchDeleteDocs(db, allDeletions);
    }

    const userRef = doc(db, COL_USERS, id);
    await timeout(deleteDoc(userRef), 'deleteUserDoc');
  },

  async getAllUsers() {
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    const snap = await getDocs(query(colRef));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async findAll() {
    return this.getAllUsers();
  },

  async count() {
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    const snap = await getDocs(query(colRef));
    return snap.size;
  },

  async findByIdAndDelete(id) {
    return this.deleteUser(id);
  },

  async permanentDelete(id) {
    return this.deleteUser(id);
  },

  async updatePaymentStatusById(id, status) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    await updateDoc(ref, { payment_status: status });
  },

  async updateAdminStatus(id, adminStatus) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    await updateDoc(ref, { admin_status: adminStatus });
  },

  async approveReferral(referredUserId) {
    const db = getDb();
    const user = await this.findById(referredUserId);
    if (!user) throw new Error('User not found');
    if (!user.referred_by) throw new Error('User has no referral');
    if (user.referred_by_status === 'approved') throw new Error('Referral already approved');

    const referralCode = user.referred_by;
    const referrer = await this.findByReferralCode(referralCode);
    if (!referrer) throw new Error('Referrer not found');

    if (referrer.admin_status === 'suspicious') throw new Error('Referrer is marked suspicious');
    if (user.admin_status === 'suspicious') throw new Error('Referred user is suspicious');
    if (user.admin_status === 'inactive') throw new Error('Referred user is inactive');

    const newCount = (referrer.referrals_count || 0) + 1;
    const isQualified = newCount >= MAX_REFERRALS;

    const referredUserRef = doc(db, COL_USERS, referredUserId);
    await updateDoc(referredUserRef, { referred_by_status: 'approved' });

    const referrerRef = doc(db, COL_USERS, referrer.id);
    await updateDoc(referrerRef, {
      referrals_count: newCount,
      total_referral_count: (referrer.total_referral_count || 0) + 1,
      referral_limit_reached: isQualified,
      is_qualified: isQualified,
      referral_active: !isQualified,
    });

    const referralsCol = collection(db, COL_REFERRALS);
    await addDoc(referralsCol, {
      user_id: referrer.id,
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      created_at: new Date().toISOString(),
    });

    if (newCount >= MAX_REFERRALS) {
      const qualifiedUser = await this.findById(referrer.id);
      if (qualifiedUser && !qualifiedUser.referral_active) {
        await updateDoc(doc(db, COL_USERS, referrer.id), {
          account_status: 'inactive',
          referral_active: true,
          cycle_payment_status: null,
        });
      }
    }
  },

  async updateUpiQrUrl(id, url) {
    return this.updateUpiScreenshot(id, url);
  },

  async decrementReferralCount(userId) {
    const user = await this.findById(userId);
    if (!user) return;
    
    const currentCount = user.referrals_count || 0;
    const newCount = Math.max(0, currentCount - 1);
    const isQualified = newCount >= MAX_REFERRALS;
    
    const db = getDb();
    const ref = doc(db, COL_USERS, userId);
    await updateDoc(ref, {
      referrals_count: newCount,
      total_referral_count: Math.max(0, (user.total_referral_count || 0) - 1),
      referral_limit_reached: isQualified,
      referral_active: !isQualified,
      is_qualified: isQualified,
    });
  },

  async incrementReferralCountByCode(referralCode) {
    const referrer = await this.findByReferralCode(referralCode);
    if (!referrer) {
      console.log('Referrer not found for code:', referralCode);
      return;
    }
    if (referrer.referral_expires_at && new Date(referrer.referral_expires_at) < new Date()) {
      console.log('Referral code has expired:', referralCode);
      return;
    }
    if (referrer.payment_status !== 'approved' || referrer.account_status !== 'active' || referrer.admin_status === 'suspicious' || (referrer.referrals_count || 0) >= 2) {
      console.log('Referrer not eligible:', referralCode);
      return;
    }
    await this.incrementReferralCount(referrer.id);
    console.log('Incremented referral count for:', referrer.id);
  },

  async incrementReferralCount(userId) {
    const user = await this.findById(userId);
    if (!user) return;

    const currentCount = user.referrals_count || 0;
    const newCount = currentCount + 1;
    const isQualified = newCount >= MAX_REFERRALS;

    const db = getDb();
    const ref = doc(db, COL_USERS, userId);
    const updateData = {
      referrals_count: newCount,
      total_referral_count: (user.total_referral_count || 0) + 1,
      referral_limit_reached: isQualified,
      referral_active: !isQualified,
      is_qualified: isQualified,
      account_status: isQualified ? 'inactive' : (user.account_status || 'active'),
    };

    if (isQualified) {
      updateData.cycle_payment_status = null;
    }

    await updateDoc(ref, updateData);
  },

  async updateCyclePaymentStatus(id, status) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    await updateDoc(ref, { cycle_payment_status: status });
  },

  async updateCyclePayment(id, screenshotUrl, utr) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    const currentUser = await this.findById(id);
    await updateDoc(ref, {
      cycle_payment_status: 'pending',
      cycle_upi_screenshot_url: screenshotUrl || null,
      cycle_payment_utr: utr || null,
      referral_cycle: (currentUser.referral_cycle || 0) + 1,
    });
  },

  async reactivate(id) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    await updateDoc(ref, {
      account_status: 'active',
      is_qualified: false,
      referrals_count: 0,
      referral_limit_reached: false,
      referral_active: true,
      cycle_payment_status: 'approved',
      referral_expires_at: computeReferralExpiryDate(),
      referral_created_at: new Date().toISOString(),
    });
  },

  async approveCyclePayment(id) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    await updateDoc(ref, {
      cycle_payment_status: 'approved',
      referrals_count: 0,
      referral_limit_reached: false,
      referral_active: true,
    });
  },

  async resetCyclePaymentAfterApproval(id) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    await updateDoc(ref, {
      referrals_count: 0,
      referral_limit_reached: false,
      referral_active: true,
    });
  },

  async incrementReferralViewCount(id) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    const user = await this.findById(id);
    if (!user) return null;
    
    const currentCycle = user.referral_cycle || 0;
    const viewCycle = user.referral_view_cycle || 0;
    
    if (viewCycle !== currentCycle) {
      await updateDoc(ref, {
        referral_view_count: 1,
        referral_view_cycle: currentCycle,
      });
      return { count: 1, cycle: currentCycle };
    }
    
    const newCount = (user.referral_view_count || 0) + 1;
    await updateDoc(ref, {
      referral_view_count: newCount,
    });
    return { count: newCount, cycle: currentCycle };
  },

  async resetReferralViewCount(id) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    await updateDoc(ref, {
      referral_view_count: 0,
      referral_view_cycle: 0,
    });
  },

  async getUsersWithPayment() {
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    const q = query(colRef);
    const snap = await getDocs(q);
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.upi_screenshot_url || u.utr_number);
  },

  subscribeToUsers(callback) {
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    return onSnapshot(colRef, (snap) => {
      try {
        const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log('[PENDING QUERY] subscribeToUsers received:', users.length, 'total users');
        const pending = users.filter(u => u.admin_approval_status === 'PENDING');
        console.log('[PENDING QUERY] Pending users:', pending.length);
        callback(users);
      } catch (err) {
        console.error('subscribeToUsers error:', err);
        callback([]);
      }
    }, (error) => {
      console.error('subscribeToUsers snapshot error:', error);
      callback([]);
    });
  },

  subscribeToUser(userId, callback) {
    const db = getDb();
    const ref = doc(db, COL_USERS, userId);
    return onSnapshot(ref, (snap) => {
      try {
        if (snap.exists()) {
          callback({ id: snap.id, ...snap.data() });
        } else {
          callback(null);
        }
      } catch (err) {
        console.error('subscribeToUser error:', err);
        callback(null);
      }
    }, (error) => {
      console.error('subscribeToUser snapshot error:', error);
      callback(null);
    });
  },

  subscribeToPayments(callback) {
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    const q = query(colRef);
    return onSnapshot(q, (snap) => {
      try {
        const users = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(u => u.payment_status || u.cycle_payment_status || u.upi_screenshot_url || u.utr_number || u.cycle_upi_screenshot_url || u.cycle_payment_utr);
        const pending = users.filter(u => u.admin_approval_status === 'PENDING');
        console.log('[PENDING QUERY] subscribeToPayments received:', users.length, 'payment users,', pending.length, 'pending approval');
        callback(users);
      } catch (err) {
        console.error('subscribeToPayments error:', err);
        callback([]);
      }
    }, (error) => {
      console.error('subscribeToPayments snapshot error:', error);
      callback([]);
    });
  },

  subscribeToUserReferrals(userId, callback) {
    const db = getDb();
    const colRef = collection(db, COL_REFERRALS);
    const q = query(colRef, where('user_id', '==', userId));
    return onSnapshot(q, (snap) => {
      try {
        const referrals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(referrals);
      } catch (err) {
        console.error('subscribeToUserReferrals error:', err);
        callback([]);
      }
    }, (error) => {
      console.error('subscribeToUserReferrals snapshot error:', error);
      callback([]);
    });
  },

  subscribeToCyclePayments(callback) {
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    return onSnapshot(colRef, (snap) => {
      const users = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(u => u.cycle_upi_screenshot_url || u.cycle_payment_utr);
      callback(users);
    }, (error) => {
      console.error('subscribeToCyclePayments error:', error);
      callback([]);
    });
  },

  subscribeToReferralsByCode(referralCode, callback) {
    if (!referralCode) {
      callback([]);
      return () => {};
    }
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    const q = query(colRef, where('referred_by', '==', referralCode.toUpperCase()));
    return onSnapshot(q, (snap) => {
      try {
        const referrals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(referrals.filter(u => u.referred_by_status === 'approved'));
      } catch (err) {
        console.error('subscribeToReferralsByCode error:', err);
        callback([]);
      }
    }, (error) => {
      console.error('subscribeToReferralsByCode snapshot error:', error);
      callback([]);
    });
  },

  // ========== VERIFICATION SYSTEM ==========

  // UTR bank format validation — returns true if UTR matches known Indian bank patterns
  _isValidUtrFormat(utr) {
    if (!utr) return false;
    const s = utr.toString().toUpperCase().trim().replace(/\s+/g, '');
    if (s.length < 10 || s.length > 18) return false;
    // Bank-prefixed UTRs: HDFC + 12 digits, SBIN + 12 digits, ICICI + 12 digits, etc.
    const bankPatterns = [
      /^(HDFC|SBIN|ICICI|PNB|AXIS|YESB|KKBK|UBIN|CANB|BARB|IDIB|ALLA|CORP|DENA|INDB|VIJB|BOM|SYNB|IOBA|PSB|UTBI|FDRL|DCBL|SIBL|KARB|TMBL|ESAF|RATN|JSBP|NKGS|SVCB|GSCB|BCBM|IBKL|CNRB|BKDN|FINO|JAKA|KVBL|NUSB|ORBC|PRTB|SBLS|SRHT|TJSB|YESB)\d{12}$/i,
      /^[A-Z]{4}\d{12}$/i,
    ];
    for (const p of bankPatterns) {
      if (p.test(s)) return true;
    }
    // Generic numeric UTR: 12-16 digits, must NOT look like phone number or timestamp
    if (/^\d{12,16}$/.test(s)) {
      if (s.length === 10 && /^[6-9]/.test(s)) return false;
      if (/^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{4,8}$/.test(s)) return false;
      return true;
    }
    return false;
  },

  // Levenshtein distance for fuzzy UTR matching
  _levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const m = [];
    for (let i = 0; i <= b.length; i++) m[i] = [i];
    for (let j = 0; j <= a.length; j++) m[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = a[j - 1] === b[i - 1] ? 0 : 1;
        m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + cost);
      }
    }
    return m[b.length][a.length];
  },

  // Normalize UTR for comparison: uppercase, trim, remove non-alphanumeric, apply OCR fix
  _normalizeUtr(val) {
    if (!val) return '';
    const s = val.toString().toUpperCase().trim();
    const fix = { 'O': '0', 'I': '1', 'L': '1', 'S': '5', 'B': '8', 'G': '6', 'Z': '2' };
    return s.replace(/[^A-Z0-9]/g, '').split('').map(c => fix[c] || c).join('');
  },

  async findDuplicateUtr(utr, excludeUserId = null) {
    if (!utr) return null;
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    const normalized = this._normalizeUtr(utr);

    // Fast path 1: Exact match on utr_number via indexed query
    const q1 = query(colRef, where('utr_number', '==', utr.toString().trim()));
    const snap1 = await getDocs(q1);
    for (const d of snap1.docs) {
      const u = { id: d.id, ...d.data() };
      if (excludeUserId && u.id === excludeUserId) continue;
      if (u.payment_status === 'approved' || u.payment_status === 'pending') {
        return {
          id: u.id, name: u.name, email: u.email, phone: u.phone,
          payment_status: u.payment_status, cycle_payment_status: u.cycle_payment_status,
          utr_number: u.utr_number, cycle_payment_utr: u.cycle_payment_utr, created_at: u.created_at,
        };
      }
    }

    // Fast path 2: Exact match on cycle_payment_utr via indexed query
    const q2 = query(colRef, where('cycle_payment_utr', '==', utr.toString().trim()));
    const snap2 = await getDocs(q2);
    for (const d of snap2.docs) {
      const u = { id: d.id, ...d.data() };
      if (excludeUserId && u.id === excludeUserId) continue;
      if (u.cycle_payment_status === 'approved' || u.cycle_payment_status === 'pending') {
        return {
          id: u.id, name: u.name, email: u.email, phone: u.phone,
          payment_status: u.payment_status, cycle_payment_status: u.cycle_payment_status,
          utr_number: u.utr_number, cycle_payment_utr: u.cycle_payment_utr, created_at: u.created_at,
        };
      }
    }

    // Fuzzy fallback: scan only approved/pending users, match by normalized + Levenshtein
    const statusFilter = query(colRef, where('payment_status', 'in', ['approved', 'pending']));
    const statusSnap = await getDocs(statusFilter);
    for (const d of statusSnap.docs) {
      const u = { id: d.id, ...d.data() };
      if (excludeUserId && u.id === excludeUserId) continue;
      const candidates = [
        { val: u.utr_number, status: u.payment_status },
        { val: u.cycle_payment_utr, status: u.cycle_payment_status },
      ];
      for (const c of candidates) {
        if (!c.val) continue;
        if (c.status !== 'approved' && c.status !== 'pending') continue;
        const cNorm = this._normalizeUtr(c.val);
        if (cNorm === normalized) {
          return {
            id: u.id, name: u.name, email: u.email, phone: u.phone,
            payment_status: u.payment_status, cycle_payment_status: u.cycle_payment_status,
            utr_number: u.utr_number, cycle_payment_utr: u.cycle_payment_utr, created_at: u.created_at,
          };
        }
      }
    }

    return null;
  },

  async checkDuplicateUtrInTopups(transactionId, excludeTopupId = null) {
    if (!transactionId) return null;
    const db = getDb();
    const colRef = collection(db, COL_TOPUPS);
    const q = query(colRef, where('transactionId', '==', transactionId.toString().trim()));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      const t = { id: d.id, ...d.data() };
      if (excludeTopupId && t.id === excludeTopupId) continue;
      if (t.status === 'approved' || t.status === 'pending') {
        return {
          id: t.id, userName: t.userName, userEmail: t.userEmail,
          amount: t.amount, status: t.status, createdAt: t.createdAt,
        };
      }
    }
    return null;
  },

  async findDuplicateTransactionId(transactionId, excludeUserId = null) {
    if (!transactionId) return null;
    const trimmedId = transactionId.toString().trim();
    const normalizedId = this._normalizeUtr(trimmedId);

    // 1. Check users_new for matching UTR (exact + normalized, no fuzzy)
    const db = getDb();
    const usersCol = collection(db, COL_USERS);
    const statusFilter = query(usersCol, where('payment_status', 'in', ['approved', 'pending']));
    const userSnap = await getDocs(statusFilter);
    for (const d of userSnap.docs) {
      const u = { id: d.id, ...d.data() };
      if (excludeUserId && u.id === excludeUserId) continue;
      for (const field of ['utr_number', 'cycle_payment_utr']) {
        const val = u[field];
        if (!val) continue;
        const status = field === 'utr_number' ? u.payment_status : u.cycle_payment_status;
        if (status !== 'approved' && status !== 'pending') continue;
        const cNorm = this._normalizeUtr(val);
        if (cNorm === normalizedId) {
          return { source: 'user', id: u.id, name: u.name, email: u.email, phone: u.phone };
        }
      }
    }

    // 2. Check topups_new for matching transaction ID (exact + normalized)
    const topupsCol = collection(db, COL_TOPUPS);
    const topupStatusFilter = query(topupsCol, where('status', 'in', ['approved', 'pending']));
    const topupSnap = await getDocs(topupStatusFilter);
    for (const d of topupSnap.docs) {
      const t = { id: d.id, ...d.data() };
      if (t.userId === excludeUserId) continue;
      const tNorm = this._normalizeUtr(t.transactionId || '');
      if (tNorm === normalizedId) {
        return { source: 'topup', id: t.id, userName: t.userName, userEmail: t.userEmail, amount: t.amount, status: t.status };
      }
    }

    return null;
  },

  async getAllUtrs() {
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    // Only fetch users with a utr_number or cycle_payment_utr set
    const [snap1, snap2] = await Promise.all([
      getDocs(query(colRef, where('utr_number', '!=', null))),
      getDocs(query(colRef, where('cycle_payment_utr', '!=', null))),
    ]);
    const seen = new Set();
    const utrs = [];
    const add = (u, field, type) => {
      const val = u[field];
      if (!val) return;
      const key = u.id + '_' + type;
      if (seen.has(key)) return;
      seen.add(key);
      utrs.push({ utr: val, userId: u.id, name: u.name, payment_status: u[type === 'cycle' ? 'cycle_payment_status' : 'payment_status'], type });
    };
    for (const d of snap1.docs) { const u = { id: d.id, ...d.data() }; add(u, 'utr_number', 'payment'); }
    for (const d of snap2.docs) { const u = { id: d.id, ...d.data() }; add(u, 'cycle_payment_utr', 'cycle'); }
    return utrs;
  },

  async checkUtrExists(utr, excludeUserId = null) {
    if (!utr) return false;
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    const normalized = this._normalizeUtr(utr);

    // Indexed query on utr_number (exclude own user)
    const q1 = query(colRef, where('utr_number', '==', utr.toString().trim()));
    const snap1 = await getDocs(q1);
    for (const d of snap1.docs) {
      if (excludeUserId && d.id === excludeUserId) continue;
      return true;
    }

    // Indexed query on cycle_payment_utr (exclude own user)
    const q2 = query(colRef, where('cycle_payment_utr', '==', utr.toString().trim()));
    const snap2 = await getDocs(q2);
    for (const d of snap2.docs) {
      if (excludeUserId && d.id === excludeUserId) continue;
      return true;
    }

    // Check topup records for matching transaction ID
    const topupDup = await this.checkDuplicateUtrInTopups(utr);
    if (topupDup) return true;

    return false;
  },

  async findDuplicateScreenshot(hash, excludeUserId = null) {
    if (!hash || hash.length < 10) return null;
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    const q = query(colRef, where('screenshot_hash', '==', hash));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      const u = { id: d.id, ...d.data() };
      if (excludeUserId && u.id === excludeUserId) continue;
      return {
        id: u.id, name: u.name, email: u.email, phone: u.phone,
        utr_number: u.utr_number, payment_status: u.payment_status, created_at: u.created_at,
      };
    }
    return null;
  },

  // ========== SMART AUTO APPROVAL ==========
  async storeValidationResult(id, { ocrData, validationStatus, autoApproved, autoRejected, failureReasons, duplicateUtrFlag, validationDetails, confidenceScore, confidenceLabel }) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    const updateData = {};
    if (ocrData) updateData.ocr_data = ocrData;
    if (validationStatus) updateData.validation_status = validationStatus;
    if (autoApproved !== undefined) updateData.auto_approved = autoApproved;
    if (autoRejected !== undefined) updateData.auto_rejected = autoRejected;
    if (failureReasons) updateData.failure_reasons = failureReasons;
    if (duplicateUtrFlag !== undefined) updateData.duplicate_utr_flag = duplicateUtrFlag;
    if (validationDetails) updateData.validation_details = validationDetails;
    if (confidenceScore !== undefined) updateData.confidence_score = confidenceScore;
    if (confidenceLabel) updateData.confidence_label = confidenceLabel;
    await updateDoc(ref, updateData);
  },

  async processAutoApproval(userId, { ocrData, userInputs } = {}) {
    try {
      const user = await this.findById(userId);
      if (!user) {
        console.log('[VALIDATION] Pre-rejection: User not found for userId:', userId);
        return { autoApproved: false, autoRejected: false, failureReasons: ['User not found'] };
      }

    const isCycle = user.cycle_payment_status === 'pending';
    const displayUtr = isCycle ? user.cycle_payment_utr : user.utr_number;
    const details = [];
    const failureReasons = [];

    // Get server timestamp for strict date comparison
    const _db = getDb();
    const _uRef = doc(_db, COL_USERS, userId);
    await updateDoc(_uRef, { __ref_ts: serverTimestamp() });
    const _uSnap = await getDoc(_uRef);
    const _sd = _uSnap.data().__ref_ts.toDate();
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(_sd);

    // DEBUG: print raw OCR output before any validation
    console.log('=== RAW OCR OUTPUT ===');
    console.log((ocrData?.raw || 'NO RAW TEXT') + '');
    console.log('=== EXTRACTED VALUES ===');
    const _upiCandidates = [ocrData?.receiver_upi, ocrData?.upi_id, ocrData?.sender_upi].filter(Boolean);
    console.log('detectedReceiverUpi:', _upiCandidates.length > 0 ? _upiCandidates.join(', ') : 'NOT DETECTED');
    console.log('detectedAmount:', ocrData?.amount || 'NOT DETECTED');
    console.log('detectedStatus:', ocrData?.payment_status || 'NOT DETECTED');
    console.log('detectedDate:', ocrData?.date || 'NOT DETECTED');
    console.log('detectedUpiTransactionId:', ocrData?.utr || ocrData?.upi_transaction_id || 'NOT DETECTED');

    function fail(check, reason) {
      details.push({ check, passed: false, reason });
      failureReasons.push(reason);
    }

    function pass(check) {
      details.push({ check, passed: true });
    }

    function skip(check, reason) {
      details.push({ check, passed: null, reason });
    }

    // ===== NORMALIZE OCR DATA (anti-false-rejection) =====
    if (ocrData) {
      Object.keys(ocrData).forEach(k => {
        if (typeof ocrData[k] === 'string') {
          ocrData[k] = ocrData[k].replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').trim();
        }
      });
    }

    // ===== CRITICAL CHECKS (UTR, UPI) =====

    console.log('[VALIDATION] User entered UTR:', displayUtr);
    console.log('[VALIDATION] OCR raw amount:', ocrData?.amount);
    console.log('[VALIDATION] OCR raw date:', ocrData?.date);
    console.log('[VALIDATION] OCR raw UPI:', ocrData?.upi_id);
    console.log('[VALIDATION] OCR raw UTR:', ocrData?.utr || ocrData?.transaction_id);

    // 1. Unique UTR — check both user records and topup records
    let dupFound = null;
    if (displayUtr) {
      dupFound = await this.findDuplicateUtr(displayUtr, userId);
      if (!dupFound) {
        dupFound = await this.checkDuplicateUtrInTopups(displayUtr);
      }
      if (dupFound) {
        fail('Unique UTR', 'Duplicate UTR Detected');
      } else {
        pass('Unique UTR');
      }
    } else {
      fail('Unique UTR', 'No UTR Provided');
    }
    console.log('[VALIDATION] Duplicate UTR check:', dupFound ? 'DUPLICATE FOUND' : 'No duplicate');

    // 2. Receiver UPI — fuzzy match extracted fields, then raw text for "exists anywhere"
    const upiCandidates = [ocrData?.receiver_upi, ocrData?.upi_id, ocrData?.sender_upi].filter(Boolean);
    const expectedUpi = EXPECTED_UPI_ID.toLowerCase();
    let matchedUpi = upiCandidates.find(upi => isUpiValid(upi));
    if (!matchedUpi && ocrData?.raw) {
      // Fuzzy check: does any line in raw text match the admin UPI at ≥ 90%?
      const rawLines = ocrData.raw.split('\n');
      const rawHasUpi = rawLines.some(line => {
        const cleaned = line.trim();
        return cleaned.length > 5 && stringSimilarity(normalizeUpi(cleaned), normalizeUpi(EXPECTED_UPI_ID)) >= UPI_SIMILARITY_THRESHOLD;
      });
      console.log('[VALIDATION] Raw text UPI fuzzy search:', rawHasUpi ? 'FOUND' : 'NOT FOUND');
      if (rawHasUpi) matchedUpi = true;
    }
    console.log('[VALIDATION] Configured Admin UPI:', EXPECTED_UPI_ID);
    console.log('[VALIDATION] OCR extracted UPI candidates:', upiCandidates.length > 0 ? upiCandidates.join(', ') : 'None');
    if (matchedUpi) {
      pass('Receiver UPI');
    } else if (upiCandidates.length > 0) {
      fail('Receiver UPI', `Expected admin UPI "${EXPECTED_UPI_ID}" not found. OCR found: ${upiCandidates.join(', ')}`);
    } else {
      fail('Receiver UPI', 'Admin UPI not detected by OCR');
    }
    console.log('[VALIDATION] UPI Match:', matchedUpi ? 'MATCH' : 'NO MATCH');

    // ===== AMOUNT (strict: must exactly equal ₹120) =====
    let resolvedAmount = ocrData?.amount;
    if (resolvedAmount && ocrData?.raw) {
      const parsedResolved = parseFloat(resolvedAmount.replace(/[,]/g, ''));
      if (!isNaN(parsedResolved) && Math.abs(parsedResolved - EXPECTED_AMOUNT) >= 1) {
        const exactMatch = ocrData.raw.match(new RegExp(`(?:₹|Rs\\.?|INR)\\s*${EXPECTED_AMOUNT}(?:\\.00)?(?!\\d)`, 'i'));
        if (exactMatch) {
          resolvedAmount = String(EXPECTED_AMOUNT);
        }
      }
      if (!resolvedAmount || (Math.abs(parseFloat(resolvedAmount.replace(/[,]/g, '')) - EXPECTED_AMOUNT) >= 1)) {
        const plainFallback = ocrData.raw.match(new RegExp(`\\b${EXPECTED_AMOUNT}(?:\\.00)?\\b`));
        if (plainFallback) {
          resolvedAmount = String(EXPECTED_AMOUNT);
        }
      }
    }
    if (!resolvedAmount && ocrData?.raw) {
      const exactPattern = new RegExp(`(?:₹|Rs\\.?|INR)\\s*${EXPECTED_AMOUNT}(?:\\.00)?(?!\\d)`, 'i');
      if (exactPattern.test(ocrData.raw)) {
        resolvedAmount = String(EXPECTED_AMOUNT);
      }
    }
    // Fallback: plain number without currency symbol
    if (!resolvedAmount && ocrData?.raw) {
      const plainPattern = new RegExp(`\\b${EXPECTED_AMOUNT}(?:\\.00)?\\b`);
      if (plainPattern.test(ocrData.raw)) {
        resolvedAmount = String(EXPECTED_AMOUNT);
      }
    }
    console.log('[VALIDATION] OCR extracted Amount:', resolvedAmount ? `₹${resolvedAmount}` : 'Not detected');
    if (resolvedAmount) {
      const parsedAmount = parseFloat(resolvedAmount.replace(/[,]/g, ''));
      if (!isNaN(parsedAmount) && parsedAmount === EXPECTED_AMOUNT) {
        pass('Payment Amount (₹120)');
      } else {
        fail('Payment Amount (₹120)', `OCR read ₹${resolvedAmount}, expected ₹${EXPECTED_AMOUNT}`);
      }
    } else {
      fail('Payment Amount (₹120)', 'Amount not detected in OCR text');
    }
    const amtDetail = details.find(d => d.check.includes('Payment Amount'));
    console.log('[VALIDATION] Amount Match:', amtDetail && amtDetail.passed === true ? 'MATCH' : 'NO MATCH');

    // 4. Payment Status — with fallback when Tesseract can't read the word Completed
    const _statusRaw = ocrData?.payment_status;
    let _statusPassed = false;
    let _statusReason = '';
    if (_statusRaw) {
      const _s = _statusRaw.toLowerCase();
      if (_s.includes('failed')) {
        _statusPassed = false;
        _statusReason = 'Payment Failed';
      } else if (_s.startsWith('completed') || _s.startsWith('success') || _s === 'paid') {
        _statusPassed = true;
      } else {
        _statusPassed = false;
        _statusReason = `Unclear status: ${_statusRaw}`;
      }
    } else {
      _statusPassed = false;
      _statusReason = 'Not detected by OCR';
    }
    // Fallback: if status not confidently detected, check for checkmark or essential payment fields
    if (!_statusPassed && ocrData?.raw) {
      const _hasCheckmark = /[✓✔☑✅]/.test(ocrData.raw);
      const _hasAmount = /(?:₹|Rs\.?|INR)\s*\d+/i.test(ocrData.raw);
      const _hasTxnId = /\b[A-Za-z0-9]{6,}\b/.test(ocrData.raw) && /\d{6,}/.test(ocrData.raw);
      const _hasDate = /\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}\b/i.test(ocrData.raw)
        || /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/.test(ocrData.raw);
      console.log('[VALIDATION] Status fallback check — hasCheckmark:', _hasCheckmark, 'hasAmount:', _hasAmount, 'hasTxnId:', _hasTxnId, 'hasDate:', _hasDate);
      if (_hasCheckmark || (_hasAmount && _hasTxnId && _hasDate)) {
        _statusPassed = true;
        console.log('[VALIDATION] Status fallback triggered —', _hasCheckmark ? 'checkmark found' : 'all essential fields present');
      }
    }
    if (_statusPassed) {
      pass('Payment Status (Completed)');
    } else {
      fail('Payment Status', _statusReason || 'Not detected by OCR');
    }

    // 5. Transaction Date — strict server date comparison
    console.log('[VALIDATION] OCR extracted Date:', ocrData?.date || 'Not detected');
    if (ocrData?.date) {
      let ocrStr = '';
      // OCR extracts date as DD/MM/YYYY — parse manually to avoid JS treating it as MM/DD/YYYY
      const dmy = ocrData.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (dmy) {
        ocrStr = `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
      } else {
        const clean = ocrData.date.replace(/-/g, '/');
        const parsed = new Date(clean);
        if (!isNaN(parsed.getTime())) {
          ocrStr = `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`;
        } else {
          const monthFix = { 'mar': 'may', 'jur': 'jun', 'jul': 'jun', 'aug': 'apr' };
          let fixed = clean;
          for (const [bad, good] of Object.entries(monthFix)) {
            fixed = fixed.replace(new RegExp('\\b' + bad + '\\b', 'gi'), good.charAt(0).toUpperCase() + good.slice(1));
          }
          const parsed2 = new Date(fixed);
          if (!isNaN(parsed2.getTime())) {
            ocrStr = `${parsed2.getFullYear()}-${String(parsed2.getMonth()+1).padStart(2,'0')}-${String(parsed2.getDate()).padStart(2,'0')}`;
          }
        }
      }
      if (!ocrStr) {
        // Fallback: user-entered date
        if (userInputs?.date && userInputs.date.replace(/-/g, '') === todayStr.replace(/-/g, '')) {
          pass('Transaction Date (Today)');
        } else {
          fail('Transaction Date', 'Date unreadable from OCR');
        }
      } else if (ocrStr === todayStr) {
        pass('Transaction Date (Today)');
      } else {
        // Fallback: user-entered date
        if (userInputs?.date && userInputs.date.replace(/-/g, '') === todayStr.replace(/-/g, '')) {
          pass('Transaction Date (Today)');
        } else {
          fail('Transaction Date', `Transaction date ${ocrStr} does not match today ${todayStr}`);
        }
      }
    } else {
      fail('Transaction Date', 'Not detected by OCR');
    }
    const dateDetail = details.find(d => d.check.includes('Transaction Date'));
    console.log('[VALIDATION] Date Match:', dateDetail && dateDetail.passed === true ? 'MATCH' : 'NO MATCH');

    // ===== UTR Validation: screenshot UTR must exactly match user-entered UTR =====
    const ocrUtr = ocrData?.utr || ocrData?.transaction_id;
    const userEnteredUtr = userInputs?.utr || displayUtr;
    console.log('[VALIDATION] Configured Admin UPI:', EXPECTED_UPI_ID);
    console.log('[VALIDATION] User entered UTR:', userEnteredUtr);
    console.log('[VALIDATION] OCR UTR (selected for validation):', ocrUtr || 'Not detected');
    if (ocrUtr && userEnteredUtr) {
      const normOcrUtr = ocrUtr.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const normUserUtr = userEnteredUtr.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      console.log('[VALIDATION] Normalized OCR UTR:', normOcrUtr);
      console.log('[VALIDATION] Normalized User UTR:', normUserUtr);
      if (normOcrUtr === normUserUtr) {
        pass('UTR Validation');
      } else {
        fail('UTR Validation', `Screenshot UTR "${ocrUtr}" does not match entered UTR "${userEnteredUtr}"`);
      }
    } else if (!ocrUtr) {
      fail('UTR Validation', 'UTR not detected in screenshot OCR');
    } else {
      fail('UTR Validation', 'No user-entered UTR for comparison');
    }
    const utrDetail = details.find(d => d.check.includes('UTR Validation'));
    console.log('[VALIDATION] UTR Match:', utrDetail && utrDetail.passed === true ? 'MATCH' : 'NO MATCH');

    // Only core checks drive the decision
    const coreCheckNames = ['Receiver UPI', 'Payment Amount', 'Payment Status', 'Unique UTR', 'Transaction Date', 'UTR Validation'];
    const coreDetails = details.filter(d => coreCheckNames.some(c => d.check.includes(c)));
    // DEBUG: print validation booleans
    {
      const _upi = coreDetails.find(d => d.check.includes('Receiver UPI'));
      const _amt = coreDetails.find(d => d.check.includes('Payment Amount'));
      const _st = coreDetails.find(d => d.check.includes('Payment Status'));
      const _d = coreDetails.find(d => d.check.includes('Transaction Date'));
      const _utr = coreDetails.find(d => d.check.includes('UTR Validation'));
      const _dup = coreDetails.find(d => d.check.includes('Unique UTR'));
      console.log('=== VALIDATION BOOLEANS ===');
      console.log('receiverUpiPass:', _upi ? _upi.passed : false);
      console.log('amountPass:', _amt ? _amt.passed : false);
      console.log('statusPass:', _st ? _st.passed : false);
      console.log('datePass:', _d ? _d.passed : false);
      console.log('utrPass:', _utr ? _utr.passed : false);
      console.log('duplicatePass:', _dup ? _dup.passed : false);
      const firstFailCore = coreDetails.find(d => d.passed === false);
      if (firstFailCore) {
        console.log('=== REJECTION SOURCE ===');
        console.log('Failed check:', firstFailCore.check);
        console.log('Reason:', firstFailCore.reason);
        const _ocrFailed = !ocrData?.raw || !ocrData?.amount && firstFailCore.check.includes('Amount');
        if (_ocrFailed) {
          console.log('OCR FAILURE DETECTED');
        } else {
          console.log('VALIDATION CHECK FAILED (non-OCR)');
        }
      }
    }
    for (const d of coreDetails) {
      if (d.passed === false && d.reason && !failureReasons.includes(d.reason)) {
        failureReasons.push(d.reason);
      }
    }

    const allPassed = coreDetails.length > 0 && coreDetails.every(d => d.passed === true);
    const hasAnyFail = coreDetails.some(d => d.passed === false);

    const autoApproved = allPassed;
    const autoRejected = hasAnyFail || !allPassed;
    const autoPending = false;

    const validationStatus = autoApproved ? 'approved' : 'rejected';

    function _auditCheck(namePart) {
      const found = details.find(d => d.check.includes(namePart));
      return { passed: found ? found.passed === true : false, reason: found && found.reason ? found.reason : 'Check not found' };
    }
    // Resolved validation: final values after all fallbacks
    const resolvedValidation = {
      adminUpi: { expected: EXPECTED_UPI_ID, actual: upiCandidates.length > 0 ? upiCandidates.join(', ') : 'NOT DETECTED', ..._auditCheck('Receiver UPI') },
      amount: { expected: String(EXPECTED_AMOUNT), actual: resolvedAmount ? String(resolvedAmount) : 'NOT DETECTED', ..._auditCheck('Payment Amount') },
      status: { expected: 'Completed', actual: ocrData?.payment_status || 'NOT DETECTED', ..._auditCheck('Payment Status') },
      date: { expected: todayStr, actual: ocrData?.date || 'NOT DETECTED', ..._auditCheck('Transaction Date') },
      upiTransactionId: { expected: userEnteredUtr || 'NOT DETECTED', actual: ocrUtr || 'NOT DETECTED', ..._auditCheck('UTR Validation') },
      duplicateUtr: { expected: 'Unique', actual: dupFound ? 'Duplicate' : 'Unique', ..._auditCheck('Unique UTR') },
    };
    // Pre-rejection audit: print all 6 checks before rejecting
    if (!autoApproved) {
      let firstFailReason = 'Validation failed';
      for (const name of coreCheckNames) {
        const d = details.find(dd => dd.check.includes(name));
        if (d && d.passed === false && d.reason) { firstFailReason = d.reason; break; }
      }
      console.log('=== PRE-REJECTION AUDIT ===');
      console.log('Admin UPI\nExpected: ' + resolvedValidation.adminUpi.expected + '\nActual: ' + resolvedValidation.adminUpi.actual + '\nPassed: ' + resolvedValidation.adminUpi.passed);
      console.log('Amount\nExpected: ' + resolvedValidation.amount.expected + '\nActual: ' + resolvedValidation.amount.actual + '\nPassed: ' + resolvedValidation.amount.passed);
      console.log('Status\nExpected: ' + resolvedValidation.status.expected + '\nActual: ' + resolvedValidation.status.actual + '\nPassed: ' + resolvedValidation.status.passed);
      console.log('Date\nExpected: ' + resolvedValidation.date.expected + '\nActual: ' + resolvedValidation.date.actual + '\nPassed: ' + resolvedValidation.date.passed);
      console.log('UPI Transaction ID\nExpected: ' + resolvedValidation.upiTransactionId.expected + '\nActual: ' + resolvedValidation.upiTransactionId.actual + '\nPassed: ' + resolvedValidation.upiTransactionId.passed);
      console.log('Duplicate UTR\nExpected: ' + resolvedValidation.duplicateUtr.expected + '\nActual: ' + resolvedValidation.duplicateUtr.actual + '\nPassed: ' + resolvedValidation.duplicateUtr.passed);
      console.log('FINAL REJECTION REASON: ' + firstFailReason);
    }

    // Runtime trace: actual values before final decision
    const finalDecisionInput = {
      detectedAdminUpi: upiCandidates.length > 0 ? upiCandidates.join(', ') : 'NOT DETECTED',
      detectedAmount: ocrData?.amount || 'NOT DETECTED',
      detectedStatus: ocrData?.payment_status || 'NOT DETECTED',
      detectedDate: ocrData?.date || 'NOT DETECTED',
      detectedUpiTransactionId: ocrUtr || 'NOT DETECTED',
      userEnteredUtr: userEnteredUtr || 'NOT DETECTED',
      duplicateUtr: dupFound ? 'DUPLICATE' : 'UNIQUE',
      currentSystemDate: todayStr,
    };
    console.log('=== FINAL DECISION TRACE ===');
    console.log('detectedAdminUpi: ' + finalDecisionInput.detectedAdminUpi);
    console.log('detectedAmount: ' + finalDecisionInput.detectedAmount);
    console.log('detectedStatus: ' + finalDecisionInput.detectedStatus);
    console.log('detectedDate: ' + finalDecisionInput.detectedDate);
    console.log('detectedUpiTransactionId: ' + finalDecisionInput.detectedUpiTransactionId);
    console.log('userEnteredUtr: ' + finalDecisionInput.userEnteredUtr);
    console.log('duplicateUtr: ' + finalDecisionInput.duplicateUtr);
    console.log('currentSystemDate: ' + finalDecisionInput.currentSystemDate);
    const allTrue = coreDetails.length > 0 && coreDetails.every(d => d.passed === true);
    if (allTrue && !autoApproved) {
      console.log('=== LOGIC CONFLICT DETECTED ===');
      console.log('All 6 validations pass but system returned REJECT.');
    } else if (!allTrue && autoApproved) {
      console.log('=== LOGIC CONFLICT DETECTED ===');
      console.log('Some validations fail but system returned APPROVE.');
    }
    console.log('=== FINAL DECISION ===');
    console.log(autoApproved ? 'APPROVE' : 'REJECT');
    console.log('=== REASON ===');
    if (!autoApproved) {
      let reason = 'Validation failed';
      for (const name of coreCheckNames) {
        const d = details.find(dd => dd.check.includes(name));
        if (d && d.passed === false && d.reason) { reason = d.reason; break; }
      }
      console.log(reason);
    } else {
      console.log('All checks passed');
    }

    console.log('[VALIDATION] Final decision:', autoApproved ? 'APPROVED' : 'REJECTED');
    console.log('[VALIDATION] Rejection reasons:', failureReasons.length > 0 ? failureReasons : 'None (approved)');

    const validationAudit = {
      upi: {
        label: 'Admin UPI Validation',
        ..._auditCheck('Receiver UPI'),
        expected: EXPECTED_UPI_ID,
        actual: upiCandidates.length > 0 ? upiCandidates.join(', ') : 'Not detected',
      },
      utr: {
        label: 'UTR Validation',
        ..._auditCheck('UTR Validation'),
        expected: userEnteredUtr || 'N/A',
        actual: ocrUtr || 'Not detected',
      },
      duplicateUtr: {
        label: 'Duplicate UTR Validation',
        ..._auditCheck('Unique UTR'),
        expected: 'No duplicate',
        actual: dupFound ? 'Duplicate UTR detected' : 'No duplicate found',
      },
      amount: {
        label: 'Amount Validation',
        ..._auditCheck('Payment Amount'),
        expected: `₹${EXPECTED_AMOUNT}`,
        actual: resolvedAmount ? `₹${resolvedAmount}` : 'Not detected',
      },
      status: {
        label: 'Payment Status Validation',
        ..._auditCheck('Payment Status'),
        expected: 'Completed',
        actual: ocrData?.payment_status || 'Not detected',
      },
      date: {
        label: 'Date Validation',
        ..._auditCheck('Transaction Date'),
        expected: todayStr,
        actual: ocrData?.date || 'Not detected',
      },
    };

    const result = {
      autoApproved,
      autoRejected,
      autoPending: false,
      details,
      failureReasons,
      duplicateUtrFlag: !!dupFound,
      validationStatus,
      ocrData: ocrData || null,
      validationAudit,
    };

    await this.storeValidationResult(userId, {
      ocrData: ocrData || null,
      validationStatus,
      autoApproved,
      autoRejected,
      failureReasons,
      duplicateUtrFlag: !!dupFound,
      validationDetails: details,
    });

    if (autoApproved && (user.payment_status === 'pending' || user.payment_status === 'rejected' || isCycle)) {
      await this.updatePaymentStatus(userId, 'approved');
      const now = new Date().toISOString();
      if (isCycle) {
        const db = getDb();
        await updateDoc(doc(db, COL_USERS, userId), { cycle_payment_status: 'approved', admin_approval_status: 'APPROVED', is_active: true, approved_at: now, approved_by: 'Auto-Approval', auto_approved: true });
      } else {
        const db = getDb();
        await updateDoc(doc(db, COL_USERS, userId), { admin_approval_status: 'APPROVED', is_active: true, approved_at: now, approved_by: 'Auto-Approval', auto_approved: true });
      }
      console.log(`[AUTO APPROVAL] User ${userId} auto-approved, is_active=true`);
      // [DEBUG] read back and log all approval fields
      const db2 = getDb();
      const postSnap2 = await getDoc(doc(db2, COL_USERS, userId));
      if (postSnap2.exists()) {
        const post = postSnap2.data();
        console.log('[AUTO APPROVAL DEBUG] processAutoApproval fields:', JSON.stringify({
          userId,
          payment_status: post.payment_status,
          account_status: post.account_status,
          status: post.status,
          admin_approval_status: post.admin_approval_status,
          is_active: post.is_active,
          auto_approved: post.auto_approved,
          approved_at: post.approved_at,
        }));
      }
      result.wasAutoApproved = true;
    }

    if (autoRejected && (user.payment_status === 'pending' || isCycle)) {
      const db = getDb();
      if (isCycle) {
        await updateDoc(doc(db, COL_USERS, userId), { cycle_payment_status: 'rejected', admin_approval_status: 'REJECTED' });
      } else {
        await this.updatePaymentStatus(userId, 'rejected');
        await updateDoc(doc(db, COL_USERS, userId), { admin_approval_status: 'REJECTED' });
      }
      console.log(`[AUTO APPROVAL] User ${userId} auto-rejected`);
      result.wasAutoRejected = true;
    }

    return result;
    } catch (err) {
      const _msg = 'Auto-approval error: ' + (err.message || err);
      console.error('[AUTO APPROVAL ERROR]', err);
      console.log('=== PRE-REJECTION AUDIT ===');
      console.log('FINAL REJECTION REASON:', _msg);
      return { autoApproved: false, autoRejected: false, wasAutoRejected: false, autoPending: true, failureReasons: [_msg] };
    }
  },

  async updateAdminApproval(userId, status, adminName = '') {
    const db = getDb();
    const ref = doc(db, COL_USERS, userId);
    const updates = { admin_approval_status: status };
    if (status === 'APPROVED') {
      const now = new Date().toISOString();
      updates.account_status = 'active';
      updates.approved_at = now;
      updates.approved_by = adminName || 'Unknown Admin';
      updates.is_active = true;
      updates.approvedDate = now;
      const snap = await getDoc(ref);
      const user = snap.data();
      if (user && !user.joinedDate) {
        updates.joinedDate = now;
      }
      console.log(`[ADMIN APPROVAL] User ${userId} APPROVED by ${adminName}`);
    } else if (status === 'REJECTED') {
      console.log(`[ADMIN APPROVAL] User ${userId} REJECTED`);
    }
    await updateDoc(ref, updates);
  },

  async forceApprovePayment(userId, adminName, reason = '') {
    const user = await this.findById(userId);
    if (!user) throw new Error('User not found');

    const isCycle = user.cycle_payment_status === 'pending';

    if (isCycle) {
      await this.reactivate(userId);
    } else {
      await this.updatePaymentStatus(userId, 'approved');
    }

    const db = getDb();
    const ref = doc(db, COL_USERS, userId);
    await updateDoc(ref, {
      manual_override: true,
      override_reason: reason || 'Admin forced approval',
      override_by: adminName || 'Unknown Admin',
      override_at: new Date().toISOString(),
    });

    return { success: true, userId, overridden: true };
  },

  async processTopupAutoApproval(topupId, topupData, { ocrData } = {}) {
    try {
    if (!topupData) {
      console.log('[TOPUP] Topup not found for topupId:', topupId);
      return { autoApproved: false, autoRejected: false, failureReasons: ['Topup not found'] };
    }

    const details = [];
    const failureReasons = [];

    // Server timestamp
    const _db2 = getDb();
    const _tRef = doc(_db2, COL_TOPUPS, topupId);
    await updateDoc(_tRef, { __ref_ts: serverTimestamp() });
    const _tSnap = await getDoc(_tRef);
    const _sd2 = _tSnap.data().__ref_ts.toDate();
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(_sd2);

    const userTxId = (topupData.transactionId || '').toString().trim();
    const userId = topupData.userId;

    // Clean OCR data
    if (ocrData) {
      const keys = Object.keys(ocrData);
      for (const k of keys) {
        if (typeof ocrData[k] === 'string') {
          ocrData[k] = ocrData[k].replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').trim();
        }
      }
    }

    function pass(check) { details.push({ check, passed: true }); }
    function fail(check, reason) { details.push({ check, passed: false, reason }); failureReasons.push(reason); }
    function unavailable(check, reason) { details.push({ check, passed: null, reason }); }

    function _normalizeUtrDigits(val) {
      if (!val) return '';
      let s = this._normalizeUtr(val);
      const prefixes = ['TXN', 'UTR', 'REF', 'ID', 'NO', 'NUM', 'TRN', 'RRN', 'NEFT', 'UPI', 'PAY', 'BANK', 'SBIN', 'SBIBANK'];
      for (const p of prefixes) {
        if (s.startsWith(p)) { s = s.slice(p.length); break; }
      }
      return s.replace(/[^0-9]/g, '');
    }

    const ocrUtr = ocrData?.utr || ocrData?.transaction_id;

    // ===== LAYER 1: UTR Validation (priority 60%) =====
    let utrResult = 'unavailable';
    if (!userTxId) {
      fail('UTR Validation', 'No transaction ID entered');
      utrResult = 'fail';
    } else {
      // Absolute: reject duplicate
      const dupFound = await this.findDuplicateTransactionId(userTxId, userId);
      if (dupFound) {
        fail('UTR Validation', 'Duplicate transaction ID — already used');
        utrResult = 'fail';
      } else if (ocrUtr) {
        const normOcr = _normalizeUtrDigits.call(this, ocrUtr.toString());
        const normUser = _normalizeUtrDigits.call(this, userTxId);
        console.log('[TOPUP L1] UTR — norm OCR:', normOcr, '| norm user:', normUser);
        if (normOcr === normUser) {
          pass('UTR Validation');
          utrResult = 'pass';
        } else {
          fail('UTR Validation', `Screenshot "${ocrUtr}" ≠ entered "${userTxId}"`);
          utrResult = 'fail';
        }
      } else {
        unavailable('UTR Validation', 'UTR not found in screenshot OCR. User entered: ' + userTxId);
        utrResult = 'unavailable';
      }
    }

    // ===== LAYER 2: Current Date Validation (priority 25%) =====
    let dateResult = 'unavailable';
    if (!ocrData?.date) {
      unavailable('Current Date', 'Date not detected by OCR');
      dateResult = 'unavailable';
    } else {
      let ocrStr = '';
      const dmy = ocrData.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (dmy) {
        ocrStr = `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
      } else {
        const clean = ocrData.date.replace(/-/g, '/');
        const parsed = new Date(clean);
        if (!isNaN(parsed.getTime())) {
          ocrStr = `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`;
        }
      }
      if (!ocrStr) {
        unavailable('Current Date', 'Date unreadable from OCR');
        dateResult = 'unavailable';
      } else if (ocrStr === todayStr) {
        pass('Current Date');
        dateResult = 'pass';
      } else {
        fail('Current Date', `Date ${ocrStr} ≠ today ${todayStr}`);
        dateResult = 'fail';
      }
    }

    // ===== LAYER 3: Admin UPI Validation (priority 15%) =====
    let upiResult = 'unavailable';
    if (!ocrData?.raw) {
      unavailable('Admin UPI', 'No OCR text available');
      upiResult = 'unavailable';
    } else {
      // Check structured fields first
      const receiverUpis = [ocrData?.receiver_upi, ocrData?.upi_id].filter(Boolean);
      let matchedUpi = receiverUpis.some(upi => isUpiValid(upi));
      // Fallback: fuzzy search each line of raw text
      if (!matchedUpi) {
        const rawLines = ocrData.raw.split('\n');
        matchedUpi = rawLines.some(line => {
          const cleaned = line.trim();
          return cleaned.length > 5 && stringSimilarity(normalizeUpi(cleaned), normalizeUpi(EXPECTED_UPI_ID)) >= UPI_SIMILARITY_THRESHOLD;
        });
      }
      if (matchedUpi) {
        pass('Admin UPI');
        upiResult = 'pass';
      } else {
        fail('Admin UPI', `"${EXPECTED_UPI_ID}" not found in screenshot`);
        upiResult = 'fail';
      }
    }

    // ===== DECISION ENGINE =====
    const results = [utrResult, dateResult, upiResult];
    const passes = results.filter(r => r === 'pass').length;
    const fails = results.filter(r => r === 'fail').length;
    const unavailables = results.filter(r => r === 'unavailable').length;

    let autoApproved = false;
    let autoRejected = false;
    let autoPending = false;
    let validationStatus = 'rejected';
    let decisionLabel = 'REJECT';

    if (passes === 3) {
      autoApproved = true;
      validationStatus = 'approved';
      decisionLabel = 'APPROVE';
    } else if (fails > 0) {
      autoRejected = true;
      validationStatus = 'rejected';
      decisionLabel = 'REJECT';
    } else if (unavailables === 1 && passes === 2) {
      autoPending = true;
      validationStatus = 'pending_review';
      decisionLabel = 'NEEDS REVIEW';
    } else {
      autoRejected = true;
      validationStatus = 'rejected';
      decisionLabel = 'REJECT (insufficient OCR)';
    }

    // Build first fail reason for logging
    let firstFailReason = 'Validation failed';
    for (const d of details) {
      if (d.passed === false && d.reason) { firstFailReason = d.reason; break; }
    }

    console.log('=== 3-LAYER TOPUP DECISION ===');
    console.log('UTR:', utrResult, '| Date:', dateResult, '| Admin UPI:', upiResult);
    console.log('Result:', decisionLabel);
    if (autoRejected) console.log('Reason:', firstFailReason);

    function _auditCheck(namePart) {
      const found = details.find(d => d.check.includes(namePart));
      return { passed: found ? found.passed === true : false, reason: found && found.reason ? found.reason : 'Check not found' };
    }

    const validationAudit = {
      utr: {
        label: 'UTR Validation',
        ..._auditCheck('UTR Validation'),
        userEntered: userTxId || 'N/A',
        ocrDetected: ocrUtr || 'Not detected',
      },
      date: {
        label: 'Current Date Validation',
        ..._auditCheck('Current Date'),
        expected: todayStr,
        actual: ocrData?.date || 'Not detected',
      },
      upi: {
        label: 'Admin UPI Validation',
        ..._auditCheck('Admin UPI'),
        expected: EXPECTED_UPI_ID,
        actual: ocrData?.raw && ocrData.raw.length > 0 ? 'Searched in screenshot' : 'No screenshot text',
      },
    };

    const result = {
      autoApproved,
      autoRejected,
      autoPending,
      details,
      failureReasons,
      validationStatus,
      validationAudit,
      needsReview: autoPending,
    };

    const db = getDb();
    const topupRef = doc(db, COL_TOPUPS, topupId);
    await updateDoc(topupRef, {
      auto_approved: autoApproved || null,
      auto_rejected: autoRejected || null,
      validation_status: validationStatus,
      failure_reasons: failureReasons,
      validation_details: details,
      ocr_data: ocrData || null,
    });

    if (autoApproved && topupData.status === 'pending') {
      await FirebaseTopup.updateStatus(topupId, 'approved', 'auto');
      result.wasAutoApproved = true;
    }

    if (autoRejected && topupData.status === 'pending') {
      await FirebaseTopup.updateStatus(topupId, 'rejected', 'auto');
      result.wasAutoRejected = true;
    }

    return result;
    } catch (err) {
      const _msg = 'Topup auto-approval error: ' + (err.message || err);
      console.error('[TOPUP ERROR]', err);
      return { autoApproved: false, autoRejected: false, autoPending: true, failureReasons: [_msg] };
    }
  },

  async activateUser(userId, adminName, reason = '') {
    const user = await this.findById(userId);
    if (!user) throw new Error('User not found');
    if (user.account_status === 'active') throw new Error('User is already active');

    const db = getDb();
    const ref = doc(db, COL_USERS, userId);
    const now = new Date().toISOString();

    const historyEntry = {
      from: user.account_status || 'inactive',
      to: 'active',
      changed_by: adminName || 'Unknown Admin',
      changed_at: now,
      reason: reason || 'Manual activation by admin',
    };

    const existingHistory = user.status_change_history || [];

    const updates = {
      account_status: 'active',
      activated_by: adminName || 'Unknown Admin',
      activated_at: now,
      activation_reason: reason || 'Manual activation by admin',
      status_change_history: [...existingHistory, historyEntry],
    };

    if (!user.joinedDate) updates.joinedDate = now;
    if (!user.approvedDate) updates.approvedDate = now;

    await updateDoc(ref, updates);

    return {
      success: true,
      userId,
      activated: true,
      historyEntry,
    };
  },

  async rejectUser(userId, adminName, reason = '') {
    const user = await this.findById(userId);
    if (!user) throw new Error('User not found');

    const db = getDb();
    const ref = doc(db, COL_USERS, userId);

    const historyEntry = {
      from: user.account_status || 'inactive',
      to: 'blocked',
      changed_by: adminName || 'Unknown Admin',
      changed_at: new Date().toISOString(),
      reason: reason || 'Rejected by admin',
    };

    const existingHistory = user.status_change_history || [];

    await updateDoc(ref, {
      account_status: 'blocked',
      admin_status: 'suspicious',
      rejected_by: adminName || 'Unknown Admin',
      rejected_at: new Date().toISOString(),
      rejection_reason: reason || 'Rejected by admin',
      status_change_history: [...existingHistory, historyEntry],
    });

    return { success: true, userId, rejected: true };
  },

  async updateTheme(id, themeColor) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    await updateDoc(ref, { theme_color: themeColor });
  },

  async updateProfilePicture(id, base64DataUrl) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    await updateDoc(ref, { profile_picture_url: base64DataUrl });
  },

  async removeProfilePicture(id) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    await updateDoc(ref, { profile_picture_url: null });
  },

  async updateLastActive(userId) {
    if (!userId) return;
    const db = getDb();
    const ref = doc(db, COL_USERS, userId);
    await updateDoc(ref, { lastActiveAt: new Date().toISOString() });
  },

  async createPaymentSession(userIdOrOpts, type, amount) {
    if (AppwritePayment.isConfigured()) {
      try { return await AppwritePayment.createPaymentSession(userIdOrOpts, type, amount); }
      catch (e) { console.warn('Appwrite createPaymentSession failed, using Firebase:', e.message || e); }
    }
    const db = getPaymentsDb();
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let sessionId = 'PAY-';
    for (let i = 0; i < 8; i++) sessionId += chars.charAt(Math.floor(Math.random() * chars.length));
    const now = new Date();

    let sessionData;
    if (typeof userIdOrOpts === 'object') {
      const { name, email, phone, amount: amt } = userIdOrOpts;
      if (!email) throw new Error('Email is required for registration payment');
      sessionData = {
        sessionId,
        email: email.toLowerCase().trim(),
        name: name || '',
        phone: phone || '',
        amount: amt || 120,
        type: 'registration',
        payment_status: 'created',
        createdAt: serverTimestamp(),
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      };
    } else {
      const userId = userIdOrOpts;
      if (!userId || !type) throw new Error('Missing userId or type');
      sessionData = {
        sessionId,
        userId,
        type,
        amount: amount || 120,
        payment_status: 'created',
        createdAt: serverTimestamp(),
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      };
    }
    await setDoc(doc(db, 'payment_sessions', sessionId), sessionData);
    return sessionData;
  },

  async getVerificationCode(sessionId) {
    if (AppwritePayment.isConfigured()) {
      try { return await AppwritePayment.getVerificationCode(sessionId); }
      catch (e) { console.warn('Appwrite getVerificationCode failed, using Firebase:', e.message || e); }
    }
    if (!sessionId) return null;
    const db = getPaymentsDb();
    const codesSnap = await getDocs(query(
      collection(db, 'verification_codes'),
      where('sessionId', '==', sessionId),
      limit(1),
    ));
    if (codesSnap.empty) return null;
    return { id: codesSnap.docs[0].id, ...codesSnap.docs[0].data() };
  },

  async generateVerificationCode(sessionId, razorpayOrderId, razorpayPaymentId) {
    if (AppwritePayment.isConfigured()) {
      try { return await AppwritePayment.generateVerificationCode(sessionId, razorpayOrderId, razorpayPaymentId); }
      catch (e) { console.warn('Appwrite generateVerificationCode failed, using Firebase:', e.message || e); }
    }
    if (!sessionId) throw new Error('Missing sessionId');
    const db = getPaymentsDb();
    const sessionRef = doc(db, 'payment_sessions', sessionId);
    const sessionSnap = await getDoc(sessionRef);
    if (!sessionSnap.exists()) throw new Error('Session not found');
    const sessionData = sessionSnap.data();
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let verificationCode = 'JTSB-';
    for (let i = 0; i < 6; i++) verificationCode += chars.charAt(Math.floor(Math.random() * chars.length));
    const now = new Date();
    const codeData = {
      code: verificationCode,
      sessionId,
      userId: sessionData.userId || null,
      type: sessionData.type || 'registration',
      amount: sessionData.amount || 120,
      paymentId: razorpayPaymentId || null,
      orderId: razorpayOrderId || null,
      payment_status: 'active',
      approved: false,
      createdAt: serverTimestamp(),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      used: false,
    };
    await setDoc(doc(db, 'verification_codes', verificationCode), codeData);
    await updateDoc(sessionRef, {
      payment_status: 'completed',
      razorpayPaymentId: razorpayPaymentId || null,
      razorpayOrderId: razorpayOrderId || null,
      verificationCode,
      completedAt: serverTimestamp(),
    });
    return { code: verificationCode };
  },

  async verifyPaymentCode(sessionId, code, userData = {}) {
    if (AppwritePayment.isConfigured()) {
      try {
        const result = await AppwritePayment.verifyPaymentCode(sessionId, code, userData);
        const sesh = result.session || {};
        if (userData.isTopup) {
          const topup = await FirebaseTopup.create(sesh.userId, {
            amount: Number(sesh.amount || userData.amount || 0),
            transactionId: code.toUpperCase().trim(),
            verifiedViaCode: true,
            sessionId,
          });
          await FirebaseTopup.updateStatus(topup.id, 'approved', 'auto');
          return { success: true, topup, message: 'Topup approved automatically' };
        }
        const normalizedEmail = (userData.email || '').toLowerCase().trim();
        let existingUser = null;
        try { existingUser = await this.findByEmail(normalizedEmail); } catch {}
        if (existingUser) return { success: true, user: existingUser };
        const newUser = await this.createWithPassword({
          name: userData.name || '',
          email: normalizedEmail,
          phone: userData.phone || '',
          password: userData.password || '',
          referredBy: userData.referredBy || null,
        });
        return { success: true, user: newUser };
      } catch (e) {
        console.warn('Appwrite verifyPaymentCode failed, using Firebase:', e.message || e);
      }
    }
    if (!sessionId || !code) throw new Error('Missing sessionId or code');
    const db = getPaymentsDb();
    const normalizedCode = code.toUpperCase().trim();
    const codeRef = doc(db, 'verification_codes', normalizedCode);
    const codeSnap = await getDoc(codeRef);
    if (!codeSnap.exists()) throw new Error('Invalid verification code');
    const codeData = codeSnap.data();
    if (codeData.sessionId !== sessionId) throw new Error('Code does not match this session');
    if (codeData.payment_status !== 'active' || codeData.used) throw new Error('Code has already been used');
    const now = new Date();
    if (codeData.expiresAt && new Date(codeData.expiresAt) < now) throw new Error('Verification code has expired');
    if (codeData.amount !== (userData.amount || 120)) throw new Error('Amount mismatch');

    await updateDoc(codeRef, { payment_status: 'used', approved: true, used: true, usedAt: serverTimestamp() });
    const sessionRef = doc(db, 'payment_sessions', codeData.sessionId);
    const sessionSnap = await getDoc(sessionRef);

    if (userData.isTopup) {
      if (!sessionSnap.exists()) throw new Error('Payment session not found');
      const session = sessionSnap.data();
      const topup = await FirebaseTopup.create(session.userId, {
        amount: Number(session.amount || userData.amount || 0),
        transactionId: normalizedCode,
        verifiedViaCode: true,
        sessionId: codeData.sessionId,
      });
      await FirebaseTopup.updateStatus(topup.id, 'approved', 'auto');
      if (sessionSnap.exists()) {
        await updateDoc(sessionRef, { payment_status: 'verified', verifiedAt: serverTimestamp() });
      }
      return { success: true, topup, message: 'Topup approved automatically' };
    }

    const normalizedEmail = (userData.email || '').toLowerCase().trim();
    let existingUser = null;
    try {
      existingUser = await this.findByEmail(normalizedEmail);
    } catch {}
    if (existingUser) {
      if (sessionSnap.exists()) {
        await updateDoc(sessionRef, { payment_status: 'verified', verifiedAt: serverTimestamp(), userId: existingUser.id });
      }
      return { success: true, user: existingUser };
    }

    const newUser = await this.createWithPassword({
      name: userData.name || '',
      email: normalizedEmail,
      phone: userData.phone || '',
      password: userData.password || '',
      referredBy: userData.referredBy || null,
    });
    if (sessionSnap.exists()) {
      await updateDoc(sessionRef, { payment_status: 'verified', verifiedAt: serverTimestamp(), userId: newUser.id });
    }
    return { success: true, user: newUser };
  },

  async ping() {
    if (AppwritePayment.isConfigured()) return;
    try {
      const db = getPaymentsDb();
      await getDocs(query(collection(db, 'payment_sessions'), where('payment_status', '==', 'ping_check'), limit(1)));
    } catch {}
  },
};

export const FirebaseStorage = {
  async uploadPaymentScreenshot(userId, file) {
    console.log('🔄 Converting to Base64:', file.name);
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          let imageData = reader.result;
          try {
            imageData = await this.compressImage(reader.result);
          } catch (compressErr) {
            console.warn('Compression failed, using original:', compressErr.message);
          }
          const base64 = imageData.split(',')[1];
          const fileId = `payment_${userId}_${Date.now()}`;
          
          const db = getDb();
          const imagesRef = collection(db, 'payment_images');
          await addDoc(imagesRef, {
            fileId,
            userId,
            type: 'payment',
            base64,
            fileName: file.name,
            createdAt: serverTimestamp(),
          });
          
          console.log('✅ Base64 stored in Firestore');
          resolve({ url: imageData, path: fileId });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  },

  async deletePaymentScreenshot(url) {
    console.log('Delete not needed for Base64:', url);
  },

  compressImage(dataUrl, maxWidth = 1200, quality = 0.7) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      let settled = false;
      const done = (fn) => (v) => { if (!settled) { settled = true; fn(v); } };
      const timer = setTimeout(() => done(reject)(new Error('Image compression timed out. Unsupported format?')), 10000);
      img.onload = () => {
        clearTimeout(timer);
        try {
          const canvas = document.createElement('canvas');
          let w = img.width, h = img.height;
          if (w > maxWidth) { h = h * maxWidth / w; w = maxWidth; }
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          done(resolve)(canvas.toDataURL('image/jpeg', quality));
        } catch (e) { done(reject)(e); }
      };
      img.onerror = () => { clearTimeout(timer); done(reject)(new Error('Failed to load image for compression')); };
      img.src = dataUrl;
    });
  },

  async uploadTopupScreenshot(userId, file) {
    console.log('Converting topup to Base64:', file.name);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          let imageData = reader.result;
          try {
            imageData = await this.compressImage(reader.result);
          } catch (compressErr) {
            console.warn('Compression failed, using original:', compressErr.message);
          }
          console.log('Topup image ready');
          resolve(imageData);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  },

  async uploadCyclePaymentScreenshot(userId, file) {
    console.log('🔄 Converting cycle payment to Base64:', file.name);
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          let imageData = reader.result;
          try {
            imageData = await this.compressImage(reader.result);
          } catch (compressErr) {
            console.warn('Compression failed, using original:', compressErr.message);
          }
          const base64 = imageData.split(',')[1];
          const fileId = `cycle_${userId}_${Date.now()}`;
          
          const db = getDb();
          const imagesRef = collection(db, 'payment_images');
          await addDoc(imagesRef, {
            fileId,
            userId,
            type: 'cycle',
            base64,
            fileName: file.name,
            createdAt: serverTimestamp(),
          });
          
          console.log('✅ Cycle payment Base64 stored in Firestore');
          resolve(imageData);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  },
};

export async function seedDefaultAdmin() {
  try {
    const db = getDb();
    const adminEmail = 'jayaraj@gmail.com';
    const adminCollection = collection(db, 'admins');
    const snap = await getDocs(query(adminCollection, where('email', '==', adminEmail)));
    
    if (snap.empty) {
      await addDoc(adminCollection, {
        email: adminEmail,
        password: 'hashed_jayaraj7523',
        createdAt: new Date().toISOString(),
      });
      console.log('✅ Default admin record created in Firestore');
    }
  } catch (e) {
    console.error('⚠️ seedDefaultAdmin:', e.message);
  }
}

export async function checkReferralLinkExpiry(referralCode) {
  if (!referralCode) return { valid: false, reason: 'no_code' };
  const referrer = await FirebaseUser.findByReferralCode(referralCode);
  if (!referrer) return { valid: false, reason: 'not_found' };
  if (referrer.referral_expires_at && new Date(referrer.referral_expires_at) < new Date()) {
    return { valid: false, reason: 'expired', referrer };
  }
  if ((referrer.referrals_count || 0) >= MAX_REFERRALS) {
    return { valid: false, reason: 'limit_reached', referrer };
  }
  return { valid: true, reason: 'valid', referrer };
}

// ========== TOPUP SYSTEM ==========
export const FirebaseTopup = {
  async create(userId, { amount, transactionId, screenshotData, sessionId, verifiedViaCode }) {
    const db = getDb();
    const user = await FirebaseUser.findById(userId);
    if (!user) throw new Error('User not found');

    // Inactive sponsor check
    if (user.referred_by) {
      const referrer = await FirebaseUser.findByReferralCode(user.referred_by);
      if (referrer) {
        const isReferrerActive = referrer.account_status === 'active' && referrer.payment_status === 'approved';
        if (!isReferrerActive) {
          throw new Error('Your sponsor account is inactive. Please contact support to proceed with topup.');
        }
      }
    }

    const topupDoc = {
      userId,
      userName: user.name || '',
      userEmail: user.email || '',
      userPhone: user.phone || '',
      userReferralCode: user.referral_code || '',
      referred_by: user.referred_by || null,
      amount: Number(amount) || 0,
      transactionId: transactionId || '',
      screenshotData: screenshotData || null,
      sessionId: sessionId || null,
      verifiedViaCode: verifiedViaCode || false,
      status: 'pending',
      adminId: null,
      approvedAt: null,
      rejectedAt: null,
      sponsorBenefitAdded: false,
      createdAt: new Date().toISOString(),
    };

    const ref = await addDoc(collection(db, COL_TOPUPS), topupDoc);
    return { id: ref.id, ...topupDoc };
  },

  async findByUserId(userId) {
    const db = getDb();
    const colRef = collection(db, COL_TOPUPS);
    const q = query(colRef, where('userId', '==', userId));
    const snap = await getDocs(q);
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return list;
  },

  async findAll() {
    const db = getDb();
    const colRef = collection(db, COL_TOPUPS);
    const snap = await getDocs(query(colRef));
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return list;
  },

  async findById(id) {
    const db = getDb();
    const ref = doc(db, COL_TOPUPS, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  },

  async updateStatus(id, status, adminId) {
    const db = getDb();
    const ref = doc(db, COL_TOPUPS, id);
    const topup = await FirebaseTopup.findById(id);
    if (!topup) throw new Error('Topup not found');
    if (topup.status !== 'pending') throw new Error('Topup already ' + topup.status);

    const updateData = {
      status,
      adminId: adminId || 'admin',
    };
    if (status === 'approved') {
      updateData.approvedAt = new Date().toISOString();
    } else if (status === 'rejected') {
      updateData.rejectedAt = new Date().toISOString();
    }
    await updateDoc(ref, updateData);
    
    if (status === 'approved') {
      // Process referral benefit for the referrer (non-blocking for inactive check)
      try {
        await FirebaseTopupReferral.processTopupReferral(topup);
      } catch (e) {
        console.warn('processTopupReferral warning (non-fatal):', e);
      }

      // After processing referral benefit, check if THIS topup user is a qualified sponsor
      // If so, set account inactive and flag for manual admin credit
      const topupUserSnap = await getDoc(doc(db, COL_USERS, topup.userId));
      if (topupUserSnap.exists()) {
        const topupUserData = topupUserSnap.data();
        if (topupUserData.topup_referral_qualified && !topupUserData.sponsor_topup_completed) {
          await updateDoc(doc(db, COL_USERS, topup.userId), {
            account_status: 'inactive',
            sponsor_topup_completed: true,
            sponsor_awaiting_credit: true,
            sponsor_topup_id: topup.id,
            sponsor_topup_amount: Number(topup.amount) || 0,
            inactive_reason: 'own_topup_completed',
          });

          // Unlock all locked income records for this sponsor
          const incomeCol = collection(db, COL_TOPUP_INCOME);
          const lockedQ = query(incomeCol, where('userId', '==', topup.userId), where('status', '==', 'locked'));
          const lockedSnap = await getDocs(lockedQ);
          const updatePromises = lockedSnap.docs.map(d => updateDoc(d.ref, { status: 'eligible' }));
          await Promise.all(updatePromises);
        }
      }
    }

    return { id, ...topup, ...updateData };
  },

  async delete(id) {
    const db = getDb();
    const ref = doc(db, COL_TOPUPS, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Topup not found');
    await deleteDoc(ref);
    return { id, ...snap.data() };
  },

  async getSponsorsAwaitingCredit() {
    const db = getDb();
    const usersRef = collection(db, COL_USERS);
    const q = query(usersRef, where('sponsor_awaiting_credit', '==', true));
    const snap = await getDocs(q);
    const results = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name || '',
        email: data.email || '',
        phone: data.phone || '',
        referral_code: data.referral_code || '',
        topup_referrals_count: data.topup_referrals_count || 0,
        sponsor_topup_amount: data.sponsor_topup_amount || 0,
        sponsor_topup_id: data.sponsor_topup_id || null,
        sponsor_credited: data.sponsor_credited || false,
        sponsor_credited_amount: data.sponsor_credited_amount || 0,
        sponsor_credited_at: data.sponsor_credited_at || null,
        sponsor_credited_by: data.sponsor_credited_by || null,
      };
    });
    // Uncredited first, then credited
    results.sort((a, b) => {
      if (a.sponsor_credited !== b.sponsor_credited) return a.sponsor_credited ? 1 : -1;
      return 0;
    });
    return results;
  },

  async creditSponsor(userId, amount, adminId) {
    const db = getDb();
    const userRef = doc(db, COL_USERS, userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) throw new Error('User not found');
    const userData = userSnap.data();
    if (!userData.sponsor_awaiting_credit) throw new Error('User is not awaiting credit');
    if (userData.sponsor_credited) throw new Error('User already credited');

    await updateDoc(userRef, {
      sponsor_credited: true,
      sponsor_credited_amount: Number(amount) || 0,
      sponsor_credited_at: new Date().toISOString(),
      sponsor_credited_by: adminId || 'admin',
      sponsor_awaiting_credit: false,
      sponsor_cycle_completed: true,
    });

    // Mark all eligible income records as claimed
    const incomeCol = collection(db, COL_TOPUP_INCOME);
    const eligibleQ = query(incomeCol, where('userId', '==', userId), where('status', '==', 'eligible'));
    const eligibleSnap = await getDocs(eligibleQ);
    const updatePromises = eligibleSnap.docs.map(d =>
      updateDoc(d.ref, { status: 'claimed', claimedAt: new Date().toISOString() })
    );
    await Promise.all(updatePromises);

    return { userId, amount: Number(amount) || 0, credited: true };
  },

  async reactivateSponsor(userId) {
    const db = getDb();
    const userRef = doc(db, COL_USERS, userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) throw new Error('User not found');
    const userData = userSnap.data();

    const updateData = {
      account_status: 'active',
      sponsor_topup_completed: false,
      sponsor_awaiting_credit: false,
      sponsor_credited: false,
      sponsor_credited_amount: 0,
      sponsor_topup_id: null,
      sponsor_topup_amount: 0,
      inactive_reason: null,
      sponsor_cycle_completed: true,
    };

    // Also reset referral tracking for a fresh cycle if they had old-system inactive
    if (userData.is_qualified || userData.referral_limit_reached) {
      updateData.is_qualified = false;
      updateData.referrals_count = 0;
      updateData.referral_limit_reached = false;
      updateData.referral_active = true;
    }

    await updateDoc(userRef, updateData);
    return { userId, activated: true };
  },

  subscribeToTopups(callback) {
    const db = getDb();
    const colRef = collection(db, COL_TOPUPS);
    const q = query(colRef);
    return onSnapshot(q, (snap) => {
      try {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        callback(list);
      } catch (err) {
        console.error('subscribeToTopups error:', err);
        callback([]);
      }
    }, (error) => {
      console.error('subscribeToTopups snapshot error:', error);
      callback([]);
    });
  },

  subscribeToUserTopups(userId, callback) {
    const db = getDb();
    const colRef = collection(db, COL_TOPUPS);
    const q = query(colRef, where('userId', '==', userId));
    return onSnapshot(q, (snap) => {
      try {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        callback(list);
      } catch (err) {
        console.error('subscribeToUserTopups error:', err);
        callback([]);
      }
    }, (error) => {
      console.error('subscribeToUserTopups snapshot error:', error);
      callback([]);
    });
  },
};

export const FirebaseTopupReferral = {
  async processTopupReferral(topup) {
    if (!topup || topup.sponsorBenefitAdded) return;
    if (!topup.referred_by) return;

    const db = getDb();
    const referrer = await FirebaseUser.findByReferralCode(topup.referred_by);
    if (!referrer) return;

    // Check if referrer (sponsor) has completed their own topup
    const sponsorTopupsQuery = query(
      collection(db, COL_TOPUPS),
      where('userId', '==', referrer.id),
      where('status', '==', 'approved')
    );
    const sponsorTopupsSnap = await getDocs(sponsorTopupsQuery);
    const sponsorHasTopup = !sponsorTopupsSnap.empty;
    const incomeStatus = sponsorHasTopup ? 'eligible' : 'locked';

    // Add referral income record with claim status
    const incomeDoc = {
      userId: referrer.id,
      userName: referrer.name || '',
      userEmail: referrer.email || '',
      fromUserId: topup.userId,
      fromUserName: topup.userName || '',
      topupId: topup.id,
      amount: Number(topup.amount) || 0,
      status: incomeStatus,
      claimedAt: null,
      createdAt: new Date().toISOString(),
    };
    await addDoc(collection(db, COL_TOPUP_INCOME), incomeDoc);

    // Track topup referral count (completely separate from normal referral system)
    const currentTopupCount = referrer.topup_referrals_count || 0;
    const newTopupCount = currentTopupCount + 1;
    const combinedCount = (referrer.referrals_count || 0) + newTopupCount;
    const topupQualified = newTopupCount >= MAX_REFERRALS || combinedCount >= MAX_REFERRALS;

    const referrerUpdate = {
      topup_referrals_count: newTopupCount,
      topup_referral_qualified: topupQualified,
    };
    await updateDoc(doc(db, COL_USERS, referrer.id), referrerUpdate);

    // Also update the topup user's referred_by_status to 'approved'
    if (topup.userId) {
      const topupUserRef = doc(db, COL_USERS, topup.userId);
      const topupUserSnap = await getDoc(topupUserRef);
      if (topupUserSnap.exists()) {
        await updateDoc(topupUserRef, { referred_by_status: 'approved' });
      }
    }

    // Mark benefit as added
    const topupRef = doc(db, COL_TOPUPS, topup.id);
    await updateDoc(topupRef, { sponsorBenefitAdded: true });

    console.log('Topup referral processed for sponsor:', referrer.id, 'count:', newTopupCount, 'amount:', topup.amount, 'status:', incomeStatus);
  },

  async claimTopupIncome(incomeId) {
    const db = getDb();
    const ref = doc(db, COL_TOPUP_INCOME, incomeId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Income record not found');
    const data = snap.data();
    if (data.status !== 'eligible') throw new Error('Income is not eligible for claiming');
    await updateDoc(ref, { status: 'claimed', claimedAt: new Date().toISOString() });
    return { id: incomeId, ...data, status: 'claimed' };
  },

  async getIncomeByUserId(userId) {
    const db = getDb();
    const colRef = collection(db, COL_TOPUP_INCOME);
    const q = query(colRef, where('userId', '==', userId));
    const snap = await getDocs(q);
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return list;
  },

  async getTotalIncomeByUserId(userId) {
    const incomes = await FirebaseTopupReferral.getIncomeByUserId(userId);
    return incomes.reduce((sum, inc) => sum + (Number(inc.amount) || 0), 0);
  },

  subscribeToIncome(userId, callback) {
    const db = getDb();
    const colRef = collection(db, COL_TOPUP_INCOME);
    const q = query(colRef, where('userId', '==', userId));
    return onSnapshot(q, (snap) => {
      try {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        callback(list);
      } catch (err) {
        console.error('subscribeToIncome error:', err);
        callback([]);
      }
    }, (error) => {
      console.error('subscribeToIncome snapshot error:', error);
      callback([]);
    });
  },

  async getAllIncome() {
    const db = getDb();
    const colRef = collection(db, COL_TOPUP_INCOME);
    const snap = await getDocs(query(colRef));
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return list;
  },
};

export { generateReferralCode, MAX_REFERRALS, REFERRAL_EXPIRY_DAYS, STORAGE_FOLDER, hashPassword, hashPasswordCached, comparePassword, hashData };

export const FirebaseReferralAccess = {
  async check(userId) {
    const user = await FirebaseUser.findById(userId);
    if (!user) throw new Error('User not found');
    if (user.account_status === 'inactive') {
      throw new Error('Account inactive. Complete payment to continue referrals.');
    }
    if (user.referrals_count >= MAX_REFERRALS) {
      throw new Error(`Maximum ${MAX_REFERRALS} referrals allowed`);
    }
    return true;
  },

  async reactivate(id) {
    return FirebaseUser.reactivate(id);
  },
};

export const FirebaseNewReferral = {
  async create(referralData) {
    const db = getDb();
    const now = new Date().toISOString();

    const user = await FirebaseUser.findById(referralData.user_id);
    if (!user) {
      throw new Error('User not found');
    }

    const existingReferrals = await FirebaseUser.getReferrals(referralData.user_id);
    if (existingReferrals.length >= MAX_REFERRALS) {
      throw new Error(`Maximum ${MAX_REFERRALS} referrals allowed`);
    }

    const referralDoc = {
      user_id: referralData.user_id,
      name: referralData.name,
      email: referralData.email.toLowerCase(),
      phone: referralData.phone || '',
      created_at: now,
    };

    const ref = await addDoc(collection(db, COL_REFERRALS), referralDoc);
    
    await FirebaseUser.incrementReferralCount(referralData.user_id);
    
    return { id: ref.id, ...referralDoc };
  },

  async findByUserId(userId) {
    const db = getDb();
    const colRef = collection(db, COL_REFERRALS);
    const q = query(colRef, where('user_id', '==', userId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async findByEmail(email) {
    const db = getDb();
    const colRef = collection(db, COL_REFERRALS);
    const q = query(colRef, where('email', '==', email.toLowerCase()));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async delete(id) {
    const db = getDb();
    const ref = doc(db, COL_REFERRALS, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    
    const data = snap.data();
    await deleteDoc(ref);
    
    await FirebaseUser.decrementReferralCount(data.user_id);
    
    return { id, ...data };
  },

  async deleteByUserId(userId) {
    const db = getDb();
    const colRef = collection(db, COL_REFERRALS);
    const q = query(colRef, where('user_id', '==', userId));
    const snap = await getDocs(q);
    const deleted = [];
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
      deleted.push({ id: d.id, ...d.data() });
    }
    return deleted;
  },

  subscribeToUserReferrals(userId, callback) {
    const db = getDb();
    const colRef = collection(db, COL_REFERRALS);
    const q = query(colRef, where('user_id', '==', userId));
    return onSnapshot(q, (snap) => {
      const referrals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(referrals);
    }, (error) => {
      console.error('subscribeToUserReferrals error:', error);
      callback([]);
    });
  },
};

function getNotificationTitle(type) {
  const titles = {
    user_activated: 'Account Approved',
    user_rejected: 'Account Rejected',
    payment_approved: 'Payment Approved',
    payment_rejected: 'Payment Rejected',
    topup_approved: 'Top-Up Approved',
    topup_rejected: 'Top-Up Rejected',
    admin_approval_approved: 'Admin Access Approved',
    admin_approval_rejected: 'Admin Access Rejected',
    general: 'Notification',
  };
  return titles[type] || 'Notification';
}

export const FirebaseNotification = {
  async send({ receiverId, receiverName, title, message, type, senderId, senderName }) {
    if (!receiverId || !message || !type) {
      throw new Error('receiverId, message, and type are required');
    }
    const user = await FirebaseUser.findById(receiverId);
    if (!user) {
      throw new Error('Recipient user not found');
    }
    const db = getDb();
    const doc = {
      senderId: senderId || 'admin',
      receiverId,
      receiverName: receiverName || user.name || '',
      senderName: senderName || 'Admin',
      title: title || getNotificationTitle(type),
      message,
      type: type || 'general',
      status: 'unread',
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    const ref = await addDoc(collection(db, COL_MESSAGES), doc);
    return { id: ref.id, ...doc };
  },

  async getByUser(userId) {
    const db = getDb();
    const colRef = collection(db, COL_MESSAGES);
    const q = query(colRef, where('receiverId', '==', userId), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getAll(limitCount = 200) {
    const db = getDb();
    const colRef = collection(db, COL_MESSAGES);
    const q = query(colRef, orderBy('createdAt', 'desc'), limit(limitCount));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async markAsRead(notificationId) {
    const db = getDb();
    const ref = doc(db, COL_MESSAGES, notificationId);
    await updateDoc(ref, {
      status: 'read',
      readAt: new Date().toISOString(),
    });
  },

  async markAllAsRead(userId) {
    const db = getDb();
    const colRef = collection(db, COL_MESSAGES);
    const q = query(colRef, where('receiverId', '==', userId), where('status', '==', 'unread'));
    const snap = await getDocs(q);
    const updates = snap.docs.map(d => updateDoc(d.ref, {
      status: 'read',
      readAt: new Date().toISOString(),
    }));
    await Promise.all(updates);
  },

  async getUnreadCount(userId) {
    const db = getDb();
    const colRef = collection(db, COL_MESSAGES);
    const q = query(colRef, where('receiverId', '==', userId), where('status', '==', 'unread'));
    const snap = await getDocs(q);
    return snap.size;
  },

  subscribeToUserNotifications(userId, callback) {
    const db = getDb();
    const colRef = collection(db, COL_MESSAGES);
    const q = query(colRef, where('receiverId', '==', userId), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(items);
    }, (error) => {
      console.error('subscribeToUserNotifications error:', error);
      callback([]);
    });
  },

  subscribeToAllNotifications(callback) {
    const db = getDb();
    const colRef = collection(db, COL_MESSAGES);
    const q = query(colRef, orderBy('createdAt', 'desc'), limit(200));
    return onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(items);
    }, (error) => {
      console.error('subscribeToAllNotifications error:', error);
      callback([]);
    });
  },

  async deleteNotification(notificationId) {
    const db = getDb();
    const ref = doc(db, COL_MESSAGES, notificationId);
    await deleteDoc(ref);
  },
};

export const FirebaseMessage = FirebaseNotification;

export const FirebaseChat = {
  getConvoId(userId) {
    return `admin_${userId}`;
  },

  async ensureConvo(userId, userName, userEmail) {
    const db = getDb();
    const convoId = this.getConvoId(userId);
    const ref = doc(db, COL_CHAT_CONVOS, convoId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const now = new Date().toISOString();
      await setDoc(ref, {
        convoId,
        userId,
        userName: userName || '',
        userEmail: userEmail || '',
        createdAt: now,
        updatedAt: now,
        lastMessage: '',
        lastSenderId: '',
      });
    }
    return convoId;
  },

  async send({ senderId, receiverId, messageText }) {
    if (!senderId || !receiverId || !messageText) {
      throw new Error('senderId, receiverId, and messageText are required');
    }
    const db = getDb();
    const userId = senderId === 'admin' ? receiverId : senderId;
    const convoId = this.getConvoId(userId);
    await this.ensureConvo(userId, '', '');
    const msg = {
      convoId,
      senderId,
      receiverId,
      messageText,
      createdAt: new Date().toISOString(),
      isRead: false,
      isDelivered: true,
    };
    const ref = await addDoc(collection(db, COL_CHAT_MESSAGES), msg);
    await updateDoc(doc(db, COL_CHAT_CONVOS, convoId), {
      lastMessage: messageText,
      lastSenderId: senderId,
      updatedAt: new Date().toISOString(),
    });
    return { id: ref.id, ...msg };
  },

  async getMessages(convoId) {
    const db = getDb();
    const colRef = collection(db, COL_CHAT_MESSAGES);
    const q = query(colRef, where('convoId', '==', convoId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  },

  async getConvosForAdmin() {
    const db = getDb();
    const colRef = collection(db, COL_CHAT_CONVOS);
    const snap = await getDocs(colRef);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((b.updatedAt || '') > (a.updatedAt || '') ? 1 : -1));
  },

  async getConvoForUser(userId) {
    const db = getDb();
    const convoId = this.getConvoId(userId);
    const ref = doc(db, COL_CHAT_CONVOS, convoId);
    const snap = await getDoc(ref);
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  async markAsRead(messageId) {
    const db = getDb();
    const ref = doc(db, COL_CHAT_MESSAGES, messageId);
    await updateDoc(ref, { isRead: true });
  },

  async markConvoAsRead(convoId, userId) {
    const db = getDb();
    const colRef = collection(db, COL_CHAT_MESSAGES);
    const q = query(colRef, where('convoId', '==', convoId), where('receiverId', '==', userId), where('isRead', '==', false));
    const snap = await getDocs(q);
    const updates = snap.docs.map(d => updateDoc(d.ref, { isRead: true }));
    await Promise.all(updates);
  },

  async getUnreadCount(userId) {
    const db = getDb();
    const colRef = collection(db, COL_CHAT_MESSAGES);
    const q = query(colRef, where('receiverId', '==', userId), where('isRead', '==', false));
    const snap = await getDocs(q);
    return snap.size;
  },

  subscribeToMessages(convoId, callback) {
    const db = getDb();
    const colRef = collection(db, COL_CHAT_MESSAGES);
    const q = query(colRef, where('convoId', '==', convoId));
    return onSnapshot(q, (snap) => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      callback(msgs);
    }, (error) => {
      console.error('subscribeToMessages error:', error.message);
      callback([]);
    });
  },

  subscribeToAdminConvos(callback) {
    const db = getDb();
    const colRef = collection(db, COL_CHAT_CONVOS);
    return onSnapshot(colRef, (snap) => {
      const convos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => ((b.updatedAt || '') > (a.updatedAt || '') ? 1 : -1));
      callback(convos);
    }, (error) => {
      console.error('subscribeToAdminConvos error:', error.message);
      callback([]);
    });
  },

  subscribeToUserConvo(userId, callback) {
    const db = getDb();
    const convoId = this.getConvoId(userId);
    const ref = doc(db, COL_CHAT_CONVOS, convoId);
    return onSnapshot(ref, (snap) => {
      callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    }, (error) => {
      console.error('subscribeToUserConvo error:', error.message);
      callback(null);
    });
  },

  // ---- Delete all chat data for a user (messages + conversation) ----
  async deleteUserChatData(userId) {
    const db = getDb();
    const convoId = this.getConvoId(userId);
    try {
      const q = query(collection(db, COL_CHAT_MESSAGES), where('convoId', '==', convoId));
      const snap = await getDocs(q);
      console.log(`[DELETE CHAT] Found ${snap.docs.length} chat messages for convo ${convoId}`);
      const deletions = snap.docs.map(d => deleteDoc(doc(db, COL_CHAT_MESSAGES, d.id)));
      await Promise.all(deletions);
      console.log('[DELETE CHAT] Chat messages deleted');
    } catch (e) {
      console.error('[DELETE CHAT] FAILED to delete chat messages:', e.message);
    }
    try {
      const convoRef = doc(db, COL_CHAT_CONVOS, convoId);
      await deleteDoc(convoRef);
      console.log('[DELETE CHAT] Conversation deleted');
    } catch (e) {
      console.error('[DELETE CHAT] FAILED to delete conversation:', e.message);
    }
  },

  // ---- Delete chat data for all deleted users (orphaned conversations) ----
  async cleanupOrphanedConvos() {
    const db = getDb();
    const convosSnap = await getDocs(collection(db, COL_CHAT_CONVOS));
    const convos = convosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    let deleted = 0;
    for (const c of convos) {
      const userRef = doc(db, COL_USERS, c.userId);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        await this.deleteUserChatData(c.userId);
        deleted++;
      }
    }
    return deleted;
  },
};
