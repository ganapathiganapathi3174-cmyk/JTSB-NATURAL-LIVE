import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { FirebaseUser } from '../db/firebase-db.js';

const AMOUNT = Number(import.meta.env.VITE_PAYMENT_AMOUNT) || 120;
const UPI_VPA = import.meta.env.VITE_UPI_VPA || 'jayarajj126-3@okicici';
const UPI_PAYEE_NAME = import.meta.env.VITE_UPI_PAYEE_NAME || 'Community';

function buildUpiUri() {
  const pa = encodeURIComponent(UPI_VPA);
  const pn = encodeURIComponent(UPI_PAYEE_NAME);
  const am = AMOUNT.toFixed(2);
  return `upi://pay?pa=${pa}&pn=${pn}&am=${am}&cu=INR`;
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

export default function PaymentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const referredBy = searchParams.get('ref') || '';
  const [manualReferralCode, setManualReferralCode] = useState('');
  
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [utr, setUtr] = useState('');
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const MAX_FILE_SIZE = 500000; // 500KB limit for base64
  const UPI_REF_REGEX = /^[0-9]{10,20}$/;

  useEffect(() => {
    const uri = buildUpiUri();
    QRCode.toDataURL(uri, { width: 280, margin: 2 }).then(setQrDataUrl);
  }, []);

  function handleScreenshotChange(e) {
    const file = e.target.files?.[0];
    if (!file) {
      setScreenshot(null);
      setScreenshotPreview(null);
      return;
    }
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('Only JPG and PNG files are allowed');
      setScreenshot(null);
      setScreenshotPreview(null);
      e.target.value = '';
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('File size must be less than 500KB for faster upload');
      setScreenshot(null);
      setScreenshotPreview(null);
      e.target.value = '';
      return;
    }
    setError('');
    setScreenshot(file);
    const reader = new FileReader();
    reader.onload = (e) => setScreenshotPreview(e.target?.result);
    reader.readAsDataURL(file);
  }

  function validateForm() {
    if (!fullName.trim() || fullName.trim().length < 2) {
      setError('Full name must be at least 2 characters');
      return false;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address');
      return false;
    }
    if (!phoneNumber || !/^[6-9]\d{9}$/.test(phoneNumber)) {
      setError('Please enter a valid 10-digit Indian mobile number');
      return false;
    }
    if (!utr.trim() || !UPI_REF_REGEX.test(utr.trim())) {
      setError('Enter a valid UPI Reference Number (10-20 digits)');
      return false;
    }
    if (!screenshot) {
      setError('Please upload payment screenshot before submitting');
      return false;
    }
    return true;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    console.log('handleSubmit called');
    setError('');
    setSuccess('');

    if (!validateForm()) {
      console.log('validateForm failed');
      return;
    }

    setLoading(true);
    console.log('Loading started');
    
    try {
      const normalizedEmail = email.trim().toLowerCase();
      console.log('Email:', normalizedEmail);
      
      console.log('Finding user by email...');
      let user = await FirebaseUser.findByEmail(normalizedEmail);
      console.log('User found:', user);
      
      let screenshotData = null;
      if (screenshot) {
        try {
          const base64 = await toBase64(screenshot);
          screenshotData = base64;
          console.log('Screenshot converted to base64');
        } catch (err) {
          console.error('Failed to convert screenshot:', err);
        }
      }

      if (user) {
        console.log('Updating existing user...');
        await FirebaseUser.updatePayment(user.id, screenshotData, utr.trim());
        // If no password, save it
        if (!user.password && password) {
          await FirebaseUser.updatePassword(user.id, password);
        }
        // If referral code provided, save it
        const refCode = manualReferralCode || referredBy;
        if (refCode && !user.referred_by) {
          await FirebaseUser.updateReferralCode(user.id, refCode);
        }
      } else {
        // Save referred_by for new user registration
        console.log('Creating new user with password...');
        user = await FirebaseUser.createWithPassword({
          name: fullName.trim(),
          email: normalizedEmail,
          phone: phoneNumber.trim(),
          password: password,
          referredBy: manualReferralCode || referredBy || null,
        });
        console.log('New user created:', user.id);
        await FirebaseUser.updatePayment(user.id, screenshotData, utr.trim());
      }

      console.log('Done!');
      setSuccess('Payment submitted successfully!');
      setTimeout(() => {
        navigate(`/fb/login?email=${encodeURIComponent(normalizedEmail)}`);
      }, 2000);
    } catch (err) {
      console.error('Submission error:', err);
      setError(err.message || 'Submission failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function copyUpiId() {
    navigator.clipboard.writeText(UPI_VPA);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">JTSB NATURAL LIVE</div>
        <div>
          <Link to="/fb/login">Login</Link>
          {' · '}
          <Link to="/fb-admin">Admin</Link>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 600, margin: '0 auto' }}>
        <div className="payment-header">
          <h1>Register - Join JTSB Natural Live</h1>
          <p className="muted">
            One-time payment of ₹{AMOUNT} for lifetime access
          </p>
        </div>

        {referredBy && (
          <div className="alert alert-success" style={{ marginBottom: '1rem' }}>
            You were referred by someone! They will get credit for your signup.
          </div>
        )}

        <div className="payment-steps">
          <h3>How to Pay:</h3>
          <div className="step-item">
            <div className="step-number">1</div>
            <div className="step-text">
              <strong>Scan the QR code</strong> below with any UPI app (PhonePe, GPay, Paytm, etc.)
            </div>
          </div>
          <div className="step-item">
            <div className="step-number">2</div>
            <div className="step-text">
              <strong>Pay ₹{AMOUNT}</strong> and save the transaction screenshot
            </div>
          </div>
          <div className="step-item">
            <div className="step-number">3</div>
            <div className="step-text">
              <strong>Copy the UPI Reference Number</strong> from your payment confirmation screen
            </div>
          </div>
          <div className="step-item">
            <div className="step-number">4</div>
            <div className="step-text">
              <strong>Fill the form</strong> below with your details and submit
            </div>
          </div>
        </div>

        {qrDataUrl && (
          <>
            <div className="qr-container">
              <div className="qr-box">
                <img src={qrDataUrl} alt="UPI QR Code" />
              </div>
              <div className="qr-label">Scan with any UPI app</div>
            </div>

            <div className="amount-display">
              <div className="amount">₹{AMOUNT}</div>
              <div className="label">Payment Amount</div>
            </div>

            <div className="upi-id-box">
              <div className="label">UPI ID / VPA</div>
              <div className="value">
                <code>{UPI_VPA}</code>
                <button type="button" className={`copy-btn ${copied ? 'copied' : ''}`} onClick={copyUpiId}>
                  {copied ? '✓ Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          </>
        )}

        <div className="divider">
          <span>Submit Payment Details</span>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Full Name *</label>
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Enter your full name"
            />
          </div>

          <div className="field">
            <label>Email Address *</label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your.email@example.com"
              autoComplete="email"
            />
          </div>

          <div className="field">
            <label>Phone Number *</label>
            <input
              required
              inputMode="numeric"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit mobile number"
              autoComplete="tel"
            />
            <div className="hint">Example: 9876543210</div>
          </div>

          <div className="field">
            <label>Password *</label>
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a password"
              minLength={6}
            />
            <div className="hint">Use this password to login</div>
          </div>

          <div className="field">
            <label>Referral Code (optional)</label>
            <input
              value={manualReferralCode || referredBy}
              onChange={(e) => {
                setManualReferralCode(e.target.value.toUpperCase().trim());
              }}
              placeholder="Enter referral code if you have one"
            />
            <div className="hint">
              Have a referral code? Enter it here to get bonus referrals
            </div>
          </div>

          <div className="field">
            <label>UPI Reference Number *</label>
            <input
              required
              value={utr}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '');
                setUtr(val.slice(0, 20));
              }}
              inputMode="numeric"
              placeholder="e.g. 1234567890123"
            />
            <div className="hint">
              This is the UPI Reference Number (10-20 digits) shown in your payment app after completing the payment
            </div>
          </div>

          <div className="field">
            <label>Payment Screenshot *</label>
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={handleScreenshotChange}
            />
            {screenshotPreview && (
              <div style={{ marginTop: '0.5rem' }}>
                <img src={screenshotPreview} alt="Preview" style={{ maxWidth: '150px', borderRadius: '4px' }} />
              </div>
            )}
            <div className="hint">Upload a screenshot of your payment (optional, helps verification)</div>
          </div>

          <button 
            className="btn btn-primary" 
            type="submit" 
            disabled={loading} 
            style={{ width: '100%', padding: '0.85rem', fontSize: '1.05rem' }}
          >
            {loading ? 'Submitting...' : 'Submit Payment Details →'}
          </button>
        </form>

        <div className="alert alert-success" style={{ marginTop: '1.5rem', textAlign: 'center' }}>
          <strong>Payment submitted!</strong><br/>
          Admin will verify and enable your account.<br/>
          Contact admin for login access after approval.
        </div>
      </div>
    </div>
  );
}
