import { useState, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FirebaseUser, FirebaseAuth, generateReferralCode } from '../db/firebase-db.js';

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
    return nameValid && emailValid && phoneValid && utrValid && passwordValid && isValidReferral && !loading && !emailExists && !phoneExists;
  }, [name, email, phone, utr, password, isValidReferral, loading, emailExists, phoneExists]);

  function checkEmailDuplicate(emailVal) {
    if (!emailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      setEmailExists(false);
      return;
    }
    FirebaseUser.findByEmail(emailVal).then(existing => {
      setEmailExists(!!existing);
    });
  }

  function checkPhoneDuplicate(phoneVal) {
    if (phoneVal.trim().length < 10) {
      setPhoneExists(false);
      return;
    }
    FirebaseUser.findByPhone(phoneVal).then(existing => {
      setPhoneExists(!!existing);
    });
  }

  async function validateReferralCode() {
    if (!referralCode.trim()) {
      setReferralError('');
      setValidatingReferral(false);
      return true;
    }
    setReferralError('');
    try {
      const referrer = await FirebaseUser.findByReferralCode(referralCode.trim().toUpperCase());
      if (!referrer) {
        setReferralError('Invalid referral code');
        setValidatingReferral(false);
        return false;
      }
      if (referrer.payment_status !== 'approved' || referrer.account_status !== 'active') {
        setReferralError('Referral code is no longer valid');
        setValidatingReferral(false);
        return false;
      }
      if ((referrer.referrals_count || 0) >= 2) {
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

      const passVal = password;
      if (!passVal || passVal.length < 6) {
        setError('Password must be at least 6 characters');
        setLoading(false);
        return;
      }

      let referredBy = null;
      if (referralCode.trim()) {
        const referrer = await FirebaseUser.findByReferralCode(referralCode.trim().toUpperCase());
        if (referrer) {
          if (referrer.payment_status !== 'approved' || referrer.account_status !== 'active') {
            setError('Referral code is no longer valid');
            setLoading(false);
            return;
          }
          if ((referrer.referrals_count || 0) >= 2) {
            setError('Referral code is no longer valid');
            setLoading(false);
            return;
          }
          referredBy = referralCode.trim().toUpperCase();
        }
      }

      console.log('=== REGISTRATION START ===');
      console.log('Name:', name.trim());
      console.log('Email:', emailVal);
      console.log('Phone:', phone.trim());
      console.log('UTR:', utrVal);
      console.log('Referred By:', referredBy);
      
      console.log('Checking email...');
      const existingEmail = await FirebaseUser.findByEmail(emailVal);
      console.log('Existing email:', existingEmail);
      if (existingEmail) {
        setError('This email is already registered. Please use a different email.');
        setLoading(false);
        return;
      }
      
      console.log('Checking phone...');
      const existingPhone = await FirebaseUser.findByPhone(phone.trim());
      console.log('Existing phone:', existingPhone);
      if (existingPhone) {
        setError('This phone number is already registered. Please use a different number.');
        setLoading(false);
        return;
      }
      
      console.log('Creating user...');
      const user = await FirebaseUser.createWithPassword({
        name: name.trim(),
        email: emailVal,
        phone: phone.trim(),
        password: passVal,
        referredBy: referredBy,
      });

      console.log('User created with ID:', user.id);

      if (referredBy) {
        await FirebaseUser.incrementReferralCountByCode(referredBy);
      }

      await FirebaseUser.updatePayment(user.id, null, utrVal);
      console.log('UTR updated');
      
      console.log('=== REGISTRATION COMPLETE ===');

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
        <div className="card" style={{ maxWidth: 440, margin: '2rem auto', textAlign: 'center' }}>
          <h1>Registration Successful!</h1>
          <div className="alert alert-success">
            <strong>Account created!</strong><br/>
            Please wait for admin approval.<br/>
            Then login with your email and password.
          </div>
          <Link to="/fb/login" className="btn btn-primary" style={{ marginTop: '1rem' }}>
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
      <div className="card" style={{ maxWidth: 440, margin: '2rem auto' }}>
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
            {emailExists && <div style={{ color: 'var(--error)', fontSize: '0.85rem', marginTop: '0.25rem' }}>This email is already registered</div>}
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
            {phoneExists && <div style={{ color: 'var(--error)', fontSize: '0.85rem', marginTop: '0.25rem' }}>This phone number is already registered</div>}
          </div>
          <div className="field">
            <label>UTR Number *</label>
            <input 
              required 
              value={utr} 
              onChange={e => setUtr(e.target.value)} 
              style={utr.trim() ? {} : {}}
            />
          </div>
          <div className="field">
            <label>Password *</label>
            <div style={{ position: 'relative' }}>
              <input 
                required 
                type={showPassword ? 'text' : 'password'} 
                value={password} 
                minLength={6} 
                onChange={e => setPassword(e.target.value)} 
                style={{ width: '100%', paddingRight: '2.5rem', ...(password.length >= 6 ? {} : {}) }}
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
            {referralError && <div className="muted" style={{ color: 'var(--error)', fontSize: '0.8rem', marginTop: '0.25rem' }}>{referralError}</div>}
            {validatingReferral && <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>Validating...</div>}
          </div>
          {(emailExists || phoneExists) && (
            <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
              {emailExists && <div>This email is already registered. Please use a different email.</div>}
              {phoneExists && <div>This phone number is already registered. Please use a different number.</div>}
            </div>
          )}
          <button className="btn btn-primary" type="submit" disabled={!canSubmit || emailExists || phoneExists} style={{ width: '100%' }}>
            {loading ? 'Creating...' : 'Create Account'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: '1rem' }}>
          Already have account? <Link to="/fb/login">Login</Link>
        </p>
      </div>
    </div>
  );
}
