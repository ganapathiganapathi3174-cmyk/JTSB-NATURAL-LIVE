import { describe, it, expect, beforeEach } from 'vitest';
import { validateMobileUniqueness, clearMobileCache, normalizePhone, isValidMobileFormat } from '../utils/validateMobileUniqueness.js';

const MAX_REFERRALS = 2;

function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function createMockFirebase() {
  const users = new Map();
  const referrals = [];
  let idCounter = 1;

  function nextId() {
    return `mock-user-${idCounter++}`;
  }

  function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  const db = {
    users,
    referrals,
    async findByEmail(email) {
      const normalized = String(email).trim().toLowerCase();
      for (const [, u] of users) {
        if (u.email === normalized) return deepCopy(u);
      }
      return null;
    },
    async findByPhone(phone) {
      const normalized = normalizePhone(phone);
      for (const [, u] of users) {
        if (u.phone === normalized) return deepCopy(u);
      }
      return null;
    },
    async findByReferralCode(code) {
      const upper = String(code).toUpperCase();
      for (const [, u] of users) {
        if (u.referral_code === upper) return deepCopy(u);
      }
      return null;
    },
    async findById(id) {
      const u = users.get(id);
      return u ? deepCopy(u) : null;
    },
    async create(userData) {
      const existingEmail = await db.findByEmail(userData.email);
      if (existingEmail) throw new Error('This email is already registered.');
      const existingPhone = await db.findByPhone(userData.phone);
      if (existingPhone) throw new Error('This phone number is already registered.');
      const id = nextId();
      const user = {
        id,
        name: userData.name,
        email: String(userData.email).toLowerCase(),
        phone: userData.phone || '',
        password: userData.password || '',
        status: 'pending',
        payment_status: 'pending',
        upi_screenshot_url: null,
        utr_number: null,
        referral_code: generateReferralCode(),
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
        is_qualified: false,
        admin_status: null,
        referral_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        referral_created_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
      users.set(id, user);
      return deepCopy(user);
    },
    async createWithPassword(userData) {
      const result = await db.create(userData);
      if (userData.referredBy) {
        const mapUser = users.get(result.id);
        if (mapUser) {
          mapUser.referred_by = userData.referredBy;
          mapUser.referred_by_status = 'pending';
        }
      }
      const final = users.get(result.id);
      return final ? deepCopy(final) : result;
    },
    async updatePaymentStatus(id, paymentStatus) {
      const u = users.get(id);
      if (!u) return;
      if (paymentStatus === 'approved') {
        u.payment_status = 'approved';
        u.status = 'approved';
        u.account_status = 'active';
        u.is_first_payment_done = true;
        if (u.referred_by && u.referred_by_status === 'pending') {
          u.referred_by_status = 'approved';
          const referrer = await db.findByReferralCode(u.referred_by);
          if (referrer && referrer.referrals_count < MAX_REFERRALS) {
            const refUser = users.get(referrer.id);
            if (refUser) {
              refUser.referrals_count = (refUser.referrals_count || 0) + 1;
              refUser.total_referral_count = (refUser.total_referral_count || 0) + 1;
              refUser.referral_limit_reached = refUser.referrals_count >= MAX_REFERRALS;
              refUser.referral_active = refUser.referrals_count < MAX_REFERRALS;
              refUser.is_qualified = refUser.referrals_count >= MAX_REFERRALS;
              if (refUser.referrals_count >= MAX_REFERRALS) {
                refUser.account_status = 'inactive';
                refUser.cycle_payment_status = null;
              }
              db.referrals.push({
                user_id: refUser.id,
                name: u.name,
                email: u.email,
                phone: u.phone || '',
                created_at: new Date().toISOString(),
              });
            }
          }
        }
      }
    },
    async updatePayment(id, screenshotData, utr) {
      const u = users.get(id);
      if (u) {
        u.utr_number = utr || null;
        if (screenshotData) u.upi_screenshot_url = screenshotData;
      }
    },
    async updateUpiScreenshot(id, value1, value2) {
      const u = users.get(id);
      if (u) {
        if (value2 && ['pending', 'approved', 'rejected'].includes(value2)) {
          u.payment_status = value2;
        } else {
          u.upi_screenshot_url = value1 || null;
          u.utr_number = value2 || null;
          u.payment_status = 'pending';
        }
      }
    },
    async updatePassword(id, newPassword) {
      const u = users.get(id);
      if (u) u.password = newPassword;
    },
    async updateReferralCode(id, refCode) {
      const u = users.get(id);
      if (u && !u.referred_by) {
        u.referred_by = refCode;
      }
    },
    async getReferralsByReferrerCode(referralCode) {
      if (!referralCode) return [];
      const results = [];
      for (const [, u] of users) {
        if (u.referred_by === referralCode.toUpperCase()) {
          if (u.referred_by_status === 'approved' || !u.referred_by_status) {
            results.push(deepCopy(u));
          }
        }
      }
      return results;
    },
    async getAllReferralsByReferrerCode(referralCode) {
      if (!referralCode) return [];
      const results = [];
      for (const [, u] of users) {
        if (u.referred_by === referralCode.toUpperCase()) {
          results.push(deepCopy(u));
        }
      }
      return results;
    },
    async countReferralsUsed(referralCode) {
      const refs = await db.getReferralsByReferrerCode(referralCode);
      return refs.length;
    },
    subscribeToReferralsByCode(referralCode, callback) {
      if (!referralCode) {
        callback([]);
        return () => {};
      }
      const results = [];
      for (const [, u] of users) {
        if (u.referred_by === referralCode.toUpperCase() && u.referred_by_status === 'approved') {
          results.push(deepCopy(u));
        }
      }
      callback(results);
      return () => {};
    },
    async approveReferral(referredUserId) {
      const u = users.get(referredUserId);
      if (!u) throw new Error('User not found');
      if (!u.referred_by) throw new Error('User has no referral');
      if (u.referred_by_status === 'approved') throw new Error('Referral already approved');

      const referrer = await db.findByReferralCode(u.referred_by);
      if (!referrer) throw new Error('Referrer not found');

      if (referrer.admin_status === 'suspicious') throw new Error('Referrer is marked suspicious');
      if (u.admin_status === 'suspicious') throw new Error('Referred user is suspicious');
      if (u.admin_status === 'inactive') throw new Error('Referred user is inactive');

      u.referred_by_status = 'approved';

      const refUser = users.get(referrer.id);
      if (refUser) {
        refUser.referrals_count = (refUser.referrals_count || 0) + 1;
        refUser.total_referral_count = (refUser.total_referral_count || 0) + 1;
        refUser.referral_limit_reached = refUser.referrals_count >= MAX_REFERRALS;
        refUser.is_qualified = refUser.referrals_count >= MAX_REFERRALS;
        refUser.referral_active = refUser.referrals_count < MAX_REFERRALS;

        db.referrals.push({
          user_id: refUser.id,
          name: u.name,
          email: u.email,
          phone: u.phone || '',
          created_at: new Date().toISOString(),
        });

        if (refUser.referrals_count >= MAX_REFERRALS && !refUser.referral_active) {
          refUser.account_status = 'inactive';
          refUser.referral_active = true;
          refUser.cycle_payment_status = null;
        }
      }
    },
    async reactivate(userId) {
      const u = users.get(userId);
      if (!u) return;
      u.account_status = 'active';
      u.is_qualified = false;
      u.referrals_count = 0;
      u.referral_limit_reached = false;
      u.referral_active = true;
      u.cycle_payment_status = 'approved';
    },
    async updateCyclePayment(userId, url, utr) {
      const u = users.get(userId);
      if (u) {
        u.cycle_payment_status = 'pending';
        u.cycle_upi_screenshot_url = url;
        u.cycle_payment_utr = utr;
        u.referral_cycle = (u.referral_cycle || 0) + 1;
      }
    },
    async decrementReferralCount(userId) {
      const u = users.get(userId);
      if (!u) return;
      const currentCount = u.referrals_count || 0;
      const newCount = Math.max(0, currentCount - 1);
      const isQualified = newCount >= MAX_REFERRALS;
      u.referrals_count = newCount;
      u.total_referral_count = Math.max(0, (u.total_referral_count || 0) - 1);
      u.referral_limit_reached = isQualified;
      u.referral_active = !isQualified;
      u.is_qualified = isQualified;
    },
    async count() {
      return users.size;
    },
    seedUser(overrides = {}) {
      const id = nextId();
      const user = {
        id,
        name: 'Seeded User',
        email: 'seeded@test.com',
        phone: '9876543210',
        password: 'hashed-password',
        status: 'pending',
        payment_status: 'pending',
        upi_screenshot_url: null,
        utr_number: null,
        referral_code: 'SEEDCODE',
        referred_by: null,
        referred_by_status: null,
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
        is_qualified: false,
        admin_status: null,
        referral_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        referral_created_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        ...overrides,
      };
      users.set(id, user);
      return deepCopy(user);
    },
    clear() {
      users.clear();
      referrals.length = 0;
      idCounter = 1;
    },
  };
  return db;
}

let mockDb;

beforeEach(() => {
  mockDb = createMockFirebase();
  clearMobileCache();
});

describe('Payment Cycle - Full Flow', () => {
  describe('Registration with referral tracking', () => {
    it('should set referred_by_status to pending on registration with valid referral', async () => {
      mockDb.seedUser({
        email: 'referrer@test.com',
        referral_code: 'REFERRR',
        payment_status: 'approved',
        account_status: 'active',
        referrals_count: 0,
      });
      const user = await mockDb.createWithPassword({
        name: 'Referred User',
        email: 'referred@test.com',
        phone: '9000000000',
        password: 'pass123',
        referredBy: 'REFERRR',
      });
      expect(user.referred_by).toBe('REFERRR');
      expect(user.referred_by_status).toBe('pending');
    });

    it('should set referred_by_status to null when no referral code provided', async () => {
      const user = await mockDb.createWithPassword({
        name: 'No Referral',
        email: 'noref@test.com',
        phone: '9876543211',
        password: 'pass123',
      });
      expect(user.referred_by).toBeNull();
      expect(user.referred_by_status).toBeNull();
    });
  });

  describe('subscribeToReferralsByCode filtering', () => {
    it('should return only approved referrals', () => {
      mockDb.seedUser({
        email: 'referrer@test.com',
        referral_code: 'REFERRR',
        payment_status: 'approved',
        account_status: 'active',
        referrals_count: 0,
      });
      mockDb.seedUser({
        email: 'approved@test.com',
        referred_by: 'REFERRR',
        referred_by_status: 'approved',
        payment_status: 'approved',
        account_status: 'active',
      });
      mockDb.seedUser({
        email: 'pending@test.com',
        referred_by: 'REFERRR',
        referred_by_status: 'pending',
        payment_status: 'pending',
        account_status: 'inactive',
      });
      mockDb.seedUser({
        email: 'nobody@test.com',
        referred_by: null,
        referred_by_status: null,
      });

      const callback = (referrals) => {
        expect(referrals.length).toBe(1);
        expect(referrals[0].email).toBe('approved@test.com');
      };
      mockDb.subscribeToReferralsByCode('REFERRR', callback);
    });

    it('should return empty array when no approved referrals', () => {
      mockDb.seedUser({
        email: 'referrer@test.com',
        referral_code: 'REFERRR',
      });
      mockDb.seedUser({
        email: 'pending@test.com',
        referred_by: 'REFERRR',
        referred_by_status: 'pending',
      });

      const callback = (referrals) => {
        expect(referrals.length).toBe(0);
      };
      mockDb.subscribeToReferralsByCode('REFERRR', callback);
    });

    it('should return empty array when referral code is null/empty', () => {
      const callback = (referrals) => {
        expect(referrals).toEqual([]);
      };
      mockDb.subscribeToReferralsByCode('', callback);
      mockDb.subscribeToReferralsByCode(null, callback);
    });
  });

  describe('getAllReferralsByReferrerCode', () => {
    it('should return all referrals regardless of status', async () => {
      mockDb.seedUser({
        email: 'referrer@test.com',
        referral_code: 'REFERRR',
      });
      mockDb.seedUser({
        email: 'approved@test.com',
        referred_by: 'REFERRR',
        referred_by_status: 'approved',
      });
      mockDb.seedUser({
        email: 'pending@test.com',
        referred_by: 'REFERRR',
        referred_by_status: 'pending',
      });

      const result = await mockDb.getAllReferralsByReferrerCode('REFERRR');
      expect(result.length).toBe(2);
    });
  });

  describe('countReferralsUsed', () => {
    it('should count only approved referrals', async () => {
      mockDb.seedUser({
        email: 'referrer@test.com',
        referral_code: 'REFERRR',
        referrals_count: 0,
      });
      mockDb.seedUser({
        email: 'approved@test.com',
        referred_by: 'REFERRR',
        referred_by_status: 'approved',
      });
      mockDb.seedUser({
        email: 'pending@test.com',
        referred_by: 'REFERRR',
        referred_by_status: 'pending',
      });

      const count = await mockDb.countReferralsUsed('REFERRR');
      expect(count).toBe(1);
    });
  });

  describe('getReferralsByReferrerCode', () => {
    it('should return only approved referrals', async () => {
      mockDb.seedUser({
        email: 'referrer@test.com',
        referral_code: 'REFERRR',
      });
      mockDb.seedUser({
        email: 'approved@test.com',
        referred_by: 'REFERRR',
        referred_by_status: 'approved',
      });
      mockDb.seedUser({
        email: 'pending@test.com',
        referred_by: 'REFERRR',
        referred_by_status: 'pending',
      });

      const result = await mockDb.getReferralsByReferrerCode('REFERRR');
      expect(result.length).toBe(1);
      expect(result[0].email).toBe('approved@test.com');
    });
  });

  describe('approveReferral validation', () => {
    it('should approve a valid pending referral and update counts', async () => {
      mockDb.seedUser({
        email: 'referrer@test.com',
        referral_code: 'REFERRR',
        payment_status: 'approved',
        account_status: 'active',
        referrals_count: 0,
      });
      mockDb.seedUser({
        email: 'referred@test.com',
        referred_by: 'REFERRR',
        referred_by_status: 'pending',
      });

      await mockDb.approveReferral('mock-user-2');

      const referrer = await mockDb.findByReferralCode('REFERRR');
      expect(referrer.referrals_count).toBe(1);
      expect(referrer.is_qualified).toBe(false);
      expect(referrer.account_status).toBe('active');

      const referred = await mockDb.findById('mock-user-2');
      expect(referred.referred_by_status).toBe('approved');
    });

    it('should set is_qualified when approving second referral', async () => {
      mockDb.seedUser({
        email: 'referrer@test.com',
        referral_code: 'REFERRR',
        payment_status: 'approved',
        account_status: 'active',
        referrals_count: 1,
        is_qualified: false,
      });
      mockDb.seedUser({
        email: 'second@test.com',
        referred_by: 'REFERRR',
        referred_by_status: 'pending',
      });

      await mockDb.approveReferral('mock-user-2');

      const referrer = await mockDb.findByReferralCode('REFERRR');
      expect(referrer.referrals_count).toBe(2);
      expect(referrer.is_qualified).toBe(true);
      expect(referrer.referral_limit_reached).toBe(true);
    });

    it('should throw when user not found', async () => {
      await expect(mockDb.approveReferral('nonexistent'))
        .rejects.toThrow('User not found');
    });

    it('should throw when user has no referral', async () => {
      mockDb.seedUser({ email: 'noref@test.com' });
      await expect(mockDb.approveReferral('mock-user-1'))
        .rejects.toThrow('User has no referral');
    });

    it('should throw when referral already approved', async () => {
      mockDb.seedUser({
        email: 'referrer@test.com',
        referral_code: 'REFERRR',
      });
      mockDb.seedUser({
        email: 'already@test.com',
        referred_by: 'REFERRR',
        referred_by_status: 'approved',
      });
      await expect(mockDb.approveReferral('mock-user-2'))
        .rejects.toThrow('Referral already approved');
    });

    it('should throw when referrer not found', async () => {
      mockDb.seedUser({
        email: 'orphan@test.com',
        referred_by: 'GHOST',
        referred_by_status: 'pending',
      });
      await expect(mockDb.approveReferral('mock-user-1'))
        .rejects.toThrow('Referrer not found');
    });

    it('should throw when referrer is suspicious', async () => {
      mockDb.seedUser({
        email: 'suspicious@test.com',
        referral_code: 'SUSPECT',
        admin_status: 'suspicious',
      });
      mockDb.seedUser({
        email: 'referred@test.com',
        referred_by: 'SUSPECT',
        referred_by_status: 'pending',
      });
      await expect(mockDb.approveReferral('mock-user-2'))
        .rejects.toThrow('Referrer is marked suspicious');
    });

    it('should throw when referred user is suspicious', async () => {
      mockDb.seedUser({
        email: 'referrer@test.com',
        referral_code: 'REFERRR',
        payment_status: 'approved',
        account_status: 'active',
      });
      mockDb.seedUser({
        email: 'suspicious@test.com',
        referred_by: 'REFERRR',
        referred_by_status: 'pending',
        admin_status: 'suspicious',
      });
      await expect(mockDb.approveReferral('mock-user-2'))
        .rejects.toThrow('Referred user is suspicious');
    });

    it('should throw when referred user is inactive', async () => {
      mockDb.seedUser({
        email: 'referrer@test.com',
        referral_code: 'REFERRR',
        payment_status: 'approved',
        account_status: 'active',
      });
      mockDb.seedUser({
        email: 'inactive@test.com',
        referred_by: 'REFERRR',
        referred_by_status: 'pending',
        admin_status: 'inactive',
      });
      await expect(mockDb.approveReferral('mock-user-2'))
        .rejects.toThrow('Referred user is inactive');
    });
  });

  describe('Full payment cycle flow', () => {
    it('full smoke test: register → payment approval → 2 referrals → cycle payment', async () => {
      const referrer = mockDb.seedUser({
        email: 'referrer@test.com',
        referral_code: 'ALICE',
        payment_status: 'approved',
        account_status: 'active',
        referrals_count: 0,
        is_first_payment_done: true,
      });

      const ref1 = await mockDb.createWithPassword({
        name: 'Ref1',
        email: 'ref1@test.com',
        phone: '9000000001',
        password: 'pass123',
        referredBy: 'ALICE',
      });
      const ref2 = await mockDb.createWithPassword({
        name: 'Ref2',
        email: 'ref2@test.com',
        phone: '9000000002',
        password: 'pass123',
        referredBy: 'ALICE',
      });

      // Both referrals are pending
      expect(ref1.referred_by_status).toBe('pending');
      expect(ref2.referred_by_status).toBe('pending');

      // Referrer counts nothing yet
      let current = await mockDb.findByReferralCode('ALICE');
      expect(current.referrals_count).toBe(0);
      expect(current.is_qualified).toBe(false);
      expect(current.account_status).toBe('active');

      // Approve ref1's payment: this also promotes the referral
      await mockDb.updatePaymentStatus(ref1.id, 'approved');

      current = await mockDb.findByReferralCode('ALICE');
      expect(current.referrals_count).toBe(1);
      expect(current.is_qualified).toBe(false);
      expect(current.account_status).toBe('active');

      const approvedRef1 = await mockDb.findById(ref1.id);
      expect(approvedRef1.referred_by_status).toBe('approved');

      // Approve ref2's payment
      await mockDb.updatePaymentStatus(ref2.id, 'approved');

      current = await mockDb.findByReferralCode('ALICE');
      expect(current.referrals_count).toBe(2);
      expect(current.is_qualified).toBe(true);
      expect(current.referral_limit_reached).toBe(true);
      expect(current.referral_active).toBe(false);
      expect(current.account_status).toBe('inactive');

      const approvedRef2 = await mockDb.findById(ref2.id);
      expect(approvedRef2.referred_by_status).toBe('approved');

      // Subscribe should return both approved referrals
      const subRefs = [];
      mockDb.subscribeToReferralsByCode('ALICE', (refs) => {
        subRefs.push(...refs);
      });
      expect(subRefs.length).toBe(2);

      // Simulate cycle payment submission
      await mockDb.updateCyclePayment(referrer.id, 'http://cycle.jpg', 'UTR-CYCLE-123');

      current = await mockDb.findByReferralCode('ALICE');
      expect(current.cycle_payment_status).toBe('pending');
      expect(current.cycle_payment_utr).toBe('UTR-CYCLE-123');

      // Admin approves cycle payment
      await mockDb.reactivate(referrer.id);

      current = await mockDb.findByReferralCode('ALICE');
      expect(current.account_status).toBe('active');
      expect(current.is_qualified).toBe(false);
      expect(current.referrals_count).toBe(0);
      expect(current.referral_limit_reached).toBe(false);
      expect(current.referral_active).toBe(true);
      expect(current.cycle_payment_status).toBe('approved');
    });

    it('should grant is_qualified when admin manually approves 2 referrals via approveReferral', async () => {
      mockDb.seedUser({
        email: 'referrer@test.com',
        referral_code: 'BOB',
        payment_status: 'approved',
        account_status: 'active',
        referrals_count: 0,
        is_first_payment_done: true,
      });

      const ref1 = await mockDb.createWithPassword({
        name: 'Ref1',
        email: 'ref1m@test.com',
        phone: '9000000011',
        password: 'pass123',
        referredBy: 'BOB',
      });
      const ref2 = await mockDb.createWithPassword({
        name: 'Ref2',
        email: 'ref2m@test.com',
        phone: '9000000022',
        password: 'pass123',
        referredBy: 'BOB',
      });

      // Admin approves ref1 payment → increments count
      await mockDb.updatePaymentStatus(ref1.id, 'approved');

      // Admin manually approves ref2
      await mockDb.approveReferral(ref2.id);

      const referrer = await mockDb.findByReferralCode('BOB');
      expect(referrer.referrals_count).toBe(2);
      expect(referrer.is_qualified).toBe(true);
      expect(referrer.account_status).toBe('inactive');

      const approvedRef2 = await mockDb.findById(ref2.id);
      expect(approvedRef2.referred_by_status).toBe('approved');
    });
  });

  describe('Referral count edge cases', () => {
    it('should handle decrement of referral count correctly', async () => {
      mockDb.seedUser({
        email: 'referrer@test.com',
        referral_code: 'DECREF',
        referrals_count: 2,
        is_qualified: true,
        account_status: 'inactive',
      });

      await mockDb.decrementReferralCount('mock-user-1');

      const referrer = await mockDb.findById('mock-user-1');
      expect(referrer.referrals_count).toBe(1);
      expect(referrer.is_qualified).toBe(false);
      expect(referrer.referral_active).toBe(true);
      expect(referrer.referral_limit_reached).toBe(false);
    });

    it('should not go below 0 on decrement', async () => {
      mockDb.seedUser({
        email: 'referrer@test.com',
        referral_code: 'ZERO',
        referrals_count: 0,
      });

      await mockDb.decrementReferralCount('mock-user-1');

      const referrer = await mockDb.findById('mock-user-1');
      expect(referrer.referrals_count).toBe(0);
    });
  });
});
