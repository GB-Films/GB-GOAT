import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Team from './pages/Team';
import Providers from './pages/Providers';
import Clients from './pages/Clients';
import PlaceholderPage from './pages/PlaceholderPage';

const routerBaseUrl = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL || '/';
const routerBasename = routerBaseUrl.replace(/\/$/, '') || '/';

export default function App() {
  return (
    <AuthProvider>
      <Router basename={routerBasename}>
        <Routes>
          <Route path="/login" element={<Login />} />
          
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/proyectos" element={<Projects />} />
            <Route path="/proyectos/:id" element={<ProjectDetail />} />
            
            <Route path="/proveedores" element={<Providers />} />
            <Route path="/clientes" element={<Clients />} />
            <Route path="/equipo" element={<Team />} />
            <Route path="/reportes" element={<PlaceholderPage title="Reportes" />} />
            <Route path="/configuracion" element={<PlaceholderPage title="Configuración" />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
