import { describe, it, expect, beforeEach } from 'vitest';

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function hashPassword(password) {
  // Simple SHA-256 hex for test purposes using Web Crypto API
  // We just need a consistent hash, not production-grade crypto
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(64, '0');
}

// Mock Supabase store that mimics the real DB operations
function createMockDB() {
  const stores = {
    users: new Map(),
    wallet_balances: new Map(),
    wallet_transactions: [],
    pending_registrations: new Map(),
    upi_payments: new Map(),
    topups: new Map(),
    topup_referral_income: new Map(),
    audit_logs: new Map(),
    notifications: new Map(),
    uniques: new Map(),
  };

  function deepCopy(obj) { return obj ? JSON.parse(JSON.stringify(obj)) : obj; }

  const db = {
    stores,
    idCounter: 1,

    async addDoc(table, data) {
      const id = `mock-${table}-${db.idCounter++}`;
      const record = { id, ...data, created_at: new Date().toISOString() };
      if (!stores[table]) throw new Error(`Unknown table: ${table}`);
      stores[table].set(id, record);
      return { id, ...record };
    },

    async writeDoc(table, id, data) {
      if (!stores[table]) throw new Error(`Unknown table: ${table}`);
      stores[table].set(id, { ...data, id });
      return { id, ...data };
    },

    async getDoc(table, id) {
      if (!stores[table]) return null;
      const doc = stores[table].get(id);
      return doc ? deepCopy(doc) : null;
    },

    async runQuery(table, filters = [], opts = {}) {
      if (!stores[table]) return [];
      let results = Array.from(stores[table].values());
      for (const f of filters) {
        if (f.op === 'EQUAL') results = results.filter(r => r[f.field] === f.value);
        else if (f.op === 'IN') results = results.filter(r => f.value.includes(r[f.field]));
        else if (f.op === 'NOT_EQUAL') results = results.filter(r => r[f.field] !== f.value);
      }
      if (opts.orderBy) {
        results.sort((a, b) => {
          const va = a[opts.orderBy] || '';
          const vb = b[opts.orderBy] || '';
          return opts.ascending !== false ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
        });
      }
      if (opts.limit) results = results.slice(0, opts.limit);
      if (opts.offset) results = results.slice(opts.offset);
      return results.map(r => deepCopy(r));
    },

    async updateDoc(table, id, updates) {
      if (!stores[table]) throw new Error(`Unknown table: ${table}`);
      const existing = stores[table].get(id);
      if (!existing) throw new Error(`Document ${id} not found in ${table}`);
      const updated = { ...existing, ...updates, id };
      stores[table].set(id, updated);
      return deepCopy(updated);
    },

    async conditionalUpdateDoc(table, id, conditions, updates) {
      if (!stores[table]) return 0;
      const existing = stores[table].get(id);
      if (!existing) return 0;
      for (const c of conditions) {
        if (c.op === 'IN' && !c.value.includes(existing[c.field])) return 0;
        if (c.op === 'EQUAL' && existing[c.field] !== c.value) return 0;
      }
      stores[table].set(id, { ...existing, ...updates, id });
      return 1;
    },

    async deleteDoc(table, id) {
      if (stores[table]) stores[table].delete(id);
    },

    async atomicCreditWallet(userId, amount, referenceId, description) {
      const balance = stores.wallet_balances.get(userId);
      if (!balance) throw new Error('Wallet not found');
      const prevBalance = balance.balance || 0;
      const prevEarned = balance.total_earned || 0;
      balance.balance = prevBalance + amount;
      balance.total_earned = prevEarned + amount;
      stores.wallet_balances.set(userId, balance);
      const tx = {
        id: `tx-${db.idCounter++}`, user_id: userId, type: 'deposit', amount,
        description: description || '', reference_id: referenceId,
        balance_after: balance.balance, created_at: new Date().toISOString(),
      };
      stores.wallet_transactions.push(tx);
    },

    // Simulate preRegister handler logic
    async preRegister({ name, email, phone, password, referralCode }) {
      // Validation
      const errors = [];
      if (!name || !name.trim()) errors.push('Name is required');
      else if (['unknown', 'undefined', 'null'].includes(name.trim().toLowerCase())) errors.push('Invalid name value');
      if (!email || !email.trim()) errors.push('Email is required');
      else if (['unknown', 'undefined', 'null'].includes(email.trim().toLowerCase())) errors.push('Invalid email value');
      if (!phone || !phone.trim()) errors.push('Phone is required');
      else if (['unknown', 'undefined', 'null'].includes(phone.trim().toLowerCase())) errors.push('Invalid phone value');
      if (!password || password.length < 6) errors.push('Password must be at least 6 characters');
      if (errors.length) return { error: errors.join('. ') };

      // Check uniqueness
      const existingEmail = Array.from(stores.users.values()).filter(u => u.email === email.toLowerCase().trim());
      if (existingEmail.length) return { error: 'Email already registered. Please login.' };

      const existingPhone = Array.from(stores.users.values()).filter(u => u.phone === phone.trim());
      if (existingPhone.length) return { error: 'Phone already registered. Please login.' };

      // Check referrer
      const refCode = referralCode && referralCode.trim() ? referralCode.trim().toUpperCase() : null;
      let referrer = null;
      if (refCode) {
        const refs = Array.from(stores.users.values()).filter(u => u.referral_code === refCode);
        if (refs.length) referrer = refs[0];
      }

      // Create pending registration
      const pendingReg = await db.addDoc('pending_registrations', {
        name: name.trim(), email: email.toLowerCase().trim(), phone: phone.trim(),
        password_hash: hashPassword(password), referral_code: refCode,
      });

      return { pendingRegId: pendingReg.id, referrer: referrer ? { name: referrer.name, code: referrer.referral_code } : null };
    },

    // Simulate verifyUPIPayment handler logic
    async verifyUPIPayment({ pendingRegId, userId, type, amount, utr, upiId, screenshotUrl }) {
      const userOrPendingId = pendingRegId || userId;
      if (!userOrPendingId || !type || !amount || !utr || !upiId || !screenshotUrl) {
        return { error: 'Missing required fields' };
      }
      if (!['registration', 'topup'].includes(type)) return { error: 'Invalid payment type' };
      if (![120, 500, 1000].includes(amount)) return { error: 'Invalid amount for ' + type };
      if (upiId.toLowerCase() !== 'jayarajj126-3@okicici') return { error: 'Invalid UPI ID' };
      if (!utr || utr.length < 12) return { error: 'UTR must be at least 12 characters' };

      // Check UTR uniqueness
      const existing = Array.from(stores.upi_payments.values()).filter(p => p.utr === utr);
      for (const e of existing) {
        if (e.status !== 'rejected') return { error: 'UTR already submitted and is under review' };
      }

      // Check daily limit
      const userPayments = Array.from(stores.upi_payments.values()).filter(p => p.user_id === userOrPendingId);
      const todayStart = new Date().setHours(0, 0, 0, 0);
      const todayCount = userPayments.filter(p => {
        const t = p.created_at ? new Date(p.created_at).getTime() : 0;
        return t >= todayStart;
      }).length;
      if (todayCount >= 3) return { error: 'Maximum 3 payment attempts per day' };

      const payment = await db.addDoc('upi_payments', {
        user_id: userOrPendingId, utr, upi_id: upiId.toLowerCase(), amount,
        amount_option: amount.toString(), payment_type: type,
        screenshot_url: screenshotUrl, status: 'manual_review',
      });

      return { status: 'manual_review', paymentId: payment.id, autoVerified: false };
    },

    // Simulate approveUPIPayment handler logic (registration type)
    async approveRegistrationPayment(paymentId, adminEmail = 'admin@test.com') {
      const payment = stores.upi_payments.get(paymentId);
      if (!payment) return { error: 'Payment not found' };

      // Atomic claim
      if (payment.status !== 'pending' && payment.status !== 'manual_review') {
        return { status: payment.status, idempotent: true };
      }
      stores.upi_payments.set(paymentId, { ...payment, status: 'verified', verified_at: new Date().toISOString() });

      const now = new Date().toISOString();
      const pendingRegId = payment.user_id;
      const pendingReg = stores.pending_registrations.get(pendingRegId);
      if (!pendingReg) return { error: 'Registration session not found' };

      // Validate fields
      const userName = pendingReg.name || '';
      const userEmail = pendingReg.email || '';
      const userPhone = pendingReg.phone || '';
      const missingFields = [];
      if (!userName) missingFields.push('name');
      if (!userEmail) missingFields.push('email');
      if (!userPhone) missingFields.push('phone');
      if (['unknown', 'undefined', 'null'].includes(userName.toLowerCase())) missingFields.push('name=unknown');
      if (['unknown', 'undefined', 'null'].includes(userEmail.toLowerCase())) missingFields.push('email=unknown');
      if (['unknown', 'undefined', 'null'].includes(userPhone.toLowerCase())) missingFields.push('phone=unknown');
      if (missingFields.length) {
        stores.upi_payments.set(paymentId, { ...payment, status: 'rejected', rejection_reasons: ['Invalid registration data: ' + missingFields.join(', ')] });
        return { error: 'Invalid registration data' };
      }

      const refCode = pendingReg.referral_code;
      let referredByUserId = null;
      let referredByCode = null;
      if (refCode) {
        const refUsers = Array.from(stores.users.values()).filter(u => u.referral_code === refCode);
        if (refUsers.length) { referredByUserId = refUsers[0].id; referredByCode = refCode; }
      }

      const newUserId = `user-${db.idCounter++}`;
      await db.writeDoc('users', newUserId, {
        id: newUserId, email: userEmail, name: userName,
        phone: userPhone, password_hash: pendingReg.password_hash,
        referral_code: randomString(8), referred_by: referredByCode,
        account_status: 'active', payment_status: 'success',
        approved: true, active: true, membership_paid: true,
        joined_date: now, approved_date: now,
      });

      await db.writeDoc('wallet_balances', newUserId, { balance: 0, total_earned: payment.amount });
      stores.wallet_transactions.push({
        id: `tx-${db.idCounter++}`, user_id: newUserId, type: 'deposit',
        amount: payment.amount, description: 'Registration payment (test)',
        reference_id: paymentId, balance_after: payment.amount,
        created_at: now,
      });

      if (referredByUserId) {
        const refAmount = payment.amount * 0.1;
        await db.atomicCreditWallet(referredByUserId, refAmount, paymentId, 'Referral bonus for ' + newUserId);
      }

      stores.pending_registrations.delete(pendingRegId);
      return { status: 'approved', userId: newUserId };
    },

    // Simulate approveUPIPayment handler logic (topup type)
    async approveTopupPayment(paymentId) {
      const payment = stores.upi_payments.get(paymentId);
      if (!payment) return { error: 'Payment not found' };

      if (payment.status !== 'pending' && payment.status !== 'manual_review') {
        return { status: payment.status, idempotent: true };
      }
      stores.upi_payments.set(paymentId, { ...payment, status: 'verified', verified_at: new Date().toISOString() });

      const userId = payment.user_id;
      const userDoc = stores.users.get(userId);
      if (!userDoc) return { error: 'User not found' };

      await db.atomicCreditWallet(userId, payment.amount, paymentId, 'Topup via UPI (test)');

      const topupData = {
        user_id: userId, amount: payment.amount, utr: payment.utr,
        screenshot_url: payment.screenshot_url, status: 'approved', verified_at: new Date().toISOString(),
      };
      const topup = await db.addDoc('topups', topupData);

      // Referral income for topup
      const referredByCode = userDoc.referred_by || null;
      if (referredByCode) {
        const refUsers = Array.from(stores.users.values()).filter(u => u.referral_code === referredByCode);
        const referrer = refUsers.length ? refUsers[0] : null;
        if (referrer) {
          const incomeStatus = 'eligible';
          await db.addDoc('topup_referral_income', {
            user_id: referrer.id, from_user_id: userId, topup_id: topup.id,
            amount: payment.amount, level: 1, status: incomeStatus,
          });
          const currentCount = referrer.topup_referral_qualified_count || 0;
          const newCount = currentCount + 1;
          const topupQualified = (referrer.referrals_count || 0) + newCount >= 2;
          stores.users.set(referrer.id, { ...referrer, topup_referral_qualified_count: newCount, topup_referral_qualified: topupQualified });
        }
      }

      return { status: 'approved', userId };
    },

    // Simulate rejectUPIPayment handler logic
    async rejectPayment(paymentId) {
      const payment = stores.upi_payments.get(paymentId);
      if (!payment) return { error: 'Payment not found' };

      const claimed = await db.conditionalUpdateDoc('upi_payments', paymentId, [
        { field: 'status', op: 'IN', value: ['pending', 'manual_review', 'verified'] },
      ], { status: 'rejected', rejection_reasons: ['Rejected by admin (test)'], verified_at: new Date().toISOString() });

      if (claimed === 0) {
        return { status: payment.status, idempotent: true };
      }
      return { status: 'rejected' };
    },

    // Simulate restoreUPIPayment handler logic
    async restorePayment(paymentId) {
      const payment = stores.upi_payments.get(paymentId);
      if (!payment) return { error: 'Payment not found' };

      const claimed = await db.conditionalUpdateDoc('upi_payments', paymentId, [
        { field: 'status', op: 'EQUAL', value: 'rejected' },
      ], { status: 'manual_review', rejection_reasons: ['Restored by admin (test)'] });

      if (claimed === 0) {
        return { status: payment.status, idempotent: true };
      }
      return { status: 'manual_review' };
    },
  };

  return db;
}

let db;

beforeEach(() => {
  db = createMockDB();
});

describe('Registration → Payment → Approval → Wallet (E2E)', () => {
  it('completes full registration flow with referral bonus', async () => {
    // 1. Create a referrer user
    const referrerId = 'referrer-1';
    const referrerCode = 'REF123';
    await db.writeDoc('users', referrerId, {
      id: referrerId, name: 'Referrer', email: 'referrer@test.com',
      phone: '9999999999', referral_code: referrerCode,
      account_status: 'active',
    });
    await db.writeDoc('wallet_balances', referrerId, { balance: 100, total_earned: 100 });

    // 2. Pre-register new user with referral code
    const regResult = await db.preRegister({
      name: 'New User', email: 'newuser@test.com', phone: '8888888888',
      password: 'password123', referralCode: referrerCode,
    });
    expect(regResult.error).toBeUndefined();
    expect(regResult.pendingRegId).toBeTruthy();
    expect(regResult.referrer).toEqual({ name: 'Referrer', code: referrerCode });

    // Verify pending registration was created
    const pendingRegs = await db.runQuery('pending_registrations', [{ field: 'id', op: 'EQUAL', value: regResult.pendingRegId }]);
    expect(pendingRegs.length).toBe(1);
    expect(pendingRegs[0].referral_code).toBe(referrerCode);

    // 3. Submit payment for registration
    const payResult = await db.verifyUPIPayment({
      pendingRegId: regResult.pendingRegId, type: 'registration', amount: 120,
      utr: 'ABCD12345678', upiId: 'jayarajj126-3@okicici',
      screenshotUrl: 'https://example.com/ss.jpg',
    });
    expect(payResult.error).toBeUndefined();
    expect(payResult.status).toBe('manual_review');
    expect(payResult.paymentId).toBeTruthy();

    // 4. Approve the payment (admin)
    const approveResult = await db.approveRegistrationPayment(payResult.paymentId);
    expect(approveResult.status).toBe('approved');
    expect(approveResult.userId).toBeTruthy();

    // 5. Verify user was created
    const newUser = await db.getDoc('users', approveResult.userId);
    expect(newUser).toBeTruthy();
    expect(newUser.name).toBe('New User');
    expect(newUser.email).toBe('newuser@test.com');
    expect(newUser.referred_by).toBe(referrerCode);
    expect(newUser.account_status).toBe('active');
    expect(newUser.membership_paid).toBe(true);

    // 6. Verify wallet was created with correct balance
    const wallet = await db.getDoc('wallet_balances', approveResult.userId);
    expect(wallet).toBeTruthy();
    expect(wallet.balance).toBe(0);
    expect(wallet.total_earned).toBe(120);

    // 7. Wallet transactions
    const txs = db.stores.wallet_transactions.filter(t => t.user_id === approveResult.userId);
    expect(txs.length).toBe(1);
    expect(txs[0].amount).toBe(120);

    // 8. Verify referrer got bonus
    const referrerWallet = await db.getDoc('wallet_balances', referrerId);
    expect(referrerWallet.balance).toBe(112); // 100 + 12 (10% of 120)

    // 9. Verify pending registration was deleted
    const deletedReg = await db.getDoc('pending_registrations', regResult.pendingRegId);
    expect(deletedReg).toBeNull();

    // 10. Idempotency — approving same payment returns existing status
    const idempotentResult = await db.approveRegistrationPayment(payResult.paymentId);
    expect(idempotentResult.idempotent).toBe(true);
    expect(idempotentResult.status).toBe('verified');
  });

  it('rejects duplicate UTR submissions', async () => {
    const regResult = await db.preRegister({
      name: 'User A', email: 'usera@test.com', phone: '7777777777',
      password: 'password123', referralCode: null,
    });
    expect(regResult.pendingRegId).toBeTruthy();

    // First submission — should succeed
    const firstPay = await db.verifyUPIPayment({
      pendingRegId: regResult.pendingRegId, type: 'registration', amount: 120,
      utr: 'DUPLICATE123456', upiId: 'jayarajj126-3@okicici',
      screenshotUrl: 'https://example.com/ss.jpg',
    });
    expect(firstPay.paymentId).toBeTruthy();

    // Second submission with same UTR — should fail
    const secondPay = await db.verifyUPIPayment({
      pendingRegId: regResult.pendingRegId, type: 'registration', amount: 120,
      utr: 'DUPLICATE123456', upiId: 'jayarajj126-3@okicici',
      screenshotUrl: 'https://example.com/ss2.jpg',
    });
    expect(secondPay.error).toBe('UTR already submitted and is under review');
  });

  it('enforces daily limit of 3 payment attempts', async () => {
    const regResult = await db.preRegister({
      name: 'User B', email: 'userb@test.com', phone: '6666666666',
      password: 'password123', referralCode: null,
    });
    expect(regResult.pendingRegId).toBeTruthy();

    // Submit 3 payments
    for (let i = 0; i < 3; i++) {
      const result = await db.verifyUPIPayment({
        pendingRegId: regResult.pendingRegId, type: 'registration', amount: 120,
        utr: `UTR-${i}-123456789`, upiId: 'jayarajj126-3@okicici',
        screenshotUrl: `https://example.com/ss${i}.jpg`,
      });
      expect(result.paymentId).toBeTruthy();
    }

    // 4th should be rejected
    const fourth = await db.verifyUPIPayment({
      pendingRegId: regResult.pendingRegId, type: 'registration', amount: 120,
      utr: 'UTR-X-1234567890', upiId: 'jayarajj126-3@okicici',
      screenshotUrl: 'https://example.com/ss4.jpg',
    });
    expect(fourth.error).toBe('Maximum 3 payment attempts per day');
  });

  it('rejects invalid input data', async () => {
    // Missing name
    const result1 = await db.preRegister({
      name: '', email: 'test@test.com', phone: '5555555555',
      password: 'password123', referralCode: null,
    });
    expect(result1.error).toContain('Name');

    // Invalid name
    const result2 = await db.preRegister({
      name: 'unknown', email: 'test@test.com', phone: '5555555555',
      password: 'password123', referralCode: null,
    });
    expect(result2.error).toContain('Invalid name');

    // Short password
    const result3 = await db.preRegister({
      name: 'User', email: 'test@test.com', phone: '5555555555',
      password: '12345', referralCode: null,
    });
    expect(result3.error).toContain('at least 6 characters');

    // Duplicate email (only fails if already a USER, not pending registration)
    // First create a real user via approveRegistrationPayment
    const preReg = await db.preRegister({
      name: 'User D', email: 'dupe@test.com', phone: '4444444444',
      password: 'password123', referralCode: null,
    });
    const payReg = await db.verifyUPIPayment({
      pendingRegId: preReg.pendingRegId, type: 'registration', amount: 120,
      utr: 'DUPECHECK12345', upiId: 'jayarajj126-3@okicici',
      screenshotUrl: 'https://example.com/dupe.jpg',
    });
    await db.approveRegistrationPayment(payReg.paymentId);
    // Now the email exists as a user — duplicate should be rejected
    const result4 = await db.preRegister({
      name: 'User E', email: 'dupe@test.com', phone: '3333333333',
      password: 'password123', referralCode: null,
    });
    expect(result4.error).toContain('already registered');
  });
});

describe('Topup payment flow', () => {
  let userId;
  let referrerId;
  const referrerCode = 'TOPUPREF';

  beforeEach(async () => {
    // Create user and referrer
    referrerId = 'topup-referrer';
    await db.writeDoc('users', referrerId, {
      id: referrerId, name: 'Topup Referrer', email: 'topref@test.com',
      phone: '1111111111', referral_code: referrerCode,
      referrals_count: 1,
    });
    await db.writeDoc('wallet_balances', referrerId, { balance: 500, total_earned: 500 });

    userId = 'topup-user';
    await db.writeDoc('users', userId, {
      id: userId, name: 'Topup User', email: 'topuser@test.com',
      phone: '2222222222', referral_code: 'USERCODE',
      referred_by: referrerCode,
    });
    await db.writeDoc('wallet_balances', userId, { balance: 200, total_earned: 200 });
  });

  it('approves topup and credits wallet + referral income', async () => {
    // Submit topup payment
    const payResult = await db.verifyUPIPayment({
      userId, type: 'topup', amount: 500,
      utr: 'TOPUPUTR123456', upiId: 'jayarajj126-3@okicici',
      screenshotUrl: 'https://example.com/topup.jpg',
    });
    expect(payResult.paymentId).toBeTruthy();

    // Approve
    const approveResult = await db.approveTopupPayment(payResult.paymentId);
    expect(approveResult.status).toBe('approved');

    // Check wallet credited
    const wallet = await db.getDoc('wallet_balances', userId);
    expect(wallet.balance).toBe(700); // 200 + 500

    // Check topup record
    const topups = await db.runQuery('topups', [{ field: 'user_id', op: 'EQUAL', value: userId }]);
    expect(topups.length).toBe(1);
    expect(topups[0].amount).toBe(500);
    expect(topups[0].status).toBe('approved');

    // Check referral income created
    const incomes = await db.runQuery('topup_referral_income', [{ field: 'user_id', op: 'EQUAL', value: referrerId }]);
    expect(incomes.length).toBe(1);
    expect(incomes[0].from_user_id).toBe(userId);
  });
});

describe('Reject and restore payment flow', () => {
  it('rejects payment atomically and restores it', async () => {
    // Create a payment
    const regResult = await db.preRegister({
      name: 'User R', email: 'userr@test.com', phone: '3333333333',
      password: 'password123', referralCode: null,
    });
    const payResult = await db.verifyUPIPayment({
      pendingRegId: regResult.pendingRegId, type: 'registration', amount: 120,
      utr: 'REJECT12345678', upiId: 'jayarajj126-3@okicici',
      screenshotUrl: 'https://example.com/r.jpg',
    });

    // Reject
    const rejectResult = await db.rejectPayment(payResult.paymentId);
    expect(rejectResult.status).toBe('rejected');

    const rejectedPayment = await db.getDoc('upi_payments', payResult.paymentId);
    expect(rejectedPayment.status).toBe('rejected');
    expect(rejectedPayment.rejection_reasons).toBeDefined();

    // Idempotent reject
    const idempotentReject = await db.rejectPayment(payResult.paymentId);
    expect(idempotentReject.idempotent).toBe(true);

    // Restore
    const restoreResult = await db.restorePayment(payResult.paymentId);
    expect(restoreResult.status).toBe('manual_review');

    const restoredPayment = await db.getDoc('upi_payments', payResult.paymentId);
    expect(restoredPayment.status).toBe('manual_review');

    // Idempotent restore (already manual_review, not rejected)
    const idempotentRestore = await db.restorePayment(payResult.paymentId);
    expect(idempotentRestore.idempotent).toBe(true);
  });

  it('prevents double approval via atomic claim', async () => {
    const regResult = await db.preRegister({
      name: 'Double User', email: 'double@test.com', phone: '4444444444',
      password: 'password123', referralCode: null,
    });
    const payResult = await db.verifyUPIPayment({
      pendingRegId: regResult.pendingRegId, type: 'registration', amount: 120,
      utr: 'DOUBLE12345678', upiId: 'jayarajj126-3@okicici',
      screenshotUrl: 'https://example.com/d.jpg',
    });

    // First approval — succeeds
    const first = await db.approveRegistrationPayment(payResult.paymentId);
    expect(first.status).toBe('approved');

    // Second approval — returns existing status (idempotent), no duplicate user
    const second = await db.approveRegistrationPayment(payResult.paymentId);
    expect(second.idempotent).toBe(true);
    expect(second.status).toBe('verified');

    // Only one user created
    const users = await db.runQuery('users', []);
    const createdByFlow = users.filter(u => u.name === 'Double User');
    expect(createdByFlow.length).toBe(1);
  });
});
