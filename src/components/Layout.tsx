import { Outlet, Navigate, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import { AssistantChat } from './AssistantChat';
import { useAuth } from '../context/AuthContext';
import { normalizeEmail } from '../lib/identity';

export default function Layout() {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-black border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-medium text-slate-500">Cargando GB GOAT...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const projectMatch = location.pathname.match(/^\/proyectos\/([^/?#]+)/);
  const currentProjectId = projectMatch ? decodeURIComponent(projectMatch[1]) : null;

  return (
    <div className="flex min-h-screen bg-[#e9edf4]">
      <Sidebar />
      <main className="flex-1 bg-[radial-gradient(circle_at_top_left,#ffffff_0,#f5f7fb_34%,#e9edf4_100%)] p-2 pb-20 sm:p-3 lg:p-4 lg:pb-4 overflow-auto">
        <Outlet />
      </main>
      <AssistantChat
        uid={user.uid}
        email={normalizeEmail(user.email || profile?.email || '')}
        globalRole={profile?.role || null}
        currentProjectId={currentProjectId}
      />
    </div>
  );
}
