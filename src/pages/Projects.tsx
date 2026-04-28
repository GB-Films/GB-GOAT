import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, addDoc, serverTimestamp, where, or } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError } from '../lib/firestoreUtils';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { Plus, Search, ExternalLink, Clapperboard } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';

const normalizeEmail = (email?: string | null) => (email || '').trim().toLowerCase();

const statusColors: Record<string, string> = {
  'Presupuesto': 'bg-slate-100 text-slate-700',
  'Pre Producción': 'bg-blue-100 text-blue-700',
  'Rodaje': 'bg-rose-100 text-rose-700',
  'Post': 'bg-purple-100 text-purple-700',
  'Aprobado': 'bg-emerald-100 text-emerald-700',
};

export default function Projects() {
  const [projects, setProjects] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const { profile } = useAuth();
  const isAppAdmin = profile?.role === 'admin';

  useEffect(() => {
    const fetchProjects = async () => {
      if (!profile?.uid || !profile?.email) return;
      try {
        const projectsRef = collection(db, 'projects');
        const q = profile.role === 'admin'
          ? query(projectsRef)
          : query(
              projectsRef,
              or(
                where('createdBy', '==', profile.uid),
                where('collaboratorEmails', 'array-contains', normalizeEmail(profile.email))
              )
            );
        const querySnapshot = await getDocs(q);
        setProjects(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error: any) {
        if (error.message?.includes('insufficient permissions')) {
            handleFirestoreError(error, 'list', 'projects');
        }
        console.error("Error fetching projects:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchProjects();

    const fetchClients = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'clients'));
        setClients(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error: any) {
        console.error("Error fetching clients:", error);
        if (error.message?.includes('insufficient permissions')) {
          handleFirestoreError(error, 'list', 'clients');
        }
      }
    };
    fetchClients();
  }, [profile]);

  const handleCreateProject = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isAppAdmin) {
      alert('Solo un administrador puede crear proyectos.');
      return;
    }

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name'),
      description: formData.get('description'),
      clientName: formData.get('clientName') || '',
      budgetTotal: Number(formData.get('budgetTotal')) || 0,
      status: 'Presupuesto',
      createdBy: profile?.uid,
      createdByEmail: normalizeEmail(profile?.email),
      collaboratorEmails: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      const docRef = await addDoc(collection(db, 'projects'), data);
      setProjects([{ id: docRef.id, ...data }, ...projects]);
      setShowNewModal(false);
    } catch (error) {
      console.error("Error adding project:", error);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header className="flex items-end justify-between border-b border-slate-200 pb-4">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">GB GOAT / Catálogo</div>
          <h1 className="text-2xl font-light text-slate-900">Producciones: <span className="font-bold text-black">Histórico y Activas</span></h1>
        </div>
        {isAppAdmin && (
          <button 
            onClick={() => setShowNewModal(true)}
            className="px-3 py-1.5 bg-black text-white rounded text-[10px] font-bold hover:bg-slate-800 transition-all active:scale-[0.98] uppercase tracking-widest flex items-center gap-2"
          >
            <Plus className="w-3 h-3" />
            Nuevo Proyecto
          </button>
        )}
      </header>

      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
          <input 
            type="text" 
            placeholder="Filtrar por nombre o cliente..."
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded text-sm focus:outline-none focus:border-slate-400 transition-all placeholder:text-slate-300"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-48 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-200">
           <Clapperboard className="w-12 h-12 text-slate-100 mx-auto mb-4" />
           <h3 className="text-sm font-bold uppercase tracking-widest text-slate-300">
             {isAppAdmin ? 'Sin Producciones registradas' : 'Acceso pendiente'}
           </h3>
           {!isAppAdmin && (
             <p className="text-xs text-slate-400 mt-3 max-w-md mx-auto">
               Tu cuenta ya está activa como colaborador, pero todavía no fuiste incorporado a ningún proyecto.
             </p>
           )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project, i) => (
            <Link key={project.id} to={`/proyectos/${project.id}`}>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="group bg-white p-6 rounded-xl border border-slate-200 hover:border-slate-900 transition-all shadow-sm shadow-slate-200/50 cursor-pointer h-full"
              >
                <div className="flex justify-between items-start mb-6">
                  <span className={cn(
                    "text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded",
                    statusColors[project.status] || 'bg-slate-50 text-slate-400'
                  )}>
                    {project.status}
                  </span>
                  <ExternalLink className="w-4 h-4 text-slate-200 group-hover:text-slate-900 transition-colors" />
                </div>
                
                <h3 className="text-xl font-bold text-slate-900 leading-tight mb-2">
                  {project.name}
                </h3>
                
                {project.clientName && (
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">
                    Cliente: {project.clientName}
                  </div>
                )}
                
                <p className="text-xs text-slate-400 line-clamp-2 mb-8 font-medium font-sans">
                  {project.description || 'Sin descripción detallada disponible.'}
                </p>
                
                <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                  <div className="text-[10px] font-bold text-slate-300 uppercase tracking-tighter">
                      Creado: {project.createdAt ? new Date(project.createdAt.seconds * 1000).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-'}
                  </div>
                  <div className="flex -space-x-1">
                    {[1, 2, 3].map(u => (
                      <div key={u} className="w-5 h-5 rounded-full border border-white bg-slate-100" />
                    ))}
                  </div>
                </div>
              </motion.div>
            </Link>
          ))}
        </div>
      )}

      {/* New Project Modal */}
      <AnimatePresence>
        {showNewModal && isAppAdmin && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNewModal(false)}
              className="absolute inset-0 bg-white/80 backdrop-blur-md" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="bg-white rounded-xl w-full max-w-md p-8 relative z-10 border border-slate-200 shadow-2xl shadow-slate-200/50"
            >
              <h2 className="text-xs font-bold uppercase tracking-widest mb-8 border-l-4 border-black pl-4">Nueva Producción</h2>
              <form onSubmit={handleCreateProject} className="space-y-6">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Nombre</label>
                  <input name="name" required className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" placeholder="Título del proyecto..." />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Resumen</label>
                  <textarea name="description" rows={3} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all resize-none" placeholder="Descripción breve..." />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Cliente</label>
                    <select name="clientName" className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all appearance-none">
                      <option value="">Sin cliente</option>
                      {clients.map(client => (
                        <option key={client.id} value={client.businessName}>{client.businessName}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Presupuesto Total</label>
                    <input name="budgetTotal" type="number" className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" placeholder="0" />
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setShowNewModal(false)} className="flex-1 px-4 py-3 border border-slate-200 rounded text-xs font-bold tracking-widest uppercase hover:bg-slate-50 transition-colors">Cancelar</button>
                  <button type="submit" className="flex-1 px-4 py-3 bg-black text-white rounded text-xs font-bold tracking-widest uppercase hover:bg-slate-800 transition-colors">Confirmar</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Clapperboard(props: any) {
    return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-clapperboard"><path d="M20.2 6 3 11l-.9-2.4c-.3-.8.1-1.6.9-1.9l2.7-1c.8-.3 1.6.1 1.9.9l.9 2.4"/><path d="M12.5 10l2.4-5.9c.3-.8 1.1-1.2 1.9-.9l2.7 1c.8.3 1.2 1.1.9 1.9L20.2 10"/><path d="M2 11h20v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V11z"/></svg>
}
