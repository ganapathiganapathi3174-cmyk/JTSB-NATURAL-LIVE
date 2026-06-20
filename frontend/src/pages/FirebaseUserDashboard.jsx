import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FirebaseUser, FirebaseStorage, FirebaseAuth, MAX_REFERRALS, FirebaseNewReferral, FirebaseReferralAccess, FirebaseTopup, FirebaseTopupReferral, FirebaseNotification, FirebaseWallet } from '../db/firebase-db.js';
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

  // Referral form state
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

  // Topup state
  const [topups, setTopups] = useState([]);
  const [topupIncome, setTopupIncome] = useState([]);
  const [claimingId, setClaimingId] = useState(null);
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

  // Clear stale quota flag on mount (might be a new day)
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
        if (result) {
          setViewCount(result.count);
        }
      }).catch(err => console.error('View count error:', err));
    }
  }, [user?.id]);

  // Load topups
  useEffect(() => {
    if (!userId) return;
    const unsub = FirebaseTopup.subscribeToUserTopups(userId, (data) => {
      setTopups(data || []);
    });
    return () => { if (unsub) unsub(); };
  }, [userId]);

  // Load topup income
  useEffect(() => {
    if (!userId) return;
    const unsub = FirebaseTopupReferral.subscribeToIncome(userId, (data) => {
      setTopupIncome(data || []);
    });
    return () => { if (unsub) unsub(); };
  }, [userId]);

  // Subscribe to wallet balance
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
      await FirebaseReferralAccess.check(userId);
      await FirebaseNewReferral.create({
        user_id: userId,
        name: refName.trim(),
        email: refEmail.trim(),
        phone: refPhone.trim(),
      });
      
      setRefName('');
      setRefEmail('');
      setRefPhone('');
      setShowReferralForm(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setAddingReferral(false);
    }
  }

  async function handleRemoveReferral(referralId) {
    if (!window.confirm('Remove this referral?')) return;
    
    try {
      await FirebaseNewReferral.delete(referralId);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleProfilePicSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setError('Only JPG, PNG, and WebP images are allowed');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be under 5MB');
      return;
    }
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
    } catch (err) {
      setError('Failed to upload profile picture: ' + err.message);
    } finally {
      setUploadingProfilePic(false);
    }
  }

  async function handleRemoveProfilePic() {
    if (!user?.id) return;
    setUploadingProfilePic(true);
    try {
      await FirebaseUser.removeProfilePicture(user.id);
      setUser(prev => ({ ...prev, profile_picture_url: null }));
      setProfilePicFile(null);
      setProfilePicPreview(null);
    } catch (err) {
      setError('Failed to remove profile picture: ' + err.message);
    } finally {
      setUploadingProfilePic(false);
    }
  }

  function handleGoToTopupPayment() {
    localStorage.setItem('fb_user_id', userId);
    navigate('/payment?mode=topup');
  }

  async function handleClaimIncome(incomeId) {
    setClaimingId(incomeId);
    try {
      await FirebaseTopupReferral.claimTopupIncome(incomeId);
    } catch (err) {
      setError(err.message);
    } finally {
      setClaimingId(null);
    }
  }

const totalTopupIncome = useMemo(() => {
  return topupIncome.reduce((sum, inc) => sum + (Number(inc.amount) || 0), 0);
}, [topupIncome]);

const approvedTopups = useMemo(() => {
  return topups.filter(t => t.status === 'approved');
}, [topups]);

const lockedIncome = useMemo(() => {
  return topupIncome.filter(inc => inc.status === 'locked');
}, [topupIncome]);

const eligibleIncome = useMemo(() => {
  return topupIncome.filter(inc => inc.status === 'eligible');
}, [topupIncome]);

const claimedIncome = useMemo(() => {
  return topupIncome.filter(inc => inc.status === 'claimed');
}, [topupIncome]);

const pendingClaimAmount = useMemo(() => {
  return eligibleIncome.reduce((sum, inc) => sum + (Number(inc.amount) || 0), 0);
}, [eligibleIncome]);

const userHasOwnTopup = useMemo(() => {
  return approvedTopups.length > 0;
}, [approvedTopups]);

  const pendingTopups = useMemo(() => {
    return topups.filter(t => t.status === 'pending');
  }, [topups]);

  const rejectedTopups = useMemo(() => {
    return topups.filter(t => t.status === 'rejected');
  }, [topups]);

  const approvedReferralCount = referrals.length;
  const pendingReferralCount = Math.max(0, (user?.referrals_count || 0) - approvedReferralCount);
  const canAddMoreReferrals = approvedReferralCount < MAX_REFERRALS;
  const referralCount = user?.referrals_count || 0;
  const isQualified = useMemo(() => approvedReferralCount >= 2 || user?.is_qualified === true, [approvedReferralCount, user?.is_qualified]);
  const isActive = useMemo(() => user?.account_status === 'active' && (user?.payment_status === 'approved' || user?.payment_status === 'success'), [user?.account_status, user?.payment_status]);

  if (loading) {
    return (
      <div className="app-shell">
        <div className="topbar">
          <div className="brand">Loading...</div>
        </div>
        <div className="dashboard-loading">
          {error && <div className="alert alert-error mb-md">{error}</div>}
          <div className="skeleton-card">
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
          <div className="skeleton-card">
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
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function copyReferralLink() {
    const link = window.location.origin + '/fb/register?ref=' + user?.referral_code;
    if (link) {
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  }

  async function shareReferralLink() {
    const link = window.location.origin + '/fb/register?ref=' + user?.referral_code;
    const text = 'Join using my referral code: ' + user?.referral_code;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Join with my referral', text: text, url: link });
      } else {
        await navigator.clipboard.writeText(link);
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      }
    } catch (err) {
      // Share cancelled or failed
    }
  }

  async function handleUpdatePassword(e) {
    e.preventDefault();
    setError('');
    
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    
    setUpdatingPassword(true);
    try {
      await FirebaseUser.updatePassword(userId, newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordForm(false);
      alert('Password updated successfully!');
    } catch (err) {
      setError(err.message);
    } finally {
      setUpdatingPassword(false);
    }
  }

return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">Dashboard</div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }} className="topbar-actions">
          <div className="notification-bell-wrapper" style={{ position: 'relative' }}>
            <button className="btn btn-ghost" onClick={() => setShowBellDropdown(v => !v)}
              style={{ position: 'relative', display: 'flex', alignItems: 'center', padding: '0.35rem', border: 'none', background: 'transparent', cursor: 'pointer' }}
              title="Notifications"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unreadCount > 0 && (
                <span className="notification-bell-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </button>
            {showBellDropdown && (
              <>
                <div className="notification-bell-backdrop" onClick={() => setShowBellDropdown(false)}
                  style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
                <div className="notification-bell-dropdown"
                  style={{ position: 'absolute', top: '100%', right: 0, zIndex: 100, background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', width: '340px', maxHeight: '420px', overflowY: 'auto', marginTop: '4px' }}
                >
                  <div style={{ padding: '0.6rem 0.85rem', borderBottom: '1px solid #f0f0f0', fontWeight: 600, fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Notifications</span>
                    <Link to="/fb/messages" style={{ fontSize: '0.75rem', color: '#2563eb', textDecoration: 'none' }} onClick={() => setShowBellDropdown(false)}>
                      View all
                    </Link>
                  </div>
                  {recentNotifications.length === 0 ? (
                    <div style={{ padding: '1.5rem', textAlign: 'center', color: '#999', fontSize: '0.8rem' }}>No notifications yet</div>
                  ) : (
                    recentNotifications.map(n => (
                      <Link to="/fb/messages" key={n.id} style={{ display: 'block', padding: '0.6rem 0.85rem', borderBottom: '1px solid #f5f5f5', textDecoration: 'none', color: 'inherit', background: n.status === 'unread' ? '#f0f7ff' : 'transparent' }}
                        onClick={() => setShowBellDropdown(false)}
                      >
                        <div style={{ fontSize: '0.8rem', fontWeight: n.status === 'unread' ? 600 : 400, marginBottom: '0.15rem' }}>{n.title || 'Notification'}</div>
                        <div style={{ fontSize: '0.75rem', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.message}</div>
                        <div style={{ fontSize: '0.65rem', color: '#aaa', marginTop: '0.2rem' }}>
                          {n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
          <button className="btn btn-ghost" onClick={handleLogout}>Log out</button>
        </div>
      </div>

      {error && <div className="alert alert-error mb-md">{error}</div>}
{topupSuccessMsg && <div className="alert alert-success mb-md">{topupSuccessMsg}</div>}

      <div className="user-dashboard-wrap">
        <div className="profile-card">
          <div className="profile-header-row">
            <div className="profile-header-left">
              <div className="profile-avatar-wrap">
                <div className="profile-avatar">
                  {user?.profile_picture_url ? (
                    <img src={user.profile_picture_url} alt={user?.name || 'User'} className="profile-avatar-img" />
                  ) : (
                    user?.name ? user.name.charAt(0).toUpperCase() : '?'
                  )}
                </div>
                <div className="profile-avatar-actions">
                  <input type="file" id="profile-pic-input" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                    onChange={handleProfilePicSelect} />
                  <button className="profile-pic-btn profile-pic-upload" title="Upload Photo"
                    onClick={() => document.getElementById('profile-pic-input').click()}
                    disabled={uploadingProfilePic}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  </button>
                  {user?.profile_picture_url && (
                    <button className="profile-pic-btn profile-pic-remove" title="Remove Photo"
                      onClick={handleRemoveProfilePic} disabled={uploadingProfilePic}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
                {uploadingProfilePic && <div className="profile-pic-uploading" />}
              </div>
              <div className="profile-header-info">
                <h2 className="profile-name">{user?.name || 'User'}</h2>
                <div className="profile-header-meta">
                  <span className="profile-email">{user?.email || ''}</span>
                  <span className={`profile-status-badge ${user?.status === 'approved' ? 'badge-paid' : user?.status === 'rejected' ? 'badge-rejected' : 'badge-pending'}`}>
                    {user?.status ? user.status.charAt(0).toUpperCase() + user.status.slice(1) : 'Pending'}
                  </span>
                </div>
              </div>
            </div>
            <div className="profile-header-right">
              <Link to="/fb/messages" className="profile-inbox-link">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                Inbox
                {unreadCount > 0 && <span className="msg-inbox-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
              </Link>
              <Link to="/fb/chat" className="profile-chat-link">
                Chat
              </Link>
            </div>
          </div>

          <div className="profile-body">
            <div className="quick-stats-grid">
              <div className="quick-stat-card">
                <div className="quick-stat-icon stat-icon-referrals">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <div className="quick-stat-info">
                  <span className="quick-stat-value">{approvedReferralCount}</span>
                  <span className="quick-stat-label">Completed Referrals</span>
                </div>
              </div>
              <div className="quick-stat-card">
                <div className="quick-stat-icon stat-icon-income">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                </div>
                <div className="quick-stat-info">
                  <span className="quick-stat-value">₹{totalTopupIncome.toFixed(2)}</span>
                  <span className="quick-stat-label">Total Rewards</span>
                </div>
              </div>
              <div className="quick-stat-card">
                <div className="quick-stat-icon stat-icon-income">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M12 9v6" />
                    <path d="M9 12h6" />
                  </svg>
                </div>
                <div className="quick-stat-info">
                  <span className="quick-stat-value">₹{walletBalance.toFixed(2)}</span>
                  <span className="quick-stat-label">Wallet Balance</span>
                </div>
              </div>
              <div className="quick-stat-card">
                <div className="quick-stat-icon stat-icon-status">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <div className="quick-stat-info">
                  <span className={`quick-stat-value ${user?.status === 'approved' ? 'text-success' : user?.status === 'rejected' ? 'text-danger' : 'text-warning'}`}>
                    {user?.status ? user.status.charAt(0).toUpperCase() + user.status.slice(1) : 'Pending'}
                  </span>
                  <span className="quick-stat-label">Account Status</span>
                </div>
              </div>
            </div>
            <div className="profile-detail-grid">
              <div className="profile-detail-item profile-contact-item">
                <span className="profile-detail-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                </span>
                <span className="profile-detail-label">Email</span>
                <span className="profile-detail-value profile-contact-value">{user?.email}</span>
              </div>
              <div className="profile-detail-item profile-contact-item">
                <span className="profile-detail-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </span>
                <span className="profile-detail-label">Phone</span>
                <span className="profile-detail-value profile-contact-value">{user?.phone || '—'}</span>
              </div>
              <div className="profile-detail-item">
                <span className="profile-detail-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </span>
                <span className="profile-detail-label">Status</span>
                <span className="profile-detail-value">
                  <span className={`badge ${user?.status === 'approved' ? 'badge-paid' : user?.status === 'rejected' ? 'badge-rejected' : 'badge-pending'}`}>
                    {user?.status ? user.status.charAt(0).toUpperCase() + user.status.slice(1) : 'Pending'}
                  </span>
                  {user?.is_qualified && (
                    <span className="badge badge-paid ml-sm">Qualified</span>
                  )}
                  {user?.account_status === 'inactive' && !user?.sponsor_awaiting_credit && (
                    <span className="badge badge-rejected ml-sm">Inactive</span>
                  )}
                  {user?.topup_referral_qualified && !user?.sponsor_topup_completed && !user?.sponsor_cycle_completed && pendingTopups.length === 0 && (
                    <span className="badge badge-paid ml-sm">Sponsor Eligible</span>
                  )}
                  {user?.sponsor_awaiting_credit && !user?.sponsor_credited && (
                    <span className="badge badge-rejected ml-sm">Sponsor Inactive</span>
                  )}
                  {user?.sponsor_credited && (
                    <span className="badge badge-paid ml-sm">Credited</span>
                  )}
                </span>
              </div>
              {user?.referred_by && (
                <div className="profile-detail-item">
                  <span className="profile-detail-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </span>
                  <span className="profile-detail-label">Referred By</span>
                  <span className="profile-detail-value">{referrerInfo ? `${referrerInfo.name} (${referrerInfo.email})` : user.referred_by}</span>
                </div>
              )}
            </div>

            {user?.topup_referral_qualified && (
              <div className="sponsor-banner">
                <span className="text-sm font-semibold" style={{ color: 'var(--warning)' }}>Sponsor No:</span>
                <span className="code-inline ml-sm">{user?.referral_code || '—'}</span>
              </div>
            )}
            {user?.topup_referral_qualified && !user?.sponsor_topup_completed && !user?.sponsor_cycle_completed && pendingTopups.length === 0 && (
              <div className="alert alert-success text-sm mt-sm">
                ✅ Referral topup condition met! Complete your own topup to receive sponsor benefits.
              </div>
            )}
            {user?.sponsor_awaiting_credit && !user?.sponsor_credited && (
              <div className="alert alert-warning text-sm mt-sm">
                ⏳ Your own topup is approved. Account set to Inactive. Awaiting credit of <strong>₹{Number(user?.sponsor_topup_amount || 0).toFixed(2)}</strong>.
              </div>
            )}
            {user?.sponsor_credited && (
              <div className="alert alert-success text-sm mt-sm">
                ✅ Sponsor bonus of <strong>₹{Number(user?.sponsor_credited_amount || 0).toFixed(2)}</strong> credited to your account.
              </div>
            )}

            {user?.referral_code && (
              isActive ? (
              <div className="referral-card">
                <h3>Refer & Earn</h3>
                <p className="subtitle">Invite friends to earn rewards</p>

                <div className="referral-row">
                  <span className="referral-label">Your Code</span>
                  <span className="referral-code-value">{user?.referral_code}</span>
                  <button
                    className={`btn-copy-primary ${copied ? 'copied' : ''}`}
                    onClick={copyReferralCode}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>

                <div className="referral-row">
                  <span className="referral-label">Share Link</span>
                  <span className="referral-link-value">
                    {typeof window !== 'undefined' ? window.location.origin + '/fb/register?ref=' + user?.referral_code : ''}
                  </span>
                  <div className="referral-actions">
                    <button
                      className={`btn-copy-primary ${copiedLink ? 'copied' : ''}`}
                      onClick={copyReferralLink}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                      </svg>
                      {copiedLink ? 'Copied!' : 'Copy'}
                    </button>
                    {navigator.share && (
                      <button className="btn-share-modern" onClick={shareReferralLink}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="18" cy="5" r="3"></circle>
                          <circle cx="6" cy="12" r="3"></circle>
                          <circle cx="18" cy="19" r="3"></circle>
                          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                        </svg>
                        Share
                      </button>
                    )}
                  </div>
                </div>

                <div className="referral-stats-bar">
                  <div className="referral-stat-item">
                    <span className={`referral-stat-value ${approvedReferralCount >= MAX_REFERRALS ? 'danger' : 'success'}`}>
                      {approvedReferralCount}
                    </span>
                    <span className="referral-stat-label">/ {MAX_REFERRALS} Completed</span>
                  </div>
                  {pendingReferralCount > 0 && (
                    <div className="referral-stat-item">
                      <span className="referral-stat-value warning">{pendingReferralCount}</span>
                      <span className="referral-stat-label">Pending</span>
                    </div>
                  )}
                  {approvedReferralCount >= 2 && (
                    <span className="qualified-pill">&#10003; Qualified</span>
                  )}
                </div>
              </div>
              ) : (
              <div className="referral-card referral-locked">
                <h3>Refer & Earn</h3>
                {isSuspicious ? (
                  <p className="muted">Your account is currently suspended.</p>
                ) : pendingReferralCount > 0 ? (
                  <>
                    <p className="muted">Waiting for {pendingReferralCount} referral(s) to complete registration.</p>
                    <p className="muted">Sponsor benefits unlock after 2 completed referrals.</p>
                  </>
                ) : user?.account_status === 'inactive' ? (
                  <p className="muted">Your account is currently inactive.</p>
                ) : (
                  <p className="muted">Referral access requires an active account.</p>
                )}
              </div>
              )
            )}

            <div className="password-section">
              <div className="password-status-row">
                <span className="password-label">Password</span>
                <span className={`password-status ${user?.password ? 'set' : 'not-set'}`}>
                  {user?.password ? 'Set' : 'Not Set'}
                </span>
                {!user?.password && (
                  <button className="btn btn-primary btn-sm" onClick={() => setShowPasswordForm(true)}>
                    Set Password
                  </button>
                )}
                {user?.password && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowPasswordForm(!showPasswordForm)}>
                    {showPasswordForm ? 'Cancel' : 'Change'}
                  </button>
                )}
              </div>

              {showPasswordForm && (
                <div className="password-form">
                  <h3 className="password-form-title">Set Your Password</h3>
                  <form onSubmit={handleUpdatePassword}>
                    <div className="field">
                      <label>New Password</label>
                      <div className="password-field-wrap">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={newPassword}
                          onChange={e => setNewPassword(e.target.value)}
                          minLength={6}
                          required
                          placeholder="At least 6 characters"
                          className="w-full"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="password-toggle-btn"
                        >
                          {showPassword ? '👁' : '👁️'}
                        </button>
                      </div>
                    </div>
                    <div className="field">
                      <label>Confirm Password</label>
                      <div className="password-field-wrap">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={confirmPassword}
                          onChange={e => setConfirmPassword(e.target.value)}
                          minLength={6}
                          required
                          placeholder="Re-enter password"
                          className="w-full"
                        />
                      </div>
                    </div>
                    <div className="flex-row mt-sm">
                      <button type="submit" className={`btn btn-primary${updatingPassword ? ' btn-loading' : ''}`} disabled={updatingPassword}>
                        {updatingPassword ? 'Saving...' : 'Save Password'}
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => setShowPasswordForm(false)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>

          </div>
        </div>

        <div className="card mb-lg account-info-card">
          <h3 className="card-title">Account Information</h3>
          <div className="account-info-grid">
            <div className="account-info-item">
              <span className="account-info-label">Joined Date</span>
              <span className="account-info-value">
                {user?.joinedDate ? new Date(user.joinedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '—'}
              </span>
            </div>
            <div className="account-info-item">
              <span className="account-info-label">Approved Date</span>
              <span className="account-info-value">
                {user?.approvedDate ? new Date(user.approvedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '—'}
              </span>
            </div>
            <div className="account-info-item">
              <span className="account-info-label">Last Active</span>
              <span className={`account-info-value ${user?.lastActiveAt ? getLastActiveStatus(user.lastActiveAt) : ''}`}>
                {user?.lastActiveAt ? (
                  <span className={`last-active-indicator ${getLastActiveStatus(user.lastActiveAt)}`}>
                    {new Date(user.lastActiveAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                  </span>
                ) : '—'}
              </span>
            </div>
            <div className="account-info-item">
              <span className="account-info-label">Account Status</span>
              <span className={`account-info-value ${user?.account_status === 'active' ? 'text-success' : user?.account_status === 'blocked' ? 'text-danger' : 'text-warning'}`}>
                {(user?.account_status || 'inactive').charAt(0).toUpperCase() + (user?.account_status || 'inactive').slice(1)}
              </span>
            </div>
          </div>
        </div>

        {/* Referral progress - complete 2 approved referrals to unlock payment */}
        {!isQualified && !isActive && !user?.is_first_payment_done && (
          <div className="card mb-lg">
            <h2>Complete Referrals to Unlock Payment</h2>
            <p className="muted">Sponsor benefits unlock after 2 completed referrals.</p>
            {pendingReferralCount > 0 && (
              <div className="alert alert-info text-sm mb-sm">
                {pendingReferralCount} referral(s) pending completion. Only completed referrals count.
              </div>
            )}
            <div className="progress-container">
              <div className="progress-bar-wrap">
                <div className="progress-bar-fill" style={{ width: `${Math.min((approvedReferralCount / 2) * 100, 100)}%` }}></div>
              </div>
              <span className="progress-label">{approvedReferralCount} / 2 completed</span>
            </div>
          </div>
        )}

        {/* ===== TOPUP SECTION ===== */}
        <div className="card mb-lg">
          <h2 className="flex-row gap-sm">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
            </svg>
            Topup
          </h2>
          <p className="muted mb-md">
            Add funds to your wallet via Razorpay. Payment is verified automatically via webhook.
          </p>

            <div className="stats-grid-modern mb-md">
              <div className="stat-card-modern success">
                <div className="stat-bg-icon">✓</div>
                <div className="stat-value">{approvedTopups.length}</div>
                <div className="stat-label">Approved</div>
              </div>
              <div className="stat-card-modern warning">
                <div className="stat-bg-icon">⏳</div>
                <div className="stat-value">{pendingTopups.length}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-card-modern danger">
                <div className="stat-bg-icon">✕</div>
                <div className="stat-value">{rejectedTopups.length}</div>
                <div className="stat-label">Rejected</div>
              </div>
              <div className="stat-card-modern accent">
                <div className="stat-bg-icon">₹</div>
                <div className="stat-value">₹{totalTopupIncome.toFixed(2)}</div>
                <div className="stat-label">Total Income</div>
              </div>
              <div className={`stat-card-modern ${userHasOwnTopup ? 'success' : 'warning'}`}>
                <div className="stat-bg-icon">💰</div>
                <div className="stat-value">₹{pendingClaimAmount.toFixed(2)}</div>
                <div className="stat-label">Claimable</div>
              </div>
            </div>

          <button className="btn btn-primary mb-md" onClick={handleGoToTopupPayment}>
            Submit Topup Request
          </button>

          {topups.length > 0 && (
            <div className="mt-sm">
              <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Topup History</h3>
              <div className="table-wrap">
                <table>
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
                        <td data-label="Date" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                          {t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '—'}
                        </td>
                        <td data-label="Amount" style={{ fontWeight: 700 }}>₹{Number(t.amount || 0).toFixed(2)}</td>
                        <td data-label="Transaction ID" className="font-mono text-sm">{t.transactionId || '—'}</td>
                        <td data-label="Status">
                          <span className={`badge ${t.status === 'approved' ? 'badge-paid' : t.status === 'rejected' ? 'badge-rejected' : 'badge-pending'}`}>
                            {t.status ? t.status.charAt(0).toUpperCase() + t.status.slice(1) : 'Pending'}
                          </span>
                        </td>
                        <td data-label="Sponsor Benefit">
                          {t.status === 'approved' ? (
                            <span className="badge badge-paid">Done</span>
                          ) : (
                            <span className="muted text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="surface-card mt-md">
            <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Topup Referral Income</h3>

            {!userHasOwnTopup && (
              <div className="alert alert-warning text-sm mb-md">
                <strong>Topup required!</strong> Complete your own topup to unlock referral income claims.
              </div>
            )}

            {lockedIncome.length > 0 && (
              <div className="alert alert-warning text-sm mb-md">
                <strong>{lockedIncome.length} income record(s) locked.</strong> Complete your own topup to make them eligible.
              </div>
            )}

            {pendingClaimAmount > 0 && (
              <div className="alert alert-success text-sm mb-md">
                <strong>₹{pendingClaimAmount.toFixed(2)}</strong> eligible for claim!
              </div>
            )}

            <div className="table-wrap">
              <table>
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
                      <td data-label="Date" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                        {inc.createdAt ? new Date(inc.createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td data-label="From">{inc.fromUserName || inc.fromUserId || '—'}</td>
                      <td data-label="Amount" style={{ fontWeight: 700, color: inc.status === 'claimed' ? 'var(--muted)' : 'var(--success)' }}>
                        +₹{Number(inc.amount || 0).toFixed(2)}
                      </td>
                      <td data-label="Status">
                        {inc.status === 'locked' && (
                          <span className="badge badge-pending" style={{ background: 'var(--warning)', color: '#000' }}>Locked</span>
                        )}
                        {inc.status === 'eligible' && (
                          <span className="badge badge-paid">Eligible</span>
                        )}
                        {inc.status === 'claimed' && (
                          <span className="badge badge-rejected">Claimed</span>
                        )}
                        {!inc.status && (
                          <span className="badge badge-pending">Pending</span>
                        )}
                      </td>
                      <td data-label="Action">
                        {inc.status === 'eligible' && userHasOwnTopup && !user?.sponsor_awaiting_credit && (
                          <button
                            className="btn btn-primary btn-modern-sm"
                            onClick={() => handleClaimIncome(inc.id)}
                            disabled={claimingId === inc.id}
                          >
                            {claimingId === inc.id ? 'Claiming...' : 'Claim'}
                          </button>
                        )}
                        {inc.status === 'eligible' && user?.sponsor_awaiting_credit && (
                          <span className="badge badge-pending text-xs">Pending Credit</span>
                        )}
                        {inc.status === 'locked' && (
                          <span className="muted text-xs">Locked</span>
                        )}
                        {inc.status === 'claimed' && (
                          <span className="muted text-xs">—</span>
                        )}
                        {!inc.status && (
                          <span className="muted text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Referrals Card - only show after payment approval */}
        {(user?.payment_status === 'approved' || user?.payment_status === 'success') && (
        <div className={`card${isQualified ? ' card-dim' : ''}`}>
          <div className="flex-row-wrap refer-header">
            <h2 className="refer-header-title">My Referrals ({approvedReferralCount})</h2>
            <span className="badge badge-paid text-xs">
              Views: {viewCount}
            </span>
          </div>

          {pendingReferralCount > 0 && (
            <div className="alert alert-info text-sm mt-sm">
              Waiting for {pendingReferralCount} referral(s) to complete registration.
            </div>
          )}

          {approvedReferralCount === 0 ? (
            <p className="muted mt-md">
              No referrals yet. Share your referral code to invite members.
            </p>
          ) : (
            <div className="referral-grid mt-md">
              {referrals.map((ref) => (
                <div key={ref.id} className="surface-card">
                  <div className="font-semibold">{ref.name}</div>
                  <div className="muted text-sm">📧 {ref.email}</div>
                  <div className="muted text-sm">📞 {ref.phone || '—'}</div>
                </div>
              ))}
            </div>
          )}

          {!canAddMoreReferrals && isActive && (
            <p className="muted mt-md">
              You have reached the maximum of {MAX_REFERRALS} referrals.
            </p>
          )}
        </div>
        )}

        {/* Activity Feed */}
        <div className="card mb-lg">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            Recent Activity
          </h2>
          {recentNotifications.length === 0 ? (
            <p className="muted" style={{ fontSize: '0.85rem' }}>No recent activity.</p>
          ) : (
            <div className="activity-feed" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {recentNotifications.slice(0, 5).map(n => (
                <div key={n.id} className="activity-item" style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.5rem 0',
                  borderBottom: '1px solid #f0f0f0', fontSize: '0.85rem'
                }}>
                  <span style={{
                    width: '8px', height: '8px', borderRadius: '50%', marginTop: '0.35rem', flexShrink: 0,
                    background: n.status === 'unread' ? '#2563eb' : '#d1d5db'
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: n.status === 'unread' ? 600 : 400 }}>{n.title || 'Notification'}</div>
                    <div style={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.message}</div>
                    <div style={{ fontSize: '0.7rem', color: '#aaa', marginTop: '0.15rem' }}>
                      {n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}
                    </div>
                  </div>
                  <Link to="/fb/messages" style={{ fontSize: '0.7rem', color: '#2563eb', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    View
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Activity Timeline */}
        <div className="card mb-lg">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            Activity Timeline
          </h2>
          {recentNotifications.length === 0 ? (
            <p className="muted" style={{ fontSize: '0.85rem' }}>No timeline events yet.</p>
          ) : (
            <div className="timeline" style={{ position: 'relative', paddingLeft: '1.25rem' }}>
              <div style={{ position: 'absolute', left: '0.4rem', top: '0.25rem', bottom: '0.25rem', width: '2px', background: '#e5e7eb' }} />
              {recentNotifications.filter(n => n.type && (n.type.includes('approv') || n.type.includes('reject') || n.type.includes('activat'))).map(n => (
                <div key={n.id} className="timeline-item" style={{
                  position: 'relative', paddingLeft: '1rem', paddingBottom: '1rem'
                }}>
                  <div style={{
                    position: 'absolute', left: '-1.3rem', top: '0.35rem', width: '12px', height: '12px', borderRadius: '50%',
                    background: n.type.includes('reject') ? '#ef4444' : '#22c55e', border: '2px solid #fff', boxShadow: '0 0 0 2px #e5e7eb'
                  }} />
                  <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>{n.title || 'Update'}</div>
                  <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.15rem' }}>{n.message}</div>
                  <div style={{ fontSize: '0.7rem', color: '#aaa', marginTop: '0.15rem' }}>
                    {n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}
                  </div>
                </div>
              ))}
              {recentNotifications.filter(n => n.type && (n.type.includes('approv') || n.type.includes('reject') || n.type.includes('activat'))).length === 0 && (
                <p className="muted" style={{ fontSize: '0.85rem' }}>No timeline events yet.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}