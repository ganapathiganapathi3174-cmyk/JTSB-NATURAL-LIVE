import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import TestPage from './pages/TestPage.jsx';
import PaymentPage from './pages/PaymentPage.jsx';
import FirebaseRegisterPage from './pages/FirebaseRegisterPage.jsx';
import FirebaseLoginPage from './pages/FirebaseLoginPage.jsx';
import FirebaseUserDashboard from './pages/FirebaseUserDashboard.jsx';
import FirebaseAdminLoginPage from './pages/FirebaseAdminLoginPage.jsx';
import FirebaseAdminDashboardPage from './pages/FirebaseAdminDashboardPage.jsx';
import FirebaseAdminPaymentsPage from './pages/FirebaseAdminPaymentsPage.jsx';
import FirebaseAdminUsersPage from './pages/FirebaseAdminUsersPage.jsx';

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

      <Route path="*" element={<Navigate to="/payment" replace />} />
    </Routes>
  );
}
