import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { FirebaseUser, FirebaseStorage, FirebaseAuth, MAX_REFERRALS, FirebaseNewReferral, FirebaseReferralAccess } from '../db/firebase-db.js';

const UPI_VPA = import.meta.env.VITE_UPI_VPA || 'jayarajj126-3@okicici';
const UPI_PAYEE_NAME = import.meta.env.VITE_UPI_PAYEE_NAME || 'Community';

function buildUpiUri() {
  const pa = encodeURIComponent(UPI_VPA);
  const pn = encodeURIComponent(UPI_PAYEE_NAME);
  return `upi://pay?pa=${pa}&pn=${pn}&am=&cu=INR`;
}

function UpiQrDisplay() {
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    QRCode.toDataURL(buildUpiUri(), { width: 200, margin: 2 }).then(setQrDataUrl);
  }, []);

  return (
    <div style={{ textAlign: 'center', marginTop: '1rem' }}>
      {qrDataUrl && <img src={qrDataUrl} alt="UPI QR" style={{ borderRadius: '8px', border: '1px solid var(--border)' }} />}
      <div className="upi-id-box" style={{ marginTop: '0.75rem' }}>
        <div className="label">UPI ID / VPA</div>
        <code style={{ fontSize: '1rem' }}>{UPI_VPA}</code>
      </div>
    </div>
  );
}

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

  const userId = localStorage.getItem('fb_user_id');

  useEffect(() => {
    if (!userId) {
      navigate('/fb/login', { replace: true });
      return;
    }

    let timeoutId;
    let cancelled = false;

    const loadUser = async () => {
      timeoutId = setTimeout(() => {
        if (!cancelled) {
          setError('Loading is taking too long. Please check your connection and refresh the page.');
          setLoading(false);
        }
      }, 15000); // 15 second timeout

      try {
        const data = await FirebaseUser.findById(userId);
        clearTimeout(timeoutId);

        if (cancelled) return;

        if (!data) {
          localStorage.removeItem('fb_user_id');
          navigate('/fb/login');
          return;
        }
        setUser(data);
        setLoading(false);
      } catch (err) {
        clearTimeout(timeoutId);
        if (!cancelled) {
          console.error('Dashboard load error:', err);
          setError(err.message || 'Failed to load user data. Please try again.');
          setLoading(false);
        }
      }
    };

    loadUser();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [userId, navigate]);

  useEffect(() => {
    if (!user?.referral_code) return;
    const unsubscribeReferrals = FirebaseUser.subscribeToReferralsByCode(user.referral_code, (updatedReferrals) => {
      console.log('📥 Referrals updated:', updatedReferrals);
      setReferrals(updatedReferrals);
    });
    return () => {
      if (unsubscribeReferrals) unsubscribeReferrals();
    };
  }, [user?.referral_code]);

  useEffect(() => {
    if (user?.referred_by) {
      FirebaseUser.getReferrerInfo(user.referred_by).then(setReferrerInfo);
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

    // Backend validation: ensure user has completed 2 referrals
    const freshUser = await FirebaseUser.findById(userId);
    if (!freshUser) {
      setError('User not found');
      return;
    }
    const freshCount = freshUser.referrals_count || 0;
    if (freshCount < 2 && !freshUser.is_qualified) {
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
    console.log('Cycle payment: userId=', userId, 'UTR=', cycleUtr, 'file=', cyclePaymentFile?.name);
    try {
      const url = await FirebaseStorage.uploadCyclePaymentScreenshot(userId, cyclePaymentFile);
      console.log('Uploaded to:', url);
      await FirebaseUser.updateCyclePayment(userId, url, cycleUtr.trim());
      console.log('Cycle payment submitted');
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

  if (loading) {
    return (
      <div className="app-shell">
        <div className="topbar">
          <div className="brand">Loading...</div>
        </div>
        <div style={{ textAlign: 'center', padding: '2rem' }}>Loading...</div>
      </div>
    );
  }

  const canAddMoreReferrals = referrals.length < MAX_REFERRALS;
  const referralCount = user?.referrals_count || 0;
  const isQualified = referralCount >= 2 || user?.is_qualified === true;
  const isActive = user?.account_status === 'active' && user?.payment_status === 'approved';
  const canRefer = isActive && referralCount < 2;
  const cyclePending = user?.cycle_payment_status === 'pending';
  const cycleApproved = user?.cycle_payment_status === 'approved';
  const needsCyclePayment = isQualified && !cycleApproved;
  const showCyclePayment = needsCyclePayment && !cyclePending;

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
      console.log('Share failed:', err);
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
                {user?.status || 'pending'}
              </span>
              {user?.is_qualified && (
                <span className="badge badge-paid" style={{ marginLeft: '0.5rem' }}>Qualified</span>
              )}
              {user?.account_status === 'inactive' && (
                <span className="badge badge-rejected" style={{ marginLeft: '0.5rem' }}>Inactive</span>
              )}
            </div>
            {user?.referred_by && (
              <div>
                <strong>Referred By:</strong> 
                <span style={{ marginLeft: '0.5rem' }}>
                  {referrerInfo ? `${referrerInfo.name} (${referrerInfo.email})` : user.referred_by}
                </span>
              </div>
            )}
            
            {user?.referral_code && (
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
                  <span className={`referral-stat-value ${referrals.length >= MAX_REFERRALS ? 'danger' : 'success'}`}>
                    {referrals.length}
                  </span>
                  <span className="referral-stat-label">/ {MAX_REFERRALS} Referrals</span>
                </div>
                {user?.total_referral_count > 0 && (
                  <div className="referral-stat-item">
                    <span className="referral-stat-value info">{user.total_referral_count}</span>
                    <span className="referral-stat-label">Total</span>
                  </div>
                )}
                {referrals.length >= 2 && (
                  <span className="qualified-pill">&#10003; Qualified</span>
                )}
              </div>
            </div>
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
                    <button type="submit" className="btn btn-primary" disabled={updatingPassword}>
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

        {/* Referral progress - complete 2 referrals to unlock payment */}
        {!isQualified && !isActive && !user?.is_first_payment_done && (
          <div className="card" style={{ marginBottom: '1.5rem', border: '1px solid var(--border)' }}>
            <h2>Complete Referrals to Unlock Payment</h2>
            <p className="muted">Invite 2 friends using your referral code to unlock payment access.</p>
            <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ flex: 1, height: '8px', background: 'var(--surface-2)', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min((referralCount / 2) * 100, 100)}%`, background: 'linear-gradient(90deg, var(--accent), var(--success))', borderRadius: '999px', transition: 'width 0.5s ease' }}></div>
              </div>
              <span style={{ fontWeight: 700, fontSize: '0.9rem', whiteSpace: 'nowrap', color: 'var(--text)' }}>{referralCount} / 2</span>
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
                      className="btn btn-primary" 
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

        {/* Cycle Payment Card */}
        {isQualified && (
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
                      className="btn btn-primary"
                      onClick={() => {
                        console.log('Submit button clicked', { cyclePaymentFile, cycleUtr, uploading });
                        handleUploadCyclePayment();
                      }}
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

        {/* Referrals Card - only show after payment approval */}
        {user?.payment_status === 'approved' && (
        <div className={`card ${isQualified ? 'disabled-card' : ''}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>My Referrals ({referrals.length})</h2>
            <span className="badge badge-paid" style={{ fontSize: '0.75rem' }}>
              Views: {viewCount}
            </span>
          </div>

          {referrals.length === 0 ? (
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