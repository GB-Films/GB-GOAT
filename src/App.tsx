import { lazy, Suspense, type ReactNode } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import { hasGlobalRole, PROVIDER_ACCESS_ROLES } from './lib/roles';

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Projects = lazy(() => import('./pages/Projects'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));
const Team = lazy(() => import('./pages/Team'));
const Providers = lazy(() => import('./pages/Providers'));
const ProviderInvite = lazy(() => import('./pages/ProviderInvite'));
const InvoiceUploadInvite = lazy(() => import('./pages/InvoiceUploadInvite'));
const Clients = lazy(() => import('./pages/Clients'));
const Reports = lazy(() => import('./pages/Reports'));
const PlaceholderPage = lazy(() => import('./pages/PlaceholderPage'));

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
      Cargando módulo…
    </div>
  );
}

function AdminRoute({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth();

  if (loading) return null;
  if (profile?.role !== 'admin') return <Navigate to="/proyectos" replace />;

  return <>{children}</>;
}

function ProvidersRoute({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth();

  if (loading) return null;
  if (!hasGlobalRole(profile?.role, PROVIDER_ACCESS_ROLES)) return <Navigate to="/proyectos" replace />;

  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/alta-proveedor/:token" element={<ProviderInvite />} />
            <Route path="/carga-factura/:token" element={<InvoiceUploadInvite />} />
            
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/proyectos" element={<Projects />} />
              <Route path="/proyectos/:id" element={<ProjectDetail />} />

              <Route path="/proveedores" element={<ProvidersRoute><Providers /></ProvidersRoute>} />
              <Route path="/clientes" element={<AdminRoute><Clients /></AdminRoute>} />
              <Route path="/equipo" element={<AdminRoute><Team /></AdminRoute>} />
              <Route path="/reportes" element={<AdminRoute><Reports /></AdminRoute>} />
              <Route path="/configuracion" element={<AdminRoute><PlaceholderPage title="Configuración" /></AdminRoute>} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Router>
    </AuthProvider>
  );
}
