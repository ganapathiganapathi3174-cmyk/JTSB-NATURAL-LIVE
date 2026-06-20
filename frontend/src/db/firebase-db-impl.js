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
import { getDb, getAuthRef } from '../firebase/config.js';
import { ref, deleteObject } from 'firebase/storage';

const COL_USERS = 'users_new';
const COL_REFERRALS = 'referrals_new';
const COL_TOPUPS = 'topups_new';
const COL_TOPUP_INCOME = 'topup_referral_income';
const COL_MESSAGES = 'notifications';
const COL_CHAT_MESSAGES = 'chat_messages';
const COL_CHAT_CONVOS = 'chat_conversations';
const COL_WALLET = 'wallet_balances';
const COL_WALLET_TX = 'wallet_transactions';

const MAX_REFERRALS = 2;
const REFERRAL_EXPIRY_DAYS = 7;

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

async function hashPassword(password) {
  if (!password) return '';
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
  const hash = await hashPassword(plaintext);
  if (hash === storedHash) return true;
  if (plaintext === storedHash) return true;
  return false;
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
    // Non-blocking â€” Firestore security rules now allow delete without auth
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
            // Stale claim â€” delete and re-create
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
      membershipStatus: 'inactive',
      sponsorId: userData.sponsorId || null,
      sponsorRenewalRequired: false,
      reviewRequired: false,
      upi_screenshot_url: null,
      utr_number: null,
      referral_code: referralCode,
      referred_by: userData.referredBy || null,
      referred_by_status: userData.referredBy ? 'pending' : null,
      referrals_count: 0,
      total_referral_count: 0,
      referral_limit_reached: false,
      referral_active: true,
      referral_view_count: 0,
      account_status: 'inactive',
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
      membershipStatus: 'inactive',
      membershipPaid: false,
      sponsorId: userData.sponsorId || null,
      sponsorRenewalRequired: false,
      renewalRequired: false,
      inactiveReason: null,
      reviewRequired: false,
      referral_code: referralCode,
      referred_by: userData.referredBy || null,
      referred_by_status: userData.referredBy ? 'pending' : null,
      referrals_count: 0,
      total_referral_count: 0,
      referral_limit_reached: false,
      referral_active: true,
      referral_view_count: 0,
      account_status: 'inactive',
      is_active: false,
      is_first_payment_done: false,
      approved: false,
      active: false,
      loginEnabled: userData.loginEnabled === true,
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
    console.log('[REGISTRATION] account_status:', userDoc.account_status);
    console.log('[REGISTRATION] payment_status:', userDoc.payment_status);
    console.log('[REGISTRATION] is_active:', userDoc.is_active);
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

  async updateAdminStatus(id, adminStatus) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    await updateDoc(ref, { admin_status: adminStatus });
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

    await updateDoc(ref, updateData);
  },




  async incrementReferralViewCount(id) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    const user = await this.findById(id);
    if (!user) return null;
    const newCount = (user.referral_view_count || 0) + 1;
    await updateDoc(ref, {
      referral_view_count: newCount,
    });
    return { count: newCount };
  },

  subscribeToUsers(callback) {
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    return onSnapshot(colRef, (snap) => {
      try {
        const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log('[PENDING QUERY] subscribeToUsers received:', users.length, 'total users');
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
          .filter(u => u.payment_status || u.razorpay_payment_id);
        console.log('[PENDING QUERY] subscribeToPayments received:', users.length, 'payment users');
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
      reason: reason || 'Rejected',
    };

    const existingHistory = user.status_change_history || [];

    await updateDoc(ref, {
      account_status: 'blocked',
      admin_status: 'suspicious',
      rejected_by: adminName || 'Unknown Admin',
      rejected_at: new Date().toISOString(),
      rejection_reason: reason || 'Rejected',
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
};

export const FirebaseWallet = {
  async getBalance(userId) {
    if (!userId) return 0;
    const db = getDb();
    const ref = doc(db, COL_WALLET, userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return 0;
    return snap.data().balance || 0;
  },

  async creditBalance(userId, amount, metadata = {}) {
    if (!userId || !amount || amount <= 0) throw new Error('Invalid userId or amount');
    const db = getDb();
    const ref = doc(db, COL_WALLET, userId);
    const existing = await getDoc(ref);
    const currentBalance = existing.exists() ? (existing.data().balance || 0) : 0;
    const newBalance = currentBalance + Number(amount);
    await setDoc(ref, { userId, balance: newBalance, updatedAt: new Date().toISOString() }, { merge: true });
    const tx = await FirebaseWallet.createTransaction(userId, {
      type: 'credit',
      amount: Number(amount),
      balanceAfter: newBalance,
      description: metadata.description || 'Credit',
      razorpay_payment_id: metadata.razorpay_payment_id || '',
      razorpay_order_id: metadata.razorpay_order_id || '',
    });
    return { balance: newBalance, transaction: tx };
  },

  async debitBalance(userId, amount, metadata = {}) {
    if (!userId || !amount || amount <= 0) throw new Error('Invalid userId or amount');
    const db = getDb();
    const ref = doc(db, COL_WALLET, userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Wallet not found');
    const currentBalance = snap.data().balance || 0;
    if (currentBalance < amount) throw new Error('Insufficient balance');
    const newBalance = currentBalance - Number(amount);
    await updateDoc(ref, { balance: newBalance, updatedAt: new Date().toISOString() });
    const tx = await FirebaseWallet.createTransaction(userId, {
      type: 'debit',
      amount: Number(amount),
      balanceAfter: newBalance,
      description: metadata.description || 'Debit',
      razorpay_payment_id: metadata.razorpay_payment_id || '',
      razorpay_order_id: metadata.razorpay_order_id || '',
    });
    return { balance: newBalance, transaction: tx };
  },

  async createTransaction(userId, data) {
    if (!userId) throw new Error('userId is required');
    const db = getDb();
    const txRef = await addDoc(collection(db, COL_WALLET_TX), {
      userId,
      type: data.type || 'credit',
      amount: Number(data.amount),
      balanceAfter: data.balanceAfter || 0,
      description: data.description || '',
      razorpay_payment_id: data.razorpay_payment_id || '',
      razorpay_order_id: data.razorpay_order_id || '',
      createdAt: new Date().toISOString(),
    });
    return { id: txRef.id };
  },

  async listTransactions(userId, limitCount = 50) {
    if (!userId) return [];
    const db = getDb();
    const q = query(
      collection(db, COL_WALLET_TX),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  subscribeToWallet(userId, callback) {
    if (!userId) { callback(null); return () => {}; }
    const db = getDb();
    const ref = doc(db, COL_WALLET, userId);
    return onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        callback({ balance: snap.data().balance || 0, updatedAt: snap.data().updatedAt });
      } else {
        callback({ balance: 0 });
      }
    }, (error) => {
      console.error('Wallet subscription error:', error);
      callback(null);
    });
  },
};

export const FirebaseStorage = {
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
      console.log('âœ… Default admin record created in Firestore');
    }
  } catch (e) {
    console.error('âš ï¸ seedDefaultAdmin:', e.message);
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
      deleted: false,
      deletedAt: null,
      deletedBy: null,
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

  async softDelete(id, adminId, reason) {
    const db = getDb();
    const ref = doc(db, COL_TOPUPS, id);
    const topup = await FirebaseTopup.findById(id);
    if (!topup) throw new Error('Topup not found');
    if (topup.deleted) throw new Error('Topup already deleted');

    const now = new Date().toISOString();
    await updateDoc(ref, {
      deleted: true,
      deletedAt: now,
      deletedBy: adminId || 'Unknown Admin',
      status: 'deleted',
    });

    // Write audit log
    const auditCol = collection(db, 'topup_audit_log');
    await addDoc(auditCol, {
      action: 'delete',
      adminId: adminId || 'Unknown Admin',
      topupId: id,
      reason: reason || '',
      previousData: {
        status: topup.status,
        deleted: false,
      },
      timestamp: now,
    });

    return { success: true, id, deleted: true };
  },

  async restore(id, adminId, reason) {
    const db = getDb();
    const ref = doc(db, COL_TOPUPS, id);
    const topup = await FirebaseTopup.findById(id);
    if (!topup) throw new Error('Topup not found');
    if (!topup.deleted) throw new Error('Topup is not deleted');

    const now = new Date().toISOString();
    await updateDoc(ref, {
      deleted: false,
      deletedAt: null,
      deletedBy: null,
      status: 'success',
    });

    // Write audit log
    const auditCol = collection(db, 'topup_audit_log');
    await addDoc(auditCol, {
      action: 'restore',
      adminId: adminId || 'Unknown Admin',
      topupId: id,
      reason: reason || '',
      previousData: {
        status: topup.status,
        deleted: true,
      },
      timestamp: now,
    });

    return { success: true, id, restored: true };
  },

  async findDeleted() {
    const db = getDb();
    const colRef = collection(db, COL_TOPUPS);
    const q = query(colRef, where('deleted', '==', true));
    const snap = await getDocs(q);
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => new Date(b.deletedAt || b.createdAt) - new Date(a.deletedAt || a.createdAt));
    return list;
  },

  async getAuditLog(topupId) {
    const db = getDb();
    const colRef = collection(db, 'topup_audit_log');
    const q = query(colRef, where('topupId', '==', topupId), orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getDeletedCount() {
    const db = getDb();
    const colRef = collection(db, COL_TOPUPS);
    const q = query(colRef, where('deleted', '==', true));
    const snap = await getDocs(q);
    return snap.size;
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

export { generateReferralCode, MAX_REFERRALS, REFERRAL_EXPIRY_DAYS, hashPassword, hashPasswordCached, comparePassword, hashData };

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
    admin_approval_approved: 'Access Approved',
    admin_approval_rejected: 'Access Rejected',
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
