import { useEffect, useState, useMemo, memo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { FirebaseUser, FirebaseStorage, FirebaseAuth, MAX_REFERRALS, FirebaseNewReferral, FirebaseReferralAccess, FirebaseTopup, FirebaseTopupReferral, FirebaseNotification } from '../db/firebase-db.js';
import { ClaimEngine } from '../db/firebase-claim-engine.js';
const QUOTA_KEY = 'fb_quota_exhausted';

const UPI_VPA = import.meta.env.VITE_UPI_VPA || 'jayarajj126-3@okicici';
const UPI_PAYEE_NAME = import.meta.env.VITE_UPI_PAYEE_NAME || 'Community';

function buildUpiUri() {
  const pa = encodeURIComponent(UPI_VPA);
  const pn = encodeURIComponent(UPI_PAYEE_NAME);
  return `upi://pay?pa=${pa}&pn=${pn}&am=&cu=INR`;
}

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) { resolve(true); return; }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
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
  const [topupAudit, setTopupAudit] = useState(null);
  const [topupOcrDebug, setTopupOcrDebug] = useState(null);
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
  const [showTopupForm, setShowTopupForm] = useState(false);
  const [submittingTopup, setSubmittingTopup] = useState(false);
  const [topupIncome, setTopupIncome] = useState([]);
  const [claimingId, setClaimingId] = useState(null);
  const [topupPaymentStep, setTopupPaymentStep] = useState('init');
  const [topupVerificationCode, setTopupVerificationCode] = useState('');
  const [generatedTopupCode, setGeneratedTopupCode] = useState('');
  const [topupPaymentSessionId, setTopupPaymentSessionId] = useState('');
  const [topupRazorpayLoaded, setTopupRazorpayLoaded] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [recentNotifications, setRecentNotifications] = useState([]);
  const [showBellDropdown, setShowBellDropdown] = useState(false);
  const [profilePicFile, setProfilePicFile] = useState(null);
  const [profilePicPreview, setProfilePicPreview] = useState(null);
  const [uploadingProfilePic, setUploadingProfilePic] = useState(false);
  const [claims, setClaims] = useState([]);
  const [claimAmount, setClaimAmount] = useState('');
  const [claimTransactionId, setClaimTransactionId] = useState('');
  const [claimFile, setClaimFile] = useState(null);
  const [claimPreview, setClaimPreview] = useState(null);
  const [showClaimForm, setShowClaimForm] = useState(false);
  const [submittingClaim, setSubmittingClaim] = useState(false);

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

  // Load claims
  useEffect(() => {
    if (!userId) return;
    const unsub = ClaimEngine.subscribeToClaims(userId, (data) => {
      setClaims(data || []);
    });
    return () => { if (unsub) unsub(); };
  }, [userId]);

  useEffect(() => {
    loadRazorpayScript().then(setTopupRazorpayLoaded);
    FirebaseUser.ping?.();
  }, []);

  async function handleLogout() {
    await FirebaseAuth.logout();
    localStorage.removeItem('fb_user_id');
    navigate('/fb/login');
  }

  async function handleAddReferral(e) {
    e.preventDefault();
    
    if (referralCount >= MAX_REFERRALS) {
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

    setUploading(true);

    const currentCount = user.referrals_count || 0;
    if (currentCount < MAX_REFERRALS && !user.is_qualified) {
      setError(`Complete ${MAX_REFERRALS} referrals before making payment`);
      return;
    }

    const trimmedUtr = paymentUtr.trim();
    try {
      const dupCheck = await FirebaseUser.checkUtrExists(trimmedUtr);
      if (dupCheck) {
        setError('This UTR ID has already been used.');
        setUploading(false);
        return;
      }
    } catch {
      setError('Could not verify UTR. Try again later.');
      setUploading(false);
      return;
    }

    try {
      const uploadResult = await FirebaseStorage.uploadPaymentScreenshot(userId, paymentFile);
      const url = typeof uploadResult === 'string' ? uploadResult : uploadResult.url;
      await FirebaseUser.updateUpiScreenshot(userId, url, trimmedUtr);
      
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

  function handleClaimFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
      setClaimFile(file);
      const reader = new FileReader();
      reader.onload = () => setClaimPreview(reader.result);
      reader.readAsDataURL(file);
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

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out — Firestore daily quota is exhausted. Upgrade to Blaze plan at https://console.firebase.google.com or try again tomorrow.')), ms))
    ]);
  }

  function preprocessImage(imgSrc, opts = {}) {
    const { crop = true, denoise = true, scale = 2, contrast = 1.8, quality = 0.9 } = opts;
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          const ctx = c.getContext('2d');
          c.width = img.width; c.height = img.height;
          ctx.drawImage(img, 0, 0);
          let iData = ctx.getImageData(0, 0, img.width, img.height);
          let pix = iData.data;
          let cropX = 0, cropY = 0, cropW = img.width, cropH = img.height;
          if (crop) {
            const thr = 30;
            let mnX = img.width, mnY = img.height, mxX = 0, mxY = 0;
            for (let y = 0; y < img.height; y++) {
              for (let x = 0; x < img.width; x++) {
                const idx = (y * img.width + x) * 4;
                if (pix[idx] > thr && pix[idx] < 255 - thr) {
                  if (x < mnX) mnX = x; if (x > mxX) mxX = x;
                  if (y < mnY) mnY = y; if (y > mxY) mxY = y;
                }
              }
            }
            if (mnX < mxX && mnY < mxY) {
              const pad = 10;
              cropX = Math.max(0, mnX - pad); cropY = Math.max(0, mnY - pad);
              cropW = Math.min(img.width - cropX, mxX - mnX + pad * 2);
              cropH = Math.min(img.height - cropY, mxY - mnY + pad * 2);
            }
          }
          const tw = cropW * scale, th = cropH * scale;
          c.width = tw; c.height = th;
          ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, tw, th);
          iData = ctx.getImageData(0, 0, tw, th);
          pix = iData.data;
          for (let i = 0; i < pix.length; i += 4) {
            const gray = 0.299 * pix[i] + 0.587 * pix[i+1] + 0.114 * pix[i+2];
            let v = contrast * (gray - 128) + 128;
            pix[i] = pix[i+1] = pix[i+2] = Math.max(0, Math.min(255, v));
          }
          if (denoise) {
            const den = new Uint8ClampedArray(pix.length);
            for (let y = 1; y < th - 1; y++) {
              for (let x = 1; x < tw - 1; x++) {
                const ns = [];
                for (let dy = -1; dy <= 1; dy++) {
                  for (let dx = -1; dx <= 1; dx++) {
                    ns.push(pix[((y+dy)*tw+(x+dx))*4]);
                  }
                }
                ns.sort((a,b)=>a-b);
                const med = ns[4];
                const idx = (y*tw+x)*4;
                den[idx]=den[idx+1]=den[idx+2]=med; den[idx+3]=255;
              }
            }
            for (let y = 1; y < th - 1; y++) {
              for (let x = 1; x < tw - 1; x++) {
                const idx = (y*tw+x)*4;
                const vv = -den[((y-1)*tw+(x-1))*4] - den[((y-1)*tw+x)*4] - den[((y-1)*tw+(x+1))*4] - den[(y*tw+(x-1))*4] + 9*den[idx] - den[(y*tw+(x+1))*4] - den[((y+1)*tw+(x-1))*4] - den[((y+1)*tw+x)*4] - den[((y+1)*tw+(x+1))*4];
                pix[idx]=Math.max(0,Math.min(255,vv)); pix[idx+1]=pix[idx]; pix[idx+2]=pix[idx];
              }
            }
          }
          ctx.putImageData(iData, 0, 0);
          resolve(c.toDataURL('image/jpeg', quality));
        } catch (e) { reject(e); }
      };
      img.onerror = reject;
      img.src = imgSrc;
    });
  }

  async function runOcr(imageUrl) {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    try {
      await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
      // Multi-pass OCR: run 3 sequential passes on the same worker (Tesseract is not reentrant)
      const passOpts = [
        { crop: true, denoise: true, scale: 2, contrast: 1.8 },
        { crop: true, denoise: true, scale: 3, contrast: 2.5 },
        { crop: true, denoise: false, scale: 2, contrast: 1.2 },
      ];
      const passes = [];
      for (const opts of passOpts) {
        const url = await preprocessImage(imageUrl, opts);
        const r = await worker.recognize(url);
        passes.push({ text: r.data.text || '', conf: Math.round(r.data.confidence || 0) });
      }
      // Merge all unique lines from all passes (sequential, no corruption)
      const allLines = [];
      const seen = new Set();
      for (const pass of passes) {
        for (const line of pass.text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && !seen.has(trimmed.toLowerCase())) {
            allLines.push(trimmed);
            seen.add(trimmed.toLowerCase());
          }
        }
      }
      const rawText = allLines.join('\n');
      // Use overall best confidence for display
      let confidence = Math.max(...passes.map(p => p.conf));
      console.log('[OCR] Best confidence:', confidence, '| Total unique lines:', allLines.length);

      // Remove hidden/unprintable characters that break regex matching
      const text = rawText.replace(/[\u200B-\u200D\uFEFF\u00A0\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();

      let amount = null;
      const amountWithSymbol = text.match(/(?:₹|Rs\.?|INR)\s*(\d+)/i);
      if (amountWithSymbol) {
        amount = amountWithSymbol[1];
      } else {
        const plainAmount = text.match(/\b(\d{2,6}(?:\.\d{1,2})?)\b/);
        if (plainAmount) {
          amount = plainAmount[1];
        }
      }

      // Prefer label-based extraction for UPI transaction ID
      let detected_upi_transaction_id = null;
      const upiTxnPatterns = [
        /UPI\s*(?:transaction|txn)\s*(?:id|no|number)?[:\s\-]+([A-Za-z0-9\s]{4,30})/i,
        /UPI\s*(?:ref(?:erence)?)\s*(?:id|no|number)?[:\s\-]+([A-Za-z0-9\s]{4,30})/i,
        /(?:Txn\s*ID|Transaction\s*(?:ID|No|Number))[:\s\-]+([A-Za-z0-9\s]{4,30})/i,
        /UTR[:\s\-]+([A-Za-z0-9\s]{4,30})/i,
      ];
      for (const pattern of upiTxnPatterns) {
        const match = text.match(pattern);
        if (match) {
          detected_upi_transaction_id = match[1].trim().replace(/\s+/g, '');
          break;
        }
      }

      // Detect Google transaction ID separately (for debug display only, NOT used for UTR validation)
      let detected_google_transaction_id = null;
      const googleMatch = text.match(/Google\s*(?:transaction|txn|play)\s*(?:id|no|number)?[:\s\-]+([A-Za-z0-9.\-_]{4,40})/i);
      if (googleMatch) {
        detected_google_transaction_id = googleMatch[1].trim();
      }

      // UTR = detected UPI transaction ID (label-based), fallback to any 12-22 digit sequence
      let utr = detected_upi_transaction_id;
      if (!utr) {
        const digitsOnly = text.replace(/\D/g, '');
        const utrMatch = digitsOnly.match(/\d{12,22}/);
        utr = utrMatch ? utrMatch[0] : null;
      }

      const selected_for_validation = utr;

      // Extract receiver UPI from 'To' section first, fallback to any UPI
      let upi_id = null;
      const toSection = text.match(/(?:To|Paid\s*to|Receiver|Beneficiary|Transfer\s*to|Pay\s*to)[:\s\-]*([a-zA-Z0-9._\-]+@[a-zA-Z]{3,})/i);
      if (toSection) {
        upi_id = toSection[1].trim();
      }
      if (!upi_id) {
        const upiMatch = text.match(/[a-zA-Z0-9._-]+@[a-zA-Z]{3,}/);
        upi_id = upiMatch ? upiMatch[0] : null;
      }
      let date = null;
      // Try YYYY-MM-DD (ISO format) first
      let dateMatch = text.match(/\b(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/);
      if (dateMatch) {
        date = `${dateMatch[3]}/${dateMatch[2]}/${dateMatch[1]}`;
      }
      // Try DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
      if (!date) {
        dateMatch = text.match(/\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})\b/);
        if (dateMatch) {
          date = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
        }
      }
      // Try DD/MM/YY, DD-MM-YY with 2-digit year
      if (!date) {
        dateMatch = text.match(/\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})\b(?!\d)/);
        if (dateMatch) {
          const year = '20' + dateMatch[3];
          date = `${dateMatch[1]}/${dateMatch[2]}/${year}`;
        }
      }
      if (!date) {
        const textDate = text.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{2,4})\b/i);
        if (textDate) {
          const months = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'07', sep:'09', oct:'10', nov:'11', dec:'12' };
          const month = months[textDate[2].toLowerCase().slice(0, 3)];
          const year = textDate[3].length === 2 ? '20' + textDate[3] : textDate[3];
          if (month) date = `${textDate[1]}/${month}/${year}`;
        }
      }
      let statusText = (text.match(/(Completed|Success|Failed|Pending|Paid)/i) || [])[0] || null;
      if (!statusText && /[✓✔☑✅]/.test(text)) statusText = 'Success';

      console.log('[OCR EXTRACT] UPI ID:', upi_id);
      console.log('[OCR EXTRACT] UPI Transaction ID:', utr);
      console.log('[OCR EXTRACT] Amount:', amount);
      console.log('[OCR EXTRACT] Date:', date);
      console.log('[OCR EXTRACT] Status:', statusText);
      console.log('[OCR EXTRACT] Confidence:', confidence);

      return {
        raw: text,
        ocr_confidence: confidence,
        utr,
        amount,
        upi_id,
        sender_upi: null,
        receiver_upi: upi_id,
        sender_name: null,
        receiver_name: null,
        date,
        time: null,
        payment_status: statusText,
        bank_name: null,
        ref_number: utr,
        transaction_id: utr,
        detected_upi_transaction_id,
        detected_google_transaction_id,
        selected_for_validation,
      };
    } finally {
      await worker.terminate();
    }
  }

  async function handlePayTopup() {
    console.log('[TOPUP] Button clicked');
    if (!topupAmount || Number(topupAmount) < 1) {
      setError('Enter a valid topup amount');
      return;
    }
    if (!topupRazorpayLoaded) {
      setError('Razorpay is loading. Please wait...');
      return;
    }
    setError('');
    setSubmittingTopup(true);
    try {
      console.log('[TOPUP] Creating payment order');
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out. Check your network connection.')), 15000)
      );
      const session = await Promise.race([
        FirebaseUser.createPaymentSession(userId, 'topup', Number(topupAmount)),
        timeoutPromise,
      ]);
      console.log('[TOPUP] Order created successfully', session?.sessionId);
      setTopupPaymentSessionId(session.sessionId);

      const rzpOptions = {
        key: import.meta.env.VITE_RAZORPAY_KEY_ID || 'rzp_test_xxxxxxxxxxxx',
        amount: Number(topupAmount) * 100,
        currency: 'INR',
        name: 'Starlight Ascent',
        description: 'Wallet Topup',
        prefill: {
          name: user?.name || '',
          email: user?.email || '',
          contact: user?.phone || '',
        },
        handler: async function (response) {
          console.log('[TOPUP] Payment success', response.razorpay_payment_id);
          try {
            const codePromise = FirebaseUser.generateVerificationCode(
              session.sessionId,
              response.razorpay_order_id,
              response.razorpay_payment_id,
            );
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Code generation timed out')), 10000)
            );
            const codeResult = await Promise.race([codePromise, timeoutPromise]);
            setGeneratedTopupCode(codeResult?.code || '');
          } catch (codeErr) {
            console.warn('[TOPUP] Direct code generation failed, webhook may handle it:', codeErr);
          }
          setTopupPaymentStep('verify');
          setSubmittingTopup(false);
        },
        modal: {
          ondismiss: function () {
            setSubmittingTopup(false);
            setError('Payment cancelled. Please try again when ready.');
            console.log('[TOPUP] Modal dismissed');
          },
        },
      };
      if (session.razorpayOrderId) {
        rzpOptions.order_id = session.razorpayOrderId;
      }
      console.log('[TOPUP] Payment page opening');
      const rzp = new window.Razorpay(rzpOptions);
      rzp.on('payment.failed', function (response) {
        console.log('[TOPUP] Payment failed', response.error?.description);
        setError('Payment failed: ' + (response.error?.description || 'Unknown error'));
        setSubmittingTopup(false);
        setTopupPaymentStep('init');
      });
      rzp.open();
      setTopupPaymentStep('pay');
    } catch (err) {
      console.log('[TOPUP] Error:', err.message);
      setError(err.message || 'Failed to initiate payment');
      setSubmittingTopup(false);
      setTopupPaymentStep('init');
    }
  }

  async function handleVerifyTopupCode() {
    const code = topupVerificationCode.trim();
    if (!code || !/^JTSB-[A-Z0-9]{6}$/i.test(code)) {
      setError('Enter a valid verification code (format: JTSB-XXXXXX)');
      return;
    }
    setError('');
    setSubmittingTopup(true);
    try {
      const result = await FirebaseUser.verifyPaymentCode(topupPaymentSessionId, code.toUpperCase(), {
        name: user?.name || 'User',
        email: user?.email || '',
        phone: user?.phone || '',
        isTopup: true,
        amount: Number(topupAmount),
      });
      if (result.success) {
        setTopupSuccessMsg('Topup verified! ₹' + Number(topupAmount) + ' will be credited to your wallet.');
        setTopupPaymentStep('done');
        setShowTopupForm(false);
        setTopupAmount('');
        setTopupVerificationCode('');
      } else {
        setError(result.error || 'Verification failed. Please try again.');
      }
    } catch (err) {
      setError(err.message || 'Verification failed');
    } finally {
      setSubmittingTopup(false);
    }
  }

  async function handleSubmitClaim() {
    if (!claimAmount || !claimTransactionId.trim() || !claimFile) {
      setError('Amount, transaction ID, and screenshot are required');
      return;
    }
    const trimmedTxId = claimTransactionId.trim();
    let dupCheck = false;
    try {
      dupCheck = await withTimeout(FirebaseUser.checkUtrExists(trimmedTxId), 10000);
    } catch (e) {
      setError('Could not verify transaction ID. Try again later.');
      return;
    }
    if (dupCheck) {
      setError('This UTR ID has already been used.');
      return;
    }
    setSubmittingClaim(true);
    setError('');
    setTopupSuccessMsg('');
    try {
      const url = await withTimeout(FirebaseStorage.uploadTopupScreenshot(userId, claimFile), 10000);
      const claimResult = await withTimeout(ClaimEngine.submitClaim(userId, user?.name || 'User', user?.email || '', Number(claimAmount), trimmedTxId, url), 15000);
      localStorage.removeItem(QUOTA_KEY);
      setClaimAmount('');
      setClaimTransactionId('');
      setClaimFile(null);
      setClaimPreview(null);
      setShowClaimForm(false);
      if (claimResult === 'pending' || claimResult.needsReview) {
        setTopupSuccessMsg('Claim submitted for review. Admin will verify shortly.');
      } else if (claimResult.approved) {
        setTopupSuccessMsg('Claim approved and ₹' + Number(claimAmount) + ' credited to your wallet!');
      } else if (claimResult.rejected) {
        setTopupSuccessMsg('Claim was auto-rejected: ' + (claimResult.reason || 'verification failed') + '. Admin may still review.');
      } else {
        setTopupSuccessMsg('Claim submitted successfully. Awaiting admin review.');
      }
    } catch (err) {
      console.error('Claim submission error:', err);
      setError(err.message);
    } finally {
      setSubmittingClaim(false);
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
{topupSuccessMsg && <div className="alert alert-success mb-md">{topupSuccessMsg}</div>}
{topupAudit && (() => {
  const checks = [topupAudit.utr, topupAudit.date, topupAudit.upi].filter(Boolean);
  const allPassed = checks.every(c => c.passed === true);
  const anyFailed = checks.some(c => c.passed === false);
  const anyUnavailable = checks.some(c => c.passed === null);
  const d = topupOcrDebug || {};
  const bannerBg = allPassed ? '#28a745' : (anyFailed ? '#dc3545' : '#ffc107');
  const bannerText = allPassed ? 'APPROVED' : (anyFailed ? 'REJECTED' : 'NEEDS REVIEW');
  return (
    <div className="validation-audit" style={{ border: '1px solid var(--border, #ddd)', borderRadius: '6px', padding: '0.6rem', marginBottom: '1rem' }}>
      <div style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.5rem', padding: '0.3rem 0.5rem', borderRadius: '4px', color: '#fff', background: bannerBg, textAlign: 'center' }}>
        {bannerText}
      </div>

      {!allPassed && checks.filter(c => c.passed === false).length > 0 && (
        <div style={{ fontSize: '0.8rem', marginBottom: '0.5rem', padding: '0.3rem 0.5rem', borderRadius: '4px', background: '#fff0f0', border: '1px solid #dc3545' }}>
          <div style={{ fontWeight: 700, color: '#dc3545', marginBottom: '0.2rem' }}>FAILED VALIDATION</div>
          {checks.filter(c => c.passed === false).map((check, i) => (
            <div key={i} style={{ marginBottom: '0.3rem', padding: '0.2rem', borderBottom: i < checks.length - 1 ? '1px dashed #e0c0c0' : 'none' }}>
              <div><strong>Check:</strong> {check.label}</div>
              <div><strong>Reason:</strong> <span style={{ color: '#dc3545' }}>{check.reason}</span></div>
            </div>
          ))}
        </div>
      )}

      {[
        { ...topupAudit.utr, lbl: topupAudit.utr?.label || 'UTR Validation', exp: `User: "${topupAudit.utr?.userEntered || '—'}"`, act: `OCR: "${topupAudit.utr?.ocrDetected || '—'}"` },
        { ...topupAudit.date, lbl: topupAudit.date?.label || 'Current Date', exp: topupAudit.date?.expected || '—', act: topupAudit.date?.actual || '—' },
        { ...topupAudit.upi, lbl: topupAudit.upi?.label || 'Admin UPI', exp: topupAudit.upi?.expected || '—', act: topupAudit.upi?.actual || '—' },
      ].filter(Boolean).map((c, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.77rem', padding: '0.3rem 0', borderBottom: '1px solid var(--border, #eee)' }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 600 }}>{c.lbl}</span>
            <div style={{ fontSize: '0.68rem', color: '#666' }}>
              Expected: {c.exp} &nbsp;|&nbsp; Actual: {c.act}
            </div>
          </div>
          <span style={{ fontWeight: 700, fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '3px', color: '#fff', background: c.passed === true ? '#28a745' : (c.passed === false ? '#dc3545' : '#ffc107'), whiteSpace: 'nowrap' }}>
            {c.passed === true ? 'PASS' : (c.passed === false ? 'FAIL' : 'N/A')}
          </span>
        </div>
      ))}

      {d && Object.keys(d).length > 0 && (
        <>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, marginTop: '0.5rem', marginBottom: '0.3rem', padding: '0.2rem 0', borderBottom: '2px solid var(--border, #ddd)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            OCR EXTRACTED DATA
          </div>
          <div style={{ fontSize: '0.73rem', padding: '0.3rem', background: 'var(--bg-soft, #f5f7fa)', borderRadius: '4px' }}>
            <div style={{ marginBottom: '0.2rem' }}><strong>UPI Transaction ID:</strong> {d.detected_upi_transaction_id || d.selected_for_validation || 'Not detected'}</div>
            <div style={{ marginBottom: '0.2rem' }}><strong>Receiver UPI ID:</strong> {d.upi_id || 'Not detected'}</div>
            <div style={{ marginBottom: '0.2rem' }}><strong>Date:</strong> {d.date || 'Not detected'}</div>
            <div style={{ marginBottom: '0.2rem' }}><strong>OCR Confidence:</strong> {d.ocr_confidence != null ? `${d.ocr_confidence}%` : 'Not detected'}</div>
          </div>
        </>
      )}
    </div>
  );
})()}

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
            <button className="btn btn-primary mb-md" onClick={() => { setShowTopupForm(true); setTopupPaymentStep('init'); }}>
              Submit Topup Request
            </button>
          ) : (
            <div className="surface-card mb-md">
              {topupPaymentStep === 'init' && (
                <>
                  <div className="field">
                    <label>Amount (INR) *</label>
                    <input type="number" value={topupAmount} onChange={e => setTopupAmount(e.target.value)} placeholder="Enter topup amount" min="1" />
                  </div>
                  <div className="flex-row">
                    <button className={`btn btn-primary${submittingTopup ? ' btn-loading' : ''}`} onClick={handlePayTopup} disabled={submittingTopup || !topupAmount || Number(topupAmount) < 1}>
                      {submittingTopup ? 'Opening Razorpay...' : `Pay with Razorpay →`}
                    </button>
                    <button className="btn btn-ghost" onClick={() => { setShowTopupForm(false); setTopupAmount(''); setError(''); }}>
                      Cancel
                    </button>
                  </div>
                </>
              )}

              {topupPaymentStep === 'pay' && (
                <>
                  {error && <div className="alert alert-error">{error}</div>}
                  <div className="alert alert-info">
                    <strong>Payment window opened!</strong><br />
                    Complete the payment in the Razorpay popup to continue.
                  </div>
                </>
              )}

              {topupPaymentStep === 'verify' && (
                <>
                  {generatedTopupCode && (
                    <div className="alert alert-success" style={{ fontSize: '1.2rem', textAlign: 'center', padding: '1rem' }}>
                      Your verification code: <strong>{generatedTopupCode}</strong>
                    </div>
                  )}
                  <div className="field">
                    <label>Verification Code *</label>
                    <input
                      required
                      value={topupVerificationCode}
                      onChange={e => setTopupVerificationCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                      placeholder="JTSB-XXXXXX"
                    />
                    <div className="hint">Enter the verification code from your payment confirmation</div>
                  </div>
                  <div className="flex-row">
                    <button className={`btn btn-primary${submittingTopup ? ' btn-loading' : ''}`} onClick={handleVerifyTopupCode} disabled={submittingTopup || !topupVerificationCode.trim()}>
                      {submittingTopup ? 'Verifying...' : 'Verify Topup'}
                    </button>
                    <button className="btn btn-ghost" onClick={() => { setTopupPaymentStep('init'); setTopupVerificationCode(''); setError(''); }}>
                      Back
                    </button>
                  </div>
                </>
              )}

              {topupPaymentStep === 'done' && (
                <div className="alert alert-success">
                  <strong>Topup verified successfully!</strong>
                </div>
              )}
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

        {/* ===== CLAIM SECTION ===== */}
        <div className="card mb-lg">
          <h2 className="flex-row gap-sm">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            Top-Up Claim Request
          </h2>
          <p className="muted mb-md">
            Already paid and need wallet credit? Submit a claim request with proof of payment. Once verified, funds are credited to your wallet.
          </p>

          {!showClaimForm ? (
            <button className="btn btn-primary" onClick={() => setShowClaimForm(true)}>
              {'\u2795'} Submit Claim
            </button>
          ) : (
            <div className="form-section">
              <div className="field">
                <label>Amount *</label>
                <select value={claimAmount} onChange={e => setClaimAmount(e.target.value)}>
                  <option value="">Select amount</option>
                  <option value="120">₹120 — Starter</option>
                  <option value="500">₹500 — Silver</option>
                  <option value="1000">₹1,000 — Gold</option>
                  <option value="2000">₹2,000 — Premium</option>
                </select>
              </div>
              <div className="field">
                <label>Transaction ID / UTR *</label>
                <input type="text" value={claimTransactionId} onChange={e => setClaimTransactionId(e.target.value)} placeholder="Enter transaction reference number" />
              </div>
              <div className="field">
                <label>Payment Screenshot *</label>
                <input type="file" accept="image/*" onChange={handleClaimFileSelect} />
                {claimPreview && (
                  <img src={claimPreview} alt="Preview" className="screenshot-preview" />
                )}
              </div>
              <div className="flex-row">
                <button className={`btn btn-primary${submittingClaim ? ' btn-loading' : ''}`} onClick={handleSubmitClaim} disabled={submittingClaim || !claimAmount || !claimTransactionId.trim() || !claimFile}>
                  {submittingClaim ? 'Submitting...' : 'Submit Claim'}
                </button>
                <button className="btn btn-ghost" onClick={() => { setShowClaimForm(false); setClaimPreview(null); setClaimFile(null); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {claims.filter(c => c.status === 'approved' || c.status === 'rejected' || c.status === 'pending' || c.status === 'manual_review').length > 0 && (
            <div className="mt-sm">
              <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Claim History</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Transaction ID</th>
                      <th>Status</th>
                      <th>Wallet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claims.map(c => (
                      <tr key={c.id}>
                        <td data-label="Date" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                          {c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}
                        </td>
                        <td data-label="Amount" className="font-bold">₹{Number(c.amount || 0).toFixed(2)}</td>
                        <td data-label="TX ID" className="font-mono" style={{ fontSize: '0.75rem' }}>{c.transactionId || '—'}</td>
                        <td data-label="Status">
                          <span className={`badge ${c.status === 'approved' ? 'badge-paid' : c.status === 'rejected' ? 'badge-rejected' : c.status === 'manual_review' ? 'badge-warning' : 'badge-pending'} badge-xs`}>
                            {c.status === 'approved' ? 'Approved' : c.status === 'rejected' ? 'Rejected' : c.status === 'manual_review' ? 'Manual Review' : 'Pending'}
                          </span>
                        </td>
                        <td data-label="Wallet">
                          {c.wallet_credited ? (
                            <span className="badge badge-paid badge-xs">Credited</span>
                          ) : c.status === 'rejected' ? (
                            <span className="badge badge-rejected badge-xs">—</span>
                          ) : (
                            <span className="badge badge-pending badge-xs">Pending</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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