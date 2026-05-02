import { Outlet, Navigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { user, loading } = useAuth();

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

  return (
    <div className="flex min-h-screen bg-[#e9edf4]">
      <Sidebar />
      <main className="flex-1 bg-[radial-gradient(circle_at_top_left,#ffffff_0,#f5f7fb_34%,#e9edf4_100%)] p-6 lg:p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
