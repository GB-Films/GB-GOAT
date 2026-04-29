import type { ReactNode } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Team from './pages/Team';
import Providers from './pages/Providers';
import ProviderInvite from './pages/ProviderInvite';
import Clients from './pages/Clients';
import Reports from './pages/Reports';
import PlaceholderPage from './pages/PlaceholderPage';

function AdminRoute({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth();

  if (loading) return null;
  if (profile?.role !== 'admin') return <Navigate to="/proyectos" replace />;

  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/alta-proveedor/:token" element={<ProviderInvite />} />
          
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/proyectos" element={<Projects />} />
            <Route path="/proyectos/:id" element={<ProjectDetail />} />
            
            <Route path="/proveedores" element={<AdminRoute><Providers /></AdminRoute>} />
            <Route path="/clientes" element={<AdminRoute><Clients /></AdminRoute>} />
            <Route path="/equipo" element={<AdminRoute><Team /></AdminRoute>} />
            <Route path="/reportes" element={<AdminRoute><Reports /></AdminRoute>} />
            <Route path="/configuracion" element={<AdminRoute><PlaceholderPage title="Configuración" /></AdminRoute>} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
