import * as authController from '../controllers/authController';
import * as paymentController from '../controllers/paymentController';
import * as adminController from '../controllers/adminController';

// ===== Route map =====
const routes = {
  'POST /auth/register': authController.register,
  'POST /auth/login': authController.login,
  'GET /auth/me': authController.me,
  // ===== NEW: Referral Contacts =====
  'GET /auth/referral-contacts': authController.listReferralContacts,
  'POST /auth/referral-contacts': authController.addReferralContact,
  'DELETE /auth/referral-contacts/:contactId': authController.deleteReferralContact,
  'POST /admin/login': adminController.adminLogin,
  'GET /admin/stats': adminController.dashboardStats,
  'GET /admin/users': adminController.listUsers,
  'DELETE /admin/users/:id': adminController.deleteUser,
  'DELETE /admin/users/:id/permanent': adminController.permanentDeleteUser,
  'GET /admin/payments': adminController.listPayments,
  'GET /admin/referrals': adminController.referralTree,
  'GET /admin/referrals/:id': adminController.getUserReferrals,
  'GET /admin/users/filter': adminController.filterUsersByReferral,
  'GET /admin/users/:userId/referral-contacts': adminController.getUserReferralContacts,
  'POST /admin/activate-sponsor': adminController.activateSponsor,
  'POST /admin/reactivate-sponsor': adminController.reactivateSponsor,
  'POST /admin/suspend-user': adminController.suspendUser,
  'POST /admin/block-user': adminController.blockUser,
  'GET /wallet/balance': paymentController.getWalletBalance,
  'GET /wallet/transactions': paymentController.getWalletTransactions,
};

// ===== Create client =====
export function createClient() {
  let token = null;
  let user = null;

  function matchRoute(method, path) {
    const key = `${method.toUpperCase()} ${path}`;
    
    // Exact match first
    if (routes[key]) return { handler: routes[key], params: {} };
    
    // Dynamic match: split pattern into method and path parts
    for (const pattern of Object.keys(routes)) {
      const spaceIdx = pattern.indexOf(' ');
      const patternMethod = pattern.slice(0, spaceIdx);
      const patternPath = pattern.slice(spaceIdx + 1);
      
      // Method must match
      if (patternMethod !== method.toUpperCase()) continue;
      
      // Split paths into segments (filter out empty strings)
      const patternSegments = patternPath.split('/').filter(s => s.length > 0);
      const pathSegments = path.split('/').filter(s => s.length > 0);
      
      // Must have same number of segments
      if (patternSegments.length !== pathSegments.length) continue;
      
      // Match each segment
      const params = {};
      let matched = true;
      for (let i = 0; i < patternSegments.length; i++) {
        const pSeg = patternSegments[i];
        const rSeg = pathSegments[i];
        
        if (pSeg.startsWith(':')) {
          // Dynamic parameter - capture it
          params[pSeg.slice(1)] = rSeg;
        } else if (pSeg !== rSeg) {
          // Literal segment mismatch
          matched = false;
          break;
        }
      }
      
      if (matched) {
        console.log(`✅ Route matched: ${method} ${path} -> ${pattern}`, params);
        return { handler: routes[pattern], params };
      }
    }
    
    console.error(`❌ Route NOT found: ${method} ${path}`);
    console.error(`Available routes:`, Object.keys(routes));
    return null;
  }

  async function request(method, path, body) {
    const match = matchRoute(method, path.split('?')[0]);
    if (!match) {
      const err = new Error('Route not found: ' + method + ' ' + path);
      err.response = { status: 404, data: { message: 'Route not found' } };
      throw err;
    }

    // Parse query parameters from URL
    const queryIndex = path.indexOf('?');
    const query = queryIndex !== -1
      ? Object.fromEntries(new URLSearchParams(path.slice(queryIndex + 1)))
      : {};

    const req = {
      body: body || {},
      params: match.params,
      query,
      headers: {},
      file: body?.__file || null,
    };
    if (token) req.headers.authorization = 'Bearer ' + token;

    try {
      const res = await match.handler(req, user, token);
      if (res.status >= 400) {
        const err = new Error(res.data?.message || 'Error');
        err.response = { status: res.status, data: res.data };
        throw err;
      }
      return { data: res.data, status: res.status };
    } catch (e) {
      if (e.response) throw e;
      const err = new Error(e.message || 'Server error');
      err.response = { status: e.status || 500, data: { message: e.message || 'Server error' } };
      throw err;
    }
  }

  return {
    get(path) { return request('GET', path, null); },
    post(path, body) { return request('POST', path, body); },
    patch(path, body) { return request('PATCH', path, body); },
    delete(path) { return request('DELETE', path, null); },
    // Internal setters
    _setToken(t) { token = t; },
    _setUser(u) { user = u; },
  };
}

export const publicApi = createClient();
export const userApi = createClient();
export const adminApi = createClient();

// Helpers
export function setClientUserToken(client, t) { client._setToken(t); }
export function setClientAdminToken(client, t) { client._setToken(t); }
export function setClientUser(client, u) { client._setUser(u); }

// Aliases for backward compatibility
export const attachUserToken = setClientUserToken;
export const attachAdminToken = setClientAdminToken;
