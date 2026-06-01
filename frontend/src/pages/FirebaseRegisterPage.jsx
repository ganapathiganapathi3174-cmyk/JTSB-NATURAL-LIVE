import { useState, useMemo, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FirebaseUser, checkReferralLinkExpiry } from '../db/firebase-db.js';

export default function FirebaseRegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [utr, setUtr] = useState('');
  const [referralCode, setReferralCode] = useState(() => searchParams.get('ref') || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [referralError, setReferralError] = useState('');
  const [validatingReferral, setValidatingReferral] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [emailExists, setEmailExists] = useState(false);
  const [phoneExists, setPhoneExists] = useState(false);
  const [utrExists, setUtrExists] = useState(false);
  const [checkingUtr, setCheckingUtr] = useState(false);
  const utrTimer = useRef(null);

  const isValidReferral = useMemo(() => {
    if (!referralCode.trim()) return true;
    return referralError === '';
  }, [referralCode, referralError]);

  const canSubmit = useMemo(() => {
    const nameValid = name.trim().length > 0;
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    const phoneValid = phone.trim().length >= 10;
    const utrValid = utr.trim().length > 0;
    const passwordValid = password.length >= 6;
    return nameValid && emailValid && phoneValid && utrValid && passwordValid && isValidReferral && !loading && !emailExists && !phoneExists && !utrExists;
  }, [name, email, phone, utr, password, isValidReferral, loading, emailExists, phoneExists]);

  function checkEmailDuplicate(emailVal) {
    if (!emailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      setEmailExists(false);
      return;
    }
    FirebaseUser.findByEmail(emailVal).then(existing => {
      setEmailExists(!!existing);
    }).catch(() => setEmailExists(false));
  }

  function checkPhoneDuplicate(phoneVal) {
    if (phoneVal.trim().length < 10) {
      setPhoneExists(false);
      return;
    }
    FirebaseUser.findByPhone(phoneVal).then(existing => {
      setPhoneExists(!!existing);
    }).catch(() => setPhoneExists(false));
  }

  function checkUtrDuplicate(val) {
    if (utrTimer.current) clearTimeout(utrTimer.current);
    if (!val.trim()) {
      setUtrExists(false);
      setCheckingUtr(false);
      return;
    }
    setCheckingUtr(true);
    utrTimer.current = setTimeout(async () => {
      try {
        const exists = await FirebaseUser.checkUtrExists(val.trim());
        setUtrExists(exists);
      } catch {
        setUtrExists(false);
      } finally {
        setCheckingUtr(false);
      }
    }, 500);
  }

  async function validateReferralCode() {
    if (!referralCode.trim()) {
      setReferralError('');
      setValidatingReferral(false);
      return true;
    }
    setReferralError('');
    try {
      const expiryResult = await checkReferralLinkExpiry(referralCode.trim().toUpperCase());
      if (!expiryResult.valid) {
        if (expiryResult.reason === 'expired') {
          setReferralError('Referral link has expired');
        } else if (expiryResult.reason === 'limit_reached') {
          setReferralError('Invalid Referral Code');
        } else {
          setReferralError('Invalid referral code');
        }
        setValidatingReferral(false);
        return false;
      }
      const referrer = expiryResult.referrer;
      if (!referrer || referrer.payment_status !== 'approved' || referrer.account_status !== 'active' || referrer.admin_status === 'suspicious') {
        setReferralError('Referral code is no longer valid');
        setValidatingReferral(false);
        return false;
      }
      
      setValidatingReferral(false);
      return true;
    } catch (err) {
      setReferralError('Referral validation failed');
      setValidatingReferral(false);
      return false;
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!name.trim()) {
        setError('Name is required');
        setLoading(false);
        return;
      }

      const emailVal = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
        setError('Valid email is required');
        setLoading(false);
        return;
      }

      if (!phone.trim()) {
        setError('Phone number is required');
        setLoading(false);
        return;
      }

      const utrVal = utr.trim();
      if (!utrVal) {
        setError('UTR Number is required');
        setLoading(false);
        return;
      }
      const dupCheck = await FirebaseUser.checkUtrExists(utrVal);
      if (dupCheck) {
        setError('This UTR number already exists.');
        setLoading(false);
        return;
      }

      const passVal = password;
      if (!passVal || passVal.length < 6) {
        setError('Password must be at least 6 characters');
        setLoading(false);
        return;
      }

      let referredBy = null;
      if (referralCode.trim()) {
        const expiryCheck = await checkReferralLinkExpiry(referralCode.trim().toUpperCase());
        if (!expiryCheck.valid) {
          if (expiryCheck.reason === 'expired') {
            setError('Referral link has expired. Please use a valid referral code.');
          } else if (expiryCheck.reason === 'limit_reached') {
            setError('Invalid Referral Code');
          } else {
            setError('Invalid referral code');
          }
          setLoading(false);
          return;
        }
        const referrer = expiryCheck.referrer;
        if (!referrer || referrer.payment_status !== 'approved' || referrer.account_status !== 'active' || referrer.admin_status === 'suspicious') {
          setError('Referral code is no longer valid');
          setLoading(false);
          return;
        }
        referredBy = referralCode.trim().toUpperCase();
      }

      const user = await FirebaseUser.createWithPassword({
        name: name.trim(),
        email: emailVal,
        phone: phone.trim(),
        password: passVal,
        referredBy: referredBy,
      });

      await FirebaseUser.updatePayment(user.id, null, utrVal);

      setSuccess(true);
      setTimeout(() => navigate('/fb/login'), 2000);
    } catch (err) {
      console.error('Registration error:', err);
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="app-shell">
        <div className="topbar">
          <div className="brand">Starlight Ascent</div>
        </div>
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <h1>Registration Successful!</h1>
          <div className="alert alert-success">
            <strong>Account created!</strong><br/>
            Please wait for admin approval.<br/>
            Then login with your email and password.
          </div>
          <Link to="/fb/login" className="btn btn-primary mt-md">
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">Starlight Ascent</div>
        <Link to="/fb/login">Login</Link>
      </div>
      <div className="auth-card">
        <h1>Create Account</h1>
        
        {error && <div className="alert alert-error">{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Full name *</label>
            <input 
              required 
              value={name} 
              onChange={e => setName(e.target.value)} 
              style={!name.trim() ? {} : { borderColor: 'var(--success)' }}
            />
          </div>
          <div className="field">
            <label>Email *</label>
            <input 
              required 
              type="email" 
              value={email} 
              onChange={e => setEmail(e.target.value)} 
              onBlur={e => checkEmailDuplicate(e.target.value)}
              style={{ borderColor: emailExists ? 'var(--error)' : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? 'var(--success)' : '' }}
            />
            {emailExists && <div className="field-error">This email is already registered</div>}
          </div>
          <div className="field">
            <label>Phone *</label>
            <input 
              required 
              type="tel" 
              value={phone} 
              onChange={e => setPhone(e.target.value)} 
              onBlur={e => checkPhoneDuplicate(e.target.value)}
              style={{ borderColor: phoneExists ? 'var(--error)' : phone.trim().length >= 10 ? 'var(--success)' : '' }}
            />
            {phoneExists && <div className="field-error">This phone number is already registered</div>}
          </div>
          <div className="field">
            <label>UTR Number *</label>
            <input
              required
              value={utr}
              onChange={e => setUtr(e.target.value)}
              onBlur={e => checkUtrDuplicate(e.target.value)}
              className={utrExists ? 'input-error' : (utr.trim() && !utrExists ? 'input-valid' : '')}
            />
            {checkingUtr && <div className="hint">Checking UTR...</div>}
            {utrExists && <div className="field-error">This UTR number already exists.</div>}
            {utr.trim() && !utrExists && !checkingUtr && <div className="hint" style={{ color: 'var(--success)' }}>UTR number is available</div>}
          </div>
          <div className="field">
            <label>Password *</label>
            <div className="password-field-wrap">
              <input 
                required 
                type={showPassword ? 'text' : 'password'} 
                value={password} 
                minLength={6} 
                onChange={e => setPassword(e.target.value)} 
                className="w-full"
                style={{ paddingRight: '2.5rem' }}
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
            <label>Referral Code (optional)</label>
            <input 
              value={referralCode} 
              onChange={e => {
                setReferralCode(e.target.value.toUpperCase());
                setReferralError('');
              }} 
              onBlur={validateReferralCode}
              style={referralError ? { borderColor: 'var(--error)' } : !referralCode.trim() ? {} : { borderColor: 'var(--success)' }}
            />
            {referralError && <div className="field-error">{referralError}</div>}
            {validatingReferral && <div className="hint">Validating...</div>}
          </div>
          {(emailExists || phoneExists) && (
            <div className="alert alert-error mb-md">
              {emailExists && <div>This email is already registered. Please use a different email.</div>}
              {phoneExists && <div>This phone number is already registered. Please use a different number.</div>}
            </div>
          )}
          <button className={`btn btn-primary w-full${loading ? ' btn-loading' : ''}`} type="submit" disabled={!canSubmit || emailExists || phoneExists}>
            {loading ? 'Creating...' : 'Create Account'}
          </button>
        </form>
        <p className="muted mt-md">
          Already have account? <Link to="/fb/login">Login</Link>
        </p>
      </div>
    </div>
  );
}
