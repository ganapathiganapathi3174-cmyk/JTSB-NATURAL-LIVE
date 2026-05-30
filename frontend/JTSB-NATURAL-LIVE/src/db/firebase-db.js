// Firebase Firestore database layer - NEW COLLECTIONS
import {
  collection,
  doc,
  addDoc,
  getDocs,
  getDoc,
  query,
  where,
  updateDoc,
  deleteDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
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
const STORAGE_FOLDER = 'new_payments';
const MAX_REFERRALS = 2;
const REFERRAL_EXPIRY_DAYS = 7;

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
  async create(userData) {
    const db = getDb();
    const now = new Date().toISOString();
    
    const existingEmail = await FirebaseUser.findByEmail(userData.email);
    if (existingEmail) {
      throw new Error('This email is already registered. Please use a different email.');
    }
    
    const existingPhone = await FirebaseUser.findByPhone(userData.phone);
    if (existingPhone) {
      throw new Error('This phone number is already registered. Please use a different number.');
    }
    
    let referralCode;
    for (let i = 0; i < 10; i++) {
      referralCode = generateReferralCode();
      const existing = await FirebaseUser.findByReferralCode(referralCode);
      if (!existing) break;
    }

    console.log('Creating user document with password:', userData.password ? 'YES' : 'NO');
    
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
      password: userData.password || '',
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
      is_first_payment_done: false,
      created_at: now,
      referral_created_at: now,
      referral_expires_at: computeReferralExpiryDate(),
    };

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
    
    const existingEmail = await FirebaseUser.findByEmail(userData.email);
    if (existingEmail) {
      throw new Error('This email is already registered. Please use a different email.');
    }
    
    const existingPhone = await FirebaseUser.findByPhone(userData.phone);
    if (existingPhone) {
      throw new Error('This phone number is already registered. Please use a different number.');
    }
    
    console.log('createWithPassword: creating user with password:', pass.substring(0, 2) + '***');
    console.log('Collection name:', COL_USERS);
    
    let referralCode = generateReferralCode();
    
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
      password: pass,
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
      is_first_payment_done: false,
      created_at: now,
      referral_created_at: now,
      referral_expires_at: computeReferralExpiryDate(),
    };

    const ref = await addDoc(collection(db, COL_USERS), userDoc);
    const newId = ref.id;
    
    console.log('User document created in:', COL_USERS);
    console.log('User ID:', newId);
    console.log('User data being saved:', JSON.stringify(userDoc));
    
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
    const q = query(colRef, where('email', '==', email.toLowerCase()), where('password', '==', password));
    const snap = await getDocs(q);
    console.log('findByEmailAndPassword found:', snap.size);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
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
      
      if (user.referred_by && user.referred_by_status === 'pending') {
        updateData.referred_by_status = 'approved';
      }
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
    console.log('=== UPDATE PASSWORD START ===');
    console.log('User ID:', id);
    console.log('Password to save:', newPassword);
    console.log('Password length:', newPassword ? newPassword.length : 0);
    
    try {
      await updateDoc(ref, { password: newPassword });
      console.log('UpdateDoc completed');
      
      // Verify
      const snap = await getDoc(ref);
      const data = snap.data();
      console.log('Password after update:', data.password);
      console.log('=== UPDATE PASSWORD END ===');
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
    console.log('Setting user password for:', id);
    console.log('Password value:', password);
    await updateDoc(ref, { password: password });
    const updated = await getDoc(ref);
    console.log('Password saved:', updated.data().password);
  },

  async updatePayment(id, screenshotData, utr) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    const data = {
      utr_number: utr || null,
      payment_status: 'pending',
    };
    console.log('updatePayment: id:', id, 'utr:', utr);
    if (screenshotData) {
      data.upi_screenshot_data = screenshotData;
      data.upi_screenshot_url = screenshotData;
    }
    try {
      await updateDoc(ref, data);
      console.log('updatePayment: SUCCESS');
    } catch (err) {
      console.log('updatePayment: ERROR', err.message);
    }
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

  async deleteUser(id) {
    const db = getDb();
    const user = await FirebaseUser.findById(id);
    
    if (!user) {
      throw new Error('User not found');
    }

    // Decrement referrer's count if this user was referred and approved
    if (user.referred_by && user.referred_by_status === 'approved') {
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
    if (user.upi_screenshot_url) {
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
          .filter(u => u.upi_screenshot_url || u.utr_number || u.cycle_upi_screenshot_url || u.cycle_payment_utr);
        console.log('subscribeToPayments received:', users.length, 'users');
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
    const q = query(colRef, where('userId', '==', userId), where('createdAt', '>=', '2000-01-01'));
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

export { generateReferralCode, MAX_REFERRALS, REFERRAL_EXPIRY_DAYS, STORAGE_FOLDER };

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
