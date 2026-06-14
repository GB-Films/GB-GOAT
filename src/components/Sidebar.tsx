import { 
  LayoutDashboard, 
  Clapperboard, 
  Truck, 
  Users, 
  BarChart3, 
  Settings, 
  LogOut,
  Star
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { collection, getDocs, or, query, where } from 'firebase/firestore';
import { cn } from '../lib/utils';
import { auth, db } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { PROVIDER_ACCESS_ROLES } from '../lib/roles';

const menuItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/', adminOnly: false },
  { icon: Clapperboard, label: 'Proyectos', path: '/proyectos', adminOnly: false },
  { icon: Truck, label: 'Proveedores', path: '/proveedores', adminOnly: true, productionLead: true },
  { icon: Users, label: 'Clientes', path: '/clientes', adminOnly: true },
  { icon: Users, label: 'Equipo', path: '/equipo', adminOnly: true },
  { icon: BarChart3, label: 'Reportes', path: '/reportes', adminOnly: true },
  { icon: Settings, label: 'Configuración', path: '/configuracion', adminOnly: true },
];

const roleLabels: Record<string, string> = {
  admin: 'Administrador',
  ayudante_admin: 'Ayudante Admin',
  jefe_produccion: 'Jefe de Producción',
  colaborador: 'Colaborador',
};

const normalizeEmail = (email?: string | null) => (email || '').trim().toLowerCase();

export default function Sidebar() {
  const { profile } = useAuth();
  const [pinnedProjectIds, setPinnedProjectIds] = useState<string[]>([]);
  const [pinnedProjects, setPinnedProjects] = useState<any[]>([]);
  const logoSrc = `${(import.meta as any).env.BASE_URL}gb-films-logo.png`;

  const filteredMenuItems = menuItems.filter(item => (
    profile?.role === 'admin'
    || !item.adminOnly
    || (item.productionLead && PROVIDER_ACCESS_ROLES.includes(profile?.role))
  ));

  useEffect(() => {
    setPinnedProjectIds(Array.isArray(profile?.pinnedProjectIds) ? profile.pinnedProjectIds : []);
  }, [profile?.pinnedProjectIds]);

  useEffect(() => {
    const handlePinnedProjectsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<string[]>).detail;
      if (Array.isArray(detail)) setPinnedProjectIds(detail);
    };

    window.addEventListener('gb:pinned-projects-updated', handlePinnedProjectsUpdated);
    return () => window.removeEventListener('gb:pinned-projects-updated', handlePinnedProjectsUpdated);
  }, []);

  useEffect(() => {
    const fetchPinnedProjects = async () => {
      if (!profile?.uid || !profile?.email || pinnedProjectIds.length === 0) {
        setPinnedProjects([]);
        return;
      }

      try {
        const projectsRef = collection(db, 'projects');
        const projectsQuery = profile.role === 'admin'
          ? query(projectsRef)
          : query(
              projectsRef,
              or(
                where('createdBy', '==', profile.uid),
                where('collaboratorEmails', 'array-contains', normalizeEmail(profile.email))
              )
            );
        const snapshot = await getDocs(projectsQuery);
        const projectById = new Map(snapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() }]));
        setPinnedProjects(
          pinnedProjectIds
            .map((projectId) => projectById.get(projectId))
            .filter(Boolean)
            .slice(0, 8)
        );
      } catch (error) {
        console.error('Error fetching pinned projects:', error);
      }
    };

    void fetchPinnedProjects();
  }, [pinnedProjectIds, profile]);

  return (
    <>
    <aside className="hidden w-52 bg-[#020817] text-white border-r border-white/10 lg:flex flex-col h-screen sticky top-0 shadow-2xl shadow-slate-950/30 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_0%,rgba(59,130,246,0.18),transparent_36%),linear-gradient(180deg,rgba(15,23,42,0.95),#020817)] pointer-events-none" />
      <div className="relative p-4">
        <div className="mb-5 flex justify-center border-b border-white/10 pb-5">
          <img
            src={logoSrc}
            alt="GB Films"
            className="w-20 h-auto object-contain drop-shadow-[0_12px_28px_rgba(0,0,0,0.45)]"
          />
        </div>
        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.22em] mb-3 px-2.5">Menú</div>

        <nav className="space-y-1">
          {filteredMenuItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => cn(
                "flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all group",
                isActive 
                  ? "bg-gradient-to-r from-blue-600 to-indigo-700 text-white shadow-lg shadow-blue-950/40 ring-1 ring-white/10" 
                  : "text-slate-300 hover:text-white hover:bg-white/10"
              )}
            >
              {({ isActive }) => (
                <>
                  <item.icon className={cn("w-4 h-4", isActive ? "text-white" : "text-slate-500 group-hover:text-white")} />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {pinnedProjects.length > 0 && (
          <div className="mt-5 border-t border-white/10 pt-4">
            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.22em] mb-2 px-2.5">Pineados</div>
            <div className="space-y-1">
              {pinnedProjects.map((project) => (
                <NavLink
                  key={project.id}
                  to={`/proyectos/${project.id}`}
                  className={({ isActive }) => cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all group",
                    isActive
                      ? "bg-white/15 text-white"
                      : "text-slate-300 hover:text-white hover:bg-white/10"
                  )}
                  title={project.name}
                >
                  <Star className="w-3.5 h-3.5 text-amber-400 fill-current shrink-0" />
                  <span className="truncate">{project.name || 'Proyecto sin nombre'}</span>
                </NavLink>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="relative mt-auto p-3 border-t border-white/10">
        <div className="mb-3 h-24 rounded-2xl bg-[radial-gradient(circle_at_center,rgba(30,64,175,0.25),transparent_55%)] opacity-70" />
        <div className="flex items-center gap-2.5 p-2.5 bg-white/10 rounded-2xl border border-white/10 shadow-xl shadow-black/20">
          <img 
            src={profile?.photoURL || `https://ui-avatars.com/api/?name=${profile?.displayName || 'User'}&background=000&color=fff`} 
            alt="Avatar" 
            className="w-8 h-8 rounded-full border border-white/15"
          />
          <div className="overflow-hidden">
            <p className="text-[10px] font-bold text-white truncate uppercase tracking-tight">{profile?.displayName || 'GB FILMS'}</p>
            <p className="text-[10px] text-slate-400 truncate tracking-tighter">{roleLabels[profile?.role] || 'Colaborador'}</p>
          </div>
        </div>
        <button 
          onClick={() => auth.signOut()}
          className="mt-2 flex items-center gap-2 w-full px-2 py-1.5 text-[10px] uppercase font-bold text-slate-400 hover:text-red-300 transition-colors"
        >
          <LogOut className="w-3 h-3" />
          Cerrar sesión
        </button>
      </div>
    </aside>
    <nav className="fixed inset-x-0 bottom-0 z-[500] flex items-center gap-1 overflow-x-auto border-t border-slate-200 bg-white/95 px-2 py-1.5 shadow-[0_-10px_30px_rgba(15,23,42,0.12)] backdrop-blur lg:hidden">
      {filteredMenuItems.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) => cn(
            "flex min-w-[68px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 text-[9px] font-black uppercase tracking-tight transition-all",
            isActive
              ? "bg-slate-900 text-white shadow-sm"
              : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          )}
        >
          {({ isActive }) => (
            <>
              <item.icon className={cn("h-4 w-4", isActive ? "text-white" : "text-slate-400")} />
              <span className="max-w-[64px] truncate">{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
    </>
  );
}
