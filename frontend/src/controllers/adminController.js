import { getSupabase } from '../supabase/config.js';
import { FirebaseUser, FirebaseNewReferral } from '../db/firebase-db.js';

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL;
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;

function signAdminToken() {
  return crypto.randomUUID();
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
  
  let users = await FirebaseUser.findAll();
  
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
    membershipStatus: u.membershipStatus || 'inactive',
    accountStatus: u.account_status,
    referralCode: u.referral_code,
    referredBy: u.referred_by,
    sponsorId: u.sponsorId || null,
    referralsCount: u.referrals_count,
    referralLimitReached: u.referral_limit_reached,
    paymentApproved: u.membershipPaid === true || u.payment_status === 'approved' || u.payment_status === 'success',
    membershipPaid: u.membershipPaid,
    sponsorRenewalRequired: u.sponsorRenewalRequired || false,
    reviewRequired: u.reviewRequired || false,
    inactiveReason: u.inactive_reason || null,
    createdAt: u.created_at,
  }));

  return {
    status: 200,
    data: { users: safeUsers, total: safeUsers.length },
  };
}

export async function deleteUser(req) {
  const { id } = req.params;
  
  const user = await FirebaseUser.findById(id);
  if (!user) {
    throw { status: 404, message: 'User not found' };
  }
  
  if (user.referred_by) {
    const referrer = await FirebaseUser.findByReferralCode(user.referred_by);
    if (referrer) {
      await FirebaseUser.decrementReferralCount(referrer.id);
    }
  }
  
  await FirebaseUser.findByIdAndDelete(id);
  
  return {
    status: 200,
    data: { message: 'User deleted' },
  };
}

export async function permanentDeleteUser(req) {
  const { id } = req.params;
  
  const user = await FirebaseUser.findById(id);
  if (!user) {
    throw { status: 404, message: 'User not found' };
  }
  
  await FirebaseNewReferral.deleteByUserId(id);
  
  if (user.referred_by) {
    const referrer = await FirebaseUser.findByReferralCode(user.referred_by);
    if (referrer) {
      await FirebaseUser.decrementReferralCount(referrer.id);
    }
  }
  
  await FirebaseUser.permanentDelete(id);
  
  return {
    status: 200,
    data: { message: 'User permanently deleted' },
  };
}

export async function dashboardStats() {
  const totalUsers = await FirebaseUser.count();
  const allUsers = await FirebaseUser.findAll();
  
  const totalReferrals = allUsers.reduce((sum, u) => sum + (u.referrals_count || 0), 0);
  const usersWithReferrals = allUsers.filter(u => u.referrals_count > 0).length;
  const usersWithoutReferrals = allUsers.filter(u => u.referrals_count === 0).length;
  const usersWhoWereReferred = allUsers.filter(u => u.referred_by !== null).length;
  const usersWhoJoinedAlone = allUsers.filter(u => u.referred_by === null).length;
  const approvedPayments = allUsers.filter(u => u.membershipPaid === true || u.payment_status === 'approved' || u.payment_status === 'success').length;
  const activeUsers = allUsers.filter(u => u.account_status === 'active').length;
  const inactiveUsers = allUsers.filter(u => u.account_status === 'inactive').length;
  const pendingUsers = allUsers.filter(u => u.payment_status === 'pending' || u.account_status === 'inactive').length;
  const suspendedUsers = allUsers.filter(u => u.account_status === 'suspended').length;
  const blockedUsers = allUsers.filter(u => u.account_status === 'blocked').length;
  const sponsorsAwaitingRenewal = allUsers.filter(u => u.sponsorRenewalRequired === true).length;
  const usersNeedingReview = allUsers.filter(u => u.reviewRequired === true).length;

  return {
    status: 200,
    data: {
      totalUsers,
      activeUsers,
      inactiveUsers,
      pendingUsers,
      suspendedUsers,
      blockedUsers,
      totalPayments: approvedPayments,
      paymentsByStatus: { success: approvedPayments },
      totalReferrals,
      usersWithReferrals,
      usersWithoutReferrals,
      usersWhoWereReferred,
      usersWhoJoinedAlone,
      sponsorsAwaitingRenewal,
      usersNeedingReview,
    },
  };
}

export async function activateSponsor(req) {
  const { userId, adminName } = req.body;
  if (!userId) throw { status: 400, message: 'userId is required' };

  const user = await FirebaseUser.findById(userId);
  if (!user) throw { status: 404, message: 'User not found' };

  const db = (await import('../db/firebase-db.js')).FirebaseUser;
  const updateData = {
    account_status: 'active',
    sponsorRenewalRequired: false,
    sponsor_awaiting_credit: false,
    inactive_reason: null,
    activated_by: adminName || 'Unknown Admin',
    activated_at: new Date().toISOString(),
  };

  const supabase = getSupabase();
  await supabase.from('users').update(updateData).eq('id', userId);

  return { status: 200, data: { message: 'Sponsor activated', userId } };
}

export async function reactivateSponsor(req) {
  const { userId, adminName } = req.body;
  if (!userId) throw { status: 400, message: 'userId is required' };

  const user = await FirebaseUser.findById(userId);
  if (!user) throw { status: 404, message: 'User not found' };

  const supabase = getSupabase();
  await supabase.from('users').update({
    account_status: 'active',
    reviewRequired: false,
    referral_limit_reached: false,
    referrals_count: 0,
    is_qualified: false,
    referral_active: true,
    activated_by: adminName || 'Unknown Admin',
    activated_at: new Date().toISOString(),
  }).eq('id', userId);

  return { status: 200, data: { message: 'Sponsor reactivated', userId } };
}

export async function suspendUser(req) {
  const { userId, reason, adminName } = req.body;
  if (!userId) throw { status: 400, message: 'userId is required' };

  const user = await FirebaseUser.findById(userId);
  if (!user) throw { status: 404, message: 'User not found' };

  const supabase = getSupabase();
  await supabase.from('users').update({
    account_status: 'suspended',
    suspended_by: adminName || 'Unknown Admin',
    suspended_at: new Date().toISOString(),
    suspension_reason: reason || 'Suspended by admin',
  }).eq('id', userId);

  return { status: 200, data: { message: 'User suspended', userId } };
}

export async function blockUser(req) {
  const { userId, reason, adminName } = req.body;
  if (!userId) throw { status: 400, message: 'userId is required' };

  const user = await FirebaseUser.findById(userId);
  if (!user) throw { status: 404, message: 'User not found' };

  const supabase = getSupabase();
  await supabase.from('users').update({
    account_status: 'blocked',
    admin_status: 'suspicious',
    blocked_by: adminName || 'Unknown Admin',
    blocked_at: new Date().toISOString(),
    block_reason: reason || 'Blocked by admin',
  }).eq('id', userId);

  return { status: 200, data: { message: 'User blocked', userId } };
}

export async function listPayments(req) {
  const allUsers = await FirebaseUser.findAll();
  const payments = allUsers.map(u => ({
    _id: u.id,
    name: u.name,
    email: u.email,
    phoneNumber: u.phone,
    status: u.payment_status,
    membershipPaid: u.membershipPaid,
    razorpay_payment_id: u.razorpay_payment_id,
    razorpay_order_id: u.razorpay_order_id,
    amount: u.paymentAmount || Number(import.meta.env.VITE_PAYMENT_AMOUNT) || 120,
    createdAt: u.created_at,
  }));

  return {
    status: 200,
    data: { payments },
  };
}

export async function referralTree(req) {
  const allUsers = await FirebaseUser.findAll();
  
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
      paymentApproved: user.payment_status === 'approved' || user.payment_status === 'success',
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
  
  const user = await FirebaseUser.findById(id);
  if (!user) {
    throw { status: 404, message: 'User not found' };
  }

  const referrals = await FirebaseNewReferral.findByUserId(id);

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
  
  let users = await FirebaseUser.findAll();

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

export async function getUserReferralContacts(req) {
  const { userId } = req.params;

  const contacts = await FirebaseNewReferral.findByUserId(userId);

  return {
    status: 200,
    data: { contacts, total: contacts.length },
  };
}