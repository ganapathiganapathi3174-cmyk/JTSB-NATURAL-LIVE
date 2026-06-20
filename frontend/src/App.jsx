import { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

const TestPage = lazy(() => import('./pages/TestPage.jsx'));
const PaymentPage = lazy(() => import('./pages/PaymentPage.jsx'));
const FirebaseRegisterPage = lazy(() => import('./pages/FirebaseRegisterPage.jsx'));
const FirebaseLoginPage = lazy(() => import('./pages/FirebaseLoginPage.jsx'));
const FirebaseUserDashboard = lazy(() => import('./pages/FirebaseUserDashboard.jsx'));
const UserMessageCenter = lazy(() => import('./pages/UserMessageCenter.jsx'));
const AdminMessageHistory = lazy(() => import('./pages/AdminMessageHistory.jsx'));
const AdminChat = lazy(() => import('./pages/AdminChat.jsx'));
const UserChat = lazy(() => import('./pages/UserChat.jsx'));
const FirebaseAdminLoginPage = lazy(() => import('./pages/FirebaseAdminLoginPage.jsx'));
const FirebaseAdminDashboardPage = lazy(() => import('./pages/FirebaseAdminDashboardPage.jsx'));
const FirebaseAdminPaymentsPage = lazy(() => import('./pages/FirebaseAdminPaymentsPage.jsx'));
const FirebaseAdminUsersPage = lazy(() => import('./pages/FirebaseAdminUsersPage.jsx'));
const ReferralGraphPage = lazy(() => import('./pages/ReferralGraphPage.jsx'));
const FirebaseAdminStatusPage = lazy(() => import('./pages/FirebaseAdminStatusPage.jsx'));
const FirebaseAdminTopupsPage = lazy(() => import('./pages/FirebaseAdminTopupsPage.jsx'));

const SESSION_DURATION = 7 * 3600 * 1000;

function isSessionExpired(key) {
  const loginAt = parseInt(localStorage.getItem(key), 10);
  if (!loginAt) return true;
  return Date.now() - loginAt > SESSION_DURATION;
}

function clearSession() {
  localStorage.removeItem('fb_user_id');
  localStorage.removeItem('fb_login_at');
  localStorage.removeItem('fb_admin_token');
  localStorage.removeItem('fb_admin_login_at');
}

function LoadingFallback() {
  return (
    <div className="loading-page">
      <div className="loading-spinner loading-spinner-lg" />
      <div className="loading-text">Loading...</div>
    </div>
  );
}

function ProtectedFirebase({ children }) {
  const [verified, setVerified] = useState(null);
  const userId = localStorage.getItem('fb_user_id');
  useEffect(() => {
    if (!userId) { setVerified(false); return; }
    if (isSessionExpired('fb_login_at')) {
      clearSession();
      setVerified(false);
      return;
    }
    let cancelled = false;
    import('./db/firebase-db.js').then(({ FirebaseUser }) => {
      FirebaseUser.findById(userId).then(user => {
        if (!cancelled) setVerified(!!user);
      }).catch(() => { if (!cancelled) setVerified(false); });
    }).catch(() => { if (!cancelled) setVerified(false); });
    return () => { cancelled = true; };
  }, [userId]);
  if (verified === null) return <LoadingFallback />;
  if (!verified) return <Navigate to="/fb/login" replace />;
  return children;
}

function ProtectedFirebaseAdmin({ children }) {
  const adminToken = localStorage.getItem('fb_admin_token');
  if (!adminToken) return <Navigate to="/fb-admin" replace />;
  if (isSessionExpired('fb_admin_login_at')) {
    clearSession();
    return <Navigate to="/fb-admin" replace />;
  }
  return children;
}

export default function App() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path="/test" element={<TestPage />} />
        <Route path="/" element={<Navigate to="/fb/register" replace />} />
        <Route path="/payment" element={<PaymentPage />} />
        <Route path="/fb/register" element={<FirebaseRegisterPage />} />
        <Route path="/fb/login" element={<FirebaseLoginPage />} />
        <Route path="/fb/dashboard" element={<ProtectedFirebase><FirebaseUserDashboard /></ProtectedFirebase>} />
        <Route path="/fb/messages" element={<ProtectedFirebase><UserMessageCenter /></ProtectedFirebase>} />
        <Route path="/fb/chat" element={<ProtectedFirebase><UserChat /></ProtectedFirebase>} />

        {/* Firebase Admin routes */}
        <Route path="/fb-admin" element={<FirebaseAdminLoginPage />} />
        <Route path="/fb-admin/dashboard" element={<ProtectedFirebaseAdmin><FirebaseAdminDashboardPage /></ProtectedFirebaseAdmin>} />
        <Route path="/fb-admin/payments" element={<ProtectedFirebaseAdmin><FirebaseAdminPaymentsPage /></ProtectedFirebaseAdmin>} />
        <Route path="/fb-admin/users" element={<ProtectedFirebaseAdmin><FirebaseAdminUsersPage /></ProtectedFirebaseAdmin>} />
        <Route path="/fb-admin/status" element={<ProtectedFirebaseAdmin><FirebaseAdminStatusPage /></ProtectedFirebaseAdmin>} />
        <Route path="/fb-admin/referral-graph" element={<ProtectedFirebaseAdmin><ReferralGraphPage /></ProtectedFirebaseAdmin>} />
        <Route path="/fb-admin/messages" element={<ProtectedFirebaseAdmin><AdminMessageHistory /></ProtectedFirebaseAdmin>} />
        <Route path="/fb-admin/chat" element={<ProtectedFirebaseAdmin><AdminChat /></ProtectedFirebaseAdmin>} />
        <Route path="/fb-admin/topups" element={<ProtectedFirebaseAdmin><FirebaseAdminTopupsPage /></ProtectedFirebaseAdmin>} />

        <Route path="*" element={<Navigate to="/fb/register" replace />} />
      </Routes>
    </Suspense>
  );
}
