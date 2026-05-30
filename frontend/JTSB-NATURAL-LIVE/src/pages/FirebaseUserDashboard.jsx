import { useEffect, useState, useMemo, memo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { FirebaseUser, FirebaseStorage, FirebaseAuth, MAX_REFERRALS, FirebaseNewReferral, FirebaseReferralAccess, FirebaseTopup, FirebaseTopupReferral } from '../db/firebase-db.js';

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
    <div style={{ textAlign: 'center', marginTop: '1rem' }}>
      {qrError ? (
        <div className="muted" style={{ padding: '1rem' }}>{qrError}</div>
      ) : qrDataUrl ? (
        <img src={qrDataUrl} alt="UPI QR" style={{ borderRadius: '8px', border: '1px solid var(--border)' }} />
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

export default function FirebaseUserDashboard() {
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

  // Topup state
  const [topups, setTopups] = useState([]);
  const [topupAmount, setTopupAmount] = useState('');
  const [topupTransactionId, setTopupTransactionId] = useState('');
  const [topupFile, setTopupFile] = useState(null);
  const [topupPreview, setTopupPreview] = useState(null);
  const [showTopupForm, setShowTopupForm] = useState(false);
  const [submittingTopup, setSubmittingTopup] = useState(false);
  const [topupIncome, setTopupIncome] = useState([]);
  const [claimingId, setClaimingId] = useState(null);

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

  async function handleUploadCyclePayment() {
    if (!cyclePaymentFile || !cycleUtr.trim()) {
      setError('Screenshot and UTR are required');
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
      setShowCyclePaymentForm(false);
    } catch (err) {
      console.error('Cycle payment error:', err);
      setError(err.message);
    } finally {
      setUploading(false);
    }
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
        <div style={{ padding: '1rem', maxWidth: '800px', margin: '0 auto' }}>
          {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}
          <div className="skeleton-card">
            <div className="skeleton skeleton-line-lg" />
            <div className="skeleton skeleton-line-sm" style={{ width: '30%' }} />
            <div style={{ marginTop: '1.5rem' }}>
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line" style={{ width: '60%' }} />
            </div>
            <div style={{ marginTop: '1.5rem' }}>
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
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-ghost" onClick={handleLogout}>Log out</button>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ margin: '1rem' }}>{error}</div>}

      <div style={{ padding: '1rem', maxWidth: '800px', margin: '0 auto' }}>
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h2>My Profile</h2>
          <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
            <div>
              <strong>Name:</strong> {user?.name}
            </div>
            <div>
              <strong>Email:</strong> {user?.email}
            </div>
            <div>
              <strong>Phone:</strong> {user?.phone || '—'}
            </div>
            <div>
              <strong>Status:</strong> 
              <span className={`badge ${user?.status === 'approved' ? 'badge-paid' : user?.status === 'rejected' ? 'badge-rejected' : 'badge-pending'}`} style={{ marginLeft: '0.5rem' }}>
                {user?.status ? user.status.charAt(0).toUpperCase() + user.status.slice(1) : 'Pending'}
              </span>
              {user?.is_qualified && (
                <span className="badge badge-paid" style={{ marginLeft: '0.5rem' }}>Qualified</span>
              )}
              {user?.account_status === 'inactive' && !user?.sponsor_awaiting_credit && (
                <span className="badge badge-rejected" style={{ marginLeft: '0.5rem' }}>Inactive</span>
              )}
              {user?.topup_referral_qualified && !user?.sponsor_topup_completed && !user?.sponsor_cycle_completed && pendingTopups.length === 0 && (
                <span className="badge badge-paid" style={{ marginLeft: '0.5rem' }}>Sponsor Eligible</span>
              )}
              {user?.sponsor_awaiting_credit && !user?.sponsor_credited && (
                <span className="badge badge-rejected" style={{ marginLeft: '0.5rem' }}>Sponsor Inactive</span>
              )}
              {user?.sponsor_credited && (
                <span className="badge badge-paid" style={{ marginLeft: '0.5rem' }}>Credited</span>
              )}
            </div>
            {user?.topup_referral_qualified && (
              <div className="card" style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#856404' }}>Sponsor No:</span>
                <span style={{ fontFamily: 'monospace', fontSize: '1rem', fontWeight: 700, color: '#533f03', background: '#fff3cd', padding: '0.25rem 0.75rem', borderRadius: '6px', letterSpacing: '0.5px', border: '1px solid #ffc107' }}>{user?.referral_code || '—'}</span>
              </div>
            )}
            {user?.topup_referral_qualified && !user?.sponsor_topup_completed && !user?.sponsor_cycle_completed && pendingTopups.length === 0 && (
              <div className="alert alert-success" style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}>
                ✅ Referral topup condition met! Complete your own topup to receive sponsor benefits.
              </div>
            )}
            {user?.sponsor_awaiting_credit && !user?.sponsor_credited && (
              <div className="alert alert-info" style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}>
                ⏳ Your own topup is approved. Account set to Inactive. Awaiting admin credit of <strong>₹{Number(user?.sponsor_topup_amount || 0).toFixed(2)}</strong>.
              </div>
            )}
            {user?.sponsor_credited && (
              <div className="alert alert-success" style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}>
                ✅ Admin credited <strong>₹{Number(user?.sponsor_credited_amount || 0).toFixed(2)}</strong> to your account.
              </div>
            )}
            {user?.referred_by && (
              <div>
                <strong>Referred By:</strong> 
                <span style={{ marginLeft: '0.5rem' }}>
                  {referrerInfo ? `${referrerInfo.name} (${referrerInfo.email})` : user.referred_by}
                </span>
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
            
            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
              <strong>Password:</strong> 
              <span style={{ marginLeft: '0.5rem', color: user?.password ? 'var(--success)' : 'var(--error)' }}>
                {user?.password ? 'Set' : 'Not Set'}
              </span>
              {!user?.password && (
                <button 
                  className="btn btn-primary" 
                  onClick={() => setShowPasswordForm(true)}
                  style={{ marginLeft: '1rem' }}
                >
                  Set Password
                </button>
              )}
            </div>
            
            {showPasswordForm && (
              <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg)', borderRadius: '8px' }}>
                <h3>Set Your Password</h3>
                <form onSubmit={handleUpdatePassword}>
                  <div className="field">
                    <label>New Password</label>
                    <div style={{ position: 'relative' }}>
                      <input 
                        type={showPassword ? 'text' : 'password'} 
                        value={newPassword} 
                        onChange={e => setNewPassword(e.target.value)}
                        minLength={6}
                        required
                        placeholder="At least 6 characters"
                        style={{ width: '100%', paddingRight: '2.5rem' }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        style={{
                          position: 'absolute',
                          right: '0.5rem',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '1.1rem',
                          padding: '0.25rem'
                        }}
                      >
                        {showPassword ? '👁' : '👁️'}
                      </button>
                    </div>
                  </div>
                  <div className="field">
                    <label>Confirm Password</label>
                    <div style={{ position: 'relative' }}>
                      <input 
                        type={showPassword ? 'text' : 'password'} 
                        value={confirmPassword} 
                        onChange={e => setConfirmPassword(e.target.value)}
                        minLength={6}
                        required
                        placeholder="Re-enter password"
                        style={{ width: '100%', paddingRight: '2.5rem' }}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
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

        {/* Referral progress - complete 2 approved referrals to unlock payment */}
        {!isQualified && !isActive && !user?.is_first_payment_done && (
          <div className="card" style={{ marginBottom: '1.5rem', border: '1px solid var(--border)' }}>
            <h2>Complete Referrals to Unlock Payment</h2>
            <p className="muted">Payment cycle will unlock after 2 admin-approved referrals.</p>
            {pendingReferralCount > 0 && (
              <div className="alert alert-info" style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}>
                {pendingReferralCount} referral(s) pending admin approval. Only approved referrals count.
              </div>
            )}
            <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ flex: 1, height: '8px', background: 'var(--surface-2)', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min((approvedReferralCount / 2) * 100, 100)}%`, background: 'linear-gradient(90deg, var(--accent), var(--success))', borderRadius: '999px', transition: 'width 0.5s ease' }}></div>
              </div>
              <span style={{ fontWeight: 700, fontSize: '0.9rem', whiteSpace: 'nowrap', color: 'var(--text)' }}>{approvedReferralCount} / 2 approved</span>
            </div>
          </div>
        )}

        {/* First-time payment for qualified users */}
        {isQualified && !isActive && !user?.is_first_payment_done && (
          <div className="card" style={{ marginBottom: '1.5rem', border: '2px solid var(--success)' }}>
            <div className="alert alert-success" style={{ marginBottom: '1rem' }}>
              <strong>Referral Target Completed!</strong> Your payment is now unlocked.
            </div>
            <h2>Complete Your Payment</h2>
            <p>Please submit your payment to activate your account.</p>
            <UpiQrDisplay />
            
            {!showPaymentUpload ? (
              <button 
                className="btn btn-primary" 
                style={{ marginTop: '1rem' }}
                onClick={() => setShowPaymentUpload(true)}
              >
                Submit Payment Details
              </button>
            ) : (
              user?.payment_status === 'pending' ? (
                <div className="alert alert-info" style={{ marginTop: '1rem' }}>
                  <strong>Payment submitted.</strong> Waiting for admin approval.
                </div>
              ) : (
                <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg)', borderRadius: '8px' }}>
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
                        style={{ maxWidth: '200px', marginTop: '0.5rem', borderRadius: '8px' }} 
                      />
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
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
          <div className="alert alert-warning" style={{ marginBottom: '1.5rem' }}>
            <strong>Referral Limit Reached!</strong> Complete the cycle payment to continue referring members.
          </div>
        )}

        {/* Cycle Payment Card (only after first payment is done) */}
        {isQualified && user?.is_first_payment_done && (
          <div className="card" style={{ marginBottom: '1.5rem', border: '2px solid var(--warning)' }}>
            <h2>Referral Limit Reached</h2>
            <p>Complete payment to continue referring members.</p>
            <UpiQrDisplay />

            {cyclePending ? (
              <div className="alert alert-info" style={{ marginTop: '1rem' }}>
                <strong>Waiting for admin approval.</strong> Your payment is being reviewed.
              </div>
            ) : !showCyclePaymentForm ? (
              <button
                className="btn btn-primary"
                style={{ marginTop: '1rem' }}
                onClick={() => setShowCyclePaymentForm(true)}
              >
                Submit Payment Details
              </button>
            ) : (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ padding: '1rem', background: 'var(--bg)', borderRadius: '8px' }}>
                  <div className="field">
                    <label>UTR Number *</label>
                    <input
                      type="text"
                      value={cycleUtr}
                      onChange={e => setCycleUtr(e.target.value)}
                      placeholder="Enter UTR from payment confirmation"
                    />
                  </div>
                  <div className="field">
                    <label>Payment Screenshot *</label>
                    <input type="file" accept="image/*" onChange={handleCycleFileSelect} />
                    {cyclePaymentPreview && (
                      <img
                        src={cyclePaymentPreview}
                        alt="Preview"
                        style={{ maxWidth: '200px', marginTop: '0.5rem', borderRadius: '8px' }}
                      />
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      className={`btn btn-primary${uploading ? ' btn-loading' : ''}`}
                      onClick={() => handleUploadCyclePayment()}
                      disabled={uploading || !cyclePaymentFile || !cycleUtr.trim()}
                    >
                      {uploading ? 'Submitting...' : 'Submit Payment'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setShowCyclePaymentForm(false)}
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
        <div className="card" style={{ marginBottom: '1.5rem', border: '1px solid var(--border)' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
            </svg>
            Topup
          </h2>
          <p className="muted" style={{ marginBottom: '1rem' }}>
            Submit a topup payment request. Once approved by admin, your sponsor will receive a referral benefit.
          </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
              <div className="stat" style={{ padding: '0.75rem' }}>
                <div className="value" style={{ fontSize: '1.2rem', color: 'var(--success)' }}>{approvedTopups.length}</div>
                <div className="label">Approved</div>
              </div>
              <div className="stat" style={{ padding: '0.75rem' }}>
                <div className="value" style={{ fontSize: '1.2rem', color: 'var(--warning)' }}>{pendingTopups.length}</div>
                <div className="label">Pending</div>
              </div>
              <div className="stat" style={{ padding: '0.75rem' }}>
                <div className="value" style={{ fontSize: '1.2rem', color: 'var(--danger)' }}>{rejectedTopups.length}</div>
                <div className="label">Rejected</div>
              </div>
              <div className="stat" style={{ padding: '0.75rem' }}>
                <div className="value" style={{ fontSize: '1.2rem', color: 'var(--accent)' }}>₹{totalTopupIncome.toFixed(2)}</div>
                <div className="label">Total Income</div>
              </div>
              <div className="stat" style={{ padding: '0.75rem' }}>
                <div className="value" style={{ fontSize: '1.2rem', color: userHasOwnTopup ? 'var(--success)' : 'var(--warning)' }}>
                  ₹{pendingClaimAmount.toFixed(2)}
                </div>
                <div className="label">Claimable</div>
              </div>
            </div>

          {!showTopupForm ? (
            <button className="btn btn-primary" onClick={() => setShowTopupForm(true)} style={{ marginBottom: '1rem' }}>
              Submit Topup Request
            </button>
          ) : (
            <div style={{ padding: '1rem', background: 'var(--bg)', borderRadius: '8px', marginBottom: '1rem' }}>
              <UpiQrDisplay />
              <div className="field">
                <label>Amount (INR) *</label>
                <input type="number" value={topupAmount} onChange={e => setTopupAmount(e.target.value)} placeholder="Enter topup amount" min="1" />
              </div>
              <div className="field">
                <label>Transaction ID / UTR *</label>
                <input type="text" value={topupTransactionId} onChange={e => setTopupTransactionId(e.target.value)} placeholder="Enter transaction reference number" />
              </div>
              <div className="field">
                <label>Payment Screenshot *</label>
                <input type="file" accept="image/*" onChange={handleTopupFileSelect} />
                {topupPreview && (
                  <img src={topupPreview} alt="Preview" style={{ maxWidth: '200px', marginTop: '0.5rem', borderRadius: '8px' }} />
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className={`btn btn-primary${submittingTopup ? ' btn-loading' : ''}`} onClick={handleSubmitTopup} disabled={submittingTopup || !topupAmount || !topupTransactionId.trim() || !topupFile}>
                  {submittingTopup ? 'Submitting...' : 'Submit Topup'}
                </button>
                <button className="btn btn-ghost" onClick={() => { setShowTopupForm(false); setTopupPreview(null); setTopupFile(null); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {topups.length > 0 && (
            <div style={{ marginTop: '0.75rem' }}>
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
                        <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                          {t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '—'}
                        </td>
                        <td style={{ fontWeight: 700 }}>₹{Number(t.amount || 0).toFixed(2)}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{t.transactionId || '—'}</td>
                        <td>
                          <span className={`badge ${t.status === 'approved' ? 'badge-paid' : t.status === 'rejected' ? 'badge-rejected' : 'badge-pending'}`}>
                            {t.status ? t.status.charAt(0).toUpperCase() + t.status.slice(1) : 'Pending'}
                          </span>
                        </td>
                        <td>
                          {t.status === 'approved' ? (
                            <span className="badge badge-paid">Done</span>
                          ) : (
                            <span className="muted" style={{ fontSize: '0.75rem' }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card" style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg)', borderRadius: '8px' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Topup Referral Income</h3>

            {!userHasOwnTopup && (
              <div className="alert alert-warning" style={{ marginBottom: '1rem', padding: '0.75rem', fontSize: '0.85rem' }}>
                <strong>Topup required!</strong> Complete your own topup to unlock referral income claims.
              </div>
            )}

            {lockedIncome.length > 0 && (
              <div className="alert alert-info" style={{ marginBottom: '1rem', padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}>
                <strong>{lockedIncome.length} income record(s) locked.</strong> Complete your own topup to make them eligible.
              </div>
            )}

            {pendingClaimAmount > 0 && (
              <div className="alert alert-success" style={{ marginBottom: '1rem', padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}>
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
                      <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                        {inc.createdAt ? new Date(inc.createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td>{inc.fromUserName || inc.fromUserId || '—'}</td>
                      <td style={{ fontWeight: 700, color: inc.status === 'claimed' ? 'var(--text-muted)' : 'var(--success)' }}>
                        +₹{Number(inc.amount || 0).toFixed(2)}
                      </td>
                      <td>
                        {inc.status === 'locked' && (
                          <span className="badge badge-pending" style={{ background: 'var(--warning)', color: '#000' }}>Locked</span>
                        )}
                        {inc.status === 'eligible' && (
                          <span className="badge badge-paid">Eligible</span>
                        )}
                        {inc.status === 'claimed' && (
                          <span className="badge badge-rejected" style={{ background: 'var(--text-muted)' }}>Claimed</span>
                        )}
                        {!inc.status && (
                          <span className="badge badge-pending">Pending</span>
                        )}
                      </td>
                      <td>
                        {inc.status === 'eligible' && userHasOwnTopup && !user?.sponsor_awaiting_credit && (
                          <button
                            className="btn btn-primary"
                            onClick={() => handleClaimIncome(inc.id)}
                            disabled={claimingId === inc.id}
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                          >
                            {claimingId === inc.id ? 'Claiming...' : 'Claim'}
                          </button>
                        )}
                        {inc.status === 'eligible' && user?.sponsor_awaiting_credit && (
                          <span className="badge badge-pending" style={{ fontSize: '0.7rem' }}>Pending Admin Credit</span>
                        )}
                        {inc.status === 'locked' && (
                          <span className="muted" style={{ fontSize: '0.75rem' }}>Locked</span>
                        )}
                        {inc.status === 'claimed' && (
                          <span className="muted" style={{ fontSize: '0.75rem' }}>—</span>
                        )}
                        {!inc.status && (
                          <span className="muted" style={{ fontSize: '0.75rem' }}>—</span>
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
        <div className={`card ${isQualified ? 'disabled-card' : ''}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>My Referrals ({approvedReferralCount})</h2>
            <span className="badge badge-paid" style={{ fontSize: '0.75rem' }}>
              Views: {viewCount}
            </span>
          </div>

          {pendingReferralCount > 0 && (
            <div className="alert alert-info" style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}>
              Waiting for admin approval of {pendingReferralCount} referral(s).
            </div>
          )}

          {approvedReferralCount === 0 ? (
            <p className="muted" style={{ marginTop: '1rem' }}>
              No referrals yet. Share your referral code to invite members.
            </p>
          ) : (
            <div style={{ marginTop: '1rem', display: 'grid', gap: '1rem' }}>
              {referrals.map((ref) => (
                <div key={ref.id} style={{ padding: '1rem', background: 'var(--bg)', borderRadius: '8px' }}>
                  <div style={{ fontWeight: 'bold' }}>{ref.name}</div>
                  <div className="muted">📧 {ref.email}</div>
                  <div className="muted">📞 {ref.phone}</div>
                </div>
              ))}
            </div>
          )}

          {!canAddMoreReferrals && isActive && (
            <p className="muted" style={{ marginTop: '1rem' }}>
              You have reached the maximum of {MAX_REFERRALS} referrals. Complete cycle payment to refer more.
            </p>
          )}
        </div>
        )}

        
      </div>
    </div>
  );
}