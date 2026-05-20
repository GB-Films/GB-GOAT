import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { collection, collectionGroup, getDocs, doc, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Users, Mail, Shield, ShieldCheck, MoreVertical, Lock, Link2, Copy, CheckCircle2 } from 'lucide-react';
import { useAuth, APP_OWNER_EMAIL } from '../context/AuthContext';

const normalizeEmail = (email?: string | null) => (email || '').trim().toLowerCase();

const generateInviteToken = () => {
  const bytes = new Uint8Array(20);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const getUserInviteLink = (token: string) => {
  const baseUrl = ((import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL || '/');
  return `${window.location.origin}${baseUrl}#/login?invite=${token}`;
};

export default function Team() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [generatedInviteLink, setGeneratedInviteLink] = useState('');
  const [copiedInviteLink, setCopiedInviteLink] = useState(false);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const { profile, isOwner, isAdmin } = useAuth();

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'users'));
        const userItems = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
        setUsers(userItems);

        try {
          const productionLeadSnapshot = await getDocs(query(
            collectionGroup(db, 'collaborators'),
            where('role', '==', 'jefe_produccion')
          ));
          const productionLeadEmails = new Set(
            productionLeadSnapshot.docs
              .map((item) => normalizeEmail(item.data().email || item.id))
              .filter(Boolean)
          );
          const syncedUsers = userItems.map((item) => {
            const shouldPromote = productionLeadEmails.has(normalizeEmail(item.email))
              && !['admin', 'jefe_produccion'].includes(item.role);
            return shouldPromote ? { ...item, role: 'jefe_produccion' } : item;
          });

          setUsers(syncedUsers);

          await Promise.all(syncedUsers
            .filter((item, index) => item.role !== userItems[index].role)
            .map((item) => updateDoc(doc(db, 'users', item.id), { role: 'jefe_produccion' })));
        } catch (syncError) {
          console.warn('No se pudo sincronizar jefes de produccion globales:', syncError);
        }
      } catch (error) {
        console.error("Error fetching users:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, []);

  const handleRoleChange = async (targetUser: any, newRole: string) => {
    if (!isAdmin) {
      alert('Solo administradores pueden cambiar roles globales de usuarios.');
      return;
    }

    if (normalizeEmail(targetUser.email) === APP_OWNER_EMAIL) {
      alert('El rol del dueño no se puede modificar.');
      return;
    }

    if (newRole === 'admin' && !isOwner) {
      alert('Solo info@granbertafilms.com puede asignar rol global de administrador.');
      return;
    }

    if (targetUser.role === 'admin' && !isOwner) {
      alert('Solo info@granbertafilms.com puede modificar usuarios administradores.');
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

  const createUserInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isAdmin) return;

    const email = normalizeEmail(inviteEmail);
    if (!email) return;

    setGeneratingInvite(true);
    setGeneratedInviteLink('');
    setCopiedInviteLink(false);

    try {
      const token = generateInviteToken();
      await setDoc(doc(db, 'userInvites', token), {
        token,
        email,
        status: 'pending',
        used: false,
        createdBy: profile?.uid,
        createdByEmail: profile?.email,
        createdAt: serverTimestamp(),
      });

      const link = getUserInviteLink(token);
      setGeneratedInviteLink(link);
      try {
        await navigator.clipboard.writeText(link);
        setCopiedInviteLink(true);
      } catch (clipboardError) {
        console.warn('No se pudo copiar automáticamente el link:', clipboardError);
      }
    } catch (error) {
      console.error('Error creating user invite:', error);
      alert('No se pudo generar la invitación.');
    } finally {
      setGeneratingInvite(false);
    }
  };

  const copyInviteLink = async () => {
    if (!generatedInviteLink) return;
    await navigator.clipboard.writeText(generatedInviteLink);
    setCopiedInviteLink(true);
    window.setTimeout(() => setCopiedInviteLink(false), 2500);
  };

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between border-b border-slate-200 pb-6">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">GB GOAT / Accesos</div>
          <h1 className="text-2xl font-light text-slate-900 leading-none">Equipo: <span className="font-bold text-black">Usuarios y permisos</span></h1>
          <p className="text-xs text-slate-500 mt-2 max-w-2xl">Invitaciones, roles globales y usuarios habilitados para trabajar en la app.</p>
        </div>
      </header>

      {isAdmin && (
        <div className="mb-8 bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex flex-col lg:flex-row lg:items-end gap-4">
            <form onSubmit={createUserInvite} className="flex-1">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                Invitar usuario por email
              </label>
              <div className="flex flex-col md:flex-row gap-2">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="usuario@email.com"
                  required
                  className="flex-1 px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black"
                />
                <button
                  type="submit"
                  disabled={generatingInvite}
                  className="px-4 py-3 bg-black text-white rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-colors disabled:bg-slate-300 flex items-center justify-center gap-2"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  {generatingInvite ? 'Generando...' : 'Generar link'}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                El usuario deberá iniciar sesión con este mismo email. Todos ingresan como colaboradores.
              </p>
            </form>
          </div>

          {generatedInviteLink && (
            <div className="mt-4 p-4 rounded-xl border border-emerald-100 bg-emerald-50 flex flex-col lg:flex-row gap-3 lg:items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 mb-2 flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Invitación generada
                </div>
                <input readOnly value={generatedInviteLink} className="w-full px-3 py-2 bg-white border border-emerald-100 rounded text-xs text-slate-600" />
              </div>
              <button
                type="button"
                onClick={copyInviteLink}
                className="px-4 py-3 bg-white border border-emerald-100 rounded text-[10px] font-bold uppercase tracking-widest hover:border-emerald-400 transition-colors flex items-center justify-center gap-2"
              >
                <Copy className="w-3.5 h-3.5" />
                {copiedInviteLink ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          )}
        </div>
      )}

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
                const canEditRole = isAdmin && !isProtectedOwner;
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
                        ) : role === 'jefe_produccion' ? (
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Shield className="w-3.5 h-3.5 text-slate-400" />
                        )}
                        <select 
                          value={role} 
                          onChange={(e) => handleRoleChange(user, e.target.value)}
                          disabled={!canEditRole}
                          className="text-xs font-bold bg-transparent border-none focus:ring-0 p-0 cursor-pointer capitalize text-slate-700 disabled:cursor-not-allowed disabled:text-slate-400"
                          title={canEditRole ? 'Cambiar rol global' : 'Solo administradores pueden modificar roles globales'}
                        >
                          <option value="admin" disabled={!isOwner}>Administrador</option>
                          <option value="jefe_produccion">Jefe de Producción</option>
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
            Los nuevos usuarios quedan como colaboradores y no ven proyectos hasta que sean incorporados a una producción. Los Jefes de Producción globales pueden cargar proveedores y generar links de alta; solo info@granbertafilms.com puede subir o bajar roles globales de administrador.
          </p>
          {profile?.email && !isOwner && (
            <p className="text-[10px] text-blue-500 mt-2 font-bold uppercase tracking-widest">
              Tu cuenta puede asignar Jefes de Producción globales, pero no modificar roles globales de admin.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
