// Admin controller using Firebase
import jwt from '../utils/jwt.js';
import { FirebaseUser, FirebaseStorage } from '../db/firebase-db.js';

const SupabaseUser = FirebaseUser;
const SupabaseReferral = { 
  deleteByUserId: async (userId) => {
    const { FirebaseNewReferral } = await import('../db/firebase-db.js');
    return await FirebaseNewReferral.deleteByUserId(userId);
  },
  findByUserId: async (userId) => {
    const { FirebaseNewReferral } = await import('../db/firebase-db.js');
    return await FirebaseNewReferral.findByUserId(userId);
  }
};
const SupabaseStorage = FirebaseStorage;

const ADMIN_JWT_SECRET = import.meta.env.VITE_ADMIN_JWT_SECRET || import.meta.env.VITE_JWT_SECRET || 'frontend-dev-secret-change-in-production';

const ADMIN_EMAIL = 'jayaraj@gmail.com';
const ADMIN_PASSWORD = 'jayaraj7523';

function signAdminToken(admin) {
  const expiresInMs = 7 * 24 * 60 * 60 * 1000;
  const payload = {
    sub: admin.id,
    email: admin.email,
    role: 'admin',
    exp: Math.floor((Date.now() + expiresInMs) / 1000),
  };
  return jwt.sign(payload, ADMIN_JWT_SECRET);
}

export async function adminLogin(req) {
  const { email, password } = req.body;
  
  if (email.toLowerCase() !== ADMIN_EMAIL) {
    throw { status: 401, message: 'Invalid credentials' };
  }
  
  if (password !== ADMIN_PASSWORD) {
    throw { status: 401, message: 'Invalid credentials' };
  }
  
  const token = signAdminToken({ id: 'admin-1', email });
  
  return {
    status: 200,
    data: {
      token,
      admin: { id: 'admin-1', email: ADMIN_EMAIL },
    },
  };
}

export async function listUsers(req) {
  const q = String(req.query?.q || '').trim().toLowerCase();
  
  let users = await SupabaseUser.findAll();
  
  if (q) {
    users = users.filter(u => 
      u.name?.toLowerCase().includes(q) || 
      u.email?.toLowerCase().includes(q)
    );
  }
  
  users.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  
  const safeUsers = users.map(u => ({
    _id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    status: u.status,
    paymentStatus: u.payment_status,
    upiQrUrl: u.upi_screenshot_url,
    upiQrStatus: u.payment_status,
    referralCode: u.referral_code,
    referredBy: u.referred_by,
    referralsCount: u.referrals_count,
    referralLimitReached: u.referral_limit_reached,
    paymentApproved: u.payment_status === 'approved',
    createdAt: u.created_at,
  }));

  return {
    status: 200,
    data: { users: safeUsers, total: safeUsers.length },
  };
}

export async function deleteUser(req) {
  const { id } = req.params;
  
  const user = await SupabaseUser.findById(id);
  if (!user) {
    throw { status: 404, message: 'User not found' };
  }
  
  if (user.referred_by) {
    const referrer = await SupabaseUser.findByReferralCode(user.referred_by);
    if (referrer) {
      await SupabaseUser.decrementReferralCount(referrer.id);
    }
  }
  
  await SupabaseUser.findByIdAndDelete(id);
  
  return {
    status: 200,
    data: { message: 'User deleted' },
  };
}

export async function permanentDeleteUser(req) {
  const { id } = req.params;
  
  const user = await SupabaseUser.findById(id);
  if (!user) {
    throw { status: 404, message: 'User not found' };
  }
  
  if (user.upi_screenshot_url) {
    await SupabaseStorage.deletePaymentScreenshot(user.upi_screenshot_url);
  }
  
  await SupabaseReferral.deleteByUserId(id);
  
  if (user.referred_by) {
    const referrer = await SupabaseUser.findByReferralCode(user.referred_by);
    if (referrer) {
      await SupabaseUser.decrementReferralCount(referrer.id);
    }
  }
  
  await SupabaseUser.permanentDelete(id);
  
  return {
    status: 200,
    data: { message: 'User permanently deleted' },
  };
}

export async function dashboardStats() {
  const totalUsers = await SupabaseUser.count();
  const allUsers = await SupabaseUser.findAll();
  
  const totalReferrals = allUsers.reduce((sum, u) => sum + (u.referrals_count || 0), 0);
  const usersWithReferrals = allUsers.filter(u => u.referrals_count > 0).length;
  const usersWithoutReferrals = allUsers.filter(u => u.referrals_count === 0).length;
  const usersWhoWereReferred = allUsers.filter(u => u.referred_by !== null).length;
  const usersWhoJoinedAlone = allUsers.filter(u => u.referred_by === null).length;
  const pendingPayments = allUsers.filter(u => u.payment_status === 'pending').length;
  const approvedPayments = allUsers.filter(u => u.payment_status === 'approved').length;

  return {
    status: 200,
    data: {
      totalUsers,
      totalPayments: pendingPayments + approvedPayments,
      paymentsByStatus: { pending: pendingPayments, approved: approvedPayments, rejected: 0, suspicious: 0 },
      totalReferrals,
      usersWithReferrals,
      usersWithoutReferrals,
      usersWhoWereReferred,
      usersWhoJoinedAlone,
    },
  };
}

export async function listPayments(req) {
  const allUsers = await SupabaseUser.findAll();
  const payments = allUsers
    .filter(u => u.upi_screenshot_url)
    .map(u => ({
      _id: u.id,
      name: u.name,
      email: u.email,
      phoneNumber: u.phone,
      screenshot: u.upi_screenshot_url,
      status: u.payment_status,
      amount: Number(import.meta.env.VITE_PAYMENT_AMOUNT) || 120,
      createdAt: u.created_at,
    }));

  return {
    status: 200,
    data: { payments },
  };
}

export async function verifyPayment(req) {
  const { id } = req.params;
  const { action } = req.body;

  if (!['approved', 'rejected', 'pending'].includes(action)) {
    throw { status: 400, message: 'action must be approved, rejected, or pending' };
  }

  const user = await SupabaseUser.findById(id);
  if (!user) {
    throw { status: 404, message: 'User not found' };
  }

  await SupabaseUser.updatePaymentStatusById(id, action);

  return {
    status: 200,
    data: { message: `Payment marked ${action}` },
  };
}

export async function referralTree(req) {
  const allUsers = await SupabaseUser.findAll();
  
  const userByCode = {};
  allUsers.forEach(u => {
    if (u.referral_code) {
      userByCode[u.referral_code] = u;
    }
  });

  const tree = allUsers.map(user => {
    const referrer = user.referred_by ? userByCode[user.referred_by] : null;
    
    return {
      _id: user.id,
      name: user.name,
      email: user.email,
      referralCode: user.referral_code,
      referredBy: user.referred_by,
      referrerName: referrer?.name || null,
      referrerEmail: referrer?.email || null,
      referralsCount: user.referrals_count || 0,
      referredUsers: [],
      createdAt: user.created_at,
      paymentApproved: user.payment_status === 'approved',
    };
  });

  tree.sort((a, b) => b.referralsCount - a.referralsCount);

  return {
    status: 200,
    data: { tree, total: tree.length },
  };
}

export async function getUserReferrals(req) {
  const { id } = req.params;
  
  const user = await SupabaseUser.findById(id);
  if (!user) {
    throw { status: 404, message: 'User not found' };
  }

  const referrals = await SupabaseReferral.findByUserId(id);

  return {
    status: 200,
    data: {
      user: {
        _id: user.id,
        name: user.name,
        email: user.email,
        referralCode: user.referral_code,
        referralsCount: user.referrals_count,
      },
      referredUsers: referrals,
      total: referrals.length,
    },
  };
}

export async function filterUsersByReferral(req) {
  const { filter } = req.query;
  
  let users = await SupabaseUser.findAll();

  switch (filter) {
    case 'has_referrals':
      users = users.filter(u => u.referrals_count > 0);
      break;
    case 'no_referrals':
      users = users.filter(u => u.referrals_count === 0);
      break;
    case 'referred':
      users = users.filter(u => u.referred_by !== null);
      break;
    case 'not_referred':
      users = users.filter(u => u.referred_by === null);
      break;
    default:
      break;
  }

  users.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const safeUsers = users.map(u => ({
    _id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    status: u.status,
    paymentStatus: u.payment_status,
    upiQrUrl: u.upi_screenshot_url,
    upiQrStatus: u.payment_status,
    referralCode: u.referral_code,
    referredBy: u.referred_by,
    referralsCount: u.referrals_count,
    referralLimitReached: u.referral_limit_reached,
    createdAt: u.created_at,
  }));

  return {
    status: 200,
    data: { users: safeUsers, total: safeUsers.length, filter },
  };
}

export async function updateUserUpiQr(req) {
  const { id } = req.params;
  const { upiQrUrl } = req.body;

  const user = await SupabaseUser.findById(id);
  if (!user) {
    throw { status: 404, message: 'User not found' };
  }

  await SupabaseUser.updateUpiQrUrl(id, upiQrUrl);

  return {
    status: 200,
    data: { message: 'UPI QR updated', upiQrUrl, upiQrStatus: 'pending' },
  };
}

export async function verifyUpiQr(req) {
  const { id } = req.params;
  const { status } = req.body;

  if (!['approved', 'rejected', 'pending'].includes(status)) {
    throw { status: 400, message: 'status must be approved, rejected, or pending' };
  }

  const user = await SupabaseUser.findById(id);
  if (!user) {
    throw { status: 404, message: 'User not found' };
  }

  await SupabaseUser.updatePaymentStatusById(id, status);

  return {
    status: 200,
    data: { message: `UPI QR ${status}`, upiQrStatus: status },
  };
}

export async function getUserReferralContacts(req) {
  const { userId } = req.params;

  const contacts = await SupabaseReferral.findByUserId(userId);

  return {
    status: 200,
    data: { contacts, total: contacts.length },
  };
}