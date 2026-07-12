import { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ToastProvider } from './components/ToastProvider.jsx';


const HomePage = lazy(() => import('./pages/HomePage.jsx'));
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
const FirebaseAdminUPIPaymentsPage = lazy(() => import('./pages/FirebaseAdminUPIPaymentsPage.jsx'));
const FirebaseAdminToolsPage = lazy(() => import('./pages/FirebaseAdminToolsPage.jsx'));
const FirebaseAdminQueuePage = lazy(() => import('./pages/FirebaseAdminQueuePage.jsx'));
const SponsorMarketplacePage = lazy(() => import('./pages/SponsorMarketplacePage.jsx'));
const SponsorRequestsPage = lazy(() => import('./pages/SponsorRequestsPage.jsx'));
const AdminSponsorTransfersPage = lazy(() => import('./pages/AdminSponsorTransfersPage.jsx'));
const AdminPendingPaymentsPage = lazy(() => import('./pages/AdminPendingPaymentsPage.jsx'));

const SESSION_DURATION = 24 * 3600 * 1000;

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
  try {
    const parts = adminToken.split('.');
    if (parts.length !== 3) { clearSession(); return <Navigate to="/fb-admin" replace />; }
    const body = JSON.parse(atob(parts[1]));
    const exp = body.exp;
    if (!exp || Math.floor(Date.now() / 1000) > exp) {
      clearSession();
      return <Navigate to="/fb-admin" replace />;
    }
  } catch {
    clearSession();
    return <Navigate to="/fb-admin" replace />;
  }
  return children;
}

const pageTransition = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] },
};

function AnimatedPage({ children }) {
  return <motion.div {...pageTransition}>{children}</motion.div>;
}

export default function App() {
  const location = useLocation();

  return (
    <ToastProvider>
      <AnimatePresence mode="wait">
        <Suspense fallback={<LoadingFallback />} key={location.pathname}>
          <Routes location={location}>
            <Route path="/" element={<AnimatedPage><HomePage /></AnimatedPage>} />
            <Route path="/test" element={<AnimatedPage><TestPage /></AnimatedPage>} />
            <Route path="/payment" element={<AnimatedPage><PaymentPage /></AnimatedPage>} />
            <Route path="/fb/register" element={<AnimatedPage><FirebaseRegisterPage /></AnimatedPage>} />
            <Route path="/fb/login" element={<AnimatedPage><FirebaseLoginPage /></AnimatedPage>} />
            <Route path="/fb/dashboard" element={<ProtectedFirebase><AnimatedPage><FirebaseUserDashboard /></AnimatedPage></ProtectedFirebase>} />
            <Route path="/fb/messages" element={<ProtectedFirebase><AnimatedPage><UserMessageCenter /></AnimatedPage></ProtectedFirebase>} />
            <Route path="/fb/chat" element={<ProtectedFirebase><AnimatedPage><UserChat /></AnimatedPage></ProtectedFirebase>} />
            <Route path="/fb/sponsor-marketplace" element={<ProtectedFirebase><AnimatedPage><SponsorMarketplacePage /></AnimatedPage></ProtectedFirebase>} />
            <Route path="/fb/sponsor-requests" element={<ProtectedFirebase><AnimatedPage><SponsorRequestsPage /></AnimatedPage></ProtectedFirebase>} />

            <Route path="/fb-admin" element={<AnimatedPage><FirebaseAdminLoginPage /></AnimatedPage>} />
            <Route path="/fb-admin/dashboard" element={<ProtectedFirebaseAdmin><AnimatedPage><FirebaseAdminDashboardPage /></AnimatedPage></ProtectedFirebaseAdmin>} />
            <Route path="/fb-admin/payments" element={<ProtectedFirebaseAdmin><AnimatedPage><FirebaseAdminPaymentsPage /></AnimatedPage></ProtectedFirebaseAdmin>} />
            <Route path="/fb-admin/users" element={<ProtectedFirebaseAdmin><AnimatedPage><FirebaseAdminUsersPage /></AnimatedPage></ProtectedFirebaseAdmin>} />
            <Route path="/fb-admin/status" element={<ProtectedFirebaseAdmin><AnimatedPage><FirebaseAdminStatusPage /></AnimatedPage></ProtectedFirebaseAdmin>} />
            <Route path="/fb-admin/referral-graph" element={<ProtectedFirebaseAdmin><AnimatedPage><ReferralGraphPage /></AnimatedPage></ProtectedFirebaseAdmin>} />
            <Route path="/fb-admin/messages" element={<ProtectedFirebaseAdmin><AnimatedPage><AdminMessageHistory /></AnimatedPage></ProtectedFirebaseAdmin>} />
            <Route path="/fb-admin/chat" element={<ProtectedFirebaseAdmin><AnimatedPage><AdminChat /></AnimatedPage></ProtectedFirebaseAdmin>} />
            <Route path="/fb-admin/topups" element={<ProtectedFirebaseAdmin><AnimatedPage><FirebaseAdminTopupsPage /></AnimatedPage></ProtectedFirebaseAdmin>} />
            <Route path="/fb-admin/upi-payments" element={<ProtectedFirebaseAdmin><AnimatedPage><FirebaseAdminUPIPaymentsPage /></AnimatedPage></ProtectedFirebaseAdmin>} />
            <Route path="/fb-admin/tools" element={<ProtectedFirebaseAdmin><AnimatedPage><FirebaseAdminToolsPage /></AnimatedPage></ProtectedFirebaseAdmin>} />
            <Route path="/fb-admin/queue" element={<ProtectedFirebaseAdmin><AnimatedPage><FirebaseAdminQueuePage /></AnimatedPage></ProtectedFirebaseAdmin>} />
            <Route path="/fb-admin/sponsor-transfers" element={<ProtectedFirebaseAdmin><AnimatedPage><AdminSponsorTransfersPage /></AnimatedPage></ProtectedFirebaseAdmin>} />
            <Route path="/fb-admin/pending-queue" element={<ProtectedFirebaseAdmin><AnimatedPage><AdminPendingPaymentsPage /></AnimatedPage></ProtectedFirebaseAdmin>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AnimatePresence>
    </ToastProvider>
  );
}
