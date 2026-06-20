/**
 * Database Layer — Firebase Firestore direct.
 *
 * All existing imports (from 'firebase-db.js') continue to work.
 * No UI, route, or workflow changes needed.
 */

import {
  FirebaseAuth as Auth,
  FirebaseUser as User,
  FirebaseStorage as Storage,
  FirebaseTopup as Topup,
  FirebaseTopupReferral as TopupReferral,
  FirebaseReferralAccess as ReferralAccess,
  FirebaseNewReferral as NewReferral,
  FirebaseNotification as Notification,
  FirebaseChat as Chat,
  FirebaseWallet as Wallet,
  generateReferralCode,
  hashPassword,
  hashPasswordCached,
  comparePassword,
  hashData,
  checkReferralLinkExpiry,
  seedDefaultAdmin,
  MAX_REFERRALS,
  REFERRAL_EXPIRY_DAYS,
} from './firebase-db-impl.js';

const FirebaseAuth = Auth;
const FirebaseUser = User;
const FirebaseStorage = Storage;
const FirebaseTopup = Topup;
const FirebaseTopupReferral = TopupReferral;
const FirebaseReferralAccess = ReferralAccess;
const FirebaseNewReferral = NewReferral;
const FirebaseNotification = Notification;
const FirebaseMessage = Notification;
const FirebaseChat = Chat;
const FirebaseWallet = Wallet;

export {
  FirebaseAuth,
  FirebaseUser,
  FirebaseStorage,
  FirebaseTopup,
  FirebaseTopupReferral,
  FirebaseReferralAccess,
  FirebaseNewReferral,
  FirebaseNotification,
  FirebaseMessage,
  FirebaseChat,
  FirebaseWallet,
  generateReferralCode,
  hashPassword,
  hashPasswordCached,
  comparePassword,
  hashData,
  checkReferralLinkExpiry,
  seedDefaultAdmin,
};

export { MAX_REFERRALS, REFERRAL_EXPIRY_DAYS };
