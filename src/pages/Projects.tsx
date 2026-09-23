import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, getDoc, setDoc, addDoc, serverTimestamp, where, or, doc, updateDoc, runTransaction } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError } from '../lib/firestoreUtils';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { Plus, Search, ExternalLink, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { normalizeEmail } from '../lib/identity';
import { PageHeader } from '../components/PageHeader';
import { readControlTotalProjects } from '../lib/readControlTotalProjects';
import { CONTROL_TOTAL_SPREADSHEET_ID, controlTotalProjectUrl, type ControlTotalProject } from '../lib/controlTotalProjects';

const projectCatalogRef = doc(db, 'integrations', 'controlTotalProjectCatalog');

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
  const [creationMode, setCreationMode] = useState<'controlTotal' | 'manual'>('controlTotal');
  const [sourceProjects, setSourceProjects] = useState<ControlTotalProject[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [catalogUpdatedAt, setCatalogUpdatedAt] = useState<Date | null>(null);
  const [selectedCode, setSelectedCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [localPinnedProjectIds, setLocalPinnedProjectIds] = useState<string[]>([]);
  const { profile, user } = useAuth();
  const isAppAdmin = profile?.role === 'admin';
  const canRefreshCatalog = ['info@granbertafilms.com', 'tomas@granberta.com'].includes(normalizeEmail(user?.email || '')) && isAppAdmin;
  const pinnedProjectIds = localPinnedProjectIds;

  useEffect(() => {
    setLocalPinnedProjectIds(Array.isArray(profile?.pinnedProjectIds) ? profile.pinnedProjectIds : []);
  }, [profile?.pinnedProjectIds]);

  const filteredProjects = projects
    .filter((project) => {
      const term = searchTerm.trim().toLowerCase();
      if (!term) return true;
      return [project.name, project.projectCode, project.clientName, project.brandName, project.status, project.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term);
    })
    .sort((a, b) => {
      const aPinned = pinnedProjectIds.includes(a.id);
      const bPinned = pinnedProjectIds.includes(b.id);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      const aDate = a.createdAt?.seconds || 0;
      const bDate = b.createdAt?.seconds || 0;
      return bDate - aDate;
    });

  const togglePinnedProject = async (projectId: string) => {
    if (!profile?.uid) return;
    const nextPinnedProjectIds = pinnedProjectIds.includes(projectId)
      ? pinnedProjectIds.filter((id: string) => id !== projectId)
      : [...pinnedProjectIds, projectId];

    setLocalPinnedProjectIds(nextPinnedProjectIds);
    window.dispatchEvent(new CustomEvent('gb:pinned-projects-updated', { detail: nextPinnedProjectIds }));
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        pinnedProjectIds: nextPinnedProjectIds,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      setLocalPinnedProjectIds(pinnedProjectIds);
      console.error('Error updating pinned projects:', error);
      alert('No se pudo actualizar el pin del proyecto.');
    }
  };

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

  const selectedSource = sourceProjects.find(project => project.projectCode === selectedCode);
  const sourceAlreadyInGoat = (source: ControlTotalProject) => projects.some(project =>
    project.projectCode === source.projectCode
    || (!project.projectCode && String(project.name || '').trim().toLocaleLowerCase() === source.name.toLocaleLowerCase())
  );

  const loadSourceProjects = async () => {
    if (!isAppAdmin) return;
    setSourceLoading(true);
    setSourceError('');
    try {
      const snapshot = await getDoc(projectCatalogRef);
      const data = snapshot.data();
      const catalog = data?.projects;
      setSourceProjects(Array.isArray(catalog) ? catalog.filter((project): project is ControlTotalProject =>
        typeof project?.projectCode === 'string' && project.projectCode.startsWith('G ')
      ) : []);
      setCatalogUpdatedAt(data?.updatedAt?.toDate?.() || null);
    } catch (error) {
      setSourceProjects([]);
      setSourceError(error instanceof Error ? error.message : 'No se pudo leer el catálogo de proyectos G.');
    } finally {
      setSourceLoading(false);
    }
  };

  const refreshSourceProjects = async () => {
    if (!canRefreshCatalog || !user) return;
    setSourceLoading(true);
    setSourceError('');
    try {
      const catalog = await readControlTotalProjects(user);
      if (catalog.length === 0) throw new Error('Control Total no devolvió proyectos G. No se reemplazó el catálogo existente.');
      await setDoc(projectCatalogRef, {
        sourceSpreadsheetId: CONTROL_TOTAL_SPREADSHEET_ID,
        projects: catalog,
        updatedAt: serverTimestamp(),
        updatedByEmail: normalizeEmail(user.email || ''),
      });
      setSourceProjects(catalog);
      setCatalogUpdatedAt(new Date());
      setSelectedCode('');
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : 'No se pudo actualizar el catálogo desde Control Total.');
    } finally {
      setSourceLoading(false);
    }
  };

  const openNewProject = () => {
    setShowNewModal(true);
    setCreationMode('controlTotal');
    setSelectedCode('');
    setSourceProjects([]);
    void loadSourceProjects();
  };

  const handleCreateProject = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isAppAdmin) {
      alert('Solo un administrador puede crear proyectos.');
      return;
    }

    if (creating) return;
    const formData = new FormData(e.currentTarget);
    const source = creationMode === 'controlTotal' ? selectedSource : undefined;
    if (creationMode === 'controlTotal' && (!source || sourceAlreadyInGoat(source))) {
      setSourceError('Seleccioná un proyecto G que todavía no exista en GOAT.');
      return;
    }
    const budgetTotal = Number(formData.get('budgetTotal')) || 0;
    const data = {
      name: source?.name || formData.get('name'),
      description: formData.get('description'),
      clientName: source?.client || formData.get('clientName') || '',
      brandName: source?.brand || '',
      companyName: source?.company || '',
      serviceName: source?.service || '',
      budgetTotal,
      ...(source ? {
        projectCode: source.projectCode,
        controlTotalProjectId: source.sourceProjectId,
        controlTotalUrl: controlTotalProjectUrl(source),
        controlTotalSourceRowAtImport: source.sourceRow,
        controlTotalStatusAtImport: source.status,
        controlTotalOwnerUnit: source.ownerUnit,
        controlTotalInternalProviderUnit: source.internalProviderUnit,
        controlTotalCondition: source.condition,
        controlTotalConfirmationDate: source.confirmationDate,
        controlTotalDeliveryDate: source.deliveryDate,
        controlTotalContractCurrency: source.contractCurrency,
        controlTotalContractAmount: source.contractAmount,
        controlTotalImportedAt: serverTimestamp(),
      } : {}),
      status: 'Presupuesto',
      createdBy: profile?.uid,
      createdByEmail: normalizeEmail(profile?.email),
      collaboratorEmails: [],
      categories: ['Ejecutiva', 'Producción de Campo', 'Post Producción'],
      executiveCategoryDefaultApplied: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    setCreating(true);
    try {
      const docRef = source ? doc(db, 'projects', `ct-${source.projectCode.replace(/\s+/g, '-')}`)
        : await addDoc(collection(db, 'projects'), data);
      if (source) {
        await runTransaction(db, async transaction => {
          if ((await transaction.get(docRef)).exists()) throw new Error('Este código ya tiene un proyecto en GOAT.');
          transaction.set(docRef, data);
        });
      }
      setProjects([{ id: docRef.id, ...data }, ...projects]);
      setShowNewModal(false);
    } catch (error) {
      console.error("Error adding project:", error);
      setSourceError(error instanceof Error ? error.message : 'No se pudo crear el proyecto.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-full mx-auto space-y-3 sm:space-y-6">
      <PageHeader
        eyebrow="GB GOAT / Catálogo"
        title="Histórico y activas"
        className="gap-3 pb-4 sm:gap-4 sm:pb-6"
        actions={isAppAdmin ? (
          <button 
            onClick={openNewProject}
            className="px-3 py-1.5 bg-black text-white rounded text-[10px] font-bold hover:bg-slate-800 transition-all active:scale-[0.98] uppercase tracking-widest flex items-center gap-2"
          >
            <Plus className="w-3 h-3" />
            Nuevo Proyecto
          </button>
        ) : null}
      />

      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
          <input 
            type="text" 
            placeholder="Filtrar por nombre o cliente..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded text-sm focus:outline-none focus:border-slate-400 transition-all placeholder:text-slate-300"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-48 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filteredProjects.length === 0 ? (
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-6">
          {filteredProjects.map((project) => (
            <Link key={project.id} to={`/proyectos/${project.id}`}>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0 }}
                className="group bg-white p-3 sm:p-6 rounded-lg sm:rounded-xl border border-slate-200 hover:border-slate-900 transition-all shadow-sm shadow-slate-200/50 cursor-pointer h-full"
              >
                <div className="flex justify-between items-start mb-2 sm:mb-6">
                  <span className={cn(
                    "text-[8px] sm:text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded",
                    statusColors[project.status] || 'bg-slate-50 text-slate-400'
                  )}>
                    {project.status}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void togglePinnedProject(project.id);
                      }}
                      className={cn(
                        "p-1 rounded transition-colors",
                        pinnedProjectIds.includes(project.id)
                          ? "text-amber-500 bg-amber-50"
                          : "text-slate-200 hover:text-amber-500 hover:bg-amber-50"
                      )}
                      title={pinnedProjectIds.includes(project.id) ? 'Despinear proyecto' : 'Pinear proyecto'}
                    >
                      <Star className={cn("w-4 h-4", pinnedProjectIds.includes(project.id) && "fill-current")} />
                    </button>
                    <ExternalLink className="hidden sm:block w-4 h-4 text-slate-200 group-hover:text-slate-900 transition-colors" />
                  </div>
                </div>
                
                <h3 className="text-sm sm:text-xl font-bold text-slate-900 leading-tight mb-1 sm:mb-2 line-clamp-1 sm:line-clamp-none">
                  {project.name}
                </h3>
                {project.projectCode && <div className="text-[9px] font-bold text-slate-400 mb-1">{project.projectCode}</div>}
                
                {project.clientName && (
                  <div className="text-[8px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0 sm:mb-4 truncate">
                    Cliente: {project.clientName}
                  </div>
                )}
                
                <p className="hidden sm:block text-xs text-slate-400 line-clamp-2 mb-8 font-medium font-sans">
                  {project.description || 'Sin descripción detallada disponible.'}
                </p>
                
                <div className="hidden sm:flex items-center justify-between pt-4 border-t border-slate-50">
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
              className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-8 relative z-10 border border-slate-200 shadow-2xl shadow-slate-200/50"
            >
              <h2 className="text-xs font-bold uppercase tracking-widest mb-8 border-l-4 border-black pl-4">Nueva Producción</h2>
              <form onSubmit={handleCreateProject} className="space-y-6">
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={() => setCreationMode('controlTotal')} className={cn('flex-1 rounded border px-3 py-2', creationMode === 'controlTotal' ? 'bg-black text-white' : 'border-slate-200')}>Desde Control Total</button>
                  <button type="button" onClick={() => setCreationMode('manual')} className={cn('flex-1 rounded border px-3 py-2', creationMode === 'manual' ? 'bg-black text-white' : 'border-slate-200')}>Carga manual</button>
                </div>
                {creationMode === 'controlTotal' ? (
                  <div className="space-y-3">
                    <label className="block text-[10px] font-bold uppercase text-slate-400 tracking-widest">Proyecto G de Control Total</label>
                    <select value={selectedCode} onChange={event => { setSelectedCode(event.target.value); setSourceError(''); }} disabled={sourceLoading} required className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm">
                      <option value="">{sourceLoading ? 'Leyendo proyectos...' : 'Seleccionar proyecto...'}</option>
                      {sourceProjects.map(source => (
                        <option key={source.projectCode} value={source.projectCode} disabled={sourceAlreadyInGoat(source)}>
                          {source.projectCode} · {source.name}{sourceAlreadyInGoat(source) ? ' (ya existe)' : ''}
                        </option>
                      ))}
                    </select>
                    {sourceError && <p role="alert" className="text-xs text-red-700">{sourceError}</p>}
                    <p className="text-[11px] text-slate-500">Catálogo G: {catalogUpdatedAt ? `actualizado el ${catalogUpdatedAt.toLocaleString('es-AR')}` : 'aún no publicado'}.</p>
                    {!sourceLoading && sourceProjects.length === 0 && !canRefreshCatalog && <p className="text-xs text-amber-800">Pedile a Tomás o a info@granbertafilms.com que actualice el catálogo.</p>}
                    {!sourceLoading && sourceProjects.length === 0 && <button type="button" onClick={() => void loadSourceProjects()} className="text-xs underline">Volver a cargar el catálogo</button>}
                    {canRefreshCatalog && <button type="button" onClick={() => void refreshSourceProjects()} disabled={sourceLoading} className="block text-xs font-semibold text-blue-700 underline disabled:opacity-50">Actualizar desde Control Total</button>}
                    {selectedSource && (
                      <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                        <div><b>Nombre en GOAT:</b> {selectedSource.name}</div>
                        <div><b>Código:</b> {selectedSource.projectCode}</div>
                        <div><b>Cliente:</b> {selectedSource.client || 'Sin dato'} · <b>Marca:</b> {selectedSource.brand || 'Sin dato'}</div>
                        <div><b>Contrato:</b> {selectedSource.contractAmount === null ? 'Sin importe' : `${selectedSource.contractCurrency} ${selectedSource.contractAmount.toLocaleString('es-AR')}`}</div>
                        {canRefreshCatalog && <a href={controlTotalProjectUrl(selectedSource)} target="_blank" rel="noopener noreferrer" className="inline-block text-blue-700 underline">Ver fila de origen</a>}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Nombre</label>
                    <input name="name" required className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" placeholder="Título del proyecto..." />
                    <p className="text-[11px] text-amber-700 mt-2">La carga manual no vincula el proyecto al código de Control Total.</p>
                  </div>
                )}
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Resumen</label>
                  <textarea name="description" rows={3} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all resize-none" placeholder="Descripción breve..." />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {creationMode === 'manual' && <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Cliente</label>
                    <select name="clientName" className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all appearance-none">
                      <option value="">Sin cliente</option>
                      {clients.map(client => (
                        <option key={client.id} value={client.businessName}>{client.businessName}</option>
                      ))}
                    </select>
                  </div>}
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Presupuesto GOAT (ARS)</label>
                    <input key={`${creationMode}-${selectedCode}`} name="budgetTotal" type="number" min="0" step="0.01" readOnly={selectedSource?.contractCurrency === 'USD'} defaultValue={selectedSource?.contractCurrency === 'ARS' ? selectedSource.contractAmount ?? undefined : selectedSource?.contractCurrency === 'USD' ? 0 : undefined} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" placeholder="0" />
                  </div>
                </div>
                {selectedSource?.contractCurrency === 'USD' && <p className="text-xs text-amber-800">El contrato en USD queda guardado como referencia. El presupuesto de GOAT se crea en ARS 0 y se completa manualmente después.</p>}
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setShowNewModal(false)} className="flex-1 px-4 py-3 border border-slate-200 rounded text-xs font-bold tracking-widest uppercase hover:bg-slate-50 transition-colors">Cancelar</button>
                  <button type="submit" disabled={creating || sourceLoading || (creationMode === 'controlTotal' && !selectedSource)} className="flex-1 px-4 py-3 bg-black text-white rounded text-xs font-bold tracking-widest uppercase hover:bg-slate-800 transition-colors disabled:opacity-50">{creating ? 'Creando...' : 'Confirmar'}</button>
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
