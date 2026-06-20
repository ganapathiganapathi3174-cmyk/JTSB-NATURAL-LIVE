import { FirebaseWallet } from '../db/firebase-db.js';

export async function getWalletBalance(req, user) {
  if (!user) throw { status: 401, message: 'Not authenticated' };
  const userId = user.id || user._id;
  const balance = await FirebaseWallet.getBalance(userId);
  return { status: 200, data: { balance } };
}

export async function getWalletTransactions(req, user) {
  if (!user) throw { status: 401, message: 'Not authenticated' };
  const userId = user.id || user._id;
  const limit = parseInt(req.query?.limit) || 50;
  const transactions = await FirebaseWallet.listTransactions(userId, limit);
  return { status: 200, data: { transactions } };
}
