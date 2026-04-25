import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FirebaseUser, FirebaseStorage, FirebaseAuth, MAX_REFERRALS, FirebaseNewReferral } from '../db/firebase-db.js';

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

  // Payment upload state
  const [showPaymentUpload, setShowPaymentUpload] = useState(false);
  const [paymentFile, setPaymentFile] = useState(null);
  const [paymentPreview, setPaymentPreview] = useState(null);

  const userId = localStorage.getItem('fb_user_id');

  const loadUser = useCallback(async () => {
    if (!userId) {
      navigate('/fb/login', { replace: true });
      return;
    }
    try {
      const data = await FirebaseUser.findById(userId);
      if (!data) {
        localStorage.removeItem('fb_user_id');
        navigate('/fb/login');
        return;
      }
      setUser(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [userId, navigate]);

  useEffect(() => {
    loadUser();

    const unsubscribeUser = FirebaseUser.subscribeToUser(userId, (updatedUser) => {
      console.log('📥 User updated:', updatedUser);
      if (updatedUser) {
        setUser(updatedUser);
      }
    });

    return () => {
      if (unsubscribeUser) unsubscribeUser();
    };
  }, [userId, loadUser]);

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

  async function handleLogout() {
    await FirebaseAuth.logout();
    localStorage.removeItem('fb_user_id');
    navigate('/fb/login');
  }

  async function handleAddReferral(e) {
    e.preventDefault();
    setAddingReferral(true);
    setError('');

    try {
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
    if (!paymentFile) return;
    setUploading(true);
    setError('');

    try {
      const url = await FirebaseStorage.uploadPaymentScreenshot(userId, paymentFile);
      await FirebaseUser.updateUpiScreenshot(userId, url, 'pending');
      
      setPaymentFile(null);
      setPaymentPreview(null);
      setShowPaymentUpload(false);
    } catch (err) {
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
            </div>
            {user?.referred_by && (
              <div>
                <strong>Referred By:</strong> 
                <span style={{ marginLeft: '0.5rem' }}>
                  {referrerInfo ? `${referrerInfo.name} (${referrerInfo.email})` : user.referred_by}
                </span>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <strong>Referral Code:</strong> 
              <code style={{ background: 'var(--bg)', padding: '0.4rem 0.6rem', borderRadius: '4px', fontSize: '1.1rem', fontWeight: 'bold' }}>
                {user?.referral_code}
              </code>
              <button className="btn btn-ghost" onClick={copyReferralCode}>
                {copied ? '✓ Copied!' : 'Copy'}
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <strong>Referral Link:</strong> 
              <code style={{ background: 'var(--bg)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.85rem', fontFamily: 'monospace' }}>
                {typeof window !== 'undefined' ? window.location.origin + '/fb/register?ref=' + user?.referral_code : ''}
              </code>
              <button className="btn btn-ghost" onClick={copyReferralLink} style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}>
                {copiedLink ? '✓ Copied!' : 'Copy Link'}
              </button>
              {navigator.share && (
                <button className="btn btn-ghost" onClick={shareReferralLink} style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}>
                  Share
                </button>
              )}
            </div>
            <div>
              <strong>Total Referrals:</strong> 
              <span style={{ marginLeft: '0.5rem', fontWeight: 'bold', color: referrals.length >= MAX_REFERRALS ? 'var(--error)' : 'var(--success)' }}>
                {referrals.length} / {MAX_REFERRALS}
              </span>
              {referrals.length >= 2 && (
                <span style={{ marginLeft: '0.5rem', color: 'var(--success)', fontWeight: 'bold' }}>
                  ✓ Qualified!
                </span>
              )}
            </div>
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

        {/* Referrals Card */}
        <div className="card">
          <h2>My Referrals ({referrals.length}/{MAX_REFERRALS})</h2>

          {referrals.length === 0 ? (
            <p className="muted" style={{ marginTop: '1rem' }}>
              No referrals yet. You can refer up to {MAX_REFERRALS} members.
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

          {!canAddMoreReferrals && (
            <p className="muted" style={{ marginTop: '1rem' }}>
              You have reached the maximum of {MAX_REFERRALS} referrals.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}