import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';

const TestPage = lazy(() => import('./pages/TestPage.jsx'));
const PaymentPage = lazy(() => import('./pages/PaymentPage.jsx'));
const FirebaseRegisterPage = lazy(() => import('./pages/FirebaseRegisterPage.jsx'));
const FirebaseLoginPage = lazy(() => import('./pages/FirebaseLoginPage.jsx'));
const FirebaseUserDashboard = lazy(() => import('./pages/FirebaseUserDashboard.jsx'));
const FirebaseAdminLoginPage = lazy(() => import('./pages/FirebaseAdminLoginPage.jsx'));
const FirebaseAdminDashboardPage = lazy(() => import('./pages/FirebaseAdminDashboardPage.jsx'));
const FirebaseAdminPaymentsPage = lazy(() => import('./pages/FirebaseAdminPaymentsPage.jsx'));
const FirebaseAdminUsersPage = lazy(() => import('./pages/FirebaseAdminUsersPage.jsx'));
const ReferralGraphPage = lazy(() => import('./pages/ReferralGraphPage.jsx'));

function LoadingFallback() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <div style={{ color: 'var(--muted)' }}>Loading...</div>
    </div>
  );
}

function ProtectedFirebase({ children }) {
  const userId = localStorage.getItem('fb_user_id');
  if (!userId) return <Navigate to="/fb/login" replace />;
  return children;
}

function ProtectedFirebaseAdmin({ children }) {
  const adminToken = localStorage.getItem('fb_admin_token');
  if (!adminToken) return <Navigate to="/fb-admin" replace />;
  return children;
}

export default function App() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path="/test" element={<TestPage />} />
        <Route path="/" element={<Navigate to="/fb/register" replace />} />
        <Route path="/payment" element={<Navigate to="/fb/register" replace />} />
        
        {/* Firebase User routes */}
        <Route path="/fb/register" element={<PaymentPage />} />
        <Route path="/fb/login" element={<FirebaseLoginPage />} />
        <Route path="/fb/dashboard" element={<ProtectedFirebase><FirebaseUserDashboard /></ProtectedFirebase>} />

        {/* Firebase Admin routes */}
        <Route path="/fb-admin" element={<FirebaseAdminLoginPage />} />
        <Route path="/fb-admin/dashboard" element={<ProtectedFirebaseAdmin><FirebaseAdminDashboardPage /></ProtectedFirebaseAdmin>} />
        <Route path="/fb-admin/payments" element={<ProtectedFirebaseAdmin><FirebaseAdminPaymentsPage /></ProtectedFirebaseAdmin>} />
        <Route path="/fb-admin/users" element={<ProtectedFirebaseAdmin><FirebaseAdminUsersPage /></ProtectedFirebaseAdmin>} />
        <Route path="/fb-admin/referral-graph" element={<ReferralGraphPage />} />

        <Route path="*" element={<Navigate to="/payment" replace />} />
      </Routes>
    </Suspense>
  );
}
