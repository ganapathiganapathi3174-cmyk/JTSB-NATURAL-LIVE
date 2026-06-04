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
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { getDb, getStorageRef, getAuthRef } from '../firebase/config.js';
import { ref, deleteObject } from 'firebase/storage';

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
const UPI_SIMILARITY_THRESHOLD = 85;

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
    
    const existingEmail = await FirebaseUser.findByEmail(userData.email);
    if (existingEmail) {
      throw new Error('This email is already registered. Please use another email or login.');
    }
    
    const existingPhone = await FirebaseUser.findByPhone(userData.phone);
    if (existingPhone) {
      throw new Error('This mobile number is already registered.');
    }
    
    let referralCode;
    for (let i = 0; i < 10; i++) {
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
      created_at: now,
      referral_created_at: now,
      referral_expires_at: computeReferralExpiryDate(),
    };

    await this._claimUnique(db, 'email', userData.email);
    if (userData.phone) await this._claimUnique(db, 'phone', userData.phone);

    const ref = await addDoc(collection(db, COL_USERS), userDoc);
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
    
    const existingEmail = await FirebaseUser.findByEmail(userData.email);
    if (existingEmail) {
      throw new Error('This email is already registered. Please use another email or login.');
    }
    
    const existingPhone = await FirebaseUser.findByPhone(userData.phone);
    if (existingPhone) {
      throw new Error('This mobile number is already registered.');
    }
    
    console.log('createWithPassword: creating user with password:', pass.substring(0, 2) + '***');
    console.log('Collection name:', COL_USERS);
    
    let referralCode;
    for (let i = 0; i < 10; i++) {
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
      created_at: now,
      referral_created_at: now,
      referral_expires_at: computeReferralExpiryDate(),
    };

    await this._claimUnique(db, 'email', userData.email);
    if (userData.phone) await this._claimUnique(db, 'phone', userData.phone);

    const ref = await addDoc(collection(db, COL_USERS), userDoc);
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
    
    // Verify the save
    const verifySnap = await getDoc(ref);
    const savedData = verifySnap.data();
    console.log('createWithPassword: password saved:', savedData.password === pass ? 'YES' : 'NO');
    
    return { id: newId, ...savedData };
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
      updateData.auto_approved = false;
      updateData.validation_status = 'passed';
      
    }
    await updateDoc(ref, updateData);
    console.log('Payment status updated successfully');
    
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
    const db = getDb();
    const user = await FirebaseUser.findById(id);
    
    if (!user) {
      // User doc already deleted (e.g. by old code) — still try to clean up uniqueness claims
      console.warn(`User doc not found for ${id}, cleaning up _uniques with provided data`);
    }

    // Decrement referrer's count if this user was referred and approved
    if (user?.referred_by && user?.referred_by_status === 'approved') {
      try {
        const referrer = await FirebaseUser.findByReferralCode(user.referred_by);
        if (referrer) {
          await FirebaseUser.decrementReferralCount(referrer.id);
        }
      } catch (e) {
        console.warn('Failed to decrement referrer count:', e);
      }
    }

    // Delete UPI screenshot from storage if exists
    if (user?.upi_screenshot_url) {
      try {
        const storage = getStorageRef();
        const fileRef = ref(storage, user.upi_screenshot_url);
        await deleteObject(fileRef);
      } catch (e) {
        console.warn('Failed to delete storage file:', e);
      }
    }

    // Delete all referrals for this user
    try {
      const referrals = await FirebaseUser.getReferrals(id);
      for (const referral of referrals) {
        const referralRef = doc(db, COL_REFERRALS, referral.id);
        await deleteDoc(referralRef);
      }
    } catch (e) {
      console.warn('Failed to delete referrals:', e);
    }

    // Delete all topups for this user
    try {
      const topupsQuery = query(collection(db, COL_TOPUPS), where('userId', '==', id));
      const topupsSnap = await getDocs(topupsQuery);
      const topupDeletions = topupsSnap.docs.map(d => deleteDoc(doc(db, COL_TOPUPS, d.id)));
      await Promise.all(topupDeletions);
    } catch (e) {
      console.warn('Failed to delete topups:', e);
    }

    // Delete topup referral income records for this user
    try {
      const incomeQuery1 = query(collection(db, COL_TOPUP_INCOME), where('userId', '==', id));
      const incomeSnap1 = await getDocs(incomeQuery1);
      const incomeQuery2 = query(collection(db, COL_TOPUP_INCOME), where('fromUserId', '==', id));
      const incomeSnap2 = await getDocs(incomeQuery2);
      const incomeDeletions = [...incomeSnap1.docs, ...incomeSnap2.docs].map(d => deleteDoc(doc(db, COL_TOPUP_INCOME, d.id)));
      await Promise.all(incomeDeletions);
    } catch (e) {
      console.warn('Failed to delete topup income:', e);
    }

    // Delete all notifications for this user
    try {
      const notifQuery1 = query(collection(db, COL_MESSAGES), where('receiverId', '==', id));
      const notifSnap1 = await getDocs(notifQuery1);
      const notifQuery2 = query(collection(db, COL_MESSAGES), where('senderId', '==', id));
      const notifSnap2 = await getDocs(notifQuery2);
      const notifDeletions = [...notifSnap1.docs, ...notifSnap2.docs].map(d => deleteDoc(doc(db, COL_MESSAGES, d.id)));
      await Promise.all(notifDeletions);
    } catch (e) {
      console.warn('Failed to delete notifications:', e);
    }

    // Delete payment images for this user
    try {
      const imagesQuery = query(collection(db, 'payment_images'), where('userId', '==', id));
      const imagesSnap = await getDocs(imagesQuery);
      const imageDeletions = imagesSnap.docs.map(d => deleteDoc(doc(db, 'payment_images', d.id)));
      await Promise.all(imageDeletions);
    } catch (e) {
      console.warn('Failed to delete payment images:', e);
    }

    // Delete uniqueness claims
    const userEmail = user?.email || email;
    const userPhone = user?.phone || phone;
    if (userEmail) {
      try {
        const emailClaimRef = doc(db, '_uniques', `email:${userEmail.toLowerCase().trim()}`);
        await deleteDoc(emailClaimRef);
      } catch (e) {
        console.warn('Failed to delete email uniqueness claim:', e);
      }
    }
    if (userPhone) {
      try {
        const phoneClaimRef = doc(db, '_uniques', `phone:${userPhone.trim()}`);
        await deleteDoc(phoneClaimRef);
      } catch (e) {
        console.warn('Failed to delete phone uniqueness claim:', e);
      }
    }

    // Delete chat messages and conversation for this user
    await FirebaseChat.deleteUserChatData(id);

    // Delete user document
    const userRef = doc(db, COL_USERS, id);
    await deleteDoc(userRef);
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
        if (cNorm.length >= 10 && normalized.length >= 10 && Math.abs(cNorm.length - normalized.length) <= 2) {
          const dist = this._levenshtein(cNorm, normalized);
          if (dist <= 2) {
            return {
              id: u.id, name: u.name, email: u.email, phone: u.phone,
              payment_status: u.payment_status, cycle_payment_status: u.cycle_payment_status,
              utr_number: u.utr_number, cycle_payment_utr: u.cycle_payment_utr, created_at: u.created_at,
            };
          }
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

  async checkUtrExists(utr) {
    if (!utr) return false;
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    const normalized = this._normalizeUtr(utr);

    // Indexed query on utr_number
    const q1 = query(colRef, where('utr_number', '==', utr.toString().trim()));
    const snap1 = await getDocs(q1);
    if (!snap1.empty) return true;

    // Indexed query on cycle_payment_utr
    const q2 = query(colRef, where('cycle_payment_utr', '==', utr.toString().trim()));
    const snap2 = await getDocs(q2);
    if (!snap2.empty) return true;

    // Check topup records for matching transaction ID
    const topupDup = await this.checkDuplicateUtrInTopups(utr);
    if (topupDup) return true;

    // Fuzzy fallback on approved/pending users
    const statusFilter = query(colRef, where('payment_status', 'in', ['approved', 'pending']));
    const statusSnap = await getDocs(statusFilter);
    for (const d of statusSnap.docs) {
      const u = { id: d.id, ...d.data() };
      for (const field of ['utr_number', 'cycle_payment_utr']) {
        const val = u[field];
        if (!val) continue;
        if (this._normalizeUtr(val) === normalized) return true;
      }
    }
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
      if (!user) return { autoApproved: false, autoRejected: false, failureReasons: ['User not found'] };

    const isCycle = user.cycle_payment_status === 'pending';
    const displayUtr = isCycle ? user.cycle_payment_utr : user.utr_number;
    const details = [];
    const failureReasons = [];

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

    // ===== CRITICAL CHECKS (UTR, UPI) =====

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

    // 2. Receiver UPI — must match expected admin UPI
    // Check all UPI fields (receiver_upi, upi_id, sender_upi) in order of reliability
    const upiCandidates = [ocrData?.receiver_upi, ocrData?.upi_id, ocrData?.sender_upi].filter(Boolean);
    const matchedUpi = upiCandidates.find(upi => isUpiValid(upi));
    if (matchedUpi) {
      pass('Receiver UPI');
    } else if (upiCandidates.length > 0) {
      fail('Receiver UPI', `Expected admin UPI not found. Found: ${upiCandidates.join(', ')}`);
    } else {
      skip('Receiver UPI', 'Not detected by OCR');
    }

    // ===== AMOUNT (reject on wrong, pass on match; try raw-text fallback before pending) =====
    let resolvedAmount = ocrData?.amount;
    // If extracted amount doesn't match expected, check raw text for expected amount specifically
    if (resolvedAmount && ocrData?.raw) {
      const parsedResolved = parseFloat(resolvedAmount.replace(/[,]/g, ''));
      if (!isNaN(parsedResolved) && Math.abs(parsedResolved - EXPECTED_AMOUNT) >= 1) {
        // Scan raw text for "120" — prefer it over the wrong extraction
        if (/(?:₹|Rs\.?|INR)\s*120(?:\.00)?/i.test(ocrData.raw)) {
          resolvedAmount = '120';
        } else if (/\b120\b/.test(ocrData.raw)) {
          resolvedAmount = '120';
        } else if (ocrData.raw.includes('120')) {
          const lines = ocrData.raw.split('\n');
          const lineWith120 = lines.find(l => l.includes('120') && !l.includes(ocrData?.utr || 'NOMATCH'));
          if (lineWith120) resolvedAmount = '120';
        }
      }
    }
    console.log('[BATCH AMOUNT] Structured amount:', resolvedAmount);
    if (!resolvedAmount && ocrData?.raw) {
      console.log('[BATCH AMOUNT] Raw text length:', ocrData.raw.length, '| scanning raw text...');
      const rawPatterns = [
        /₹\s?(\d+)/i,
        /Rs\.?\s?(\d+)/i,
        /INR\s?(\d+)/i,
        /\b(\d{2,6})\.00\b/,
      ];
      for (const pattern of rawPatterns) {
        const m = ocrData.raw.match(pattern);
        if (m && m[1]) {
          resolvedAmount = m[1];
          console.log('[BATCH AMOUNT] Raw-text hit:', pattern, '→', resolvedAmount);
          break;
        }
      }

      // Last resort: bare number scan (avoiding UTR/phone/date false-positives)
      if (!resolvedAmount) {
        const bareRe = /\b(\d{2,5})\b/g;
        let bareMatch;
        while ((bareMatch = bareRe.exec(ocrData.raw)) !== null) {
          const parsed = parseInt(bareMatch[1], 10);
          if (parsed < 50 || parsed > 500 || parsed === 2024 || parsed === 2025 || parsed === 2026) continue;
          const s = bareMatch[1];
          if (s.length === 4) {
            const a = parseInt(s.substring(0, 2), 10);
            const b = parseInt(s.substring(2, 4), 10);
            if ((a >= 1 && a <= 31 && b >= 1 && b <= 12) || (a >= 1 && a <= 12 && b >= 1 && b <= 31)) continue;
          }
          resolvedAmount = bareMatch[1];
          console.log('[BATCH AMOUNT] Raw-text bare number hit:', resolvedAmount);
          break;
        }
      }

      // Absolute last resort: substring check for "120"
      if (!resolvedAmount && ocrData.raw.includes('120')) {
        console.log('[BATCH AMOUNT] Found "120" substring in raw text');
        resolvedAmount = '120';
      }
      if (!resolvedAmount) console.log('[BATCH AMOUNT] No raw-text match found');
    }

    if (resolvedAmount) {
      const parsedAmount = parseFloat(resolvedAmount.replace(/[,]/g, ''));
      if (!isNaN(parsedAmount) && Math.abs(parsedAmount - EXPECTED_AMOUNT) >= 1) {
        skip('Payment Amount (₹120)', `OCR read ₹${resolvedAmount}, expected ₹120 — shown for admin review`);
      } else if (!isNaN(parsedAmount)) {
        pass('Payment Amount (₹120)');
      } else {
        skip('Payment Amount (₹120)', 'Amount unclear from OCR');
      }
    } else {
      skip('Payment Amount (₹120)', 'Amount not detected in OCR text');
    }

    // ===== SUPPORTING CHECKS (Status, Date) =====

    // 4. Payment Status
    if (ocrData?.payment_status) {
      const status = ocrData.payment_status.toLowerCase();
      if (status.includes('failed')) {
        fail('Payment Status', 'Payment Failed');
      } else if (status.startsWith('completed') || status.startsWith('success') || status === 'paid') {
        pass('Payment Status (Completed)');
      } else {
        skip('Payment Status', `Unclear status: ${ocrData.payment_status}`);
      }
    } else {
      skip('Payment Status', 'Not detected by OCR');
    }

    // 5. Transaction Date
    if (ocrData?.date) {
      const today = new Date();
      let ocrDate;
      // OCR extracts date as DD/MM/YYYY — parse manually to avoid JS treating it as MM/DD/YYYY
      const dmy = ocrData.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (dmy) {
        ocrDate = new Date(parseInt(dmy[3], 10), parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10));
      } else {
        // Text format: "02 Jun 2026" — parse with Date constructor
        ocrDate = new Date(ocrData.date.replace(/-/g, '/'));
        // Fix month confusion if still invalid
        if (isNaN(ocrDate.getTime())) {
          const monthFix = { 'mar': 'may', 'jur': 'jun', 'jul': 'jun', 'aug': 'apr' };
          let fixed = ocrData.date.replace(/-/g, '/');
          for (const [bad, good] of Object.entries(monthFix)) {
            fixed = fixed.replace(new RegExp('\\b' + bad + '\\b', 'gi'), good.charAt(0).toUpperCase() + good.slice(1));
          }
          ocrDate = new Date(fixed);
        }
      }
      if (isNaN(ocrDate.getTime())) {
        skip('Transaction Date', 'Date unreadable from OCR');
      } else if (ocrDate < new Date(today.getTime() - 48 * 60 * 60 * 1000)) {
        skip('Transaction Date', `Old Transaction Date: ${ocrData.date}`);
      } else {
        pass('Transaction Date (Today)');
      }
    } else {
      skip('Transaction Date', 'Not detected by OCR');
    }

    // ===== FINAL DECISION: weighted confidence score =====
    const weights = { amount: 0, utr: 30, status: 20, date: 20, upi: 30 };
    let totalScore = 0;
    let maxScore = 0;
    for (const d of details) {
      let w = 0;
      if (d.check.includes('Amount')) w = weights.amount;
      else if (d.check.includes('UTR')) w = weights.utr;
      else if (d.check.includes('Status')) w = weights.status;
      else if (d.check.includes('Date')) w = weights.date;
      else if (d.check.includes('UPI') || d.check.includes('Receiver UPI')) w = weights.upi;
      maxScore += w;
      if (d.passed === true) totalScore += w;
      else if (d.passed === null) totalScore += w * 0.5;
    }
    const confidenceScore = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
    let confidenceLabel = 'LOW';
    if (confidenceScore >= 95) confidenceLabel = 'HIGH';
    else if (confidenceScore >= 75) confidenceLabel = 'MEDIUM';

    // Cross-validate user input vs OCR
    const crossValidations = [];
    if (userInputs?.utr && displayUtr) {
      if (this._normalizeUtr(userInputs.utr) !== this._normalizeUtr(displayUtr)) {
        crossValidations.push(`UTR mismatch: user=${userInputs.utr} ocr=${displayUtr}`);
      }
    }
    // UTR vs Transaction ID: the UTR (from user or OCR) should match the UPI transaction ID in the screenshot
    const txId = ocrData?.transaction_id;
    if (displayUtr && txId) {
      const normUtr = this._normalizeUtr(displayUtr);
      const normTxId = txId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (!normTxId.includes(normUtr) && !normUtr.includes(normTxId) && normUtr !== normTxId) {
        crossValidations.push(`Transaction ID mismatch: UTR=${displayUtr} txn_id=${txId}`);
      }
    }
    const crossValidationFailed = crossValidations.length > 0;
    if (crossValidationFailed) {
      details.push({ check: 'Cross-Validation', passed: false, reason: crossValidations.join('; ') });
      failureReasons.push(crossValidations[0]);
    } else if (userInputs?.amount || userInputs?.utr) {
      details.push({ check: 'Cross-Validation', passed: true });
    }

    // Critical checks for auto-approval: Receiver UPI only (Date/UTR/Status/Amount are advisory)
    const receiverUpiPassed = details.some(d => d.check.includes('Receiver UPI') && d.passed === true);
    const hasDuplicateUtr = details.some(d => d.check === 'Unique UTR' && d.passed === false);
    const hasFailedStatus = details.some(d => d.check.includes('Status') && d.passed === false);
    const hasCrossValidationFailure = details.some(d => d.check === 'Cross-Validation' && d.passed === false);

    // Result: Recommended Approval, Manual Review Required, Rejected
    const autoApproved = receiverUpiPassed && !hasDuplicateUtr && !hasCrossValidationFailure && !hasFailedStatus;
    const autoRejected = hasDuplicateUtr || hasFailedStatus || hasCrossValidationFailure;
    const autoPending = !autoApproved && !autoRejected;

    // Build failure reasons from any non-passing detail
    for (const d of details) {
      if (d.passed !== true && d.reason && !failureReasons.includes(d.reason)) {
        failureReasons.push(d.reason);
      }
    }

    const validationStatus = autoApproved ? 'approved' : autoRejected ? 'rejected' : 'pending';

    const result = {
      autoApproved,
      autoRejected,
      autoPending: !autoApproved && !autoRejected,
      details,
      failureReasons,
      duplicateUtrFlag: !!dupFound,
      validationStatus,
      ocrData: ocrData || null,
    };

    await this.storeValidationResult(userId, {
      ocrData: ocrData || null,
      validationStatus,
      autoApproved,
      autoRejected,
      failureReasons,
      duplicateUtrFlag: !!dupFound,
      validationDetails: details,
      confidenceScore,
      confidenceLabel,
    });

    if (autoApproved && (user.payment_status === 'pending' || user.payment_status === 'rejected' || isCycle)) {
      await this.updatePaymentStatus(userId, 'approved');
      const now = new Date().toISOString();
      if (isCycle) {
        const db = getDb();
        await updateDoc(doc(db, COL_USERS, userId), { cycle_payment_status: 'approved', admin_approval_status: 'APPROVED', is_active: true, approved_at: now, approved_by: 'Auto-Approval' });
      } else {
        const db = getDb();
        await updateDoc(doc(db, COL_USERS, userId), { admin_approval_status: 'APPROVED', is_active: true, approved_at: now, approved_by: 'Auto-Approval' });
      }
      console.log(`[AUTO APPROVAL] User ${userId} auto-approved, is_active=true`);
      result.wasAutoApproved = true;
    }

    if (autoRejected && (user.payment_status === 'pending' || user.payment_status === 'approved' || isCycle)) {
      const db = getDb();
      if (isCycle) {
        await updateDoc(doc(db, COL_USERS, userId), { cycle_payment_status: 'rejected', account_status: 'rejected', admin_approval_status: 'REJECTED', is_active: false });
      } else {
        await this.updatePaymentStatus(userId, 'rejected');
        await updateDoc(doc(db, COL_USERS, userId), { account_status: 'rejected', admin_approval_status: 'REJECTED', is_active: false });
      }
      console.log(`[AUTO APPROVAL] User ${userId} auto-rejected, is_active=false`);
      result.wasAutoRejected = true;
    }

    return result;
    } catch (err) {
      console.error('[AUTO APPROVAL ERROR]', err);
      return { autoApproved: false, autoRejected: true, wasAutoRejected: true, failureReasons: ['Auto-approval error: ' + (err.message || err)] };
    }
  },

  async updateAdminApproval(userId, status, adminName = '') {
    const db = getDb();
    const ref = doc(db, COL_USERS, userId);
    const updates = { admin_approval_status: status };
    if (status === 'APPROVED') {
      updates.account_status = 'active';
      updates.approved_at = new Date().toISOString();
      updates.approved_by = adminName || 'Unknown Admin';
      updates.is_active = true;
      console.log(`[ADMIN APPROVAL] User ${userId} APPROVED by ${adminName}`);
    } else if (status === 'REJECTED') {
      updates.is_active = false;
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
    if (!topupData) return { autoApproved: false, autoRejected: false, failureReasons: ['Topup not found'] };

    const details = [];
    const failureReasons = [];

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

    const expectedAmount = Number(topupData.amount) || 0;

    // 1. OCR Confidence — advisory
    const conf = ocrData?.ocr_confidence;
    if (conf === undefined) {
      skip('OCR Confidence (≥70%)', 'Not detected');
    } else if (conf < 70) {
      skip('OCR Confidence (≥70%)', `Low confidence (${conf}%)`);
    } else {
      pass('OCR Confidence (≥70%)');
    }

    // 2. Amount — advisory (use raw-text fallback like Payments)
    let resolvedAmount = ocrData?.amount;
    if (resolvedAmount && ocrData?.raw && expectedAmount > 0) {
      const parsedResolved = parseFloat(resolvedAmount.replace(/[,]/g, ''));
      if (!isNaN(parsedResolved) && Math.abs(parsedResolved - expectedAmount) >= 1) {
        if (ocrData.raw.includes(String(expectedAmount))) {
          resolvedAmount = String(expectedAmount);
        }
      }
    }
    if (!resolvedAmount && ocrData?.raw && expectedAmount > 0) {
      const rawPatterns = [
        /₹\s?(\d+)/i, /Rs\.?\s?(\d+)/i, /INR\s?(\d+)/i, /\b(\d{2,6})\.00\b/,
      ];
      for (const p of rawPatterns) {
        const m = ocrData.raw.match(p);
        if (m && m[1]) { resolvedAmount = m[1]; break; }
      }
      if (!resolvedAmount) {
        const bareRe = /\b(\d{2,5})\b/g;
        let m;
        while ((m = bareRe.exec(ocrData.raw)) !== null) {
          const p = parseInt(m[1], 10);
          if (p < 50 || p > 500 || p === 2024 || p === 2025 || p === 2026) continue;
          if (m[1].length === 4) {
            const a = parseInt(m[1].substring(0, 2), 10);
            const b = parseInt(m[1].substring(2, 4), 10);
            if ((a >= 1 && a <= 31 && b >= 1 && b <= 12) || (a >= 1 && a <= 12 && b >= 1 && b <= 31)) continue;
          }
          resolvedAmount = m[1]; break;
        }
      }
      if (!resolvedAmount && ocrData.raw.includes(String(expectedAmount))) {
        resolvedAmount = String(expectedAmount);
      }
    }
    if (resolvedAmount) {
      const parsedAmount = parseFloat(resolvedAmount.replace(/[,]/g, ''));
      if (!isNaN(parsedAmount) && Math.abs(parsedAmount - expectedAmount) >= 1) {
        skip(`Payment Amount (₹${expectedAmount})`, `OCR read ₹${resolvedAmount} — shown for admin review`);
      } else if (!isNaN(parsedAmount)) {
        pass(`Payment Amount (₹${expectedAmount})`);
      } else {
        skip(`Payment Amount (₹${expectedAmount})`, 'Amount unclear from OCR');
      }
    } else {
      skip(`Payment Amount (₹${expectedAmount})`, 'Amount not detected in OCR');
    }

    // 3. Receiver UPI — PRIMARY: must match expected admin UPI
    const receiverUpi = ocrData?.receiver_upi;
    if (receiverUpi) {
      if (isUpiValid(receiverUpi)) {
        pass('Receiver UPI');
      } else {
        fail('Receiver UPI', `Receiver UPI mismatch: expected admin UPI, found ${receiverUpi}`);
      }
    } else {
      skip('Receiver UPI', 'Not detected by OCR');
    }

    // 4. Payment Status — advisory (fail only if explicitly failed)
    if (!ocrData?.payment_status) {
      skip('Payment Status', 'Not detected by OCR');
    } else {
      const status = ocrData.payment_status.toLowerCase();
      if (status.includes('failed')) {
        fail('Payment Status', 'Payment Failed');
      } else if (status === REQUIRED_PAYMENT_STATUS.toLowerCase() || status === 'success' || status === 'successful' || status === 'paid') {
        pass('Payment Status (Completed)');
      } else {
        skip('Payment Status', `Unclear status: ${ocrData.payment_status}`);
      }
    }

    // 5. Transaction Date — advisory
    if (!ocrData?.date) {
      skip('Transaction Date', 'Not detected by OCR');
    } else {
      const today = new Date();
      const ocrDateStr = ocrData.date.replace(/-/g, '/');
      const ocrDate = new Date(ocrDateStr);
      const isToday = !isNaN(ocrDate.getTime()) && ocrDate.toDateString() === today.toDateString();
      if (isToday) {
        pass('Transaction Date (Today)');
      } else {
        skip('Transaction Date', `Old Transaction Date: ${ocrData.date}`);
      }
    }

    // 6. Unique Transaction ID — normalized match across topups + user UTR records (no fuzzy)
    let dupFound = null;
    if (!topupData.transactionId) {
      skip('Unique Transaction ID', 'No Transaction ID Provided');
    } else {
      const trimmedTxId = topupData.transactionId.trim();
      dupFound = await this.findDuplicateTransactionId(trimmedTxId, topupData.userId);
      if (dupFound) {
        fail('Unique Transaction ID', 'Duplicate Transaction ID Detected');
      } else {
        pass('Unique Transaction ID');
      }
    }

    // 7. Cross-validation — PRIMARY: user UTR must match OCR-extracted UTR
    const ocrUtr = ocrData?.utr || ocrData?.transaction_id;
    const userTxId = topupData.transactionId;

    // Enhanced UTR normalization: digits-only comparison with prefix stripping
    function _normalizeUtrDigits(val) {
      if (!val) return '';
      let s = this._normalizeUtr(val);
      // Strip common OCR-added prefixes (TXN, REF, UTR, RRN, etc.)
      const prefixes = ['TXN', 'UTR', 'REF', 'ID', 'NO', 'NUM', 'TRN', 'RRN', 'NEFT', 'UPI', 'PAY', 'BANK', 'SBIN', 'SBIBANK'];
      for (const p of prefixes) {
        if (s.startsWith(p)) { s = s.slice(p.length); break; }
      }
      // Strip to digits only for final comparison
      return s.replace(/[^0-9]/g, '');
    }

    const normOcr = _normalizeUtrDigits.call(this, ocrUtr ? ocrUtr.toString() : '');
    const normUser = _normalizeUtrDigits.call(this, userTxId ? userTxId.toString() : '');

    const utrDebug = {
      userEntered: (userTxId || '').toString(),
      ocrExtracted: (ocrUtr || '').toString(),
      normalizedUser: normUser,
      normalizedOcr: normOcr,
      rawNormalizedUser: this._normalizeUtr(userTxId || ''),
      rawNormalizedOcr: this._normalizeUtr(ocrUtr || ''),
    };

    if (ocrUtr && userTxId) {
      if (normOcr !== normUser) {
        fail('Cross-Validation', `Transaction ID mismatch: entered=${userTxId} ocr=${ocrUtr}`);
      } else {
        pass('Cross-Validation');
      }
    } else {
      skip('Cross-Validation', 'Skipped (no OCR UTR or transaction ID)');
    }

    // Decision: primary validations (UTR match + UPI match) plus existing checks
    const receiverUpiPassed = details.some(d => d.check === 'Receiver UPI' && d.passed === true);
    const receiverUpiSkipped = details.some(d => d.check === 'Receiver UPI' && d.passed === null);
    const utrMatchPassed = details.some(d => d.check === 'Cross-Validation' && d.passed === true);
    const hasDuplicateUtr = details.some(d => d.check === 'Unique Transaction ID' && d.passed === false);
    const hasFailedStatus = details.some(d => d.check.includes('Status') && d.passed === false);
    const primaryFailed = details.some(d => (d.check === 'Receiver UPI' || d.check === 'Cross-Validation') && d.passed === false);

    // UPI is OK if it passed, or if it was skipped (OCR didn't detect) and UTR matches
    const upiOk = receiverUpiPassed || (receiverUpiSkipped && utrMatchPassed);
    const autoApproved = upiOk && utrMatchPassed && !hasDuplicateUtr && !hasFailedStatus;
    const autoRejected = primaryFailed || hasDuplicateUtr || hasFailedStatus;
    const autoPending = !autoApproved && !autoRejected;

    // Build failure reasons from any non-passing detail
    for (const d of details) {
      if (d.passed !== true && d.reason && !failureReasons.includes(d.reason)) {
        failureReasons.push(d.reason);
      }
    }

    const validationStatus = autoApproved ? 'approved' : autoRejected ? 'rejected' : 'pending';

    const result = {
      autoApproved,
      autoRejected,
      autoPending,
      details,
      failureReasons,
      duplicateUtrFlag: !!dupFound,
      validationStatus,
      ocrData: ocrData || null,
      utrDebug,
    };

    const db = getDb();
    const topupRef = doc(db, COL_TOPUPS, topupId);
    await updateDoc(topupRef, {
      auto_approved: result.autoApproved !== undefined ? result.autoApproved : null,
      auto_rejected: result.autoRejected !== undefined ? result.autoRejected : null,
      validation_status: result.validationStatus,
      failure_reasons: result.failureReasons,
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
  },

  async activateUser(userId, adminName, reason = '') {
    const user = await this.findById(userId);
    if (!user) throw new Error('User not found');
    if (user.account_status === 'active') throw new Error('User is already active');

    const db = getDb();
    const ref = doc(db, COL_USERS, userId);

    const historyEntry = {
      from: user.account_status || 'inactive',
      to: 'active',
      changed_by: adminName || 'Unknown Admin',
      changed_at: new Date().toISOString(),
      reason: reason || 'Manual activation by admin',
    };

    const existingHistory = user.status_change_history || [];

    await updateDoc(ref, {
      account_status: 'active',
      activated_by: adminName || 'Unknown Admin',
      activated_at: new Date().toISOString(),
      activation_reason: reason || 'Manual activation by admin',
      status_change_history: [...existingHistory, historyEntry],
    });

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
};

export const FirebaseStorage = {
  async uploadPaymentScreenshot(userId, file) {
    console.log('🔄 Converting to Base64:', file.name);
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
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
        resolve({ url: `data:image/jpeg;base64,${base64}`, path: fileId });
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  },

  async deletePaymentScreenshot(url) {
    console.log('Delete not needed for Base64:', url);
  },

  async uploadTopupScreenshot(userId, file) {
    console.log('Converting topup to Base64:', file.name);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        const fileId = `topup_${userId}_${Date.now()}`;
        const db = getDb();
        const imagesRef = collection(db, 'payment_images');
        await addDoc(imagesRef, {
          fileId,
          userId,
          type: 'topup',
          base64,
          fileName: file.name,
          createdAt: serverTimestamp(),
        });
        console.log('Topup Base64 stored in Firestore');
        resolve(`data:image/jpeg;base64,${base64}`);
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
        const base64 = reader.result.split(',')[1];
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
        resolve(`data:image/jpeg;base64,${base64}`);
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
  async create(userId, { amount, transactionId, screenshotData }) {
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
      const deletions = snap.docs.map(d => deleteDoc(doc(db, COL_CHAT_MESSAGES, d.id)));
      await Promise.all(deletions);
    } catch (e) {
      console.warn('Failed to delete chat messages:', e);
    }
    try {
      const convoRef = doc(db, COL_CHAT_CONVOS, convoId);
      await deleteDoc(convoRef);
    } catch (e) {
      console.warn('Failed to delete conversation:', e);
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
