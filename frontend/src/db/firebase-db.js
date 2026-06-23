import {
  SupabaseAuth as Auth,
  SupabaseUser as User,
  SupabaseStorage as Storage,
  SupabaseTopup as Topup,
  SupabaseTopupReferral as TopupReferral,
  SupabaseTopupReferral as ReferralAccess,
  SupabaseTopupReferral as NewReferral,
  SupabaseNotification as Notification,
  SupabaseChat as Chat,
  SupabaseWallet as Wallet,
  generateReferralCode,
  hashPassword,
  hashPasswordCached,
  comparePassword,
  hashData,
  checkReferralLinkExpiry,
  seedDefaultAdmin,
  MAX_REFERRALS,
  REFERRAL_EXPIRY_DAYS,
} from './supabase-db.js';

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
