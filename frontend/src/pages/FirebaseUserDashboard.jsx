import { useEffect, useState, useMemo, memo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { FirebaseUser, FirebaseStorage, FirebaseAuth, MAX_REFERRALS, FirebaseNewReferral, FirebaseReferralAccess, FirebaseTopup, FirebaseTopupReferral, FirebaseNotification } from '../db/firebase-db.js';

const UPI_VPA = import.meta.env.VITE_UPI_VPA || 'jayarajj126-3@okicici';
const UPI_PAYEE_NAME = import.meta.env.VITE_UPI_PAYEE_NAME || 'Community';

function buildUpiUri() {
  const pa = encodeURIComponent(UPI_VPA);
  const pn = encodeURIComponent(UPI_PAYEE_NAME);
  return `upi://pay?pa=${pa}&pn=${pn}&am=&cu=INR`;
}

const UpiQrDisplay = memo(function UpiQrDisplay() {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrError, setQrError] = useState('');

  useEffect(() => {
    QRCode.toDataURL(buildUpiUri(), { width: 200, margin: 2 }).then(setQrDataUrl).catch(() => setQrError('Failed to generate QR'));
  }, []);

  return (
    <div className="upi-qr-section">
      {qrError ? (
        <div className="muted" style={{ padding: '1rem' }}>{qrError}</div>
      ) : qrDataUrl ? (
        <img src={qrDataUrl} alt="UPI QR" style={{ borderRadius: '8px', border: '1px solid var(--border)', maxWidth: '100%' }} />
      ) : (
        <div className="muted" style={{ padding: '1rem' }}>Loading QR...</div>
      )}
      <div className="upi-id-box" style={{ marginTop: '0.75rem' }}>
        <div className="label">UPI ID / VPA</div>
        <code style={{ fontSize: '1rem' }}>{UPI_VPA}</code>
      </div>
    </div>
  );
});

const THEME_PRESETS = {
  blue: {
    accent: '#60A5FA',
    accentDim: '#3B82F6',
    glow: 'rgba(96,165,250,0.2)',
    border: 'rgba(96,165,250,0.1)',
    glassBorder: 'rgba(96,165,250,0.08)',
  },
  purple: {
    accent: '#A78BFA',
    accentDim: '#8B5CF6',
    glow: 'rgba(167,139,250,0.2)',
    border: 'rgba(167,139,250,0.1)',
    glassBorder: 'rgba(167,139,250,0.08)',
  },
  green: {
    accent: '#4ADE80',
    accentDim: '#22C55E',
    glow: 'rgba(74,222,128,0.2)',
    border: 'rgba(74,222,128,0.1)',
    glassBorder: 'rgba(74,222,128,0.08)',
  },
  orange: {
    accent: '#FB923C',
    accentDim: '#F97316',
    glow: 'rgba(251,146,60,0.2)',
    border: 'rgba(251,146,60,0.1)',
    glassBorder: 'rgba(251,146,60,0.08)',
  },
  pink: {
    accent: '#FB7185',
    accentDim: '#F43F5E',
    glow: 'rgba(251,113,133,0.2)',
    border: 'rgba(251,113,133,0.1)',
    glassBorder: 'rgba(251,113,133,0.08)',
  },
  teal: {
    accent: '#2DD4BF',
    accentDim: '#14B8A6',
    glow: 'rgba(45,212,191,0.2)',
    border: 'rgba(45,212,191,0.1)',
    glassBorder: 'rgba(45,212,191,0.08)',
  },
  cyan: {
    accent: '#22D3EE',
    accentDim: '#06B6D4',
    glow: 'rgba(34,211,238,0.2)',
    border: 'rgba(34,211,238,0.1)',
    glassBorder: 'rgba(34,211,238,0.08)',
  },
};

function applyTheme(color) {
  const t = THEME_PRESETS[color];
  if (!t) return;
  const root = document.documentElement;
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-dim', t.accentDim);
  root.style.setProperty('--accent-glow', t.glow);
  root.style.setProperty('--border', t.border);
  root.style.setProperty('--glass-border', t.glassBorder);
}

export default function getLastActiveStatus(dateStr) {
  if (!dateStr) return 'inactive';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 5 * 60 * 1000) return 'online';
  if (diff < 24 * 60 * 60 * 1000) return 'recent';
  return 'inactive';
}

function FirebaseUserDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  
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

  // Payment upload state
  const [paymentFile, setPaymentFile] = useState(null);
  const [paymentUtr, setPaymentUtr] = useState('');
  const [paymentPreview, setPaymentPreview] = useState(null);
  const [showPaymentUpload, setShowPaymentUpload] = useState(false);

  // Cycle payment state
  const [cyclePaymentFile, setCyclePaymentFile] = useState(null);
  const [cycleUtr, setCycleUtr] = useState('');
  const [cyclePaymentPreview, setCyclePaymentPreview] = useState(null);
  const [showCyclePaymentForm, setShowCyclePaymentForm] = useState(false);
  const [cycleUtrExists, setCycleUtrExists] = useState(false);
  const [checkingCycleUtr, setCheckingCycleUtr] = useState(false);
  const cycleUtrTimer = useRef(null);

  // Topup state
  const [topups, setTopups] = useState([]);
  const [topupAmount, setTopupAmount] = useState('');
  const [topupTransactionId, setTopupTransactionId] = useState('');
  const [topupFile, setTopupFile] = useState(null);
  const [topupPreview, setTopupPreview] = useState(null);
  const [showTopupForm, setShowTopupForm] = useState(false);
  const [submittingTopup, setSubmittingTopup] = useState(false);
  const [topupUtrExists, setTopupUtrExists] = useState(false);
  const [checkingTopupUtr, setCheckingTopupUtr] = useState(false);
  const topupUtrTimer = useRef(null);
  const [topupIncome, setTopupIncome] = useState([]);
  const [claimingId, setClaimingId] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [recentNotifications, setRecentNotifications] = useState([]);
  const [showBellDropdown, setShowBellDropdown] = useState(false);

  const userId = localStorage.getItem('fb_user_id');

  useEffect(() => {
    if (!userId) {
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

  // Apply saved theme when user data loads or theme_color changes
  useEffect(() => {
    if (user?.theme_color) {
      applyTheme(user.theme_color);
    }
  }, [user?.theme_color]);

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

  async function handleLogout() {
    await FirebaseAuth.logout();
    localStorage.removeItem('fb_user_id');
    navigate('/fb/login');
  }

  async function handleAddReferral(e) {
    e.preventDefault();
    
    if (referralCount >= 2) {
      setError('Referral limit reached. Complete cycle payment to refer more.');
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

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
      setPaymentFile(file);
      const reader = new FileReader();
      reader.onload = () => setPaymentPreview(reader.result);
      reader.readAsDataURL(file);
    }
  }

  async function handleUploadPayment() {
    if (!paymentFile || !paymentUtr.trim()) return;
    if (!user) return;

    const currentCount = user.referrals_count || 0;
    if (currentCount < 2 && !user.is_qualified) {
      setError('Complete 2 referrals before making payment');
      return;
    }

    setUploading(true);
    setError('');

    try {
      const url = await FirebaseStorage.uploadPaymentScreenshot(userId, paymentFile);
      await FirebaseUser.updateUpiScreenshot(userId, url, paymentUtr.trim());
      
      setPaymentFile(null);
      setPaymentPreview(null);
      setPaymentUtr('');
      setShowPaymentUpload(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function handleCycleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
      setCyclePaymentFile(file);
      const reader = new FileReader();
      reader.onload = () => setCyclePaymentPreview(reader.result);
      reader.readAsDataURL(file);
    }
  }

  function checkCycleUtrDuplicate(val) {
    if (cycleUtrTimer.current) clearTimeout(cycleUtrTimer.current);
    if (!val) {
      setCycleUtrExists(false);
      setCheckingCycleUtr(false);
      return;
    }
    setCheckingCycleUtr(true);
    cycleUtrTimer.current = setTimeout(async () => {
      try {
        const exists = await FirebaseUser.checkUtrExists(val.trim());
        setCycleUtrExists(exists);
      } catch {
        setCycleUtrExists(false);
      } finally {
        setCheckingCycleUtr(false);
      }
    }, 500);
  }

  async function handleUploadCyclePayment() {
    if (!cyclePaymentFile || !cycleUtr.trim()) {
      setError('Screenshot and UTR are required');
      return;
    }
    const trimmedUtr = cycleUtr.trim();
    const dupCheck = await FirebaseUser.checkUtrExists(trimmedUtr);
    if (dupCheck) {
      setError('This UTR ID has already been used.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const url = await FirebaseStorage.uploadCyclePaymentScreenshot(userId, cyclePaymentFile);
      await FirebaseUser.updateCyclePayment(userId, url, cycleUtr.trim());
      setCyclePaymentFile(null);
      setCyclePaymentPreview(null);
      setCycleUtr('');
      setCycleUtrExists(false);
      setShowCyclePaymentForm(false);
    } catch (err) {
      console.error('Cycle payment error:', err);
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function checkTopupUtrDuplicate(val) {
    if (topupUtrTimer.current) clearTimeout(topupUtrTimer.current);
    if (!val) {
      setTopupUtrExists(false);
      setCheckingTopupUtr(false);
      return;
    }
    setCheckingTopupUtr(true);
    topupUtrTimer.current = setTimeout(async () => {
      try {
        const exists = await FirebaseUser.checkUtrExists(val.trim());
        setTopupUtrExists(exists);
      } catch {
        setTopupUtrExists(false);
      } finally {
        setCheckingTopupUtr(false);
      }
    }, 500);
  }

  function handleTopupFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
      setTopupFile(file);
      const reader = new FileReader();
      reader.onload = () => setTopupPreview(reader.result);
      reader.readAsDataURL(file);
    }
  }

  async function handleSubmitTopup() {
    if (!topupAmount || !topupTransactionId.trim() || !topupFile) {
      setError('Amount, transaction ID, and screenshot are required');
      return;
    }
    const trimmedTxId = topupTransactionId.trim();
    const dupCheck = await FirebaseUser.checkUtrExists(trimmedTxId);
    if (dupCheck) {
      setError('This UTR ID has already been used.');
      return;
    }
    setSubmittingTopup(true);
    setError('');
    try {
      const url = await FirebaseStorage.uploadTopupScreenshot(userId, topupFile);
      await FirebaseTopup.create(userId, {
        amount: Number(topupAmount),
        transactionId: topupTransactionId.trim(),
        screenshotData: url,
      });
      setTopupAmount('');
      setTopupTransactionId('');
      setTopupUtrExists(false);
      setTopupFile(null);
      setTopupPreview(null);
      setShowTopupForm(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmittingTopup(false);
    }
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
  const isActive = useMemo(() => user?.account_status === 'active' && user?.payment_status === 'approved', [user?.account_status, user?.payment_status]);
  const isSuspicious = user?.admin_status === 'suspicious';
  const cyclePending = user?.cycle_payment_status === 'pending';
  const cycleApproved = user?.cycle_payment_status === 'approved';
  const needsCyclePayment = isQualified && !cycleApproved;

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

      <div className="user-dashboard-wrap">
        <div className="profile-card">
          <div className="profile-header-row">
            <div className="profile-header-left">
              <div className="profile-avatar">{user?.name ? user.name.charAt(0).toUpperCase() : '?'}</div>
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
                  <span className="quick-stat-label">Approved Referrals</span>
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
                ⏳ Your own topup is approved. Account set to Inactive. Awaiting admin credit of <strong>₹{Number(user?.sponsor_topup_amount || 0).toFixed(2)}</strong>.
              </div>
            )}
            {user?.sponsor_credited && (
              <div className="alert alert-success text-sm mt-sm">
                ✅ Admin credited <strong>₹{Number(user?.sponsor_credited_amount || 0).toFixed(2)}</strong> to your account.
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
                    <span className="referral-stat-label">/ {MAX_REFERRALS} Approved</span>
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
                    <p className="muted">Waiting for admin approval of {pendingReferralCount} referral(s).</p>
                    <p className="muted">Payment cycle will unlock after 2 admin-approved referrals.</p>
                  </>
                ) : user?.account_status === 'inactive' ? (
                  <p className="muted">Your account is currently inactive.</p>
                ) : (
                  <p className="muted">Referral access will be enabled after admin approval.</p>
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

            <div className="theme-section">
              <h3 className="theme-heading">Theme Color</h3>
              <div className="theme-options">
                {Object.entries(THEME_PRESETS).map(([name, colors]) => (
                  <button
                    key={name}
                    className={`theme-swatch ${user?.theme_color === name ? 'active' : ''}`}
                    style={{ background: colors.accent }}
                    onClick={() => {
                      FirebaseUser.updateTheme(user?.id, name);
                      applyTheme(name);
                    }}
                    title={name.charAt(0).toUpperCase() + name.slice(1)}
                  />
                ))}
              </div>
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
            <p className="muted">Payment cycle will unlock after 2 admin-approved referrals.</p>
            {pendingReferralCount > 0 && (
              <div className="alert alert-info text-sm mb-sm">
                {pendingReferralCount} referral(s) pending admin approval. Only approved referrals count.
              </div>
            )}
            <div className="progress-container">
              <div className="progress-bar-wrap">
                <div className="progress-bar-fill" style={{ width: `${Math.min((approvedReferralCount / 2) * 100, 100)}%` }}></div>
              </div>
              <span className="progress-label">{approvedReferralCount} / 2 approved</span>
            </div>
          </div>
        )}

        {/* First-time payment for qualified users */}
        {isQualified && !isActive && !user?.is_first_payment_done && (
          <div className="card mb-lg" style={{ border: '2px solid var(--success)' }}>
            <div className="alert alert-success mb-md">
              <strong>Referral Target Completed!</strong> Your payment is now unlocked.
            </div>
            <h2>Complete Your Payment</h2>
            <p>Please submit your payment to activate your account.</p>
            <UpiQrDisplay />
            
            {!showPaymentUpload ? (
              <button 
                className="btn btn-primary mt-md"
                onClick={() => setShowPaymentUpload(true)}
              >
                Submit Payment Details
              </button>
            ) : (
              user?.payment_status === 'pending' ? (
                <div className="alert alert-info mt-md">
                  <strong>Payment submitted.</strong> Waiting for admin approval.
                </div>
              ) : (
                <div className="surface-card mt-md">
                  <div className="field">
                    <label>UTR Number *</label>
                    <input 
                      type="text" 
                      value={paymentUtr || ''} 
                      onChange={e => setPaymentUtr(e.target.value)} 
                      placeholder="Enter UTR from payment confirmation"
                    />
                  </div>
                  <div className="field">
                    <label>Payment Screenshot *</label>
                    <input type="file" accept="image/*" onChange={handleFileSelect} />
                    {paymentPreview && (
                      <img 
                        src={paymentPreview} 
                        alt="Preview" 
                        className="screenshot-preview"
                      />
                    )}
                  </div>
                  <div className="flex-row mt-sm">
                    <button 
                      className={`btn btn-primary${uploading ? ' btn-loading' : ''}`}
                      onClick={handleUploadPayment}
                      disabled={uploading || !paymentFile || !paymentUtr.trim()}
                    >
                      {uploading ? 'Submitting...' : 'Submit Payment'}
                    </button>
                    <button 
                      className="btn btn-ghost" 
                      onClick={() => setShowPaymentUpload(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}

        {/* Qualified Banner - only for active users who reached limit */}
        {isQualified && isActive && (
          <div className="alert alert-warning mb-lg">
            <strong>Referral Limit Reached!</strong> Complete the cycle payment to continue referring members.
          </div>
        )}

        {/* Cycle Payment Card (only after first payment is done) */}
        {isQualified && user?.is_first_payment_done && (
          <div className="card mb-lg" style={{ border: '2px solid var(--warning)' }}>
            <h2>Referral Limit Reached</h2>
            <p>Complete payment to continue referring members.</p>
            <UpiQrDisplay />

            {cyclePending ? (
              <div className="alert alert-info mt-md">
                <strong>Waiting for admin approval.</strong> Your payment is being reviewed.
              </div>
            ) : !showCyclePaymentForm ? (
              <button
                className="btn btn-primary mt-md"
                onClick={() => setShowCyclePaymentForm(true)}
              >
                Submit Payment Details
              </button>
            ) : (
              <div className="mt-md">
                <div className="surface-card">
                  <div className="field">
                    <label>UTR Number *</label>
                    <input
                      type="text"
                      value={cycleUtr}
                      onChange={e => {
                        const val = e.target.value;
                        setCycleUtr(val);
                        checkCycleUtrDuplicate(val);
                      }}
                      className={cycleUtrExists ? 'input-error' : ''}
                      placeholder="Enter UTR from payment confirmation"
                    />
                    {checkingCycleUtr && <div className="hint" style={{ color: 'var(--accent)', marginTop: '0.25rem' }}>Checking UTR...</div>}
                    {cycleUtrExists && <div className="field-error">This UTR ID has already been used.</div>}
                  </div>
                  <div className="field">
                    <label>Payment Screenshot *</label>
                    <input type="file" accept="image/*" onChange={handleCycleFileSelect} />
                    {cyclePaymentPreview && (
                      <img
                        src={cyclePaymentPreview}
                        alt="Preview"
                        className="screenshot-preview"
                      />
                    )}
                  </div>
                  <div className="flex-row mt-sm">
                    <button
                      type="button"
                      className={`btn btn-primary${uploading ? ' btn-loading' : ''}`}
                      onClick={() => handleUploadCyclePayment()}
                      disabled={uploading || !cyclePaymentFile || !cycleUtr.trim() || cycleUtrExists}
                    >
                      {uploading ? 'Submitting...' : 'Submit Payment'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => { setShowCyclePaymentForm(false); setCycleUtrExists(false); }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
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
            Submit a topup payment request. Once approved by admin, your sponsor will receive a referral benefit.
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

          {!showTopupForm ? (
            <button className="btn btn-primary mb-md" onClick={() => setShowTopupForm(true)}>
              Submit Topup Request
            </button>
          ) : (
            <div className="surface-card mb-md">
              <UpiQrDisplay />
              <div className="field">
                <label>Amount (INR) *</label>
                <input type="number" value={topupAmount} onChange={e => setTopupAmount(e.target.value)} placeholder="Enter topup amount" min="1" />
              </div>
              <div className="field">
                <label>Transaction ID / UTR *</label>
                <input type="text" value={topupTransactionId} onChange={e => {
                  const val = e.target.value;
                  setTopupTransactionId(val);
                  checkTopupUtrDuplicate(val);
                }} className={topupUtrExists ? 'input-error' : ''} placeholder="Enter transaction reference number" />
                {checkingTopupUtr && <div className="hint" style={{ color: 'var(--accent)', marginTop: '0.25rem' }}>Checking UTR...</div>}
                {topupUtrExists && <div className="field-error">This UTR ID has already been used.</div>}
              </div>
              <div className="field">
                <label>Payment Screenshot *</label>
                <input type="file" accept="image/*" onChange={handleTopupFileSelect} />
                {topupPreview && (
                  <img src={topupPreview} alt="Preview" className="screenshot-preview" />
                )}
              </div>
              <div className="flex-row">
                <button className={`btn btn-primary${submittingTopup ? ' btn-loading' : ''}`} onClick={handleSubmitTopup} disabled={submittingTopup || !topupAmount || !topupTransactionId.trim() || !topupFile || topupUtrExists}>
                  {submittingTopup ? 'Submitting...' : 'Submit Topup'}
                </button>
                <button className="btn btn-ghost" onClick={() => { setShowTopupForm(false); setTopupPreview(null); setTopupFile(null); setTopupUtrExists(false); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

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
                          <span className="badge badge-pending text-xs">Pending Admin Credit</span>
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
        {user?.payment_status === 'approved' && (
        <div className={`card${isQualified ? ' card-dim' : ''}`}>
          <div className="flex-row-wrap refer-header">
            <h2 className="refer-header-title">My Referrals ({approvedReferralCount})</h2>
            <span className="badge badge-paid text-xs">
              Views: {viewCount}
            </span>
          </div>

          {pendingReferralCount > 0 && (
            <div className="alert alert-info text-sm mt-sm">
              Waiting for admin approval of {pendingReferralCount} referral(s).
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
              You have reached the maximum of {MAX_REFERRALS} referrals. Complete cycle payment to refer more.
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

        {/* Approval Timeline */}
        <div className="card mb-lg">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            Approval Timeline
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
                <p className="muted" style={{ fontSize: '0.85rem' }}>No approval events yet.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}