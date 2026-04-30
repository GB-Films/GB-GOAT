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
    <aside className="w-64 bg-white border-r border-slate-200 flex flex-col h-screen sticky top-0">
      <div className="p-6">
        <div className="mb-10 flex justify-center">
          <img
            src={logoSrc}
            alt="GB Films"
            className="w-28 h-auto object-contain"
          />
        </div>
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4 px-3">Menú</div>

        <nav className="space-y-1">
          {filteredMenuItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all group",
                isActive 
                  ? "bg-slate-900 text-white" 
                  : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
              )}
            >
              {({ isActive }) => (
                <>
                  <item.icon className={cn("w-5 h-5", isActive ? "text-white" : "text-slate-400 group-hover:text-slate-900")} />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="mt-auto p-4 border-t border-slate-100">
        <div className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg">
          <img 
            src={profile?.photoURL || `https://ui-avatars.com/api/?name=${profile?.displayName || 'User'}&background=000&color=fff`} 
            alt="Avatar" 
            className="w-8 h-8 rounded-full border border-slate-200"
          />
          <div className="overflow-hidden">
            <p className="text-[10px] font-bold text-slate-900 truncate uppercase tracking-tight">{profile?.displayName}</p>
            <p className="text-[10px] text-slate-400 truncate capitalize tracking-tighter">{profile?.role || 'colaborador'}</p>
          </div>
        </div>
        <button 
          onClick={() => auth.signOut()}
          className="mt-2 flex items-center gap-2 w-full px-3 py-2 text-[10px] uppercase font-bold text-slate-400 hover:text-red-500 transition-colors"
        >
          <LogOut className="w-3 h-3" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
