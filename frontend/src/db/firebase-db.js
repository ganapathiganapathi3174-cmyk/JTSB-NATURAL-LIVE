/**
 * Database Layer — Appwrite-first with Firebase fallback.
 *
 * Tries Appwrite Client SDK + Worker proxy first.
 * Falls back to Firebase Firestore if Appwrite is unavailable.
 *
 * All existing imports (from 'firebase-db.js') continue to work.
 * No UI, route, or workflow changes needed.
 */

import * as FirebaseImpl from './firebase-db-impl.js';
import {
  AppwriteDB,
  generateReferralCode,
  hashPassword,
  hashPasswordCached,
  comparePassword,
  hashData,
  seedDefaultAdmin,
  checkReferralLinkExpiry,
  MAX_REFERRALS as AW_MAX_REFERRALS,
  REFERRAL_EXPIRY_DAYS as AW_REFERRAL_EXPIRY_DAYS,
  STORAGE_FOLDER as AW_STORAGE_FOLDER,
} from './appwrite-db.js';

function wrapObj(name, appwriteObj, fbObj) {
  const wrapped = {};
  for (const key of Object.keys(fbObj || {})) {
    wrapped[key] = async (...args) => {
      if (appwriteObj && typeof appwriteObj[key] === 'function') {
        try {
          return await appwriteObj[key](...args);
        } catch (e) {
          if (!import.meta.env.VITE_NO_FALLBACK_WARN) {
            console.warn(`[FALLBACK] ${name}.${key}: Appwrite failed → Firebase.`, e.message);
          }
        }
      }
      return fbObj[key](...args);
    };
  }
  return wrapped;
}

const FirebaseAuth = wrapObj('Auth', AppwriteDB.Auth, FirebaseImpl.FirebaseAuth);
const FirebaseUser = wrapObj('User', AppwriteDB.User, FirebaseImpl.FirebaseUser);
const FirebaseStorage = wrapObj('Storage', AppwriteDB.Storage, FirebaseImpl.FirebaseStorage);
const FirebaseTopup = wrapObj('Topup', AppwriteDB.Topup, FirebaseImpl.FirebaseTopup);
const FirebaseTopupReferral = wrapObj('TopupReferral', AppwriteDB.TopupReferral, FirebaseImpl.FirebaseTopupReferral);
const FirebaseReferralAccess = wrapObj('ReferralAccess', AppwriteDB.ReferralAccess, FirebaseImpl.FirebaseReferralAccess);
const FirebaseNewReferral = wrapObj('NewReferral', AppwriteDB.NewReferral, FirebaseImpl.FirebaseNewReferral);
const FirebaseNotification = wrapObj('Notification', AppwriteDB.Notification, FirebaseImpl.FirebaseNotification);
const FirebaseMessage = FirebaseNotification;
const FirebaseChat = wrapObj('Chat', AppwriteDB.Chat, FirebaseImpl.FirebaseChat);

async function checkReferralLinkExpiryFallback(referralCode) {
  try { return await checkReferralLinkExpiry(referralCode); }
  catch { return FirebaseImpl.checkReferralLinkExpiry(referralCode); }
}

async function seedDefaultAdminFallback() {
  try { return await seedDefaultAdmin(); }
  catch { return FirebaseImpl.seedDefaultAdmin(); }
}

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
  generateReferralCode,
  hashPassword,
  hashPasswordCached,
  comparePassword,
  hashData,
  checkReferralLinkExpiryFallback as checkReferralLinkExpiry,
  seedDefaultAdminFallback as seedDefaultAdmin,
};

export const MAX_REFERRALS = AW_MAX_REFERRALS || FirebaseImpl.MAX_REFERRALS;
export const REFERRAL_EXPIRY_DAYS = AW_REFERRAL_EXPIRY_DAYS || FirebaseImpl.REFERRAL_EXPIRY_DAYS;
export const STORAGE_FOLDER = AW_STORAGE_FOLDER || FirebaseImpl.STORAGE_FOLDER;
