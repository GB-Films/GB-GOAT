import { useState, useEffect } from 'react';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Users, Mail, Shield, ShieldCheck, MoreVertical } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';

export default function Team() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { profile } = useAuth();

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

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (profile?.role !== 'admin' && profile?.uid !== userId) {
      alert("Solo administradores pueden cambiar roles.");
      return;
    }
    try {
      await updateDoc(doc(db, 'users', userId), { role: newRole });
      setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
    } catch (error) {
      console.error("Error updating role:", error);
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
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Rol</th>
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
              ) : users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50/30 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <img 
                        src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} 
                        alt="" 
                        className="w-10 h-10 rounded-full border border-slate-200"
                      />
                      <div>
                        <p className="text-sm font-bold text-slate-900">{user.displayName}</p>
                        <p className="text-xs text-slate-400">ID: {user.id.slice(0, 8)}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5">
                      {user.role === 'admin' ? (
                        <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                      ) : (
                        <Shield className="w-3.5 h-3.5 text-slate-400" />
                      )}
                      <select 
                        value={user.role} 
                        onChange={(e) => handleRoleChange(user.id, e.target.value)}
                        disabled={profile?.role !== 'admin'}
                        className="text-xs font-bold bg-transparent border-none focus:ring-0 p-0 cursor-pointer capitalize text-slate-700"
                      >
                        <option value="admin">Administrador</option>
                        <option value="colaborador">Colaborador</option>
                      </select>
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
              ))}
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
                El sistema detectará automáticamente a nuevos usuarios cuando inicien sesión con su cuenta corporativa por primera vez. Puedes asignarles roles y accesos específicos a proyectos desde aquí.
            </p>
        </div>
      </div>
    </div>
  );
}
