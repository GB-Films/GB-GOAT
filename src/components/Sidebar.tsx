import { 
  LayoutDashboard, 
  Clapperboard, 
  Truck, 
  Users, 
  BarChart3, 
  Settings, 
  LogOut
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { cn } from '../lib/utils';
import { auth } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';

const menuItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/', adminOnly: false },
  { icon: Clapperboard, label: 'Proyectos', path: '/proyectos', adminOnly: false },
  { icon: Truck, label: 'Proveedores', path: '/proveedores', adminOnly: true },
  { icon: Users, label: 'Clientes', path: '/clientes', adminOnly: true },
  { icon: Users, label: 'Equipo', path: '/equipo', adminOnly: true },
  { icon: BarChart3, label: 'Reportes', path: '/reportes', adminOnly: true },
  { icon: Settings, label: 'Configuración', path: '/configuracion', adminOnly: true },
];

export default function Sidebar() {
  const { profile } = useAuth();
  const logoSrc = `${(import.meta as any).env.BASE_URL}gb-films-logo.png`;

  const filteredMenuItems = menuItems.filter(item => profile?.role === 'admin' || !item.adminOnly);

  return (
    <aside className="w-64 bg-[#020817] text-white border-r border-white/10 flex flex-col h-screen sticky top-0 shadow-2xl shadow-slate-950/30 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_0%,rgba(59,130,246,0.18),transparent_36%),linear-gradient(180deg,rgba(15,23,42,0.95),#020817)] pointer-events-none" />
      <div className="relative p-6">
        <div className="mb-8 flex justify-center border-b border-white/10 pb-7">
          <img
            src={logoSrc}
            alt="GB Films"
            className="w-28 h-auto object-contain drop-shadow-[0_12px_28px_rgba(0,0,0,0.45)]"
          />
        </div>
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.24em] mb-4 px-3">Menú</div>

        <nav className="space-y-2">
          {filteredMenuItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => cn(
                "flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-semibold transition-all group",
                isActive 
                  ? "bg-gradient-to-r from-blue-600 to-indigo-700 text-white shadow-lg shadow-blue-950/40 ring-1 ring-white/10" 
                  : "text-slate-300 hover:text-white hover:bg-white/10"
              )}
            >
              {({ isActive }) => (
                <>
                  <item.icon className={cn("w-5 h-5", isActive ? "text-white" : "text-slate-500 group-hover:text-white")} />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="relative mt-auto p-4 border-t border-white/10">
        <div className="mb-4 h-44 rounded-2xl bg-[radial-gradient(circle_at_center,rgba(30,64,175,0.25),transparent_55%)] opacity-70" />
        <div className="flex items-center gap-3 p-3 bg-white/10 rounded-2xl border border-white/10 shadow-xl shadow-black/20">
          <img 
            src={profile?.photoURL || `https://ui-avatars.com/api/?name=${profile?.displayName || 'User'}&background=000&color=fff`} 
            alt="Avatar" 
            className="w-9 h-9 rounded-full border border-white/15"
          />
          <div className="overflow-hidden">
            <p className="text-[10px] font-bold text-white truncate uppercase tracking-tight">{profile?.displayName || 'GB FILMS'}</p>
            <p className="text-[10px] text-slate-400 truncate capitalize tracking-tighter">{profile?.role || 'colaborador'}</p>
          </div>
        </div>
        <button 
          onClick={() => auth.signOut()}
          className="mt-3 flex items-center gap-2 w-full px-3 py-2 text-[10px] uppercase font-bold text-slate-400 hover:text-red-300 transition-colors"
        >
          <LogOut className="w-3 h-3" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
