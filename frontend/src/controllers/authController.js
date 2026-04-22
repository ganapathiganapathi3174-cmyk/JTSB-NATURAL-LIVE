import jwt from '../utils/jwt.js';
import { FirebaseUser } from '../db/firebase-db.js';

const JWT_SECRET = import.meta.env.VITE_JWT_SECRET || 'jtsb-secret-key-2026';
const TOKEN_MS = 7 * 24 * 60 * 60 * 1000;

function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
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

function makeToken(user) {
  return jwt.sign({
    sub: user.id,
    email: user.email,
    exp: Math.floor((Date.now() + TOKEN_MS) / 1000),
  }, JWT_SECRET);
}

function safeUser(u) {
  const { password, ...rest } = u;
  return rest;
}

export async function register(req) {
  const { name, email, password, referralCode } = req.body;
  const em = String(email || '').trim().toLowerCase();

  const existing = await FirebaseUser.findByEmail(em);
  if (existing) throw { status: 409, message: 'An account with this email already exists' };

  let referredBy = null;
  if (referralCode && referralCode.trim()) {
    const rc = referralCode.trim().toUpperCase();
    const referrer = await FirebaseUser.findByReferralCode(rc);
    if (!referrer) throw { status: 400, message: 'Invalid referral code' };
    referredBy = rc;
  }

  const hash = await simpleHash(password);
  const user = await FirebaseUser.create({
    name: name.trim(),
    email: em,
    phone: '',
    password: hash,
    referredBy,
  });

  return { status: 201, data: { message: 'Registration successful', token: makeToken(user), user: safeUser(user) } };
}

export async function login(req) {
  const { email, password } = req.body;
  const em = String(email || '').trim().toLowerCase();

  const user = await FirebaseUser.findByEmail(em);
  if (!user) throw { status: 401, message: 'Invalid email or password' };

  if (!user.password) {
    throw { status: 401, message: 'Invalid email or password' };
  }

  const ok = await simpleCompare(password, user.password);
  if (!ok) throw { status: 401, message: 'Invalid email or password' };

  if (user.payment_status !== 'approved') {
    throw { status: 403, message: 'Payment not approved' };
  }

  return { status: 200, data: { token: makeToken(user), user: safeUser(user) } };
}

export async function me(req, user) {
  if (!user) throw { status: 401, message: 'Not authenticated' };
  
  const freshUser = await FirebaseUser.findById(user.id || user._id);
  if (!freshUser) throw { status: 404, message: 'User not found' };

  if (freshUser.payment_status !== 'approved') {
    throw { status: 403, message: 'Payment not approved' };
  }

  const totalUsers = await FirebaseUser.count();
  let referredByName = null;
  if (freshUser.referred_by) {
    const r = await FirebaseUser.findByReferralCode(freshUser.referred_by);
    referredByName = r?.name || null;
  }

  return { status: 200, data: { user: safeUser(freshUser), platformStats: { totalUsers }, referredByName } };
}

export async function addReferralContact(req, user) {
  const { name, phone, email } = req.body;
  const userId = user.id || user._id;

  if (!name || !phone) {
    throw { status: 400, message: 'Name and phone number are required' };
  }

  const referrals = await FirebaseUser.getReferrals(userId);
  if (referrals.length >= 2) {
    throw { status: 400, message: 'Maximum 2 referral contacts allowed' };
  }

  const { FirebaseNewReferral } = await import('../db/firebase-db.js');
  const referral = await FirebaseNewReferral.create({
    user_id: userId,
    name: name.trim(),
    email: email?.trim().toLowerCase() || '',
    phone: phone.trim(),
  });

  return { status: 201, data: { message: 'Contact added', contact: referral } };
}

export async function listReferralContacts(req, user) {
  const userId = user.id || user._id;
  const { FirebaseNewReferral } = await import('../db/firebase-db.js');
  const contacts = await FirebaseNewReferral.findByUserId(userId);
  return { status: 200, data: { contacts, total: contacts.length } };
}

export async function deleteReferralContact(req, user) {
  const { contactId } = req.params;
  const { FirebaseNewReferral } = await import('../db/firebase-db.js');
  
  const contact = await FirebaseNewReferral.delete(contactId);
  if (!contact) {
    throw { status: 404, message: 'Contact not found' };
  }

  return { status: 200, data: { message: 'Contact deleted' } };
}

export async function uploadUpiQr(req, user) {
  const { upiQrUrl } = req.body;
  const userId = user.id || user._id;

  if (!upiQrUrl) {
    throw { status: 400, message: 'UPI QR image URL is required' };
  }

  await FirebaseUser.updateUpiScreenshot(userId, upiQrUrl);

  return { status: 200, data: { message: 'UPI QR uploaded', upiQrUrl, upiQrStatus: 'pending' } };
}
