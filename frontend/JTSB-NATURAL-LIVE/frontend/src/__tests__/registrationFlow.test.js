import { describe, it, expect, beforeEach } from 'vitest';
import { validateMobileUniqueness, clearMobileCache, normalizePhone, isValidMobileFormat } from '../utils/validateMobileUniqueness.js';

function createMockFirebase() {
  const users = new Map();
  let idCounter = 1;

  function nextId() {
    return `mock-user-${idCounter++}`;
  }

  function generateReferralCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  const db = {
    users,
    async findByEmail(email) {
      const normalized = String(email).trim().toLowerCase();
      for (const [, user] of users) {
        if (user.email === normalized) return { ...user };
      }
      return null;
    },
    async findByPhone(phone) {
      const normalized = normalizePhone(phone);
      for (const [, user] of users) {
        if (user.phone === normalized) return { ...user };
      }
      return null;
    },
    async findByReferralCode(code) {
      const upper = String(code).toUpperCase();
      for (const [, user] of users) {
        if (user.referral_code === upper) return { ...user };
      }
      return null;
    },
    async findById(id) {
      const user = users.get(id);
      return user ? { ...user } : null;
    },
    async create(userData) {
      const existingEmail = await db.findByEmail(userData.email);
      if (existingEmail) {
        throw new Error('This email is already registered. Please use a different email.');
      }
      const existingPhone = await db.findByPhone(userData.phone);
      if (existingPhone) {
        throw new Error('This phone number is already registered. Please use a different number.');
      }
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
        created_at: new Date().toISOString(),
      };
      users.set(id, user);
      return { ...user };
    },
    async createWithPassword(userData) {
      return db.create(userData);
    },
    async updatePayment(id, screenshotData, utr) {
      const user = users.get(id);
      if (user) {
        user.utr_number = utr || null;
        if (screenshotData) user.upi_screenshot_url = screenshotData;
      }
    },
    async updateUpiScreenshot(id, value1, value2) {
      const user = users.get(id);
      if (user) {
        if (value2 && ['pending', 'approved', 'rejected'].includes(value2)) {
          user.payment_status = value2;
        } else {
          user.upi_screenshot_url = value1 || null;
          user.utr_number = value2 || null;
          user.payment_status = 'pending';
        }
      }
    },
    async updatePassword(id, newPassword) {
      const user = users.get(id);
      if (user) user.password = newPassword;
    },
    async updateReferralCode(id, refCode) {
      const user = users.get(id);
      if (user && !user.referred_by) {
        user.referred_by = refCode;
      }
    },
    async incrementReferralCountByCode(code) {
      const referrer = await db.findByReferralCode(code);
      if (referrer) {
        const user = users.get(referrer.id);
        if (user && user.referrals_count < 2) {
          user.referrals_count += 1;
          user.referral_limit_reached = user.referrals_count >= 2;
          user.referral_active = user.referrals_count < 2;
        }
      }
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
        created_at: new Date().toISOString(),
        ...overrides,
      };
      users.set(id, user);
      return { ...user };
    },
    clear() {
      users.clear();
      idCounter = 1;
    },
  };
  return db;
}

async function simpleHash(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'pc-salt-2026');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function simpleCompare(plaintext, hashed) {
  const hash = await simpleHash(plaintext);
  return hash === hashed;
}

async function simulateRegister(db, { name, email, password, referralCode }) {
  const em = String(email || '').trim().toLowerCase();
  const existing = await db.findByEmail(em);
  if (existing) throw { status: 409, message: 'An account with this email already exists' };

  let referredBy = null;
  if (referralCode && referralCode.trim()) {
    const rc = referralCode.trim().toUpperCase();
    const referrer = await db.findByReferralCode(rc);
    if (!referrer) throw { status: 400, message: 'Invalid referral code' };
    if (referrer.payment_status !== 'approved' || referrer.account_status !== 'active' || (referrer.referrals_count || 0) >= 2) {
      throw { status: 400, message: 'Invalid referral code' };
    }
    referredBy = rc;
  }

  const hash = await simpleHash(password);
  const user = await db.create({
    name: name.trim(),
    email: em,
    phone: '',
    password: hash,
    referredBy,
  });

  return { status: 201, data: { message: 'Registration successful', user: (({ password, ...rest }) => rest)(user) } };
}

async function simulateLogin(db, { email, password }) {
  const em = String(email || '').trim().toLowerCase();
  const user = await db.findByEmail(em);
  if (!user) throw { status: 401, message: 'Invalid email or password' };
  if (!user.password) throw { status: 401, message: 'Invalid email or password' };
  const ok = await simpleCompare(password, user.password);
  if (!ok) throw { status: 401, message: 'Invalid email or password' };
  if (user.payment_status !== 'approved') throw { status: 403, message: 'Payment not approved' };
  return { status: 200, data: { user: (({ password, ...rest }) => rest)(user) } };
}

async function simulatePaymentSubmit(db, { fullName, email, phoneNumber, utr }) {
  if (!fullName || !email || !phoneNumber || !utr) {
    throw { status: 400, message: 'All fields are required: fullName, email, phoneNumber, UPI Reference Number' };
  }
  const rawPaymentId = String(utr).trim();
  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedPhone = String(phoneNumber).trim();
  const UPI_REF_REGEX = /^[0-9]{10,20}$/;
  if (!UPI_REF_REGEX.test(rawPaymentId)) {
    throw { status: 400, message: 'Enter a valid UPI Reference Number (10-20 digits)' };
  }
  const user = await db.findByEmail(normalizedEmail);
  if (user) {
    return {
      status: 201,
      data: {
        message: 'Payment submitted for verification',
        payment: { id: user.id, name: fullName.trim(), email: normalizedEmail, phoneNumber: normalizedPhone, paymentId: rawPaymentId, status: 'pending', amount: 120, createdAt: new Date().toISOString() },
      },
    };
  }
  const newUser = await db.create({ name: fullName.trim(), email: normalizedEmail, phone: normalizedPhone });
  return {
    status: 201,
    data: {
      message: 'Payment submitted for verification',
      payment: { id: newUser.id, name: fullName.trim(), email: normalizedEmail, phoneNumber: normalizedPhone, paymentId: rawPaymentId, status: 'pending', amount: 120, createdAt: newUser.created_at },
    },
  };
}

let mockDb;

beforeEach(() => {
  mockDb = createMockFirebase();
  clearMobileCache();
});

describe('User Registration - Full Flow Integration Tests (Read-Only)', () => {
  describe('Valid Registration Cases', () => {
    it('should register with valid minimal fields', async () => {
      const response = await simulateRegister(mockDb, {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      });
      expect(response.status).toBe(201);
      expect(response.data.message).toBe('Registration successful');
      expect(response.data.user.name).toBe('Test User');
      expect(response.data.user.email).toBe('test@example.com');
      expect(response.data.user.password).toBeUndefined();
    });

    it('should register with valid referral code', async () => {
      mockDb.seedUser({
        email: 'referrer@test.com',
        phone: '9876543210',
        payment_status: 'approved',
        account_status: 'active',
        referral_code: 'VALIDREF',
        referrals_count: 0,
      });
      const response = await simulateRegister(mockDb, {
        name: 'Referred User',
        email: 'referred@example.com',
        password: 'password123',
        referralCode: 'validref',
      });
      expect(response.status).toBe(201);
      expect(response.data.user.referred_by).toBe('VALIDREF');
    });

    it('should normalize email to lowercase', async () => {
      const response = await simulateRegister(mockDb, {
        name: 'Test User',
        email: 'TEST@EXAMPLE.COM',
        password: 'password123',
      });
      expect(response.data.user.email).toBe('test@example.com');
    });

    it('should trim whitespace from name and email', async () => {
      const response = await simulateRegister(mockDb, {
        name: '  Test User  ',
        email: '  test@example.com  ',
        password: 'password123',
      });
      expect(response.data.user.name).toBe('Test User');
      expect(response.data.user.email).toBe('test@example.com');
    });
  });

  describe('Missing Fields - Backend Gap Analysis', () => {
    it('DOES NOT reject empty name (frontend-only validation)', async () => {
      const response = await simulateRegister(mockDb, { name: '', email: 'test@example.com', password: 'password123' });
      expect(response.status).toBe(201);
      expect(response.data.user.name).toBe('');
    });

    it('DOES NOT reject empty email (frontend-only validation)', async () => {
      const response = await simulateRegister(mockDb, { name: 'Test User', email: '', password: 'password123' });
      expect(response.status).toBe(201);
      expect(response.data.user.email).toBe('');
    });

    it('DOES NOT reject empty password (frontend-only validation)', async () => {
      const response = await simulateRegister(mockDb, { name: 'Test User', email: 'nopass@example.com', password: '' });
      expect(response.status).toBe(201);
    });

    it('should reject registration with undefined name', async () => {
      await expect(simulateRegister(mockDb, { email: 'test@example.com', password: 'password123' }))
        .rejects.toThrow();
    });

    it('should reject registration with null name', async () => {
      await expect(simulateRegister(mockDb, { name: null, email: 'test@example.com', password: 'password123' }))
        .rejects.toThrow();
    });
  });

  describe('Invalid Input Formats - Backend Gap Analysis', () => {
    it('DOES NOT reject invalid email format (no @) at DB level', async () => {
      const response = await simulateRegister(mockDb, { name: 'Test User', email: 'not-an-email', password: 'password123' });
      expect(response.status).toBe(201);
      expect(response.data.user.email).toBe('not-an-email');
    });

    it('DOES NOT reject email without domain at DB level', async () => {
      const response = await simulateRegister(mockDb, { name: 'Test User', email: 'test@', password: 'password123' });
      expect(response.status).toBe(201);
    });

    it('DOES NOT reject email without local part at DB level', async () => {
      const response = await simulateRegister(mockDb, { name: 'Test User', email: '@example.com', password: 'password123' });
      expect(response.status).toBe(201);
    });

    it('DOES NOT reject email with spaces at DB level', async () => {
      const response = await simulateRegister(mockDb, { name: 'Test User', email: 'test @example.com', password: 'password123' });
      expect(response.status).toBe(201);
    });
  });

  describe('Duplicate Mobile / Email', () => {
    it('should reject duplicate email registration', async () => {
      mockDb.seedUser({ email: 'existing@test.com', phone: '9876543210' });
      await expect(simulateRegister(mockDb, { name: 'Another User', email: 'existing@test.com', password: 'password123' }))
        .rejects.toThrow('already exists');
    });

    it('should reject duplicate email with different casing', async () => {
      mockDb.seedUser({ email: 'test@example.com', phone: '9876543210' });
      await expect(simulateRegister(mockDb, { name: 'Another User', email: 'TEST@EXAMPLE.COM', password: 'password123' }))
        .rejects.toThrow('already exists');
    });

    it('should reject duplicate mobile via create()', async () => {
      mockDb.seedUser({ email: 'first@test.com', phone: '9876543210' });
      await expect(mockDb.create({ name: 'Second User', email: 'second@test.com', phone: '9876543210' }))
        .rejects.toThrow('phone number is already registered');
    });

    it('should allow different mobile numbers', async () => {
      mockDb.seedUser({ email: 'first@test.com', phone: '9876543210' });
      const result = await mockDb.create({ name: 'Second User', email: 'second@test.com', phone: '8765432109' });
      expect(result.email).toBe('second@test.com');
      expect(result.phone).toBe('8765432109');
    });
  });

  describe('Invalid Referral Codes', () => {
    it('should reject non-existent referral code', async () => {
      await expect(simulateRegister(mockDb, { name: 'Test User', email: 'test@example.com', password: 'password123', referralCode: 'NONEXIST' }))
        .rejects.toThrow('Invalid referral code');
    });

    it('should reject referral code with inactive referrer', async () => {
      mockDb.seedUser({ email: 'inactive@test.com', phone: '9876543210', payment_status: 'pending', account_status: 'inactive', referral_code: 'INACTIVE' });
      await expect(simulateRegister(mockDb, { name: 'Test User', email: 'test@example.com', password: 'password123', referralCode: 'inactive' }))
        .rejects.toThrow('Invalid referral code');
    });

    it('should reject referral code when referrer has reached limit', async () => {
      mockDb.seedUser({ email: 'full@test.com', phone: '9876543210', payment_status: 'approved', account_status: 'active', referral_code: 'FULLREF', referrals_count: 2, referral_limit_reached: true });
      await expect(simulateRegister(mockDb, { name: 'Test User', email: 'test@example.com', password: 'password123', referralCode: 'fullref' }))
        .rejects.toThrow('Invalid referral code');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long name', async () => {
      const longName = 'A'.repeat(500);
      const response = await simulateRegister(mockDb, { name: longName, email: 'test@example.com', password: 'password123' });
      expect(response.data.user.name).toBe(longName);
    });

    it('should handle special characters in name', async () => {
      const response = await simulateRegister(mockDb, { name: "O'Connor-Smith Jose Maria", email: 'test@example.com', password: 'password123' });
      expect(response.data.user.name).toBe("O'Connor-Smith Jose Maria");
    });

    it('should handle name with only spaces (trimmed to empty, stored as empty)', async () => {
      const response = await simulateRegister(mockDb, { name: '   ', email: 'spaces@example.com', password: 'password123' });
      expect(response.status).toBe(201);
      expect(response.data.user.name).toBe('');
    });

    it('should handle referral code with mixed case', async () => {
      mockDb.seedUser({ email: 'mixedref@test.com', phone: '7654321098', payment_status: 'approved', account_status: 'active', referral_code: 'AB12CD34', referrals_count: 0 });
      const response = await simulateRegister(mockDb, { name: 'Mixed Case User', email: 'mixedcase@example.com', password: 'password123', referralCode: 'ab12cd34' });
      expect(response.status).toBe(201);
      expect(response.data.user.referred_by).toBe('AB12CD34');
    });

    it('should handle empty referral code string', async () => {
      const response = await simulateRegister(mockDb, { name: 'Test User', email: 'test@example.com', password: 'password123', referralCode: '' });
      expect(response.data.user.referred_by).toBeNull();
    });

    it('should handle whitespace-only referral code', async () => {
      const response = await simulateRegister(mockDb, { name: 'Test User', email: 'test@example.com', password: 'password123', referralCode: '   ' });
      expect(response.data.user.referred_by).toBeNull();
    });
  });

  describe('Data Format Validation', () => {
    it('should not expose password in response', async () => {
      const response = await simulateRegister(mockDb, { name: 'Test User', email: 'test@example.com', password: 'secret123' });
      expect(response.data.user.password).toBeUndefined();
    });

    it('should generate a referral code for new user', async () => {
      const response = await simulateRegister(mockDb, { name: 'Test User', email: 'test@example.com', password: 'password123' });
      expect(response.data.user.referral_code).toBeDefined();
      expect(response.data.user.referral_code.length).toBe(8);
      expect(/^[A-Z0-9]{8}$/.test(response.data.user.referral_code)).toBe(true);
    });

    it('should set default status values correctly', async () => {
      const response = await simulateRegister(mockDb, { name: 'Test User', email: 'test@example.com', password: 'password123' });
      expect(response.data.user.status).toBe('pending');
      expect(response.data.user.payment_status).toBe('pending');
      expect(response.data.user.account_status).toBe('inactive');
      expect(response.data.user.referrals_count).toBe(0);
    });

    it('should include created_at timestamp', async () => {
      const response = await simulateRegister(mockDb, { name: 'Test User', email: 'test@example.com', password: 'password123' });
      expect(response.data.user.created_at).toBeDefined();
      expect(new Date(response.data.user.created_at).toISOString()).toBeDefined();
    });
  });

  describe('Payment Submission Flow', () => {
    it('should reject payment submission with missing fullName', async () => {
      await expect(simulatePaymentSubmit(mockDb, { fullName: '', email: 'test@example.com', phoneNumber: '9876543210', utr: '123456789012' }))
        .rejects.toThrow();
    });

    it('should reject payment submission with missing email', async () => {
      await expect(simulatePaymentSubmit(mockDb, { fullName: 'Test User', email: '', phoneNumber: '9876543210', utr: '123456789012' }))
        .rejects.toThrow();
    });

    it('should reject payment submission with missing phoneNumber', async () => {
      await expect(simulatePaymentSubmit(mockDb, { fullName: 'Test User', email: 'test@example.com', phoneNumber: '', utr: '123456789012' }))
        .rejects.toThrow();
    });

    it('should reject payment submission with missing utr', async () => {
      await expect(simulatePaymentSubmit(mockDb, { fullName: 'Test User', email: 'test@example.com', phoneNumber: '9876543210', utr: '' }))
        .rejects.toThrow();
    });

    it('should reject payment with invalid UTR format (too short)', async () => {
      await expect(simulatePaymentSubmit(mockDb, { fullName: 'Test User', email: 'test@example.com', phoneNumber: '9876543210', utr: '123' }))
        .rejects.toThrow('valid UPI Reference Number');
    });

    it('should reject payment with invalid UTR format (non-numeric)', async () => {
      await expect(simulatePaymentSubmit(mockDb, { fullName: 'Test User', email: 'test@example.com', phoneNumber: '9876543210', utr: 'abcdef' }))
        .rejects.toThrow('valid UPI Reference Number');
    });

    it('should reject payment with UTR too long (>20 digits)', async () => {
      await expect(simulatePaymentSubmit(mockDb, { fullName: 'Test User', email: 'test@example.com', phoneNumber: '9876543210', utr: '123456789012345678901' }))
        .rejects.toThrow('valid UPI Reference Number');
    });

    it('should accept valid payment submission', async () => {
      const response = await simulatePaymentSubmit(mockDb, { fullName: 'Test User', email: 'test@example.com', phoneNumber: '9876543210', utr: '123456789012' });
      expect(response.status).toBe(201);
      expect(response.data.message).toBe('Payment submitted for verification');
      expect(response.data.payment.status).toBe('pending');
      expect(response.data.payment.amount).toBe(120);
    });

    it('should create new user when submitting payment for unknown email', async () => {
      const response = await simulatePaymentSubmit(mockDb, { fullName: 'New User', email: 'newuser@example.com', phoneNumber: '9876543210', utr: '123456789012' });
      expect(response.data.payment.email).toBe('newuser@example.com');
    });

    it('should update existing user when submitting payment', async () => {
      mockDb.seedUser({ email: 'existing@example.com', phone: '9876543210' });
      const response = await simulatePaymentSubmit(mockDb, { fullName: 'Existing User', email: 'existing@example.com', phoneNumber: '9876543210', utr: '123456789012' });
      expect(response.data.payment.email).toBe('existing@example.com');
    });

    it('should normalize email in payment submission', async () => {
      const response = await simulatePaymentSubmit(mockDb, { fullName: 'Test User', email: 'TEST@EXAMPLE.COM', phoneNumber: '9876543210', utr: '123456789012' });
      expect(response.data.payment.email).toBe('test@example.com');
    });
  });

  describe('Login Flow', () => {
    it('should reject login with non-existent email', async () => {
      await expect(simulateLogin(mockDb, { email: 'nouser@example.com', password: 'password123' }))
        .rejects.toThrow('Invalid email or password');
    });

    it('should reject login with wrong password', async () => {
      mockDb.seedUser({ email: 'user@example.com', phone: '9876543210', password: await simpleHash('correct') });
      await expect(simulateLogin(mockDb, { email: 'user@example.com', password: 'wrongpassword' }))
        .rejects.toThrow('Invalid email or password');
    });

    it('should reject login when payment not approved', async () => {
      mockDb.seedUser({ email: 'pending@example.com', phone: '9876543210', password: await simpleHash('pass'), payment_status: 'pending' });
      await expect(simulateLogin(mockDb, { email: 'pending@example.com', password: 'pass' }))
        .rejects.toThrow('Payment not approved');
    });

    it('should reject login when user has empty password field', async () => {
      mockDb.seedUser({ email: 'nopass@example.com', phone: '9876543210', password: '', payment_status: 'approved' });
      await expect(simulateLogin(mockDb, { email: 'nopass@example.com', password: 'anything' }))
        .rejects.toThrow('Invalid email or password');
    });

    it('should accept login with correct credentials and approved payment', async () => {
      const hashed = await simpleHash('correct');
      mockDb.seedUser({ email: 'approved@example.com', phone: '9876543210', password: hashed, payment_status: 'approved' });
      const response = await simulateLogin(mockDb, { email: 'approved@example.com', password: 'correct' });
      expect(response.status).toBe(200);
      expect(response.data.user.email).toBe('approved@example.com');
    });

    it('should normalize email during login', async () => {
      const hashed = await simpleHash('pass');
      mockDb.seedUser({ email: 'user@example.com', phone: '9876543210', password: hashed, payment_status: 'approved' });
      const response = await simulateLogin(mockDb, { email: 'USER@EXAMPLE.COM', password: 'pass' });
      expect(response.status).toBe(200);
    });
  });

  describe('Mobile Uniqueness Validation Layer', () => {
    it('should validate unique mobile number', async () => {
      const result = await validateMobileUniqueness('9876543210', mockDb);
      expect(result.isUnique).toBe(true);
      expect(result.allowRegistration).toBe(true);
      expect(result.error).toBe(null);
    });

    it('should detect duplicate mobile number', async () => {
      mockDb.seedUser({ phone: '9876543210' });
      const result = await validateMobileUniqueness('9876543210', mockDb);
      expect(result.isUnique).toBe(false);
      expect(result.allowRegistration).toBe(false);
      expect(result.error).toBe('This mobile number is already in use');
    });

    it('should reject invalid mobile format (starts with 5)', async () => {
      const result = await validateMobileUniqueness('5123456789', mockDb);
      expect(result.isUnique).toBe(false);
      expect(result.allowRegistration).toBe(false);
    });

    it('should reject empty mobile number', async () => {
      const result = await validateMobileUniqueness('', mockDb);
      expect(result.isUnique).toBe(false);
      expect(result.allowRegistration).toBe(false);
    });

    it('should reject mobile number shorter than 10 digits', async () => {
      const result = await validateMobileUniqueness('987654321', mockDb);
      expect(result.isUnique).toBe(false);
      expect(result.allowRegistration).toBe(false);
    });

    it('should handle mobile with spaces', async () => {
      mockDb.seedUser({ phone: '9876543210' });
      const result = await validateMobileUniqueness('98765 43210', mockDb);
      expect(result.isUnique).toBe(false);
      expect(result.error).toBe('This mobile number is already in use');
    });
  });

  describe('Phone Normalization and Format Helpers', () => {
    it('should remove spaces from phone number', () => {
      expect(normalizePhone('98765 43210')).toBe('9876543210');
    });

    it('should remove hyphens from phone number', () => {
      expect(normalizePhone('98765-43210')).toBe('9876543210');
    });

    it('should remove parentheses from phone number', () => {
      expect(normalizePhone('(98765) 43210')).toBe('9876543210');
    });

    it('should accept valid Indian mobile starting with 6', () => {
      expect(isValidMobileFormat('6123456789')).toBe(true);
    });

    it('should accept valid Indian mobile starting with 7', () => {
      expect(isValidMobileFormat('7123456789')).toBe(true);
    });

    it('should accept valid Indian mobile starting with 8', () => {
      expect(isValidMobileFormat('8123456789')).toBe(true);
    });

    it('should accept valid Indian mobile starting with 9', () => {
      expect(isValidMobileFormat('9876543210')).toBe(true);
    });

    it('should reject number starting with 0-5', () => {
      expect(isValidMobileFormat('5123456789')).toBe(false);
      expect(isValidMobileFormat('0123456789')).toBe(false);
    });

    it('should reject number shorter than 10 digits', () => {
      expect(isValidMobileFormat('987654321')).toBe(false);
    });

    it('should reject non-numeric input', () => {
      expect(isValidMobileFormat('abcdefghij')).toBe(false);
    });
  });

  describe('Concurrency / Rapid Sequential Registration', () => {
    it('should prevent duplicate registration in rapid succession', async () => {
      const email = 'rapid@test.com';
      const result1 = await simulateRegister(mockDb, { name: 'User 1', email, password: 'password123' });
      expect(result1.status).toBe(201);

      await expect(simulateRegister(mockDb, { name: 'User 2', email, password: 'password456' }))
        .rejects.toThrow('already exists');
    });

    it('should prevent duplicate mobile in rapid succession', async () => {
      const phone = '9876543210';
      const result1 = await mockDb.create({ name: 'User 1', email: 'user1@test.com', phone });
      expect(result1.phone).toBe(phone);

      await expect(mockDb.create({ name: 'User 2', email: 'user2@test.com', phone }))
        .rejects.toThrow('phone number is already registered');
    });
  });
});
