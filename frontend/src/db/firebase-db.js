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
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { getDb, getStorageRef, getAuthRef } from '../firebase/config.js';

const COL_USERS = 'users_new';
const COL_REFERRALS = 'referrals_new';
const STORAGE_FOLDER = 'new_payments';
const MAX_REFERRALS = 2;

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
    
    let referralCode;
    for (let i = 0; i < 10; i++) {
      referralCode = generateReferralCode();
      const existing = await FirebaseUser.findByReferralCode(referralCode);
      if (!existing) break;
    }

    console.log('Creating user document with password:', userData.password ? 'YES' : 'NO');
    
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
      referrals_count: 0,
      referral_limit_reached: false,
      created_at: now,
    };

    const ref = await addDoc(collection(db, COL_USERS), userDoc);
    console.log('User created in Firestore with password:', userDoc.password ? 'YES' : 'NO');
    
    if (userData.referredBy) {
      try {
        await FirebaseUser.incrementReferralCount(userData.referredBy);
      } catch (e) {
        console.warn('Failed to increment referrer count:', e);
      }
    }
    return { id: ref.id, ...userDoc };
  },

  async createWithPassword(userData) {
    const db = getDb();
    const now = new Date().toISOString();
    const pass = userData.password || '';
    
    console.log('createWithPassword: creating user with password:', pass.substring(0, 2) + '***');
    console.log('Collection name:', COL_USERS);
    
    let referralCode = generateReferralCode();
    
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
      referrals_count: 0,
      referral_limit_reached: false,
      created_at: now,
    };

    const ref = await addDoc(collection(db, COL_USERS), userDoc);
    const newId = ref.id;
    
    console.log('User document created in:', COL_USERS);
    console.log('User ID:', newId);
    console.log('User data being saved:', JSON.stringify(userDoc));
    
    // Handle referral - find referrer and update both users
    if (userData.referredBy) {
      try {
        const referralCode = userData.referredBy.toUpperCase();
        const referrer = await this.findByReferralCode(referralCode);
        if (referrer) {
          // Prevent self-referral
          if (referrer.id !== newId) {
            // Update new user's referred_by to store referrer's referral code
            await updateDoc(ref, { referred_by: referralCode });
            
            // Add new user to referrer's referrals array and increment count
            const currentReferrals = referrer.referrals || [];
            if (!currentReferrals.includes(newId)) {
              await updateDoc(doc(db, COL_USERS, referrer.id), {
                referrals: [...currentReferrals, newId],
                referrals_count: (referrer.referrals_count || 0) + 1,
                referral_limit_reached: (referrer.referrals_count || 0) + 1 >= MAX_REFERRALS,
              });
              console.log('Referral linkage complete:', referrer.id, '->', newId);
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
    const q = query(colRef, where('email', '==', email.toLowerCase()));
    const snap = await getDocs(q);
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
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getReferrerInfo(referralCode) {
    if (!referralCode) return null;
    const referrer = await this.findByReferralCode(referralCode);
    if (!referrer) return null;
    return { id: referrer.id, name: referrer.name, email: referrer.email };
  },

  async updateStatus(id, status) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    await updateDoc(ref, { status });
  },

  async updatePaymentStatus(id, payment_status) {
    const db = getDb();
    const ref = doc(db, COL_USERS, id);
    console.log('Updating payment status for:', id, 'to:', payment_status);
    await updateDoc(ref, { 
      payment_status,
      status: payment_status === 'approved' ? 'approved' : payment_status
    });
    console.log('Payment status updated successfully');
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
      await updateDoc(ref, { referred_by: refCode });
      
      // Link to referrer
      const referrer = await this.findByReferralCode(refCode);
      if (referrer && referrer.id !== id) {
        const currentReferrals = referrer.referrals || [];
        if (!currentReferrals.includes(id)) {
          await updateDoc(doc(db, COL_USERS, referrer.id), {
            referrals: [...currentReferrals, id],
            referrals_count: (referrer.referrals_count || 0) + 1,
            referral_limit_reached: (referrer.referrals_count || 0) + 1 >= MAX_REFERRALS,
          });
        }
      }
      
      console.log('Referral code updated:', refCode);
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
    const referrals = await FirebaseUser.getReferrals(id);
    for (const referral of referrals) {
      const referralRef = doc(db, COL_REFERRALS, referral.id);
      await deleteDoc(referralRef);
    }

    // Delete user document
    const ref = doc(db, COL_USERS, id);
    await deleteDoc(ref);
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

  async updateUpiQrUrl(id, url) {
    return this.updateUpiScreenshot(id, url);
  },

  async decrementReferralCount(userId) {
    const user = await this.findById(userId);
    if (!user) return;
    
    const currentCount = user.referrals_count || 0;
    const newCount = Math.max(0, currentCount - 1);
    
    const db = getDb();
    const ref = doc(db, COL_USERS, userId);
    await updateDoc(ref, {
      referrals_count: newCount,
      referral_limit_reached: false,
    });
  },

  async incrementReferralCountByCode(referralCode) {
    const referrer = await this.findByReferralCode(referralCode);
    if (!referrer) {
      console.log('Referrer not found for code:', referralCode);
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
    
    const db = getDb();
    const ref = doc(db, COL_USERS, userId);
    await updateDoc(ref, {
      referrals_count: newCount,
      referral_limit_reached: newCount >= MAX_REFERRALS,
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
      const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(users);
    });
  },

  subscribeToUser(userId, callback) {
    const db = getDb();
    const ref = doc(db, COL_USERS, userId);
    return onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        callback({ id: snap.id, ...snap.data() });
      } else {
        callback(null);
      }
    });
  },

  subscribeToPayments(callback) {
    const db = getDb();
    const colRef = collection(db, COL_USERS);
    const q = query(colRef);
    return onSnapshot(q, (snap) => {
      const users = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(u => u.upi_screenshot_url || u.utr_number);
      console.log('subscribeToPayments received:', users.length, 'users');
      callback(users);
    });
  },

  subscribeToUserReferrals(userId, callback) {
    const db = getDb();
    const colRef = collection(db, COL_REFERRALS);
    const q = query(colRef, where('user_id', '==', userId));
    return onSnapshot(q, (snap) => {
      const referrals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(referrals);
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
      const referrals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(referrals);
    });
  },
};

export const FirebaseStorage = {
  async uploadPaymentScreenshot(userId, file) {
    const storage = getStorageRef();
    const fileName = `${STORAGE_FOLDER}/${userId}/${Date.now()}_${file.name}`;
    const storageRef = ref(storage, fileName);
    
    console.log('🔄 Uploading to Storage:', fileName);
    
    await uploadBytes(storageRef, file);
    console.log('✅ Uploaded to Storage, getting URL...');
    
    let downloadUrl = await getDownloadURL(storageRef);
    console.log('📎 Got download URL:', downloadUrl);
    
    // Add alt=media for permanent access
    if (!downloadUrl.includes('alt=media')) {
      downloadUrl = downloadUrl + (downloadUrl.includes('?') ? '&' : '?') + 'alt=media';
      console.log('📎 Fixed URL with alt=media:', downloadUrl);
    }
    
    return { url: downloadUrl, path: fileName };
  },

  async deletePaymentScreenshot(url) {
    const storage = getStorageRef();
    try {
      const fileRef = ref(storage, url);
      await deleteObject(fileRef);
    } catch (e) {
      console.warn('Failed to delete file:', e);
    }
  },
};

export async function seedDefaultAdmin() {
  try {
    const db = getDb();
    const adminEmail = 'jagan@gmail.com';
    const adminCollection = collection(db, 'admins');
    const snap = await getDocs(query(adminCollection, where('email', '==', adminEmail)));
    
    if (snap.empty) {
      await addDoc(adminCollection, {
        email: adminEmail,
        password: 'hashed_jagan7523',
        createdAt: new Date().toISOString(),
      });
      console.log('✅ Default admin record created in Firestore');
    }
  } catch (e) {
    console.error('⚠️ seedDefaultAdmin:', e.message);
  }
}

export { generateReferralCode, MAX_REFERRALS, STORAGE_FOLDER };

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
    });
  },
};
