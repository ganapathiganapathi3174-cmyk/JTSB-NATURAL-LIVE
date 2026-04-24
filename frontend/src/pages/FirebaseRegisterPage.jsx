import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FirebaseUser, FirebaseAuth, generateReferralCode } from '../db/firebase-db.js';

export default function FirebaseRegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [utr, setUtr] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const emailVal = email.trim().toLowerCase();
      const utrVal = utr.trim();
      const passVal = password;

      if (!passVal) {
        setError('Password is required');
        setLoading(false);
        return;
      }

      if (!utrVal) {
        setError('UTR Number is required');
        setLoading(false);
        return;
      }

      // Check referral code
      let referredBy = null;
      if (referralCode.trim()) {
        const referrer = await FirebaseUser.findByReferralCode(referralCode.trim().toUpperCase());
        if (referrer) {
          referredBy = referralCode.trim().toUpperCase();
          console.log('User referred by:', referredBy);
        }
      }

      // Create user in Firestore first (with password and referral)
      console.log('=== REGISTRATION START ===');
      console.log('Name:', name.trim());
      console.log('Email:', emailVal);
      console.log('UTR:', utrVal);
      console.log('Referred By:', referredBy);
      
      const user = await FirebaseUser.createWithPassword({
        name: name.trim(),
        email: emailVal,
        phone: phone.trim(),
        password: passVal,
        referredBy: referredBy,
      });

      console.log('User created with ID:', user.id);

      // If referred, increment referrer's count
      if (referredBy) {
        await FirebaseUser.incrementReferralCountByCode(referredBy);
      }

      // Update UTR
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
            <label>Full name</label>
            <input required value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Email</label>
            <input required type="email" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input required type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div className="field">
            <label>UTR Number</label>
            <input required value={utr} onChange={e => setUtr(e.target.value)} />
          </div>
          <div className="field">
            <label>Password</label>
            <input required type="password" value={password} minLength={6} onChange={e => setPassword(e.target.value)} />
          </div>
          <div className="field">
            <label>Referral Code (optional)</label>
            <input value={referralCode} onChange={e => setReferralCode(e.target.value.toUpperCase())} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
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
