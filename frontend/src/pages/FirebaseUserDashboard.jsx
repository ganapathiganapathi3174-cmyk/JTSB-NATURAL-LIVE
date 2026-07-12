import { useEffect, useState, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FirebaseUser, FirebaseStorage, FirebaseAuth, MAX_REFERRALS, FirebaseTopup, FirebaseTopupReferral, FirebaseNotification, FirebaseWallet } from '../db/firebase-db.js';
const QUOTA_KEY = 'fb_quota_exhausted';

function getLastActiveStatus(dateStr) {
  if (!dateStr) return 'inactive';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 5 * 60 * 1000) return 'online';
  if (diff < 24 * 60 * 60 * 1000) return 'recent';
  return 'inactive';
}

export default function FirebaseUserDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [topupSuccessMsg, setTopupSuccessMsg] = useState('');

  const [showReferralForm, setShowReferralForm] = useState(false);
  const [refName, setRefName] = useState('');
  const [refEmail, setRefEmail] = useState('');
  const [refPhone, setRefPhone] = useState('');
  const [addingReferral, setAddingReferral] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [referrerInfo, setReferrerInfo] = useState(null);
  const [viewCount, setViewCount] = useState(0);
  const copyCodeTimeoutRef = useRef(null);
  const copyLinkTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (copyCodeTimeoutRef.current) clearTimeout(copyCodeTimeoutRef.current);
      if (copyLinkTimeoutRef.current) clearTimeout(copyLinkTimeoutRef.current);
    };
  }, []);

  const [topups, setTopups] = useState([]);
  const [topupIncome, setTopupIncome] = useState([]);
  const [claimingId, setClaimingId] = useState(null);
  const [bulkClaiming, setBulkClaiming] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [recentNotifications, setRecentNotifications] = useState([]);
  const [showBellDropdown, setShowBellDropdown] = useState(false);
  const [profilePicFile, setProfilePicFile] = useState(null);
  const [profilePicPreview, setProfilePicPreview] = useState(null);
  const [uploadingProfilePic, setUploadingProfilePic] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);

  const userId = localStorage.getItem('fb_user_id');

  useEffect(() => {
    if (!userId) {
      navigate('/fb/login', { replace: true });
      return;
    }

    const loginAt = parseInt(localStorage.getItem('fb_login_at'), 10);
    if (!loginAt || Date.now() - loginAt > 7 * 3600 * 1000) {
      localStorage.removeItem('fb_user_id');
      localStorage.removeItem('fb_login_at');
      navigate('/fb/login', { replace: true });
      return;
    }

    const timeoutId = setTimeout(() => {
      setError('Loading is taking too long. Please check your connection and refresh the page.');
      setLoading(false);
    }, 15000);

    const unsub = FirebaseUser.subscribeToUser(userId, (data) => {
      clearTimeout(timeoutId);
      if (!data) {
        localStorage.removeItem('fb_user_id');
        localStorage.removeItem('fb_login_at');
        navigate('/fb/login');
        return;
      }
      setUser(data);
      setLoading(false);
    });

    return () => {
      clearTimeout(timeoutId);
      if (unsub) unsub();
    };
  }, [userId, navigate]);

  useEffect(() => {
    if (!user?.referral_code) return;
    const unsubscribeReferrals = FirebaseUser.subscribeToReferralsByCode(user.referral_code, (updatedReferrals) => {
      setReferrals(updatedReferrals);
    });
    return () => {
      if (unsubscribeReferrals) unsubscribeReferrals();
    };
  }, [user?.referral_code]);

  useEffect(() => {
    if (!userId || !user) return;
    FirebaseUser.updateLastActive(userId);
  }, [userId, user]);

  useEffect(() => { localStorage.removeItem(QUOTA_KEY); }, []);

  useEffect(() => {
    if (!userId) return;
    const unsub = FirebaseNotification.subscribeToUserNotifications(userId, (items) => {
      setUnreadCount(items.filter(n => n.status === 'unread').length);
      setRecentNotifications(items.slice(0, 10));
    });
    return () => { if (unsub) unsub(); };
  }, [userId]);

  useEffect(() => {
    if (user?.referred_by) {
      FirebaseUser.getReferrerInfo(user.referred_by).then(setReferrerInfo).catch(() => setReferrerInfo(null));
    } else {
      setReferrerInfo(null);
    }
  }, [user?.referred_by]);

  useEffect(() => {
    if (user?.id) {
      FirebaseUser.incrementReferralViewCount(user.id).then(result => {
        if (result) setViewCount(result.count);
      }).catch(err => console.error('View count error:', err));
    }
  }, [user?.id]);

  useEffect(() => {
    if (!userId) return;
    const unsub = FirebaseTopup.subscribeToUserTopups(userId, (data) => {
      setTopups(data || []);
    });
    return () => { if (unsub) unsub(); };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const unsub = FirebaseTopupReferral.subscribeToIncome(userId, (data) => {
      setTopupIncome(data || []);
    });
    return () => { if (unsub) unsub(); };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const unsub = FirebaseWallet.subscribeToWallet(userId, (data) => {
      if (data) setWalletBalance(data.balance || 0);
    });
    return () => { if (unsub) unsub(); };
  }, [userId]);

  async function handleLogout() {
    await FirebaseAuth.logout();
    localStorage.removeItem('fb_user_id');
    localStorage.removeItem('fb_login_at');
    navigate('/fb/login');
  }

  async function handleAddReferral(e) {
    e.preventDefault();
    if (referralCount >= MAX_REFERRALS) {
      setError('You have reached the maximum number of referrals.');
      return;
    }
    setAddingReferral(true);
    setError('');
    try {
      const tempPwd = 'Temp@' + Date.now().toString(36);
      const apiBase = import.meta.env.VITE_FUNCTIONS_URL || '/api';
      const resp = await fetch(apiBase + '/preRegister', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: refName.trim(), email: refEmail.trim(), phone: refPhone.trim(), password: tempPwd, referralCode: user?.referral_code || '' }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to add referral');
      setRefName(''); setRefEmail(''); setRefPhone(''); setShowReferralForm(false);
      alert('Referral added! They will receive login instructions via email.');
    } catch (err) { setError(err.message); }
    finally { setAddingReferral(false); }
  }

  async function handleRemoveReferral(referralId) {
    if (!window.confirm('Remove this referral?')) return;
    setError('Remove referral is not available from dashboard. Please contact support.');
  }

  function handleProfilePicSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) { setError('Only JPG, PNG, and WebP images are allowed'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Image must be under 5MB'); return; }
    setError('');
    setProfilePicFile(file);
    const reader = new FileReader();
    reader.onload = async () => {
      setProfilePicPreview(reader.result);
      await handleUploadProfilePic(reader.result);
    };
    reader.readAsDataURL(file);
  }

  async function handleUploadProfilePic(dataUrl) {
    setUploadingProfilePic(true);
    try {
      const compressed = await FirebaseStorage.compressImage(dataUrl, 400, 0.8);
      await FirebaseUser.updateProfilePicture(user.id, compressed);
      setUser(prev => ({ ...prev, profile_picture_url: compressed }));
      setProfilePicFile(null);
      setProfilePicPreview(null);
    } catch (err) { setError('Failed to upload profile picture: ' + err.message); }
    finally { setUploadingProfilePic(false); }
  }

  async function handleRemoveProfilePic() {
    if (!user?.id) return;
    setUploadingProfilePic(true);
    try {
      await FirebaseUser.removeProfilePicture(user.id);
      setUser(prev => ({ ...prev, profile_picture_url: null }));
      setProfilePicFile(null);
      setProfilePicPreview(null);
    } catch (err) { setError('Failed to remove profile picture: ' + err.message); }
    finally { setUploadingProfilePic(false); }
  }

  function handleGoToTopupPayment() {
    localStorage.setItem('fb_user_id', userId);
    navigate('/payment?mode=topup');
  }

  async function handleClaimIncome(incomeId) {
    setClaimingId(incomeId);
    try { await FirebaseTopupReferral.claimTopupIncome(incomeId); }
    catch (err) { setError(err.message); }
    finally { setClaimingId(null); }
  }

  async function handleClaimSponsorBonus() {
    if (!userId) return;
    setBulkClaiming(true);
    try {
      const API_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';
      const token = localStorage.getItem('fb_admin_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const res = await fetch(`${API_BASE}/sponsorClaim`, { method: 'POST', headers, body: JSON.stringify({ userId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to claim sponsor bonus');
      alert('Sponsor bonus claimed!');
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) { setError(err.message); }
    finally { setBulkClaiming(false); }
  }

  const totalTopupIncome = useMemo(() => topupIncome.reduce((sum, inc) => sum + (Number(inc.amount) || 0), 0), [topupIncome]);
  const approvedTopups = useMemo(() => topups.filter(t => t.status === 'approved'), [topups]);
  const lockedIncome = useMemo(() => topupIncome.filter(inc => inc.status === 'locked'), [topupIncome]);
  const eligibleIncome = useMemo(() => topupIncome.filter(inc => inc.status === 'eligible'), [topupIncome]);
  const claimedIncome = useMemo(() => topupIncome.filter(inc => inc.status === 'claimed'), [topupIncome]);
  const pendingClaimAmount = useMemo(() => eligibleIncome.reduce((sum, inc) => sum + (Number(inc.amount) || 0), 0), [eligibleIncome]);
  const userHasOwnTopup = useMemo(() => approvedTopups.length > 0, [approvedTopups]);
  const pendingTopups = useMemo(() => topups.filter(t => t.status === 'pending'), [topups]);
  const rejectedTopups = useMemo(() => topups.filter(t => t.status === 'rejected'), [topups]);
  const approvedReferralCount = referrals.length;
  const pendingReferralCount = Math.max(0, (user?.referrals_count || 0) - approvedReferralCount);
  const canAddMoreReferrals = approvedReferralCount < MAX_REFERRALS;
  const referralCount = user?.referrals_count || 0;
  const isQualified = useMemo(() => approvedReferralCount >= 2 || user?.is_qualified === true, [approvedReferralCount, user?.is_qualified]);
  const isActive = useMemo(() => user?.account_status === 'active' && (user?.payment_status === 'approved' || user?.payment_status === 'success'), [user?.account_status, user?.payment_status]);
  const isReferralLimitReached = useMemo(() => user?.inactive_reason === 'Referral Limit Reached (2 Successful Referrals)' || user?.inactive_reason === 'Referral Limit Reached', [user?.inactive_reason]);
  const isSponsorClaimPending = useMemo(() => user?.inactive_reason === 'Sponsor Claim Pending Admin Approval', [user?.inactive_reason]);
  const isSuspicious = useMemo(() => user?.admin_status === 'suspicious', [user?.admin_status]);

  if (loading) {
    return (
      <div className="page-wrap" style={{ minHeight: '100vh' }}>
        <div className="flex flex-col items-center" style={{ padding: '2rem' }}>
          {error && (
            <div className="alert-error mb-md w-full" style={{ maxWidth: 600 }}>
              {error}
            </div>
          )}
          <div className="skeleton-card w-full" style={{ maxWidth: 600 }}>
            <div className="skeleton skeleton-line-lg" />
            <div className="skeleton skeleton-line-sm" />
            <div className="mt-lg">
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line" style={{ width: '60%' }} />
            </div>
            <div className="mt-lg">
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line" style={{ width: '45%' }} />
            </div>
          </div>
          <div className="skeleton-card w-full" style={{ maxWidth: 600 }}>
            <div className="skeleton skeleton-line-lg" style={{ width: '50%' }} />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" style={{ width: '35%' }} />
          </div>
        </div>
      </div>
    );
  }

  async function copyReferralCode() {
    const code = user?.referral_code;
    if (code) {
      try { await navigator.clipboard.writeText(code); } catch {}
      setCopied(true);
      if (copyCodeTimeoutRef.current) clearTimeout(copyCodeTimeoutRef.current);
      copyCodeTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    }
  }

  async function copyReferralLink() {
    const link = window.location.origin + '/fb/register?ref=' + user?.referral_code;
    if (link) {
      try { await navigator.clipboard.writeText(link); } catch {}
      setCopiedLink(true);
      if (copyLinkTimeoutRef.current) clearTimeout(copyLinkTimeoutRef.current);
      copyLinkTimeoutRef.current = setTimeout(() => setCopiedLink(false), 2000);
    }
  }

  async function shareReferralLink() {
    const link = window.location.origin + '/fb/register?ref=' + user?.referral_code;
    const text = 'Join using my referral code: ' + user?.referral_code;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Join with my referral', text, url: link });
      } else {
        try { await navigator.clipboard.writeText(link); } catch {}
        setCopiedLink(true);
        if (copyLinkTimeoutRef.current) clearTimeout(copyLinkTimeoutRef.current);
        copyLinkTimeoutRef.current = setTimeout(() => setCopiedLink(false), 2000);
      }
    } catch {}
  }

  async function handleUpdatePassword(e) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }
    if (newPassword.length < 6) { setError('Password must be at least 6 characters'); return; }
    setUpdatingPassword(true);
    try {
      await FirebaseUser.updatePassword(userId, newPassword);
      setNewPassword(''); setConfirmPassword(''); setShowPasswordForm(false);
      alert('Password updated successfully!');
    } catch (err) { setError(err.message); }
    finally { setUpdatingPassword(false); }
  }

  return (
    <div className="page-wrap has-bottom-nav">
      {/* Top Bar */}
      <div className="flex flex-between items-center mb-md" style={{ padding: '0.75rem 0' }}>
        <div className="text-lg font-bold"><span className="text-gradient">StarlightAscent</span></div>
        <div className="flex items-center gap-md">
          <div style={{ position: 'relative' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowBellDropdown(v => !v)}
              style={{ position: 'relative', padding: '0.35rem', border: 'none', background: 'transparent', cursor: 'pointer' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unreadCount > 0 && <span className="badge badge-danger badge-xs" style={{ position: 'absolute', top: '-4px', right: '-4px' }}>{unreadCount > 9 ? '9+' : unreadCount}</span>}
            </button>
            {showBellDropdown && (
              <>
                <div className="modal-overlay" style={{ background: 'transparent' }} onClick={() => setShowBellDropdown(false)} />
                <div className="card" style={{ position: 'absolute', top: '100%', right: 0, zIndex: 100, width: '340px', maxHeight: '420px', overflowY: 'auto', marginTop: '4px', padding: 0 }}>
                  <div className="flex-between items-center" style={{ padding: '0.7rem 1rem', borderBottom: '1px solid var(--border-light)' }}>
                    <span className="font-semibold text-sm">Notifications</span>
                    <Link to="/fb/messages" className="text-sm font-semibold" onClick={() => setShowBellDropdown(false)}>View all</Link>
                  </div>
                  {recentNotifications.length === 0 ? (
                    <div className="text-muted text-sm text-center" style={{ padding: '1.5rem' }}>No notifications yet</div>
                  ) : (
                    recentNotifications.map(n => (
                      <Link to="/fb/messages" key={n.id} className="flex flex-col" style={{ padding: '0.6rem 1rem', borderBottom: '1px solid var(--border-light)', textDecoration: 'none', color: 'inherit', background: n.status === 'unread' ? 'var(--accent-light)' : 'transparent' }}
                        onClick={() => setShowBellDropdown(false)}>
                        <div className="text-sm" style={{ fontWeight: n.status === 'unread' ? 600 : 400, marginBottom: '0.15rem' }}>{n.title || 'Notification'}</div>
                        <div className="text-muted text-sm truncate">{n.message}</div>
                        <div className="text-xs" style={{ color: 'var(--muted-2)', marginTop: '0.2rem' }}>{n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}</div>
                      </Link>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Log out</button>
        </div>
      </div>

      {error && (
        <div className="alert-error mb-md animate-fade-in-up">{error}</div>
      )}
      {topupSuccessMsg && (
        <div className="alert-success mb-md animate-fade-in-up">{topupSuccessMsg}</div>
      )}

      {/* Profile Card */}
      <div className="card mb-lg animate-fade-in-up stagger-1">
        <div className="flex flex-col gap-md">
          <div className="flex items-center gap" style={{ flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: '64px', height: '64px', flexShrink: 0 }}>
              <div className="avatar-lg" style={{
                background: 'linear-gradient(135deg, var(--accent), var(--accent-purple))',
              }}>
                {user?.profile_picture_url ? (
                  <img src={user.profile_picture_url} alt={user?.name || 'User'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (user?.name ? user.name.charAt(0).toUpperCase() : '?')}
              </div>
              <input type="file" id="profile-pic-input" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={handleProfilePicSelect} />
              <button onClick={() => document.getElementById('profile-pic-input').click()} disabled={uploadingProfilePic}
                style={{ position: 'absolute', bottom: 0, right: 0, width: '24px', height: '24px', borderRadius: '50%', border: '2px solid var(--surface)', background: 'var(--accent)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '0.7rem', padding: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              </button>
              {user?.profile_picture_url && (
                <button onClick={handleRemoveProfilePic} disabled={uploadingProfilePic}
                  style={{ position: 'absolute', top: 0, right: 0, width: '20px', height: '20px', borderRadius: '50%', border: '2px solid var(--surface)', background: 'var(--danger)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '0.6rem', padding: 0 }}>
                  ✕
                </button>
              )}
              {uploadingProfilePic && <div className="skeleton" style={{ position: 'absolute', inset: 0, borderRadius: '50%' }} />}
            </div>
            <div style={{ flex: 1 }}>
              <h2 className="text-lg font-bold mb-xs" style={{ letterSpacing: '-0.02em' }}>{user?.name || 'User'}</h2>
              <p className="text-muted text-sm">{user?.email || ''}</p>
              <div className="flex items-center gap-sm mt-sm" style={{ flexWrap: 'wrap' }}>
                <span className={`badge ${user?.status === 'approved' ? 'badge-success' : user?.status === 'rejected' ? 'badge-danger' : 'badge-info'}`}>
                  {user?.status ? user.status.charAt(0).toUpperCase() + user.status.slice(1) : 'Pending'}
                </span>
                {user?.is_qualified && <span className="badge badge-primary">Qualified</span>}
                {user?.account_status === 'inactive' && !user?.sponsor_awaiting_credit && <span className="badge badge-pending">Inactive</span>}
                {user?.topup_referral_qualified && !user?.sponsor_topup_completed && !user?.sponsor_cycle_completed && pendingTopups.length === 0 && <span className="badge badge-success">Sponsor Eligible</span>}
                {user?.sponsor_awaiting_credit && !user?.sponsor_credited && <span className="badge badge-warning">Sponsor Inactive</span>}
                {user?.sponsor_credited && <span className="badge badge-success">Credited</span>}
              </div>
            </div>
            <div className="flex items-center gap-sm" style={{ flexWrap: 'wrap' }}>
              <Link to="/fb/messages" className="quick-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                Inbox{unreadCount > 0 && <span className="badge badge-danger badge-xs ml-sm">{unreadCount > 9 ? '9+' : unreadCount}</span>}
              </Link>
              <Link to="/fb/chat" className="quick-btn">Chat</Link>
              <Link to="/fb/sponsor-marketplace" className="quick-btn">Sponsor</Link>
              <Link to="/fb/sponsor-requests" className="quick-btn">Requests</Link>
            </div>
          </div>

          {user?.account_status === 'inactive' && isReferralLimitReached && (
            <div className="card-dim text-center">
              <h3 className="font-semibold text-sm mb-xs" style={{ color: 'var(--warning)' }}>Account Inactive — Waiting for Admin Approval</h3>
              <p className="text-muted text-sm">Your referral link has reached the maximum of 2 successful registrations. An admin will review and reactivate your account.</p>
            </div>
          )}
          {user?.account_status === 'inactive' && isSponsorClaimPending && (
            <div className="card-dim text-center">
              <h3 className="font-semibold text-sm mb-xs" style={{ color: 'var(--warning)' }}>Account Inactive — Waiting for Admin Approval</h3>
              <p className="text-muted text-sm">Your sponsor claim is pending admin review.</p>
            </div>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="stats-grid mb-lg animate-fade-in-up stagger-2">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div className="stat-value">{approvedReferralCount}</div>
          <div className="stat-label">Completed Referrals</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--success-light)', color: 'var(--success)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
          <div className="stat-value">₹{totalTopupIncome.toFixed(2)}</div>
          <div className="stat-label">Total Rewards</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--warning-light)', color: 'var(--warning)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 9v6"/><path d="M9 12h6"/></svg>
          </div>
          <div className="stat-value">₹{walletBalance.toFixed(2)}</div>
          <div className="stat-label">Wallet Balance</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--purple-glow)', color: 'var(--accent)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <div className={`stat-value ${user?.status === 'approved' ? 'text-gradient-success' : user?.status === 'rejected' ? 'text-gradient-danger' : 'text-gradient-warning'}`}>
            {user?.status ? user.status.charAt(0).toUpperCase() + user.status.slice(1) : 'Pending'}
          </div>
          <div className="stat-label">Account Status</div>
        </div>
      </div>

      {/* Contact Details */}
      <div className="card mb-lg animate-fade-in-up stagger-3">
        <h3 className="font-semibold mb-sm">Contact Details</h3>
        <div className="flex flex-col gap-sm">
          <div className="flex items-center gap-sm">
            <span className="text-muted text-sm" style={{ minWidth: '60px' }}>Email</span>
            <span className="text-sm font-semibold">{user?.email || '—'}</span>
          </div>
          <div className="flex items-center gap-sm">
            <span className="text-muted text-sm" style={{ minWidth: '60px' }}>Phone</span>
            <span className="text-sm font-semibold">{user?.phone || '—'}</span>
          </div>
          <div className="flex items-center gap-sm">
            <span className="text-muted text-sm" style={{ minWidth: '60px' }}>Status</span>
            <span className={`badge ${user?.account_status === 'active' ? 'badge-success' : user?.account_status === 'blocked' ? 'badge-danger' : 'badge-warning'}`}>
              {(user?.account_status || 'inactive').charAt(0).toUpperCase() + (user?.account_status || 'inactive').slice(1)}
            </span>
          </div>
          {user?.referred_by && (
            <div className="flex items-center gap-sm">
              <span className="text-muted text-sm" style={{ minWidth: '60px' }}>Referred By</span>
              <span className="text-sm font-semibold">{referrerInfo ? `${referrerInfo.name} (${referrerInfo.email})` : user.referred_by}</span>
            </div>
          )}
        </div>
      </div>

      {/* Referral Section */}
      {user?.referral_code && (
        <div className="card mb-lg animate-fade-in-up stagger-4">
          {isActive ? (
            <>
              <h3 className="text-gradient font-semibold mb-xs">Refer & Earn</h3>
              <p className="text-muted text-sm mb-md">Invite friends to earn rewards</p>

              <div className="flex items-center gap-sm mb-md" style={{ flexWrap: 'wrap' }}>
                <span className="chip">Code: <strong>{user?.referral_code}</strong></span>
                <button className={`btn btn-sm ${copied ? 'btn-success' : 'btn-primary'}`} onClick={copyReferralCode}>
                  {copied ? '✓ Copied!' : 'Copy Code'}
                </button>
                <button className={`btn btn-sm ${copiedLink ? 'btn-success' : 'btn-ghost'}`} onClick={copyReferralLink}>
                  {copiedLink ? '✓ Copied!' : 'Copy Link'}
                </button>
                {navigator.share && (
                  <button className="btn btn-sm btn-ghost" onClick={shareReferralLink}>Share</button>
                )}
              </div>

              <div className="flex items-center gap-lg mb-md" style={{ flexWrap: 'wrap' }}>
                <div className="flex items-center gap-sm">
                  <span className={`text-lg font-bold ${approvedReferralCount >= MAX_REFERRALS ? 'text-gradient-success' : ''}`}>
                    {approvedReferralCount}
                  </span>
                  <span className="text-muted text-sm">/ {MAX_REFERRALS} Completed</span>
                </div>
                {pendingReferralCount > 0 && (
                  <div className="flex items-center gap-sm">
                    <span className="text-lg font-bold" style={{ color: 'var(--warning)' }}>{pendingReferralCount}</span>
                    <span className="text-muted text-sm">Pending</span>
                  </div>
                )}
                {approvedReferralCount >= 2 && <span className="badge badge-primary">✓ Qualified</span>}
              </div>
            </>
          ) : (
            <>
              <h3 className="font-semibold mb-xs">Refer & Earn</h3>
              {isSuspicious ? (
                <p className="text-muted text-sm">Your account is currently suspended.</p>
              ) : pendingReferralCount > 0 ? (
                <p className="text-muted text-sm">Waiting for {pendingReferralCount} referral(s) to complete registration. Sponsor benefits unlock after 2 completed referrals.</p>
              ) : user?.account_status === 'inactive' && isReferralLimitReached ? (
                <p className="text-muted text-sm">Referral Link Expired — limit of 2 registrations reached. Account is inactive pending admin approval.</p>
              ) : user?.account_status === 'inactive' && isSponsorClaimPending ? (
                <p className="text-muted text-sm">Sponsor claim submitted — pending admin approval.</p>
              ) : user?.account_status === 'inactive' ? (
                <p className="text-muted text-sm">Your account is currently inactive.</p>
              ) : (
                <p className="text-muted text-sm">Referral access requires an active account.</p>
              )}
            </>
          )}
        </div>
      )}

      {/* Referral Progress */}
      {!isQualified && !isActive && !user?.is_first_payment_done && (
        <div className="card mb-lg animate-fade-in-up stagger-5">
          <h3 className="font-semibold mb-sm">Complete Referrals to Unlock Payment</h3>
          <p className="text-muted text-sm mb-md">Sponsor benefits unlock after 2 completed referrals.</p>
          {pendingReferralCount > 0 && (
            <div className="card-dim mb-sm">
              {pendingReferralCount} referral(s) pending completion. Only completed referrals count.
            </div>
          )}
          <div className="progress-container">
            <div className="progress-bar-wrap">
              <div className="progress-bar-fill" style={{ width: `${Math.min((approvedReferralCount / 2) * 100, 100)}%` }} />
            </div>
            <span className="progress-label">{approvedReferralCount} / 2 completed</span>
          </div>
        </div>
      )}

      {/* Topup Section */}
      <div className="card mb-lg animate-fade-in-up stagger-5">
        <h3 className="font-semibold mb-xs flex items-center gap-sm">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          Topup
        </h3>
        <p className="text-muted text-sm mb-md">Add funds to your wallet via UPI. Payment is verified automatically.</p>

        <div className="stats-grid mb-md" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="stat-card text-center">
            <div className="text-lg font-bold" style={{ color: 'var(--success)' }}>{approvedTopups.length}</div>
            <div className="text-sm text-muted">Approved</div>
          </div>
          <div className="stat-card text-center">
            <div className="text-lg font-bold" style={{ color: 'var(--warning)' }}>{pendingTopups.length}</div>
            <div className="text-sm text-muted">Pending</div>
          </div>
          <div className="stat-card text-center">
            <div className="text-lg font-bold" style={{ color: 'var(--danger)' }}>{rejectedTopups.length}</div>
            <div className="text-sm text-muted">Rejected</div>
          </div>
          <div className="stat-card text-center">
            <div className="text-lg font-bold text-gradient">₹{totalTopupIncome.toFixed(2)}</div>
            <div className="text-sm text-muted">Total Income</div>
          </div>
        </div>

        {!isReferralLimitReached && !isSponsorClaimPending && (
          <button className="btn btn-primary mb-md" onClick={handleGoToTopupPayment}>
            Submit Topup Request
          </button>
        )}

        {topups.length > 0 && (
          <div className="mt-md">
            <h4 className="font-semibold text-sm mb-sm">Topup History</h4>
            <div className="table-wrap">
              <table style={{ minWidth: 500 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Transaction ID</th>
                    <th>Status</th>
                    <th>Sponsor Benefit</th>
                  </tr>
                </thead>
                <tbody>
                  {topups.map(t => (
                    <tr key={t.id}>
                      <td className="text-sm">{t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '—'}</td>
                      <td className="font-semibold">₹{Number(t.amount || 0).toFixed(2)}</td>
                      <td className="text-sm">{t.transactionId || '—'}</td>
                      <td>
                        <span className={`badge ${t.status === 'approved' ? 'badge-success' : t.status === 'rejected' ? 'badge-danger' : 'badge-warning'}`}>
                          {t.status ? t.status.charAt(0).toUpperCase() + t.status.slice(1) : 'Pending'}
                        </span>
                      </td>
                      <td>{t.status === 'approved' ? <span className="badge badge-success">Done</span> : <span className="text-muted text-xs">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mt-md">
          <h4 className="font-semibold text-sm mb-sm">Topup Referral Income</h4>

          {!userHasOwnTopup && (
            <div className="card-dim mb-md">
              <strong>Topup required!</strong> Complete your own topup to unlock referral income claims.
            </div>
          )}

          {lockedIncome.length > 0 && (
            <div className="card-dim mb-md">
              <strong>{lockedIncome.length} income record(s) locked.</strong> Complete your own topup to make them eligible.
            </div>
          )}

          {pendingClaimAmount > 0 && (
            <div className="card-dim mb-md flex-between items-center" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
              <span><strong>₹{pendingClaimAmount.toFixed(2)}</strong> eligible for claim!</span>
              {userHasOwnTopup && !user?.sponsor_awaiting_credit && !user?.sponsor_credited && (
                <button className="btn btn-primary btn-sm" onClick={handleClaimSponsorBonus} disabled={bulkClaiming}>
                  {bulkClaiming ? 'Claiming...' : 'Claim Sponsor Bonus'}
                </button>
              )}
            </div>
          )}

          <div className="table-wrap">
            <table style={{ minWidth: 400 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>From</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {topupIncome.map(inc => (
                  <tr key={inc.id}>
                    <td className="text-sm">{inc.createdAt ? new Date(inc.createdAt).toLocaleDateString() : '—'}</td>
                    <td className="text-sm">{inc.fromUserName || inc.fromUserId || '—'}</td>
                    <td className="font-semibold" style={{ color: inc.status === 'claimed' ? 'var(--muted)' : 'var(--success)' }}>+₹{Number(inc.amount || 0).toFixed(2)}</td>
                    <td>
                      {inc.status === 'locked' && <span className="badge badge-warning">Locked</span>}
                      {inc.status === 'eligible' && <span className="badge badge-success">Eligible</span>}
                      {inc.status === 'claimed' && <span className="badge badge-pending">Claimed</span>}
                      {!inc.status && <span className="badge badge-info">Pending</span>}
                    </td>
                    <td>
                      {inc.status === 'eligible' && userHasOwnTopup && !user?.sponsor_awaiting_credit && (
                        <button className="btn btn-primary btn-sm" onClick={() => handleClaimIncome(inc.id)} disabled={claimingId === inc.id}>
                          {claimingId === inc.id ? '...' : 'Claim'}
                        </button>
                      )}
                      {(inc.status === 'eligible' && user?.sponsor_awaiting_credit) && <span className="badge badge-warning text-xs">Pending Credit</span>}
                      {(inc.status === 'locked' || inc.status === 'claimed' || !inc.status) && <span className="text-muted text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Password */}
      <div className="card mb-lg animate-fade-in-up stagger-5">
        <div className="flex-between items-center">
          <div>
            <span className="font-semibold text-sm">Password</span>
            <span className={`chip ml-sm ${user?.password ? 'badge-success' : 'badge-danger'}`}>
              {user?.password ? 'Set' : 'Not Set'}
            </span>
          </div>
          <button className={`btn btn-sm ${user?.password ? 'btn-ghost' : 'btn-primary'}`} onClick={() => setShowPasswordForm(!showPasswordForm)}>
            {showPasswordForm ? 'Cancel' : user?.password ? 'Change' : 'Set Password'}
          </button>
        </div>

        {showPasswordForm && (
          <form onSubmit={handleUpdatePassword} className="mt-md">
            <div className="field-glass mb-sm">
              <input type={showPassword ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={6} required placeholder="New Password" />
            </div>
            <div className="field-glass mb-md">
              <input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} minLength={6} required placeholder="Confirm Password" />
            </div>
            <div className="flex items-center gap-sm">
              <button type="submit" className={`btn btn-primary btn-sm${updatingPassword ? ' btn-loading' : ''}`} disabled={updatingPassword}>
                {updatingPassword ? 'Saving...' : 'Save Password'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Referrals List */}
      {(user?.payment_status === 'approved' || user?.payment_status === 'success') && (
        <div className="card mb-lg animate-fade-in-up stagger-5">
          <div className="flex-between items-center mb-md">
            <h3 className="font-semibold text-sm">My Referrals ({approvedReferralCount})</h3>
            <span className="badge badge-info">Views: {viewCount}</span>
          </div>

          {pendingReferralCount > 0 && (
            <div className="card-dim mb-md">
              Waiting for {pendingReferralCount} referral(s) to complete registration.
            </div>
          )}

          {approvedReferralCount === 0 ? (
            <p className="text-muted text-sm">No referrals yet. Share your referral code to invite members.</p>
          ) : (
            <div className="card-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
              {referrals.map(ref => (
                <div key={ref.id} className="card-dim">
                  <div className="font-semibold text-sm">{ref.name}</div>
                  <div className="text-muted text-xs">{ref.email}</div>
                  <div className="text-muted text-xs">{ref.phone || '—'}</div>
                </div>
              ))}
            </div>
          )}

          {!canAddMoreReferrals && isActive && (
            <p className="text-muted text-sm mt-md">You have reached the maximum of {MAX_REFERRALS} referrals.</p>
          )}
        </div>
      )}

      {/* Activity */}
      <div className="card mb-lg animate-fade-in-up stagger-5">
        <h3 className="font-semibold text-sm mb-sm flex items-center gap-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Recent Activity
        </h3>
        {recentNotifications.length === 0 ? (
          <p className="text-muted text-sm">No recent activity.</p>
        ) : (
          <div className="flex flex-col">
            {recentNotifications.slice(0, 5).map(n => (
              <div key={n.id} className="flex items-start gap-sm" style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border-light)' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', marginTop: '0.35rem', flexShrink: 0, background: n.status === 'unread' ? 'var(--accent)' : 'var(--muted-2)' }} />
                <div style={{ flex: 1 }}>
                  <div className="text-sm" style={{ fontWeight: n.status === 'unread' ? 600 : 400 }}>{n.title || 'Notification'}</div>
                  <div className="text-muted text-sm truncate">{n.message}</div>
                  <div className="text-xs" style={{ color: 'var(--muted-2)', marginTop: '0.1rem' }}>{n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}</div>
                </div>
                <Link to="/fb/messages" className="text-sm" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>View</Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="card mb-lg animate-fade-in-up stagger-5">
        <h3 className="font-semibold text-sm mb-sm flex items-center gap-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Activity Timeline
        </h3>
        {recentNotifications.length === 0 ? (
          <p className="text-muted text-sm">No timeline events yet.</p>
        ) : (
          <div style={{ position: 'relative', paddingLeft: '1.25rem' }}>
            <div style={{ position: 'absolute', left: '0.4rem', top: '0.25rem', bottom: '0.25rem', width: '2px', background: 'var(--border)' }} />
            {recentNotifications.filter(n => n.type && (n.type.includes('approv') || n.type.includes('reject') || n.type.includes('activat'))).map(n => (
              <div key={n.id} style={{ position: 'relative', paddingLeft: '1rem', paddingBottom: '1rem' }}>
                <div style={{ position: 'absolute', left: '-1.3rem', top: '0.35rem', width: '12px', height: '12px', borderRadius: '50%', background: n.type.includes('reject') ? 'var(--danger)' : 'var(--success)', border: '2px solid var(--surface)', boxShadow: '0 0 0 2px var(--border)' }} />
                <div className="font-semibold text-sm">{n.title || 'Update'}</div>
                <div className="text-muted text-sm mt-xs">{n.message}</div>
                <div className="text-xs" style={{ color: 'var(--muted-2)', marginTop: '0.1rem' }}>{n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}</div>
              </div>
            ))}
            {recentNotifications.filter(n => n.type && (n.type.includes('approv') || n.type.includes('reject') || n.type.includes('activat'))).length === 0 && (
              <p className="text-muted text-sm">No timeline events yet.</p>
            )}
          </div>
        )}
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="mobile-bottom-nav">
        <a href="/fb/dashboard" className="active">
          <span className="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </span>
          <span className="nav-label">Home</span>
        </a>
        <Link to="/payment">
          <span className="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </span>
          <span className="nav-label">Topup</span>
        </Link>
        <Link to="/fb/messages">
          <span className="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          </span>
          <span className="nav-label">Inbox</span>
        </Link>
        <Link to="/fb/chat">
          <span className="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </span>
          <span className="nav-label">Chat</span>
        </Link>
        <Link to="/fb/sponsor-marketplace">
          <span className="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </span>
          <span className="nav-label">Sponsor</span>
        </Link>
      </nav>
    </div>
  );
}
