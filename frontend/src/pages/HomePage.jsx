import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function HomePage() {
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('fb_admin_token');
    const userId = localStorage.getItem('fb_user_id');
    if (token) navigate('/fb-admin/dashboard', { replace: true });
    else if (userId) navigate('/fb/dashboard', { replace: true });
    else navigate('/fb/login', { replace: true });
  }, [navigate]);

  return (
    <div className="flex flex-center" style={{ minHeight: '100vh' }}>
      <div className="loading-spinner loading-spinner-lg" />
    </div>
  );
}
