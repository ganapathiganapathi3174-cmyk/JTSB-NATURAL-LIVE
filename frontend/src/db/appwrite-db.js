/**
 * Appwrite Database Layer
 *
 * Architecture:
 *   - Appwrite Client SDK (anonymous session) for reads and own-data writes
 *   - Cloudflare Worker proxy for privileged operations
 *
 * SECURITY: No API key in frontend code.
 */

import { Client, Account, Databases, ID, Query, Permission, Role } from 'appwrite';

const ENDPOINT = import.meta.env.VITE_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const PROJECT_ID = import.meta.env.VITE_APPWRITE_PROJECT_ID || '';
const DATABASE_ID = import.meta.env.VITE_APPWRITE_DATABASE_ID || '';

let _client = null;
let _account = null;
let _databases = null;

function getClient() {
  if (!_client) {
    _client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID);
  }
  return _client;
}

function getAccount() {
  if (!_account) _account = new Account(getClient());
  return _account;
}

function getDatabases() {
  if (!_databases) _databases = new Databases(getClient());
  return _databases;
}

function isConfigured() {
  return !!(PROJECT_ID && DATABASE_ID);
}

async function initSession() {
  const acct = getAccount();
  try { await acct.get(); } catch { await acct.createAnonymousSession(); }
}

async function workerApi(endpoint, body) {
  const r = await fetch(`/api/appwrite/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `${endpoint} failed`);
  return data;
}

const AppwriteDB = {
  Auth: {
    async register(email, password) {
      await initSession();
      const acct = getAccount();
      const user = await acct.create(ID.unique(), email, password);
      return user;
    },

    async login(email, password) {
      const acct = getAccount();
      await acct.createEmailPasswordSession(email, password);
      return acct.get();
    },

    async logout() {
      const acct = getAccount();
      try { await acct.deleteSession('current'); } catch {}
    },

    onAuthChange(callback) {
      const acct = getAccount();
      const interval = setInterval(async () => {
        try {
          const user = await acct.get();
          callback(user);
        } catch {
          callback(null);
        }
      }, 2000);
      return () => clearInterval(interval);
    },

    getCurrentUser() {
      return getAccount().get();
    },
  },

  User: {
    async create(userData) {
      const db = getDatabases();
      const userId = userData.userId || userData.email?.replace(/[^a-zA-Z0-9]/g, '_');
      const doc = {
        userId,
        name: userData.name || '',
        email: userData.email || '',
        phone: userData.phone || '',
        password: userData.password || '',
        status: userData.status || 'pending',
        referral_code: userData.referral_code || '',
        referred_by: userData.referred_by || '',
        referrals_count: userData.referrals_count || 0,
        account_status: userData.account_status || 'pending',
        payment_status: userData.payment_status || 'unpaid',
        is_first_payment_done: userData.is_first_payment_done || false,
        created_at: new Date().toISOString(),
      };
      await db.createDocument(DATABASE_ID, 'users', userId, doc);
      return { id: userId, ...doc };
    },

    async findByEmail(email) {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'users', [
        Query.equal('email', email),
        Query.limit(1),
      ]);
      return result.documents.length > 0 ? result.documents[0] : null;
    },

    async findByPhone(phone) {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'users', [
        Query.equal('phone', phone),
        Query.limit(1),
      ]);
      return result.documents.length > 0 ? result.documents[0] : null;
    },

    async findById(id) {
      const db = getDatabases();
      try {
        return await db.getDocument(DATABASE_ID, 'users', id);
      } catch { return null; }
    },

    async findByReferralCode(code) {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'users', [
        Query.equal('referral_code', code),
        Query.limit(1),
      ]);
      return result.documents.length > 0 ? result.documents[0] : null;
    },

    async findByUtr(utr) {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'users', [
        Query.equal('utr_number', utr),
        Query.limit(1),
      ]);
      return result.documents.length > 0 ? result.documents[0] : null;
    },

    async getReferralsByReferrerCode(referralCode) {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'users', [
        Query.equal('referred_by', referralCode),
      ]);
      return result.documents;
    },

    async getAllReferralsByReferrerCode(referralCode) {
      return this.getReferralsByReferrerCode(referralCode);
    },

    async getReferredUsers(referralCode) {
      return this.getReferralsByReferrerCode(referralCode);
    },

    async getReferrerInfo(referralCode) {
      const user = await this.findByReferralCode(referralCode);
      return user ? { id: user.$id || user.userId, name: user.name, email: user.email, phone: user.phone } : null;
    },

    async countReferralsUsed(referralCode) {
      const users = await this.getReferralsByReferrerCode(referralCode);
      return users.length;
    },

    async updatePaymentStatus(id, payment_status) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', id, { payment_status });
    },

    async updatePassword(id, newPassword) {
      const db = getDatabases();
      const hash = await hashPassword(newPassword);
      await db.updateDocument(DATABASE_ID, 'users', id, { password: hash });
    },

    async setUserPassword(id, password) {
      return this.updatePassword(id, password);
    },

    async updateReferralCode(id, refCode) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', id, { referral_code: refCode });
    },

    async updatePayment(id, screenshotData, utr, userEnteredAmount, userEnteredDate, screenshotHash) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', id, {
        upi_screenshot_url: screenshotData || '',
        utr_number: utr || '',
        user_entered_amount: String(userEnteredAmount || ''),
        user_entered_date: userEnteredDate || '',
        screenshot_hash: screenshotHash || '',
        payment_status: 'pending',
      });
    },

    async updateUpiScreenshot(id, ...args) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', id, {
        upi_screenshot_url: args[0] || '',
        utr_number: args[1] || '',
      });
    },

    async addReferral(userId, referralData) {
      const db = getDatabases();
      const referralsDb = new Databases(getClient());
      const refId = `${userId}_${Date.now()}`;
      await db.createDocument(DATABASE_ID, 'referrals', refId, {
        user_id: userId,
        name: referralData.name || '',
        email: referralData.email || '',
        phone: referralData.phone || '',
        created_at: new Date().toISOString(),
      });
    },

    async removeReferral(userId, referralId) {
      const db = getDatabases();
      try { await db.deleteDocument(DATABASE_ID, 'referrals', referralId); } catch {}
    },

    async getReferrals(userId) {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'referrals', [
        Query.equal('user_id', userId),
      ]);
      return result.documents;
    },

    async deleteUser(id, { email, phone } = {}) {
      const db = getDatabases();
      await db.deleteDocument(DATABASE_ID, 'users', id);
    },

    async getAllUsers() {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'users');
      return result.documents;
    },

    async findAll() {
      return this.getAllUsers();
    },

    async count() {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'users', [Query.limit(1)]);
      return result.total;
    },

    async findByIdAndDelete(id) {
      return this.deleteUser(id);
    },

    async permanentDelete(id) {
      return this.deleteUser(id);
    },

    async updatePaymentStatusById(id, status) {
      return this.updatePaymentStatus(id, status);
    },

    async updateAdminStatus(id, adminStatus) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', id, { admin_status: adminStatus });
    },

    async approveReferral(referredUserId) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', referredUserId, {
        referral_active: true,
        status: 'approved',
      });
    },

    async updateUpiQrUrl(id, url) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', id, { upi_qr_url: url });
    },

    async decrementReferralCount(userId) {
      const user = await this.findById(userId);
      if (!user) return;
      const db = getDatabases();
      const count = Math.max(0, (user.referrals_count || 0) - 1);
      await db.updateDocument(DATABASE_ID, 'users', userId, { referrals_count: count });
    },

    async incrementReferralCountByCode(referralCode) {
      const user = await this.findByReferralCode(referralCode);
      if (!user) return;
      const db = getDatabases();
      const id = user.$id || user.userId;
      const count = (user.referrals_count || 0) + 1;
      await db.updateDocument(DATABASE_ID, 'users', id, { referrals_count: count });
    },

    async incrementReferralCount(userId) {
      const user = await this.findById(userId);
      if (!user) return;
      const db = getDatabases();
      const count = (user.referrals_count || 0) + 1;
      await db.updateDocument(DATABASE_ID, 'users', userId, { referrals_count: count });
    },

    async updateCyclePaymentStatus(id, status) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', id, { cycle_payment_status: status });
    },

    async updateCyclePayment(id, screenshotUrl, utr) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', id, {
        cycle_upi_screenshot_url: screenshotUrl || '',
        cycle_payment_utr: utr || '',
      });
    },

    async reactivate(id) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', id, {
        account_status: 'active',
        status: 'active',
      });
    },

    async approveCyclePayment(id) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', id, {
        cycle_payment_status: 'approved',
      });
    },

    async resetCyclePaymentAfterApproval(id) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', id, {
        cycle_payment_status: 'reset',
        cycle_upi_screenshot_url: '',
        cycle_payment_utr: '',
      });
    },

    async incrementReferralViewCount(id) {
      const user = await this.findById(id);
      if (!user) return;
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', id, {
        referral_view_count: (user.referral_view_count || 0) + 1,
      });
    },

    async resetReferralViewCount(id) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', id, { referral_view_count: 0 });
    },

    async getUsersWithPayment() {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'users', [
        Query.notEqual('payment_status', 'unpaid'),
      ]);
      return result.documents;
    },

    subscribeToUsers(callback) {
      return subscribeToCollection('users', callback);
    },
    subscribeToUser(userId, callback) {
      return subscribeToDocument('users', userId, callback);
    },
    subscribeToPayments(callback) { return this.subscribeToUsers(callback); },
    subscribeToUserReferrals(userId, callback) {
      return subscribeToCollectionQuery('referrals', [Query.equal('user_id', userId)], callback);
    },
    subscribeToCyclePayments(callback) { return this.subscribeToUsers(callback); },
    subscribeToReferralsByCode(referralCode, callback) {
      return subscribeToCollectionQuery('referrals', [Query.equal('referred_by', referralCode)], callback);
    },

    _isValidUtrFormat(utr) { return /^[A-Za-z0-9]{6,20}$/.test(utr); },
    _levenshtein(a, b) {
      const m = a.length, n = b.length;
      const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
      for (let i = 0; i <= m; i++) dp[i][0] = i;
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
          dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      return dp[m][n];
    },
    _normalizeUtr(val) { return String(val || '').replace(/\s+/g, '').toUpperCase(); },

    async findDuplicateUtr(utr, excludeUserId) {
      const db = getDatabases();
      const normalUtr = this._normalizeUtr(utr);
      const result = await db.listDocuments(DATABASE_ID, 'users', [
        Query.equal('utr_number', normalUtr),
        Query.limit(2),
      ]);
      const matches = result.documents.filter(d => (d.$id || d.userId) !== excludeUserId);
      return matches.length > 0 ? matches[0] : null;
    },

    async checkDuplicateUtrInTopups(transactionId, excludeTopupId) {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'topups', [
        Query.equal('transactionId', transactionId),
        Query.limit(2),
      ]);
      const matches = result.documents.filter(d => (d.$id || d.topupId) !== excludeTopupId);
      return matches.length > 0;
    },

    async findDuplicateTransactionId(transactionId, excludeUserId) {
      const exists = await this.checkDuplicateUtrInTopups(transactionId, null);
      return exists ? { id: 'exists' } : null;
    },

    async getAllUtrs() {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'users');
      return result.documents.map(d => d.utr_number).filter(Boolean);
    },

    async checkUtrExists(utr, excludeUserId) {
      return !!(await this.findDuplicateUtr(utr, excludeUserId));
    },

    async findDuplicateScreenshot(hash, excludeUserId) {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'users', [
        Query.equal('screenshot_hash', hash),
        Query.limit(2),
      ]);
      const matches = result.documents.filter(d => (d.$id || d.userId) !== excludeUserId);
      return matches.length > 0 ? matches[0] : null;
    },

    async storeValidationResult(id, { ocrData, validationStatus, autoApproved, autoRejected, failureReasons, duplicateUtrFlag, validationDetails, confidenceScore, confidenceLabel }) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', id, {
        validation_status: validationStatus || '',
        auto_approved: autoApproved || false,
        auto_rejected: autoRejected || false,
        failure_reasons: failureReasons || [],
        duplicate_utr_flag: duplicateUtrFlag || false,
        validation_details: validationDetails || {},
        confidence_score: confidenceScore || 0,
        confidence_label: confidenceLabel || '',
      });
    },

    async processAutoApproval(userId, { ocrData, userInputs }) {
      return this.storeValidationResult(userId, {
        ocrData,
        validationStatus: 'pending',
        autoApproved: false,
        autoRejected: false,
        failureReasons: [],
      });
    },

    async updateAdminApproval(userId, status, adminName) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', userId, {
        admin_approval_status: status,
        approved_by: adminName || '',
        approved_at: new Date().toISOString(),
      });
    },

    async forceApprovePayment(userId, adminName, reason) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', userId, {
        payment_status: 'approved',
        admin_approval_status: 'approved',
        approved_by: adminName || '',
        approved_at: new Date().toISOString(),
        manual_override: true,
        override_reason: reason || '',
      });
    },

    async processTopupAutoApproval(topupId, topupData, { ocrData }) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'topups', topupId, {
        validation_status: 'pending',
        ocr_data: ocrData || {},
      });
    },

    async activateUser(userId, adminName, reason) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', userId, {
        account_status: 'active',
        activated_by: adminName || '',
        activated_at: new Date().toISOString(),
        activation_reason: reason || '',
      });
    },

    async rejectUser(userId, adminName, reason) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', userId, {
        account_status: 'rejected',
        rejected_by: adminName || '',
        rejected_at: new Date().toISOString(),
        rejection_reason: reason || '',
      });
    },

    async updateTheme(id, themeColor) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', id, { theme_color: themeColor });
    },

    async updateProfilePicture(id, base64DataUrl) {
      await workerApi('update-profile-picture', { userId: id, base64DataUrl });
    },

    async removeProfilePicture(id) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', id, { profile_picture_url: '' });
    },

    async updateLastActive(userId) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', userId, {
        lastActiveAt: new Date().toISOString(),
      });
    },

    async createPaymentSession(userIdOrOpts, type, amount) {
      const { AppwritePayment } = await import('./appwrite-payment.js');
      return AppwritePayment.createPaymentSession(userIdOrOpts, type, amount);
    },
    async getVerificationCode(sessionId) {
      const { AppwritePayment } = await import('./appwrite-payment.js');
      return AppwritePayment.getVerificationCode(sessionId);
    },
    async generateVerificationCode(sessionId, razorpayOrderId, razorpayPaymentId) {
      const { AppwritePayment } = await import('./appwrite-payment.js');
      return AppwritePayment.generateVerificationCode(sessionId, razorpayOrderId, razorpayPaymentId);
    },
    async verifyPaymentCode(sessionId, code, userData) {
      const { AppwritePayment } = await import('./appwrite-payment.js');
      return AppwritePayment.verifyPaymentCode(sessionId, code, userData);
    },
    async ping() {
      const { AppwritePayment } = await import('./appwrite-payment.js');
      return AppwritePayment.ping();
    },
  },

  Storage: {
    async uploadPaymentScreenshot(userId, file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    },

    async deletePaymentScreenshot(url) {},
    async compressImage(dataUrl, maxWidth = 800, quality = 0.7) { return dataUrl; },

    async uploadTopupScreenshot(userId, file) {
      const reader = new FileReader();
      return new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    },

    async uploadCyclePaymentScreenshot(userId, file) {
      const reader = new FileReader();
      return new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    },
  },

  Topup: {
    async create(userId, { amount, transactionId, screenshotData, sessionId, verifiedViaCode }) {
      const db = getDatabases();
      const topupId = `TOPUP_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await db.createDocument(DATABASE_ID, 'topups', topupId, {
        userId,
        amount: String(amount || 120),
        transactionId: transactionId || '',
        screenshotData: screenshotData || '',
        sessionId: sessionId || '',
        verifiedViaCode: verifiedViaCode || false,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      return { id: topupId, userId, amount, status: 'pending' };
    },

    async findByUserId(userId) {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'topups', [
        Query.equal('userId', userId),
        Query.orderDesc('createdAt'),
      ]);
      return result.documents;
    },

    async findAll() {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'topups', [
        Query.orderDesc('createdAt'),
      ]);
      return result.documents;
    },

    async findById(id) {
      const db = getDatabases();
      try { return await db.getDocument(DATABASE_ID, 'topups', id); } catch { return null; }
    },

    async updateStatus(id, status, adminId) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'topups', id, {
        status,
        adminId: adminId || '',
        approvedAt: status === 'approved' ? new Date().toISOString() : undefined,
        rejectedAt: status === 'rejected' ? new Date().toISOString() : undefined,
      });
    },

    async delete(id) {
      const db = getDatabases();
      await db.deleteDocument(DATABASE_ID, 'topups', id);
    },

    async getSponsorsAwaitingCredit() {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'users', [
        Query.equal('sponsor_awaiting_credit', true),
      ]);
      return result.documents;
    },

    async creditSponsor(userId, amount, adminId) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', userId, {
        sponsor_credited: true,
        sponsor_credited_amount: String(amount || 0),
        sponsor_credited_at: new Date().toISOString(),
        sponsor_credited_by: adminId || '',
        sponsor_awaiting_credit: false,
      });
    },

    async reactivateSponsor(userId) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'users', userId, {
        sponsor_awaiting_credit: false,
        sponsor_credited: false,
      });
    },

    subscribeToTopups(callback) {
      return subscribeToCollection('topups', callback);
    },

    subscribeToUserTopups(userId, callback) {
      return subscribeToCollectionQuery('topups', [Query.equal('userId', userId)], callback);
    },
  },

  TopupReferral: {
    async processTopupReferral(topup) {
      const db = getDatabases();
      const incomeId = `INC_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await db.createDocument(DATABASE_ID, 'topup_income', incomeId, {
        userId: topup.referred_by || '',
        fromUserId: topup.userId || '',
        topupId: topup.$id || topup.id || '',
        amount: String(Number(topup.amount || 0) * 0.2),
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
    },

    async claimTopupIncome(incomeId) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'topup_income', incomeId, {
        status: 'claimed',
        claimedAt: new Date().toISOString(),
      });
    },

    async getIncomeByUserId(userId) {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'topup_income', [
        Query.equal('userId', userId),
        Query.orderDesc('createdAt'),
      ]);
      return result.documents;
    },

    async getTotalIncomeByUserId(userId) {
      const incomes = await this.getIncomeByUserId(userId);
      return incomes.reduce((sum, inc) => sum + Number(inc.amount || 0), 0);
    },

    subscribeToIncome(userId, callback) {
      return subscribeToCollectionQuery('topup_income', [Query.equal('userId', userId)], callback);
    },

    async getAllIncome() {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'topup_income', [
        Query.orderDesc('createdAt'),
      ]);
      return result.documents;
    },
  },

  ReferralAccess: {
    async check(userId) {
      const user = await AppwriteDB.User.findById(userId);
      if (!user) return { canRefer: false };
      const max = 2;
      const referrals = await AppwriteDB.User.getReferrals(userId);
      const referredUsers = await AppwriteDB.User.getReferralsByReferrerCode(user.referral_code || '');
      const totalUsed = referrals.length + referredUsers.length;
      return {
        canRefer: totalUsed < max,
        usedCount: totalUsed,
        maxCount: max,
        remaining: max - totalUsed,
      };
    },

    async reactivate(id) {
      return AppwriteDB.User.reactivate(id);
    },
  },

  NewReferral: {
    async create(referralData) {
      const db = getDatabases();
      const refId = `REF_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await db.createDocument(DATABASE_ID, 'referrals', refId, {
        user_id: referralData.user_id || '',
        name: referralData.name || '',
        email: referralData.email || '',
        phone: referralData.phone || '',
        created_at: new Date().toISOString(),
      });
      return { id: refId, ...referralData };
    },

    async findByUserId(userId) {
      return AppwriteDB.User.getReferrals(userId);
    },

    async findByEmail(email) {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'referrals', [
        Query.equal('email', email),
        Query.limit(1),
      ]);
      return result.documents.length > 0 ? result.documents[0] : null;
    },

    async delete(id) {
      const db = getDatabases();
      await db.deleteDocument(DATABASE_ID, 'referrals', id);
    },

    async deleteByUserId(userId) {
      const referrals = await this.findByUserId(userId);
      const db = getDatabases();
      for (const ref of referrals) {
        try { await db.deleteDocument(DATABASE_ID, 'referrals', ref.$id || ref.id); } catch {}
      }
    },

    subscribeToUserReferrals(userId, callback) {
      return subscribeToCollectionQuery('referrals', [Query.equal('user_id', userId)], callback);
    },
  },

  Notification: {
    async send({ receiverId, receiverName, title, message, type, senderId, senderName }) {
      const db = getDatabases();
      const notifId = `NOTIF_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await db.createDocument(DATABASE_ID, 'notifications', notifId, {
        senderId: senderId || '',
        receiverId: receiverId || '',
        receiverName: receiverName || '',
        senderName: senderName || '',
        title: title || '',
        message: message || '',
        type: type || 'info',
        status: 'unread',
        createdAt: new Date().toISOString(),
      });
      return { id: notifId };
    },

    async getByUser(userId) {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'notifications', [
        Query.equal('receiverId', userId),
        Query.orderDesc('createdAt'),
      ]);
      return result.documents;
    },

    async getAll(limitCount = 100) {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'notifications', [
        Query.orderDesc('createdAt'),
        Query.limit(limitCount),
      ]);
      return result.documents;
    },

    async markAsRead(notificationId) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'notifications', notificationId, {
        status: 'read',
        readAt: new Date().toISOString(),
      });
    },

    async markAllAsRead(userId) {
      const unread = await this.getByUser(userId);
      const db = getDatabases();
      for (const n of unread.filter(n => n.status === 'unread')) {
        try { await db.updateDocument(DATABASE_ID, 'notifications', n.$id, { status: 'read', readAt: new Date().toISOString() }); } catch {}
      }
    },

    async getUnreadCount(userId) {
      const all = await this.getByUser(userId);
      return all.filter(n => n.status === 'unread').length;
    },

    subscribeToUserNotifications(userId, callback) {
      return subscribeToCollectionQuery('notifications', [Query.equal('receiverId', userId)], callback);
    },

    subscribeToAllNotifications(callback) {
      return subscribeToCollection('notifications', callback);
    },

    async deleteNotification(notificationId) {
      const db = getDatabases();
      await db.deleteDocument(DATABASE_ID, 'notifications', notificationId);
    },
  },

  Message: null,
  Chat: {
    getConvoId(userId) { return `convo_admin_${userId}`; },

    async ensureConvo(userId, userName, userEmail) {
      const db = getDatabases();
      const convoId = this.getConvoId(userId);
      try {
        await db.getDocument(DATABASE_ID, 'chat_conversations', convoId);
      } catch {
        await db.createDocument(DATABASE_ID, 'chat_conversations', convoId, {
          convoId,
          userId: userId || '',
          userName: userName || '',
          userEmail: userEmail || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastMessage: '',
          lastSenderId: '',
        });
      }
      return convoId;
    },

    async send({ senderId, receiverId, messageText }) {
      const db = getDatabases();
      const msgId = `MSG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const convoId = this.getConvoId(senderId === 'admin' ? receiverId : senderId);
      await db.createDocument(DATABASE_ID, 'chat_messages', msgId, {
        convoId,
        senderId: senderId || '',
        receiverId: receiverId || '',
        messageText: messageText || '',
        createdAt: new Date().toISOString(),
        isRead: false,
        isDelivered: false,
      });
      await db.updateDocument(DATABASE_ID, 'chat_conversations', convoId, {
        updatedAt: new Date().toISOString(),
        lastMessage: messageText || '',
        lastSenderId: senderId || '',
      });
      return { id: msgId };
    },

    async getMessages(convoId) {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'chat_messages', [
        Query.equal('convoId', convoId),
        Query.orderAsc('createdAt'),
      ]);
      return result.documents;
    },

    async getConvosForAdmin() {
      const db = getDatabases();
      const result = await db.listDocuments(DATABASE_ID, 'chat_conversations', [
        Query.orderDesc('updatedAt'),
      ]);
      return result.documents;
    },

    async getConvoForUser(userId) {
      const convoId = this.getConvoId(userId);
      try {
        await db.getDocument(DATABASE_ID, 'chat_conversations', convoId);
      } catch {
        return null;
      }
      return { convoId, userId };
    },

    async markAsRead(messageId) {
      const db = getDatabases();
      await db.updateDocument(DATABASE_ID, 'chat_messages', messageId, { isRead: true });
    },

    async markConvoAsRead(convoId, userId) {
      const db = getDatabases();
      const messages = await this.getMessages(convoId);
      for (const msg of messages) {
        if (msg.senderId !== userId && !msg.isRead) {
          try { await db.updateDocument(DATABASE_ID, 'chat_messages', msg.$id, { isRead: true }); } catch {}
        }
      }
    },

    async getUnreadCount(userId) {
      const db = getDatabases();
      const convoId = this.getConvoId(userId);
      const messages = await this.getMessages(convoId);
      return messages.filter(m => m.senderId !== userId && !m.isRead).length;
    },

    subscribeToMessages(convoId, callback) {
      return subscribeToCollectionQuery('chat_messages', [
        Query.equal('convoId', convoId),
        Query.orderAsc('createdAt'),
      ], callback);
    },

    subscribeToAdminConvos(callback) {
      return subscribeToCollection('chat_conversations', callback);
    },

    subscribeToUserConvo(userId, callback) {
      const convoId = this.getConvoId(userId);
      return subscribeToCollectionQuery('chat_messages', [
        Query.equal('convoId', convoId),
        Query.orderAsc('createdAt'),
      ], callback);
    },

    async deleteUserChatData(userId) {
      const db = getDatabases();
      const convoId = this.getConvoId(userId);
      const messages = await this.getMessages(convoId);
      for (const msg of messages) {
        try { await db.deleteDocument(DATABASE_ID, 'chat_messages', msg.$id); } catch {}
      }
      try { await db.deleteDocument(DATABASE_ID, 'chat_conversations', convoId); } catch {}
    },

    async cleanupOrphanedConvos() {
      const db = getDatabases();
      const convos = await this.getConvosForAdmin();
      let deleted = 0;
      for (const c of convos) {
        try {
          await db.getDocument(DATABASE_ID, 'users', c.userId);
        } catch {
          await this.deleteUserChatData(c.userId);
          deleted++;
        }
      }
      return deleted;
    },
  },
};

// Aliases
AppwriteDB.Message = AppwriteDB.Notification;

// ---- Realtime Subscriptions ----
const _activeSubs = new Map();

function subscribeToCollection(collectionId, callback) {
  const client = getClient();
  const channel = `databases.${DATABASE_ID}.collections.${collectionId}.documents`;
  const sub = client.subscribe(channel, response => {
    const event = response.events?.[0] || '';
    const payload = response.payload;
    if (event.includes('.create') || event.includes('.update') || event.includes('.delete')) {
      callback({ type: event.split('.')[1], payload, event });
    }
  });
  return () => sub();
}

function subscribeToCollectionQuery(collectionId, queries, callback) {
  const client = getClient();
  const channel = `databases.${DATABASE_ID}.collections.${collectionId}.documents`;
  const sub = client.subscribe(channel, response => {
    const payload = response.payload;
    const matchesQuery = queries.every(q => {
      const attr = q.attribute;
      const val = q.value;
      return payload[attr] === val;
    });
    if (matchesQuery) {
      const event = response.events?.[0] || '';
      callback({ type: event.split('.')[1], payload, event });
    }
  });
  return () => sub();
}

function subscribeToDocument(collectionId, documentId, callback) {
  const client = getClient();
  const channel = `databases.${DATABASE_ID}.collections.${collectionId}.documents.${documentId}`;
  const sub = client.subscribe(channel, response => {
    const event = response.events?.[0] || '';
    callback({ type: event.split('.')[1], payload: response.payload, event });
  });
  return () => sub();
}

// ---- Standalone Functions (matching firebase-db.js) ----

function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 8; i++) code += chars.charAt(bytes[i] % chars.length);
  return code;
}

async function hashPassword(password) {
  if (!password) return '';
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
      const char = password.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }
}

const _hashCache = new Map();

async function hashPasswordCached(password) {
  if (_hashCache.has(password)) return _hashCache.get(password);
  const hash = await hashPassword(password);
  _hashCache.set(password, hash);
  return hash;
}

async function comparePassword(plaintext, storedHash) {
  if (!plaintext || !storedHash) return false;
  const hash = await hashPassword(plaintext);
  return hash === storedHash;
}

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

async function seedDefaultAdmin() {
  try { await initSession(); } catch {}
}

async function checkReferralLinkExpiry(referralCode) {
  const user = await AppwriteDB.User.findByReferralCode(referralCode);
  if (!user) return { expired: true };
  const limit = 7;
  const createdAt = user.referral_created_at || user.created_at;
  if (!createdAt) return { expired: false };
  const elapsed = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  return { expired: elapsed > limit, daysLeft: Math.max(0, limit - Math.floor(elapsed)) };
}

const REFERRAL_EXPIRY_DAYS = 7;
const STORAGE_FOLDER = 'new_payments';
const MAX_REFERRALS = 2;

export {
  AppwriteDB,
  generateReferralCode,
  hashPassword,
  hashPasswordCached,
  comparePassword,
  hashData,
  seedDefaultAdmin,
  checkReferralLinkExpiry,
  MAX_REFERRALS,
  REFERRAL_EXPIRY_DAYS,
  STORAGE_FOLDER,
};
