// Payment controller - using new Firebase database
import QRCode from 'qrcode';
import { FirebaseUser, FirebaseStorage } from '../db/firebase-db.js';

const AMOUNT = Number(import.meta.env.VITE_PAYMENT_AMOUNT) || 120;
const UPI_VPA = import.meta.env.VITE_UPI_VPA || 'jayarajj126-3@okicici';
const UPI_PAYEE_NAME = import.meta.env.VITE_UPI_PAYEE_NAME || 'Community';
const UPI_REF_REGEX = /^[0-9]{10,20}$/;

function buildUpiUri() {
  const pa = encodeURIComponent(UPI_VPA);
  const pn = encodeURIComponent(UPI_PAYEE_NAME);
  const am = AMOUNT.toFixed(2);
  return `upi://pay?pa=${pa}&pn=${pn}&am=${am}&cu=INR`;
}

export async function getPaymentConfig() {
  const upiUri = buildUpiUri();
  const qrDataUrl = await QRCode.toDataURL(upiUri, { width: 280, margin: 2 });
  
  return {
    status: 200,
    data: {
      amount: AMOUNT,
      currency: 'INR',
      paymentMethod: 'UPI',
      upiVpa: UPI_VPA,
      payeeName: UPI_PAYEE_NAME,
      upiUri,
      qrDataUrl,
    },
  };
}

export async function submitPayment(req) {
  const { fullName, email, phoneNumber, utr, userId } = req.body;

  if (!fullName || !email || !phoneNumber || !utr) {
    throw { status: 400, message: 'All fields are required: fullName, email, phoneNumber, UPI Reference Number' };
  }

  const rawPaymentId = String(utr).trim();
  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedPhone = String(phoneNumber).trim();

  if (!UPI_REF_REGEX.test(rawPaymentId)) {
    throw { status: 400, message: 'Enter a valid UPI Reference Number (10-20 digits)' };
  }

  let screenshotUrl = null;
  
  if (req.file) {
    const userIdForStorage = userId || 'temp_' + Date.now();
    const result = await FirebaseStorage.uploadPaymentScreenshot(userIdForStorage, req.file);
    screenshotUrl = result.url;
  }

  const user = await FirebaseUser.findByEmail(normalizedEmail);
  
  if (user) {
    await FirebaseUser.updateUpiScreenshot(user.id, screenshotUrl);
    
    return {
      status: 201,
      data: {
        message: 'Payment submitted for verification',
        payment: {
          id: user.id,
          name: fullName.trim(),
          email: normalizedEmail,
          phoneNumber: normalizedPhone,
          paymentId: rawPaymentId,
          screenshot: screenshotUrl,
          status: 'pending',
          amount: AMOUNT,
          createdAt: new Date().toISOString(),
        },
      },
    };
  }

  const newUser = await FirebaseUser.create({
    name: fullName.trim(),
    email: normalizedEmail,
    phone: normalizedPhone,
  });

  if (screenshotUrl) {
    await FirebaseUser.updateUpiScreenshot(newUser.id, screenshotUrl);
  }

  return {
    status: 201,
    data: {
      message: 'Payment submitted for verification',
      payment: {
        id: newUser.id,
        name: fullName.trim(),
        email: normalizedEmail,
        phoneNumber: normalizedPhone,
        paymentId: rawPaymentId,
        screenshot: screenshotUrl,
        status: 'pending',
        amount: AMOUNT,
        createdAt: newUser.created_at,
      },
    },
  };
}

export async function checkPaymentStatus(req) {
  const email = String(req.query?.email || '').trim().toLowerCase();
  
  if (!email) {
    throw { status: 400, message: 'Email is required' };
  }
  
  const user = await FirebaseUser.findByEmail(email);
  if (!user) {
    throw { status: 404, message: 'No payment found' };
  }
  
  return {
    status: 200,
    data: {
      payment: {
        name: user.name,
        email: user.email,
        phoneNumber: user.phone,
        status: user.payment_status,
        screenshot: user.upi_screenshot_url,
        createdAt: user.created_at,
      },
    },
  };
}
