import proxyClient from '../supabase/proxyClient.js';

function getSupabase() {
  return proxyClient;
}

const MAX_REFERRALS = 2;
const REFERRAL_EXPIRY_DAYS = 7;

async function hashData(data) {
  if (!data) return '';
  try {
    const encoder = new TextEncoder();
    const buf = encoder.encode(typeof data === 'string' ? data : JSON.stringify(data));
    const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return ''; }
}

async function hashPassword(password) {
  if (!password) return '';
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
  const hash = await hashPassword(plaintext);
  if (hash === storedHash) return true;
  if (plaintext === storedHash) return true;
  return false;
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

export const SupabaseAuth = {
  async register(email, password) {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data.user;
  },

  async login(email, password) {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password: String(password) });
    if (error) throw error;
    return data.user;
  },

  async logout() {
    const supabase = getSupabase();
    await supabase.auth.signOut();
  },

  onAuthChange(callback) {
    const supabase = getSupabase();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      callback(session?.user || null);
    });
    return { unsubscribe: () => subscription?.unsubscribe() };
  },

  getCurrentUser() {
    const supabase = getSupabase();
    return supabase.auth.getUser().then(({ data }) => data.user).catch(() => null);
  },
};

async function supabaseQuery(table, filters = {}, options = {}) {
  const supabase = getSupabase();
  let query = supabase.from(table).select(options.select || '*');
  for (const [field, value] of Object.entries(filters)) {
    if (field.endsWith('__neq')) {
      query = query.neq(field.replace('__neq', ''), value);
    } else {
      query = query.eq(field, value);
    }
  }
  if (options.orderBy) query = query.order(options.orderBy, { ascending: options.ascending || false });
  if (options.limit) query = query.limit(options.limit);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

export const SupabaseUser = {
  async _claimUnique(field, value) {
    const supabase = getSupabase();
    const id = `${field}:${String(value).toLowerCase().trim()}`;
    const { data: existing } = await supabase.from('uniques').select().eq('id', id).maybeSingle();
    if (existing) {
      const col = field === 'email' ? 'email' : 'phone';
      const { data: users } = await supabase.from('users').select('id').eq(col, String(value).toLowerCase().trim()).limit(1);
      if (users && users.length > 0) {
        throw new Error(field === 'email' ? 'This email is already registered. Please use another email or login.' : 'This mobile number is already registered.');
      }
      await supabase.from('uniques').delete().eq('id', id);
    }
    const { error } = await supabase.from('uniques').insert({ id, field, value: String(value).toLowerCase().trim(), claimed_at: new Date().toISOString() });
    if (error && error.code === '23505') {
      throw new Error(field === 'email' ? 'This email is already registered. Please use another email or login.' : 'This mobile number is already registered.');
    }
  },

  async create(userData) {
    const now = new Date().toISOString();
    let referralCode;
    for (let i = 0; i < 3; i++) {
      referralCode = generateReferralCode();
      const existing = await SupabaseUser.findByReferralCode(referralCode);
      if (!existing) break;
    }
    const hashedPw = await hashPasswordCached(userData.password || '');
    const supabase = getSupabase();
    const userDoc = {
      name: userData.name,
      email: userData.email.toLowerCase(),
      phone: userData.phone || '',
      password: hashedPw,
      status: 'pending',
      payment_status: 'pending',
      membershipStatus: 'inactive',
      sponsorId: userData.sponsorId || null,
      sponsorRenewalRequired: false,
      reviewRequired: false,
      upi_screenshot_url: null,
      utr_number: null,
      referral_code: referralCode,
      referred_by: userData.referredBy || null,
      referred_by_status: userData.referredBy ? 'pending' : null,
      referrals_count: 0,
      total_referral_count: 0,
      referral_limit_reached: false,
      referral_active: true,
      referral_view_count: 0,
      account_status: 'inactive',
      is_active: false,
      is_first_payment_done: false,
      joinedDate: null,
      approvedDate: null,
      lastActiveAt: null,
      created_at: now,
      referral_created_at: now,
      referral_expires_at: computeReferralExpiryDate(),
    };
    await this._claimUnique('email', userData.email);
    if (userData.phone) await this._claimUnique('phone', userData.phone);
    const { data, error } = await supabase.from('users').insert(userDoc).select().single();
    if (error) throw new Error(error.message);
    return { id: data.id, ...data };
  },

  async createWithPassword(userData) {
    const now = new Date().toISOString();
    const pass = userData.password || '';
    const hashedPass = await hashPasswordCached(pass);
    let referralCode;
    for (let i = 0; i < 3; i++) {
      referralCode = generateReferralCode();
      const existing = await SupabaseUser.findByReferralCode(referralCode);
      if (!existing) break;
    }
    const supabase = getSupabase();
    const userDoc = {
      name: userData.name,
      email: userData.email.toLowerCase(),
      phone: userData.phone || '',
      password: hashedPass,
      status: 'pending',
      payment_status: 'pending',
      membershipStatus: 'inactive',
      membershipPaid: false,
      sponsorId: userData.sponsorId || null,
      sponsorRenewalRequired: false,
      renewalRequired: false,
      inactiveReason: null,
      reviewRequired: false,
      referral_code: referralCode,
      referred_by: userData.referredBy || null,
      referred_by_status: userData.referredBy ? 'pending' : null,
      referrals_count: 0,
      total_referral_count: 0,
      referral_limit_reached: false,
      referral_active: true,
      referral_view_count: 0,
      account_status: 'inactive',
      is_active: false,
      is_first_payment_done: false,
      approved: false,
      active: false,
      loginEnabled: userData.loginEnabled === true,
      joinedDate: null,
      approvedDate: null,
      lastActiveAt: null,
      created_at: now,
      referral_created_at: now,
      referral_expires_at: computeReferralExpiryDate(),
    };
    await this._claimUnique('email', userData.email);
    if (userData.phone) await this._claimUnique('phone', userData.phone);
    const { data, error } = await supabase.from('users').insert(userDoc).select().single();
    if (error) throw new Error(error.message);
    const newId = data.id;
    if (userData.referredBy) {
      try {
        const referralCode = userData.referredBy.toUpperCase();
        const referrer = await SupabaseUser.findByReferralCode(referralCode);
        if (referrer) {
          const isExpired = referrer.referral_expires_at && new Date(referrer.referral_expires_at) < new Date();
          if (isExpired) {
            await supabase.from('users').update({ referred_by: null }).eq('id', newId);
          } else if (referrer.id !== newId) {
            const rl = referrer.referrals_count || 0;
            const isRA = referrer.referral_active !== false;
            const isPA = referrer.payment_status === 'approved';
            const isAA = referrer.account_status === 'active';
            const isSusp = referrer.admin_status === 'suspicious';
            if (rl >= 2 || !isRA || !isPA || !isAA || isSusp) {
              await supabase.from('users').update({ referred_by: null }).eq('id', newId);
            } else {
              await supabase.from('users').update({ referred_by: referralCode, referred_by_status: 'pending' }).eq('id', newId);
            }
          }
        }
      } catch (e) { console.warn('Failed to process referral:', e); }
    }
    return { id: newId, ...userDoc };
  },

  async findByEmail(email) {
    const supabase = getSupabase();
    const { data } = await supabase.from('users').select().eq('email', email.toLowerCase()).maybeSingle();
    return data || null;
  },

  async findByPhone(phone) {
    const supabase = getSupabase();
    const { data } = await supabase.from('users').select().eq('phone', phone.trim()).maybeSingle();
    return data || null;
  },

  async findByEmailAndPassword(email, password) {
    const supabase = getSupabase();
    const { data } = await supabase.from('users').select().eq('email', email.toLowerCase()).maybeSingle();
    if (!data) return null;
    const match = await comparePassword(password, data.password);
    if (!match) return null;
    return { id: data.id, ...data };
  },

  async findById(id) {
    const supabase = getSupabase();
    const { data } = await supabase.from('users').select().eq('id', id).maybeSingle();
    return data || null;
  },

  async findByReferralCode(code) {
    const supabase = getSupabase();
    const { data } = await supabase.from('users').select().eq('referral_code', code.toUpperCase()).maybeSingle();
    return data || null;
  },

  async getReferralsByReferrerCode(referralCode) {
    if (!referralCode) return [];
    const supabase = getSupabase();
    const { data } = await supabase.from('users').select().eq('referred_by', referralCode.toUpperCase());
    return (data || []).filter(u => u.referred_by_status === 'approved' || !u.referred_by_status);
  },

  async getAllReferralsByReferrerCode(referralCode) {
    if (!referralCode) return [];
    const supabase = getSupabase();
    const { data } = await supabase.from('users').select().eq('referred_by', referralCode.toUpperCase());
    return data || [];
  },

  async getReferredUsers(referralCode) { return this.getReferralsByReferrerCode(referralCode); },

  async getReferrerInfo(referralCode) {
    if (!referralCode) return null;
    const referrer = await this.findByReferralCode(referralCode);
    if (!referrer) return null;
    return { id: referrer.id, name: referrer.name, email: referrer.email };
  },

  async countReferralsUsed(referralCode) {
    if (!referralCode) return 0;
    const users = await this.getReferralsByReferrerCode(referralCode);
    return users.length;
  },

  async updatePassword(id, newPassword) {
    const supabase = getSupabase();
    const hashed = await hashPasswordCached(newPassword);
    const { error } = await supabase.from('users').update({ password: hashed }).eq('id', id);
    if (error) throw error;
    return true;
  },

  async updateReferralCode(id, refCode) {
    const user = await this.findById(id);
    if (user?.referred_by) return;
    const referrer = await this.findByReferralCode(refCode);
    const supabase = getSupabase();
    if (referrer && referrer.id !== id) {
      const isActive = referrer.referral_active !== false;
      const hasReachedLimit = (referrer.referrals_count || 0) >= 2;
      if (!isActive || hasReachedLimit) throw new Error('Referral code is no longer valid');
      await supabase.from('users').update({ referred_by: refCode, referred_by_status: 'pending' }).eq('id', id);
    }
  },

  async setUserPassword(id, password) {
    const supabase = getSupabase();
    const hashed = await hashPasswordCached(password);
    await supabase.from('users').update({ password: hashed }).eq('id', id);
  },

  async addReferral(userId, referralData) {
    const user = await SupabaseUser.findById(userId);
    if (!user) throw new Error('User not found');
    const existingReferrals = await SupabaseUser.getReferrals(userId);
    if (existingReferrals.length >= MAX_REFERRALS) throw new Error(`Maximum ${MAX_REFERRALS} referrals allowed`);
    const supabase = getSupabase();
    const { data, error } = await supabase.from('referrals').insert({
      user_id: userId, name: referralData.name, email: referralData.email.toLowerCase(),
      phone: referralData.phone || '', created_at: new Date().toISOString(),
    }).select().single();
    if (error) throw new Error(error.message);
    await SupabaseUser.incrementReferralCount(userId);
    return { id: data.id, ...data };
  },

  async removeReferral(userId, referralId) {
    const supabase = getSupabase();
    const { data } = await supabase.from('referrals').select().eq('id', referralId).maybeSingle();
    if (!data) throw new Error('Referral not found');
    await supabase.from('referrals').delete().eq('id', referralId);
    await SupabaseUser.decrementReferralCount(userId);
  },

  async getReferrals(userId) {
    const supabase = getSupabase();
    const { data } = await supabase.from('referrals').select().eq('user_id', userId);
    return data || [];
  },

  async deleteUser(id, { email, phone } = {}) {
    const supabase = getSupabase();
    const user = await SupabaseUser.findById(id).catch(() => null);
    const deletions = [];
    if (user?.referred_by && user?.referred_by_status === 'approved') {
      SupabaseUser.findByReferralCode(user.referred_by).then(r => { if (r) SupabaseUser.decrementReferralCount(r.id).catch(() => {}); }).catch(() => {});
    }
    const getRefs = async (table, field, val) => {
      const { data } = await supabase.from(table).select('id').eq(field, val);
      return (data || []).map(r => r.id);
    };
    const [refIds, topupIds, incIds1, incIds2, notifIds1, notifIds2, walTxIds, upiIds, sponIds, procIds, verLogIds, sessIds, auditIds, delAuditIds, claimIds, transferIds, pendingRegIds] = await Promise.all([
      getRefs('referrals', 'user_id', id),
      getRefs('topups', 'userId', id),
      getRefs('topup_referral_income', 'userId', id),
      getRefs('topup_referral_income', 'fromUserId', id),
      getRefs('notifications', 'receiverId', id),
      getRefs('notifications', 'senderId', id),
      getRefs('wallet_transactions', 'userId', id),
      getRefs('upi_payments', 'userId', id),
      getRefs('sponsor_data', 'user_id', id),
      getRefs('processed_payments', 'user_id', id),
      getRefs('verification_logs', 'user_id', id),
      getRefs('payment_sessions', 'user_id', id),
      getRefs('audit_logs', 'target_id', id),
      getRefs('deletion_audit_logs', 'deleted_record_id', id),
      getRefs('sponsor_claims', 'sponsor_id', id),
      getRefs('sponsor_transfers', 'user_id', id),
      getRefs('pending_registrations', 'user_id', id),
    ]);
    const batchDel = async (table, ids) => { if (ids.length > 0) await supabase.from(table).delete().in('id', ids); };
    await Promise.all([
      batchDel('referrals', refIds),
      batchDel('topups', topupIds),
      batchDel('topup_referral_income', [...incIds1, ...incIds2]),
      batchDel('notifications', [...notifIds1, ...notifIds2]),
      batchDel('wallet_transactions', walTxIds),
      batchDel('upi_payments', upiIds),
      batchDel('sponsor_data', sponIds),
      batchDel('processed_payments', procIds),
      batchDel('verification_logs', verLogIds),
      batchDel('payment_sessions', sessIds),
      batchDel('audit_logs', auditIds),
      batchDel('deletion_audit_logs', delAuditIds),
      batchDel('sponsor_claims', claimIds),
      batchDel('sponsor_transfers', transferIds),
      batchDel('pending_registrations', pendingRegIds),
    ]);
    if (topupIds.length > 0) {
      await supabase.from('topup_audit_log').delete().in('topupId', topupIds);
    }
    await supabase.from('wallet_balances').delete().eq('id', id);
    const convoId = `admin_${id}`;
    await supabase.from('chat_messages').delete().eq('convoId', convoId);
    await supabase.from('chat_conversations').delete().eq('id', convoId);
    const ue = user?.email || email;
    const up = user?.phone || phone;
    if (ue) await supabase.from('uniques').delete().eq('id', `email:${String(ue).toLowerCase().trim()}`);
    if (up) await supabase.from('uniques').delete().eq('id', `phone:${String(up).trim()}`);
    await supabase.from('users').delete().eq('id', id);
  },

  async getAllUsers() {
    const supabase = getSupabase();
    const [usersRes, pendingRes] = await Promise.all([
      supabase.from('users').select('*').order('created_at', { ascending: false }),
      supabase.from('pending_registrations').select('*').order('created_at', { ascending: false }),
    ]);
    const normalizeDates = (u) => {
      if (u.joined_date && !u.joinedDate) u.joinedDate = u.joined_date;
      if (u.approved_date && !u.approvedDate) u.approvedDate = u.approved_date;
      if (u.last_active_at && !u.lastActiveAt) u.lastActiveAt = u.last_active_at;
      return u;
    };
    const users = (usersRes.data || []).map(normalizeDates);
    const pending = (pendingRes.data || []).map(r => ({
      id: r.id,
      name: r.name || 'Unknown',
      email: r.email || '',
      phone: r.phone || '',
      referral_code: r.referral_code || '',
      payment_status: 'pending',
      account_status: 'inactive',
      active: false,
      approved: false,
      membership_paid: false,
      referrals_count: 0,
      total_referral_count: 0,
      referral_limit_reached: false,
      referred_by: null,
      referred_by_status: null,
      sponsor_topup_completed: false,
      topup_referral_qualified: false,
      created_at: r.created_at,
      joined_date: r.created_at,
      joinedDate: r.created_at,
      approved_date: null,
      approvedDate: null,
      last_active_at: null,
      lastActiveAt: null,
      _source: 'pending_registration',
    }));
    const merged = [...users, ...pending];
    merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return merged;
  },

  async findAll() { return this.getAllUsers(); },

  async count() {
    const supabase = getSupabase();
    const { count } = await supabase.from('users').select('*', { count: 'exact', head: true });
    return count || 0;
  },

  async findByIdAndDelete(id) { return this.deleteUser(id); },
  async permanentDelete(id) { return this.deleteUser(id); },

  async updateAdminStatus(id, adminStatus) {
    const supabase = getSupabase();
    await supabase.from('users').update({ admin_status: adminStatus }).eq('id', id);
  },

  async decrementReferralCount(userId) {
    const user = await this.findById(userId);
    if (!user) return;
    const nc = Math.max(0, (user.referrals_count || 0) - 1);
    const iq = nc >= MAX_REFERRALS;
    const supabase = getSupabase();
    await supabase.from('users').update({
      referrals_count: nc,
      total_referral_count: Math.max(0, (user.total_referral_count || 0) - 1),
      referral_limit_reached: iq, referral_active: !iq, is_qualified: iq,
    }).eq('id', userId);
  },

  async incrementReferralCountByCode(referralCode) {
    const referrer = await this.findByReferralCode(referralCode);
    if (!referrer || (referrer.referral_expires_at && new Date(referrer.referral_expires_at) < new Date())) return;
    if (referrer.payment_status !== 'approved' || referrer.account_status !== 'active' || referrer.admin_status === 'suspicious' || (referrer.referrals_count || 0) >= 2) return;
    await this.incrementReferralCount(referrer.id);
  },

  async incrementReferralCount(userId) {
    const user = await this.findById(userId);
    if (!user) return;
    const nc = (user.referrals_count || 0) + 1;
    const iq = nc >= MAX_REFERRALS;
    const supabase = getSupabase();
    await supabase.from('users').update({
      referrals_count: nc,
      total_referral_count: (user.total_referral_count || 0) + 1,
      referral_limit_reached: iq, referral_active: !iq, is_qualified: iq,
    }).eq('id', userId);
  },

  async incrementReferralViewCount(id) {
    const user = await this.findById(id);
    if (!user) return null;
    const nc = (user.referral_view_count || 0) + 1;
    const supabase = getSupabase();
    await supabase.from('users').update({ referral_view_count: nc }).eq('id', id);
    return { count: nc };
  },

  subscribeToUsers(callback) {
    const supabase = getSupabase();
    const channel = supabase.channel('users-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        SupabaseUser.getAllUsers().then(callback).catch(() => callback([]));
      })
      .subscribe();
    SupabaseUser.getAllUsers().then(callback).catch(() => callback([]));
    return () => supabase.removeChannel(channel);
  },

  subscribeToUser(userId, callback) {
    const supabase = getSupabase();
    const channel = supabase.channel(`user-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: `id=eq.${userId}` }, (payload) => {
        callback(payload.new || null);
      })
      .subscribe();
    SupabaseUser.findById(userId).then(callback).catch(() => callback(null));
    return () => supabase.removeChannel(channel);
  },

  subscribeToPayments(callback) {
    const supabase = getSupabase();
    const channel = supabase.channel('payments-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        SupabaseUser.getAllUsers().then(users => callback(users.filter(u => u.payment_status || u.razorpay_payment_id))).catch(() => callback([]));
      })
      .subscribe();
    SupabaseUser.getAllUsers().then(users => callback(users.filter(u => u.payment_status || u.razorpay_payment_id))).catch(() => callback([]));
    return () => supabase.removeChannel(channel);
  },

  subscribeToUserReferrals(userId, callback) {
    const supabase = getSupabase();
    const channel = supabase.channel(`refs-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'referrals', filter: `user_id=eq.${userId}` }, () => {
        SupabaseUser.getReferrals(userId).then(callback).catch(() => callback([]));
      })
      .subscribe();
    SupabaseUser.getReferrals(userId).then(callback).catch(() => callback([]));
    return () => supabase.removeChannel(channel);
  },

  subscribeToReferralsByCode(referralCode, callback) {
    if (!referralCode) { callback([]); return () => {}; }
    const supabase = getSupabase();
    const channel = supabase.channel(`refs-code-${referralCode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: `referred_by=eq.${referralCode}` }, () => {
        SupabaseUser.getReferralsByReferrerCode(referralCode).then(callback).catch(() => callback([]));
      })
      .subscribe();
    SupabaseUser.getReferralsByReferrerCode(referralCode).then(callback).catch(() => callback([]));
    return () => supabase.removeChannel(channel);
  },

  async activateUser(userId, adminName, reason = '') {
    const user = await this.findById(userId);
    if (!user) throw new Error('User not found');
    if (user.account_status === 'active') throw new Error('User is already active');
    const supabase = getSupabase();
    const now = new Date().toISOString();
    const historyEntry = { from: user.account_status || 'inactive', to: 'active', changed_by: adminName || 'Unknown Admin', changed_at: now, reason: reason || 'Manual activation by admin' };
    const existingHistory = user.status_change_history || [];
    const updates = {
      account_status: 'active', activated_by: adminName || 'Unknown Admin', activated_at: now,
      activation_reason: reason || 'Manual activation by admin',
      status_change_history: [...existingHistory, historyEntry],
    };
    if (!user.joinedDate) updates.joinedDate = now;
    if (!user.approvedDate) updates.approvedDate = now;
    await supabase.from('users').update(updates).eq('id', userId);
    return { success: true, userId, activated: true, historyEntry };
  },

  async rejectUser(userId, adminName, reason = '') {
    const user = await this.findById(userId);
    if (!user) throw new Error('User not found');
    const supabase = getSupabase();
    const historyEntry = { from: user.account_status || 'inactive', to: 'blocked', changed_by: adminName || 'Unknown Admin', changed_at: new Date().toISOString(), reason: reason || 'Rejected' };
    const existingHistory = user.status_change_history || [];
    await supabase.from('users').update({
      account_status: 'blocked', admin_status: 'suspicious', rejected_by: adminName || 'Unknown Admin',
      rejected_at: new Date().toISOString(), rejection_reason: reason || 'Rejected',
      status_change_history: [...existingHistory, historyEntry],
    }).eq('id', userId);
    return { success: true, userId, rejected: true };
  },

  async updateTheme(id, themeColor) {
    const supabase = getSupabase();
    await supabase.from('users').update({ theme_color: themeColor }).eq('id', id);
  },

  async updateProfilePicture(id, base64DataUrl) {
    const supabase = getSupabase();
    await supabase.from('users').update({ profile_picture_url: base64DataUrl }).eq('id', id);
  },

  async removeProfilePicture(id) {
    const supabase = getSupabase();
    await supabase.from('users').update({ profile_picture_url: null }).eq('id', id);
  },

  async updateLastActive(userId) {
    if (!userId) return;
    const supabase = getSupabase();
    await supabase.from('users').update({ lastActiveAt: new Date().toISOString() }).eq('id', userId);
  },
};

export const SupabaseWallet = {
  async getBalance(userId) {
    if (!userId) return 0;
    const supabase = getSupabase();
    const { data } = await supabase.from('wallet_balances').select('balance').eq('id', userId).maybeSingle();
    return data?.balance || 0;
  },

  async listTransactions(userId, limitCount = 50) {
    if (!userId) return [];
    const supabase = getSupabase();
    const { data } = await supabase.from('wallet_transactions').select().eq('userId', userId).order('createdAt', { ascending: false }).limit(limitCount);
    return data || [];
  },

  subscribeToWallet(userId, callback) {
    if (!userId) { callback(null); return () => {}; }
    const supabase = getSupabase();
    const channel = supabase.channel(`wallet-${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wallet_balances', filter: `id=eq.${userId}` }, (payload) => {
        callback({ balance: payload.new?.balance || 0, updatedAt: payload.new?.updatedAt });
      })
      .subscribe();
    SupabaseWallet.getBalance(userId).then(b => callback({ balance: b })).catch(() => callback(null));
    return () => supabase.removeChannel(channel);
  },
};

export const SupabaseStorage = {
  compressImage(dataUrl, maxWidth = 1200, quality = 0.7) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      let settled = false;
      const done = (fn) => (v) => { if (!settled) { settled = true; fn(v); } };
      const timer = setTimeout(() => done(reject)(new Error('Image compression timed out. Unsupported format?')), 10000);
      img.onload = () => {
        clearTimeout(timer);
        try {
          const canvas = document.createElement('canvas');
          let w = img.width, h = img.height;
          if (w > maxWidth) { h = h * maxWidth / w; w = maxWidth; }
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          done(resolve)(canvas.toDataURL('image/jpeg', quality));
        } catch (e) { done(reject)(e); }
      };
      img.onerror = () => { clearTimeout(timer); done(reject)(new Error('Failed to load image for compression')); };
      img.src = dataUrl;
    });
  },
};

export async function seedDefaultAdmin() {
  // ⚠️ SECURITY: Removed hardcoded credential seeding. Admins must be
  // provisioned via the database or env vars (ADMIN_EMAIL / ADMIN_PASSWORD_HASH),
  // never via the client bundle.
  if (import.meta.env.VITE_SEED_DEFAULT_ADMIN !== 'true') {
    console.warn('seedDefaultAdmin: skipped (set VITE_SEED_DEFAULT_ADMIN=true in a non-production build to enable)');
    return;
  }
  try {
    const supabase = getSupabase();
    const { data: existing } = await supabase.from('admins').select().eq('email', 'jayaraj@gmail.com').maybeSingle();
    if (!existing) {
      await supabase.from('admins').insert({ email: 'jayaraj@gmail.com', password: 'REPLACE_WITH_HASHED_PASSWORD', createdAt: new Date().toISOString() });
    }
  } catch (e) { console.error('seedDefaultAdmin:', e.message); }
}

export async function checkReferralLinkExpiry(referralCode) {
  if (!referralCode) return { valid: false, reason: 'no_code' };
  const referrer = await SupabaseUser.findByReferralCode(referralCode);
  if (!referrer) return { valid: false, reason: 'not_found' };
  if (referrer.referral_expires_at && new Date(referrer.referral_expires_at) < new Date()) return { valid: false, reason: 'expired', referrer };
  if (referrer.referral_active === false) return { valid: false, reason: 'inactive', referrer };
  if ((referrer.referrals_count || 0) >= MAX_REFERRALS) return { valid: false, reason: 'limit_reached', referrer };
  return { valid: true, reason: 'valid', referrer };
}

export const SupabaseTopup = {
  async create(userId, { amount, transactionId, screenshotData, sessionId, verifiedViaCode }) {
    const user = await SupabaseUser.findById(userId);
    if (!user) throw new Error('User not found');
    const supabase = getSupabase();
    const topupDoc = {
      userId, userName: user.name || '', userEmail: user.email || '', userPhone: user.phone || '',
      userReferralCode: user.referral_code || '', referred_by: user.referred_by || null,
      amount: Number(amount) || 0, transactionId: transactionId || '', screenshotData: screenshotData || null,
      sessionId: sessionId || null, verifiedViaCode: verifiedViaCode || false,
      status: 'pending', adminId: null, approvedAt: null, rejectedAt: null,
      sponsorBenefitAdded: false, deleted: false, deletedAt: null, deletedBy: null,
      createdAt: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('topups').insert(topupDoc).select().single();
    if (error) throw new Error(error.message);
    return { id: data.id, ...data };
  },

  async findByUserId(userId) {
    const supabase = getSupabase();
    const { data } = await supabase.from('topups').select().eq('userId', userId).order('createdAt', { ascending: false });
    return data || [];
  },

  async findAll() {
    const supabase = getSupabase();
    const { data } = await supabase.from('topups').select().order('createdAt', { ascending: false });
    return data || [];
  },

  async findById(id) {
    const supabase = getSupabase();
    const { data } = await supabase.from('topups').select().eq('id', id).maybeSingle();
    return data || null;
  },

  async updateStatus(id, status, adminId) {
    const topup = await SupabaseTopup.findById(id);
    if (!topup) throw new Error('Topup not found');
    if (topup.status !== 'pending') throw new Error('Topup already ' + topup.status);
    const supabase = getSupabase();
    const updateData = { status, adminId: adminId || 'admin' };
    if (status === 'approved') updateData.approvedAt = new Date().toISOString();
    else if (status === 'rejected') updateData.rejectedAt = new Date().toISOString();
    await supabase.from('topups').update(updateData).eq('id', id);
    if (status === 'approved') {
      try { await SupabaseTopupReferral.processTopupReferral(topup); } catch (e) { console.warn('processTopupReferral warning (non-fatal):', e); }
      const { data: tu } = await supabase.from('users').select().eq('id', topup.userId).maybeSingle();
      if (tu && tu.topup_referral_qualified && !tu.sponsor_topup_completed) {
        await supabase.from('users').update({
          account_status: 'inactive', sponsor_topup_completed: true, sponsor_awaiting_credit: true,
          sponsor_topup_id: topup.id, sponsor_topup_amount: Number(topup.amount) || 0, inactive_reason: 'own_topup_completed',
        }).eq('id', topup.userId);
        const { data: locked } = await supabase.from('topup_referral_income').select('id').eq('userId', topup.userId).eq('status', 'locked');
        if (locked && locked.length > 0) await supabase.from('topup_referral_income').update({ status: 'eligible' }).in('id', locked.map(r => r.id));
      }
    }
    return { id, ...topup, ...updateData };
  },

  async delete(id) {
    const supabase = getSupabase();
    const { data } = await supabase.from('topups').select().eq('id', id).maybeSingle();
    if (!data) throw new Error('Topup not found');
    await supabase.from('topups').delete().eq('id', id);
    return { id, ...data };
  },

  async getSponsorsAwaitingCredit() {
    const supabase = getSupabase();
    const { data } = await supabase.from('users').select().eq('sponsor_awaiting_credit', true);
    return (data || []).sort((a, b) => {
      if (a.sponsor_credited !== b.sponsor_credited) return a.sponsor_credited ? 1 : -1;
      return 0;
    });
  },

  async creditSponsor(userId, amount, adminId) {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('users').select().eq('id', userId).maybeSingle();
    if (!user) throw new Error('User not found');
    if (!user.sponsor_awaiting_credit) throw new Error('User is not awaiting credit');
    if (user.sponsor_credited) throw new Error('User already credited');
    await supabase.from('users').update({
      sponsor_credited: true, sponsor_credited_amount: Number(amount) || 0,
      sponsor_credited_at: new Date().toISOString(), sponsor_credited_by: adminId || 'admin',
      sponsor_awaiting_credit: false, sponsor_cycle_completed: true,
    }).eq('id', userId);
    const { data: eligible } = await supabase.from('topup_referral_income').select('id').eq('userId', userId).eq('status', 'eligible');
    if (eligible && eligible.length > 0) await supabase.from('topup_referral_income').update({ status: 'claimed', claimedAt: new Date().toISOString() }).in('id', eligible.map(r => r.id));
    return { userId, amount: Number(amount) || 0, credited: true };
  },

  async reactivateSponsor(userId) {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('users').select().eq('id', userId).maybeSingle();
    if (!user) throw new Error('User not found');
    const updateData = {
      account_status: 'active', sponsor_topup_completed: false, sponsor_awaiting_credit: false,
      sponsor_credited: false, sponsor_credited_amount: 0, sponsor_topup_id: null,
      sponsor_topup_amount: 0, inactive_reason: null, sponsor_cycle_completed: true,
    };
    if (user.is_qualified || user.referral_limit_reached) {
      updateData.is_qualified = false; updateData.referrals_count = 0;
      updateData.referral_limit_reached = false; updateData.referral_active = true;
    }
    await supabase.from('users').update(updateData).eq('id', userId);
    return { userId, activated: true };
  },

  async softDelete(id, adminId, reason) {
    const topup = await SupabaseTopup.findById(id);
    if (!topup) throw new Error('Topup not found');
    if (topup.deleted) throw new Error('Topup already deleted');
    const supabase = getSupabase();
    const now = new Date().toISOString();
    await supabase.from('topups').update({ deleted: true, deletedAt: now, deletedBy: adminId || 'Unknown Admin', status: 'deleted' }).eq('id', id);
    await supabase.from('topup_audit_log').insert({ action: 'delete', adminId: adminId || 'Unknown Admin', topupId: id, reason: reason || '', previousData: { status: topup.status, deleted: false }, timestamp: now });
    return { success: true, id, deleted: true };
  },

  async restore(id, adminId, reason) {
    const topup = await SupabaseTopup.findById(id);
    if (!topup) throw new Error('Topup not found');
    if (!topup.deleted) throw new Error('Topup is not deleted');
    const supabase = getSupabase();
    const now = new Date().toISOString();
    await supabase.from('topups').update({ deleted: false, deletedAt: null, deletedBy: null, status: 'success' }).eq('id', id);
    await supabase.from('topup_audit_log').insert({ action: 'restore', adminId: adminId || 'Unknown Admin', topupId: id, reason: reason || '', previousData: { status: topup.status, deleted: true }, timestamp: now });
    return { success: true, id, restored: true };
  },

  async findDeleted() {
    const supabase = getSupabase();
    const { data } = await supabase.from('topups').select().eq('deleted', true).order('createdAt', { ascending: false });
    return data || [];
  },

  async getAuditLog(topupId) {
    const supabase = getSupabase();
    const { data } = await supabase.from('topup_audit_log').select().eq('topupId', topupId).order('timestamp', { ascending: false });
    return data || [];
  },

  async getDeletedCount() {
    const supabase = getSupabase();
    const { count } = await supabase.from('topups').select('*', { count: 'exact', head: true }).eq('deleted', true);
    return count || 0;
  },

  subscribeToTopups(callback) {
    const supabase = getSupabase();
    const channel = supabase.channel('topups-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'topups' }, () => {
        SupabaseTopup.findAll().then(callback).catch(() => callback([]));
      })
      .subscribe();
    SupabaseTopup.findAll().then(callback).catch(() => callback([]));
    return () => supabase.removeChannel(channel);
  },

  subscribeToUserTopups(userId, callback) {
    const supabase = getSupabase();
    const channel = supabase.channel(`topups-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'topups', filter: `userId=eq.${userId}` }, () => {
        SupabaseTopup.findByUserId(userId).then(callback).catch(() => callback([]));
      })
      .subscribe();
    SupabaseTopup.findByUserId(userId).then(callback).catch(() => callback([]));
    return () => supabase.removeChannel(channel);
  },
};

export const SupabaseTopupReferral = {
  async processTopupReferral(topup) {
    if (!topup || topup.sponsorBenefitAdded) return;
    if (!topup.referred_by) return;
    const supabase = getSupabase();
    const referrer = await SupabaseUser.findByReferralCode(topup.referred_by);
    if (!referrer) return;
    const { data: sponsorTopups } = await supabase.from('topups').select('id').eq('userId', referrer.id).eq('status', 'approved').limit(1);
    const sponsorHasTopup = sponsorTopups && sponsorTopups.length > 0;
    const incomeStatus = sponsorHasTopup ? 'eligible' : 'locked';
    await supabase.from('topup_referral_income').insert({
      userId: referrer.id, userName: referrer.name || '', userEmail: referrer.email || '',
      fromUserId: topup.userId, fromUserName: topup.userName || '', topupId: topup.id,
      amount: Number(topup.amount) || 0, status: incomeStatus, claimedAt: null,
      createdAt: new Date().toISOString(),
    });
    const ctc = referrer.topup_referrals_count || 0;
    const ntc = ctc + 1;
    const cc = (referrer.referrals_count || 0) + ntc;
    const tq = ntc >= MAX_REFERRALS || cc >= MAX_REFERRALS;
    await supabase.from('users').update({ topup_referrals_count: ntc, topup_referral_qualified: tq }).eq('id', referrer.id);
    if (topup.userId) {
      await supabase.from('users').update({ referred_by_status: 'approved' }).eq('id', topup.userId);
    }
    await supabase.from('topups').update({ sponsorBenefitAdded: true }).eq('id', topup.id);
  },

  async claimTopupIncome(incomeId) {
    const supabase = getSupabase();
    const { data } = await supabase.from('topup_referral_income').select().eq('id', incomeId).maybeSingle();
    if (!data) throw new Error('Income record not found');
    if (data.status !== 'eligible') throw new Error('Income is not eligible for claiming');
    await supabase.from('topup_referral_income').update({ status: 'claimed', claimedAt: new Date().toISOString() }).eq('id', incomeId);
    return { id: incomeId, ...data, status: 'claimed' };
  },

  async getIncomeByUserId(userId) {
    const supabase = getSupabase();
    const { data } = await supabase.from('topup_referral_income').select().eq('userId', userId).order('createdAt', { ascending: false });
    return data || [];
  },

  async getTotalIncomeByUserId(userId) {
    const incomes = await SupabaseTopupReferral.getIncomeByUserId(userId);
    return incomes.reduce((sum, inc) => sum + (Number(inc.amount) || 0), 0);
  },

  subscribeToIncome(userId, callback) {
    const supabase = getSupabase();
    const channel = supabase.channel(`income-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'topup_referral_income', filter: `userId=eq.${userId}` }, () => {
        SupabaseTopupReferral.getIncomeByUserId(userId).then(callback).catch(() => callback([]));
      })
      .subscribe();
    SupabaseTopupReferral.getIncomeByUserId(userId).then(callback).catch(() => callback([]));
    return () => supabase.removeChannel(channel);
  },

  async getAllIncome() {
    const supabase = getSupabase();
    const { data } = await supabase.from('topup_referral_income').select().order('createdAt', { ascending: false });
    return data || [];
  },
};

function getNotificationTitle(type) {
  const titles = {
    user_activated: 'Account Approved', user_rejected: 'Account Rejected',
    payment_approved: 'Payment Approved', payment_rejected: 'Payment Rejected',
    topup_approved: 'Top-Up Approved', topup_rejected: 'Top-Up Rejected',
    admin_approval_approved: 'Access Approved', admin_approval_rejected: 'Access Rejected',
    general: 'Notification',
  };
  return titles[type] || 'Notification';
}

export const SupabaseNotification = {
  async send({ receiverId, receiverName, title, message, type, senderId, senderName }) {
    const user = await SupabaseUser.findById(receiverId);
    if (!user) throw new Error('Recipient user not found');
    const supabase = getSupabase();
    const doc = {
      senderId: senderId || 'admin', receiverId, receiverName: receiverName || user.name || '',
      senderName: senderName || 'Admin', title: title || getNotificationTitle(type),
      message, type: type || 'general', status: 'unread', createdAt: new Date().toISOString(), readAt: null,
    };
    const { data, error } = await supabase.from('notifications').insert(doc).select().single();
    if (error) throw new Error(error.message);
    return { id: data.id, ...data };
  },

  async getByUser(userId) {
    const supabase = getSupabase();
    const { data } = await supabase.from('notifications').select().eq('receiverId', userId).order('createdAt', { ascending: false });
    return data || [];
  },

  async getAll(limitCount = 200) {
    const supabase = getSupabase();
    const { data } = await supabase.from('notifications').select().order('createdAt', { ascending: false }).limit(limitCount);
    return data || [];
  },

  async markAsRead(notificationId) {
    const supabase = getSupabase();
    await supabase.from('notifications').update({ status: 'read', readAt: new Date().toISOString() }).eq('id', notificationId);
  },

  async markAllAsRead(userId) {
    const supabase = getSupabase();
    await supabase.from('notifications').update({ status: 'read', readAt: new Date().toISOString() }).eq('receiverId', userId).eq('status', 'unread');
  },

  async getUnreadCount(userId) {
    const supabase = getSupabase();
    const { count } = await supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('receiverId', userId).eq('status', 'unread');
    return count || 0;
  },

  subscribeToUserNotifications(userId, callback) {
    const supabase = getSupabase();
    const channel = supabase.channel(`notifs-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `receiverId=eq.${userId}` }, () => {
        SupabaseNotification.getByUser(userId).then(callback).catch(() => callback([]));
      })
      .subscribe();
    SupabaseNotification.getByUser(userId).then(callback).catch(() => callback([]));
    return () => supabase.removeChannel(channel);
  },

  subscribeToAllNotifications(callback) {
    const supabase = getSupabase();
    const channel = supabase.channel('notifs-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
        SupabaseNotification.getAll().then(callback).catch(() => callback([]));
      })
      .subscribe();
    SupabaseNotification.getAll().then(callback).catch(() => callback([]));
    return () => supabase.removeChannel(channel);
  },

  async deleteNotification(notificationId) {
    const supabase = getSupabase();
    await supabase.from('notifications').delete().eq('id', notificationId);
  },
};

export const SupabaseMessage = SupabaseNotification;

export const SupabaseChat = {
  getConvoId(userId) { return `admin_${userId}`; },

  async ensureConvo(userId, userName, userEmail) {
    const supabase = getSupabase();
    const convoId = this.getConvoId(userId);
    const { data: existing } = await supabase.from('chat_conversations').select().eq('id', convoId).maybeSingle();
    if (!existing) {
      const now = new Date().toISOString();
      await supabase.from('chat_conversations').upsert({
        id: convoId, convoId, userId, userName: userName || '', userEmail: userEmail || '',
        createdAt: now, updatedAt: now, lastMessage: '', lastSenderId: '',
      });
    }
    return convoId;
  },

  async send({ senderId, receiverId, messageText }) {
    const supabase = getSupabase();
    const userId = senderId === 'admin' ? receiverId : senderId;
    const convoId = this.getConvoId(userId);
    await this.ensureConvo(userId, '', '');
    const { data, error } = await supabase.from('chat_messages').insert({
      convoId, senderId, receiverId, messageText,
      createdAt: new Date().toISOString(), isRead: false, isDelivered: true,
    }).select().single();
    if (error) throw new Error(error.message);
    await supabase.from('chat_conversations').update({ lastMessage: messageText, lastSenderId: senderId, updatedAt: new Date().toISOString() }).eq('id', convoId);
    return { id: data.id, ...data };
  },

  async getMessages(convoId) {
    const supabase = getSupabase();
    const { data } = await supabase.from('chat_messages').select().eq('convoId', convoId).order('createdAt', { ascending: true });
    return data || [];
  },

  async getConvosForAdmin() {
    const supabase = getSupabase();
    const { data } = await supabase.from('chat_conversations').select().order('updatedAt', { ascending: false });
    return data || [];
  },

  async getConvoForUser(userId) {
    const supabase = getSupabase();
    const convoId = this.getConvoId(userId);
    const { data } = await supabase.from('chat_conversations').select().eq('id', convoId).maybeSingle();
    return data || null;
  },

  async markAsRead(messageId) {
    const supabase = getSupabase();
    await supabase.from('chat_messages').update({ isRead: true }).eq('id', messageId);
  },

  async markConvoAsRead(convoId, userId) {
    const supabase = getSupabase();
    await supabase.from('chat_messages').update({ isRead: true }).eq('convoId', convoId).eq('receiverId', userId).eq('isRead', false);
  },

  async getUnreadCount(userId) {
    const supabase = getSupabase();
    const { count } = await supabase.from('chat_messages').select('*', { count: 'exact', head: true }).eq('receiverId', userId).eq('isRead', false);
    return count || 0;
  },

  subscribeToMessages(convoId, callback) {
    const supabase = getSupabase();
    const channel = supabase.channel(`msgs-${convoId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `convoId=eq.${convoId}` }, () => {
        SupabaseChat.getMessages(convoId).then(callback).catch(() => callback([]));
      })
      .subscribe();
    SupabaseChat.getMessages(convoId).then(callback).catch(() => callback([]));
    return () => supabase.removeChannel(channel);
  },

  subscribeToAdminConvos(callback) {
    const supabase = getSupabase();
    const channel = supabase.channel('convos-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations' }, () => {
        SupabaseChat.getConvosForAdmin().then(callback).catch(() => callback([]));
      })
      .subscribe();
    SupabaseChat.getConvosForAdmin().then(callback).catch(() => callback([]));
    return () => supabase.removeChannel(channel);
  },

  subscribeToUserConvo(userId, callback) {
    const supabase = getSupabase();
    const convoId = this.getConvoId(userId);
    const channel = supabase.channel(`convo-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations', filter: `id=eq.${convoId}` }, (payload) => {
        callback(payload.new || null);
      })
      .subscribe();
    SupabaseChat.getConvoForUser(userId).then(callback).catch(() => callback(null));
    return () => supabase.removeChannel(channel);
  },

  async deleteUserChatData(userId) {
    const supabase = getSupabase();
    const convoId = this.getConvoId(userId);
    await supabase.from('chat_messages').delete().eq('convoId', convoId);
    await supabase.from('chat_conversations').delete().eq('id', convoId);
  },

  async cleanupOrphanedConvos() {
    const supabase = getSupabase();
    const { data: convos } = await supabase.from('chat_conversations').select('*');
    let deleted = 0;
    for (const c of convos || []) {
      const { data: user } = await supabase.from('users').select('id').eq('id', c.userId).maybeSingle();
      if (!user) {
        await this.deleteUserChatData(c.userId);
        deleted++;
      }
    }
    return deleted;
  },
};

export { MAX_REFERRALS, REFERRAL_EXPIRY_DAYS };
export { hashPassword, hashPasswordCached, comparePassword, hashData, generateReferralCode };
