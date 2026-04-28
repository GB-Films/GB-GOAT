import { useState, useEffect } from 'react';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Users, Mail, Shield, ShieldCheck, MoreVertical, Lock } from 'lucide-react';
import { useAuth, APP_OWNER_EMAIL } from '../context/AuthContext';

const normalizeEmail = (email?: string | null) => (email || '').trim().toLowerCase();

export default function Team() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { profile, isOwner } = useAuth();

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'users'));
        setUsers(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error) {
        console.error("Error fetching users:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, []);

  const handleRoleChange = async (targetUser: any, newRole: string) => {
    if (!isOwner) {
      alert('Solo info@granbertafilms.com puede cambiar roles globales de usuarios.');
      return;
    }

    if (normalizeEmail(targetUser.email) === APP_OWNER_EMAIL) {
      alert('El rol del dueño no se puede modificar.');
      return;
    }

    try {
      await updateDoc(doc(db, 'users', targetUser.id), { role: newRole });
      setUsers(users.map(u => u.id === targetUser.id ? { ...u, role: newRole } : u));
    } catch (error) {
      console.error("Error updating role:", error);
      alert('No se pudo actualizar el rol del usuario.');
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Equipo</h1>
        <p className="text-slate-500 mt-1">Gestiona los colaboradores y sus permisos de acceso</p>
      </header>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Usuario</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Rol Global</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Email</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                [1, 2, 3].map(i => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={4} className="px-6 py-8 h-16 bg-slate-50/20" />
                  </tr>
                ))
              ) : users.map((user) => {
                const userEmail = normalizeEmail(user.email);
                const isProtectedOwner = userEmail === APP_OWNER_EMAIL;
                const canEditRole = isOwner && !isProtectedOwner;
                const role = user.role || 'colaborador';

                return (
                  <tr key={user.id} className="hover:bg-slate-50/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <img 
                          src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName || user.email}`} 
                          alt="" 
                          className="w-10 h-10 rounded-full border border-slate-200"
                        />
                        <div>
                          <p className="text-sm font-bold text-slate-900">{user.displayName || 'Sin nombre'}</p>
                          <p className="text-xs text-slate-400">ID: {user.id.slice(0, 8)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5">
                        {role === 'admin' ? (
                          <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                        ) : (
                          <Shield className="w-3.5 h-3.5 text-slate-400" />
                        )}
                        <select 
                          value={role} 
                          onChange={(e) => handleRoleChange(user, e.target.value)}
                          disabled={!canEditRole}
                          className="text-xs font-bold bg-transparent border-none focus:ring-0 p-0 cursor-pointer capitalize text-slate-700 disabled:cursor-not-allowed disabled:text-slate-400"
                          title={canEditRole ? 'Cambiar rol global' : 'Solo el dueño puede modificar roles globales'}
                        >
                          <option value="admin">Administrador</option>
                          <option value="colaborador">Colaborador</option>
                        </select>
                        {!canEditRole && (
                          <Lock className="w-3 h-3 text-slate-300" />
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <Mail className="w-3.5 h-3.5" />
                        {user.email}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                        <MoreVertical className="w-4 h-4 text-slate-400" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-8 p-6 bg-blue-50/50 rounded-2xl border border-blue-100 flex items-start gap-4">
        <div className="p-2 bg-blue-100 rounded-lg">
          <Users className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-blue-900">Invitar Colaboradores</h4>
          <p className="text-xs text-blue-700 mt-1 leading-relaxed">
            Los nuevos usuarios quedan como colaboradores y no ven proyectos hasta que sean incorporados a una producción. Solo info@granbertafilms.com puede subir o bajar roles globales de administrador.
          </p>
          {profile?.email && !isOwner && (
            <p className="text-[10px] text-blue-500 mt-2 font-bold uppercase tracking-widest">
              Tu cuenta puede administrar proyectos, pero no modificar roles globales de admin.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
