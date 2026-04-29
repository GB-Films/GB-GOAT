import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, Clapperboard, Clock, MapPin } from 'lucide-react';
import { motion } from 'motion/react';
import { collection, getDocs, query, orderBy, where, or, updateDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError } from '../lib/firestoreUtils';
import { Link } from 'react-router-dom';
import { cn } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

const DraggableComponent = Draggable as any;
const DroppableComponent = Droppable as any;

const PROJECT_STATUSES = ['Presupuesto', 'Pre Producción', 'Rodaje', 'Post', 'Aprobado'];

interface PayableLine {
  id: string;
  projectId: string;
  projectName: string;
  projectStatus: string;
  area: string;
  providerId?: string;
  providerName?: string;
  description?: string;
  total: number;
  paid: number;
  debt: number;
  source: 'area' | 'budget';
}

interface ProjectFinance {
  id: string;
  name: string;
  status: string;
  clientName?: string;
  budgetTotal: number;
  committedBudget: number;
  spent: number;
  paid: number;
  debt: number;
  usagePercent: number;
  overBudget: number;
  unpaidLines: number;
  payableLines: PayableLine[];
  createdAt?: any;
  shootingDate?: any;
  location?: string;
  updatedAt?: any;
}

const statusColors: Record<string, string> = {
  Presupuesto: 'border-slate-200 bg-slate-50',
  'Pre Producción': 'border-blue-100 bg-blue-50/30',
  Rodaje: 'border-rose-100 bg-rose-50/30',
  Post: 'border-purple-100 bg-purple-50/30',
  Aprobado: 'border-emerald-100 bg-emerald-50/30',
};

const formatCurrency = (value: number) => `$${Math.round(value || 0).toLocaleString('es-AR')}`;

const formatCompactCurrency = (value: number) => {
  const abs = Math.abs(value || 0);
  if (abs >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `$${(value / 1000).toFixed(0)}k`;
  return formatCurrency(value);
};

const parseProjectDate = (value: any) => {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatProjectDate = (value: any) => {
  const date = parseProjectDate(value);
  if (!date) return 'Sin fecha';
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
};

const getDaysUntil = (value: any) => {
  const date = parseProjectDate(value);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.ceil((date.getTime() - today.getTime()) / 86400000);
};

const getOperationalFlags = (project: ProjectFinance) => {
  const flags: string[] = [];
  if (!project.shootingDate && project.status !== 'Aprobado') flags.push('Sin fecha de rodaje');
  if (project.overBudget > 0) flags.push('Presupuesto excedido');
  else if (project.usagePercent >= 85 && project.status !== 'Aprobado') flags.push('Presupuesto en alerta');
  if (project.debt > 0.01) flags.push('Pagos pendientes');
  if (!project.clientName) flags.push('Sin cliente asignado');
  return flags;
};

const getPaymentTotal = (item: any) => {
  const history = Array.isArray(item.paymentHistory) ? item.paymentHistory : [];
  return history.reduce((acc: number, payment: any) => acc + (Number(payment.amount) || 0), 0);
};

const getItemTotal = (item: any) => Number(item.total) || 0;

const buildProjectFinance = (project: any, budgetItems: any[], areaExpenses: any[]): ProjectFinance => {
  const activeAreas = Array.isArray(project.activeAreas) ? project.activeAreas : [];
  const standaloneBudgetItems = budgetItems.filter((item) => !activeAreas.includes(item.area));
  const committedBudget = budgetItems.reduce((acc, item) => acc + getItemTotal(item), 0);
  const budgetTotal = Number(project.budgetTotal) || committedBudget;

  const payableLines: PayableLine[] = [
    ...areaExpenses.map((item) => {
      const total = getItemTotal(item);
      const paid = getPaymentTotal(item);
      return {
        id: item.id,
        projectId: project.id,
        projectName: project.name || 'Sin nombre',
        projectStatus: project.status || 'Presupuesto',
        area: item.area || 'Sin area',
        providerId: item.providerId,
        providerName: item.providerName,
        description: item.description,
        total,
        paid,
        debt: Math.max(0, total - paid),
        source: 'area' as const,
      };
    }),
    ...standaloneBudgetItems.map((item) => {
      const total = getItemTotal(item);
      const paid = getPaymentTotal(item);
      return {
        id: item.id,
        projectId: project.id,
        projectName: project.name || 'Sin nombre',
        projectStatus: project.status || 'Presupuesto',
        area: item.area || 'Sin area',
        providerId: item.providerId,
        providerName: item.providerName,
        description: item.description,
        total,
        paid,
        debt: Math.max(0, total - paid),
        source: 'budget' as const,
      };
    }),
  ];

  const spent = payableLines.reduce((acc, item) => acc + item.total, 0);
  const paid = payableLines.reduce((acc, item) => acc + item.paid, 0);
  const debt = payableLines.reduce((acc, item) => acc + item.debt, 0);
  const usagePercent = budgetTotal > 0 ? Math.round((spent / budgetTotal) * 100) : 0;

  return {
    id: project.id,
    name: project.name || 'Sin nombre',
    status: project.status || 'Presupuesto',
    clientName: project.clientName,
    budgetTotal,
    committedBudget,
    spent,
    paid,
    debt,
    usagePercent,
    overBudget: Math.max(0, spent - budgetTotal),
    unpaidLines: payableLines.filter((item) => item.debt > 0.01).length,
    payableLines,
    createdAt: project.createdAt,
    shootingDate: project.shootingDate,
    location: project.location,
    updatedAt: project.updatedAt,
  };
};

export default function Dashboard() {
  const { profile } = useAuth();
  const [projects, setProjects] = useState<ProjectFinance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.uid || !profile?.email) return;

    const fetchDashboardData = async () => {
      setLoading(true);
      try {
        const pq = profile.role === 'admin'
          ? query(collection(db, 'projects'), orderBy('createdAt', 'desc'))
          : query(
              collection(db, 'projects'),
              or(
                where('createdBy', '==', profile.uid),
                where('collaboratorEmails', 'array-contains', profile.email)
              ),
              orderBy('createdAt', 'desc')
            );

        const pSnap = await getDocs(pq);
        const projectsData = pSnap.docs.map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() as any }));

        const projectsWithFinance = await Promise.all(
          projectsData.map(async (project) => {
            const [budgetSnap, expensesSnap] = await Promise.all([
              getDocs(collection(db, 'projects', project.id, 'budgetItems')),
              getDocs(collection(db, 'projects', project.id, 'areaExpenses')),
            ]);

            const budgetItems = budgetSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }));
            const areaExpenses = expensesSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }));

            return buildProjectFinance(project, budgetItems, areaExpenses);
          })
        );

        setProjects(projectsWithFinance);
      } catch (error: any) {
        console.error('Error fetching dashboard data:', error);
        if (error.message?.includes('insufficient permissions')) {
          handleFirestoreError(error, 'list', 'projects');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [profile]);

  const dashboardStats = useMemo(() => {
    const active = projects.filter((project) => project.status !== 'Aprobado').length;
    const inShoot = projects.filter((project) => project.status === 'Rodaje').length;
    const nextShoots = projects.filter((project) => {
      const days = getDaysUntil(project.shootingDate);
      return days !== null && days >= 0 && days <= 14;
    }).length;
    const attention = projects.filter((project) => getOperationalFlags(project).length > 0).length;

    return { active, inShoot, nextShoots, attention };
  }, [projects]);

  const upcomingShoots = useMemo(() => (
    projects
      .map((project) => ({ project, days: getDaysUntil(project.shootingDate) }))
      .filter((item): item is { project: ProjectFinance; days: number } => item.days !== null && item.days >= 0)
      .sort((a, b) => a.days - b.days)
      .slice(0, 6)
  ), [projects]);

  const attentionProjects = useMemo(() => {
    return projects
      .map((project) => ({ project, flags: getOperationalFlags(project) }))
      .filter((item) => item.flags.length > 0)
      .sort((a, b) => {
        const aCritical = a.project.overBudget > 0 ? 1 : 0;
        const bCritical = b.project.overBudget > 0 ? 1 : 0;
        if (aCritical !== bCritical) return bCritical - aCritical;
        return b.flags.length - a.flags.length;
      })
      .slice(0, 6);
  }, [projects]);

  const onDragEnd = async (result: any) => {
    const { destination, source, draggableId } = result;

    if (!destination) return;

    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    const newStatus = destination.droppableId;
    const previousProjects = projects;
    const updatedProjects = projects.map((project) =>
      project.id === draggableId ? { ...project, status: newStatus } : project
    );
    setProjects(updatedProjects);

    try {
      const projectRef = doc(db, 'projects', draggableId);
      await updateDoc(projectRef, {
        status: newStatus,
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error('Error updating project status:', error);
      setProjects(previousProjects);
    }
  };

  const getProjectsByStatus = (status: string) => {
    return projects.filter((project) => project.status === status);
  };

  return (
    <div className="max-w-full mx-auto space-y-5">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">Global / Operacion audiovisual</div>
          <h1 className="text-2xl font-light text-slate-900 leading-none">
            Dashboard: <span className="font-bold text-black">Estado de Producciones</span>
          </h1>
        </div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {profile?.role === 'admin' ? 'Vista administracion' : 'Vista colaborador'}
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {[
          { label: 'Producciones visibles', value: projects.length.toString(), icon: Clapperboard, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Producciones activas', value: dashboardStats.active.toString(), icon: Clock, color: 'text-slate-900', bg: 'bg-slate-50' },
          { label: 'En rodaje', value: dashboardStats.inShoot.toString(), icon: CalendarDays, color: 'text-rose-600', bg: 'bg-rose-50' },
          { label: 'Rodajes proximos', value: dashboardStats.nextShoots.toString(), icon: MapPin, color: 'text-purple-600', bg: 'bg-purple-50' },
          { label: 'Necesitan atencion', value: dashboardStats.attention.toString(), icon: AlertTriangle, color: dashboardStats.attention > 0 ? 'text-rose-600' : 'text-emerald-600', bg: dashboardStats.attention > 0 ? 'bg-rose-50' : 'bg-emerald-50' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[9px] text-slate-400 font-bold uppercase mb-1 tracking-wider">{stat.label}</div>
                <div className="text-xl font-black text-slate-900 leading-none">{loading ? '...' : stat.value}</div>
              </div>
              <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', stat.bg)}>
                <stat.icon className={cn('w-4 h-4', stat.color)} />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <section className="space-y-3">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">Pipeline operativo</div>
          <h2 className="text-lg font-bold text-slate-900">Estado de producciones</h2>
        </div>

        <DragDropContext onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2 min-h-[420px] items-start">
            {PROJECT_STATUSES.map((status, i) => {
              const columnProjects = getProjectsByStatus(status);

              return (
                <motion.div
                  key={status}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex flex-col gap-2 min-w-0 h-full"
                >
                  <div className={cn(
                    'p-2.5 rounded-lg border flex flex-col gap-0.5 shadow-sm',
                    statusColors[status] || 'border-slate-100 bg-slate-50'
                  )}>
                    <div className="flex justify-between items-center">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-900 truncate mr-1">{status}</h3>
                      <span className="text-[9px] font-bold bg-white/50 px-1.5 py-0.5 rounded-full border border-black/5 leading-none">{columnProjects.length}</span>
                    </div>
                  </div>

                  <DroppableComponent droppableId={status}>
                    {(provided: any, snapshot: any) => (
                      <div
                        {...provided.droppableProps}
                        ref={provided.innerRef}
                        className={cn(
                          'flex-1 flex flex-col gap-2 rounded-lg transition-colors p-1',
                          snapshot.isDraggingOver ? 'bg-slate-50/50' : ''
                        )}
                      >
                        {columnProjects.length > 0 ? (
                          columnProjects.map((project, index) => {
                            const flags = getOperationalFlags(project);
                            const daysUntilShoot = getDaysUntil(project.shootingDate);

                            return (
                            <DraggableComponent key={project.id} draggableId={project.id} index={index}>
                              {(provided: any, snapshot: any) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className={cn(
                                    'bg-white p-2.5 rounded-lg border border-slate-200 shadow-sm transition-all group relative',
                                    snapshot.isDragging ? 'shadow-lg border-black z-50 scale-105' : 'hover:border-black'
                                  )}
                                >
                                  <Link
                                    to={`/proyectos/${project.id}`}
                                    className="block"
                                    onClick={(e) => {
                                      if (snapshot.isDragging) e.preventDefault();
                                    }}
                                  >
                                    <div className="text-[8px] font-bold uppercase tracking-widest text-slate-400 mb-1 truncate group-hover:text-black">
                                      {project.clientName || 'Sin cliente'}
                                    </div>
                                    <h4 className="text-xs font-bold text-slate-900 mb-2 leading-tight line-clamp-2 min-h-[2rem] group-hover:underline">
                                      {project.name}
                                    </h4>
                                    <div className="space-y-2 pt-2 border-t border-slate-50">
                                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                                        <CalendarDays className="w-3 h-3 text-slate-300" />
                                        <span>{formatProjectDate(project.shootingDate)}</span>
                                        {daysUntilShoot !== null && daysUntilShoot >= 0 && (
                                          <span className="ml-auto text-[9px] text-slate-400">D-{daysUntilShoot}</span>
                                        )}
                                      </div>
                                      {project.location && (
                                        <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-400 truncate">
                                          <MapPin className="w-3 h-3 shrink-0" />
                                          <span className="truncate">{project.location}</span>
                                        </div>
                                      )}
                                      <div className={cn(
                                        'inline-flex max-w-full items-center gap-1 rounded border px-2 py-1 text-[8px] font-black uppercase tracking-widest',
                                        flags.length > 0
                                          ? 'bg-rose-50 text-rose-700 border-rose-100'
                                          : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                      )}>
                                        {flags.length > 0 ? flags[0] : 'En orden'}
                                      </div>
                                    </div>
                                  </Link>
                                </div>
                              )}
                            </DraggableComponent>
                            );
                          })
                        ) : (
                          <div className="flex-1 border border-dashed border-slate-100 rounded-lg flex items-center justify-center p-4">
                            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-200">Vacio</p>
                          </div>
                        )}
                        {provided.placeholder}
                      </div>
                    )}
                  </DroppableComponent>
                </motion.div>
              );
            })}
          </div>
        </DragDropContext>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <section className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Proximos rodajes</h2>
                <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mt-0.5">Fechas visibles ordenadas por urgencia</p>
              </div>
              <CalendarDays className="w-4 h-4 text-slate-300" />
            </div>
            <div className="divide-y divide-slate-100">
              {upcomingShoots.map(({ project, days }) => (
                <Link key={project.id} to={`/proyectos/${project.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 truncate">{project.name}</div>
                    <div className="text-[10px] font-medium text-slate-400 truncate">{project.clientName || 'Sin cliente'}{project.location ? ` / ${project.location}` : ''}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-black text-slate-900">{formatProjectDate(project.shootingDate)}</div>
                    <div className={cn("text-[9px] font-bold uppercase tracking-widest", days <= 3 ? "text-rose-600" : "text-slate-400")}>D-{days}</div>
                  </div>
                </Link>
              ))}
              {!loading && upcomingShoots.length === 0 && (
                <div className="px-4 py-10 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">
                  No hay rodajes proximos cargados
                </div>
              )}
            </div>
          </section>

          <section className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Atencion operativa</h2>
                <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mt-0.5">Datos faltantes o riesgos para resolver</p>
              </div>
              <AlertTriangle className="w-4 h-4 text-slate-300" />
            </div>
            <div className="divide-y divide-slate-100">
              {attentionProjects.map(({ project, flags }) => (
                <Link key={project.id} to={`/proyectos/${project.id}`} className="block px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">{project.name}</div>
                      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-1">{project.status}</div>
                    </div>
                    <span className="text-[9px] font-black text-rose-600 bg-rose-50 border border-rose-100 rounded px-2 py-1">
                      {flags.length}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {flags.slice(0, 3).map((flag) => (
                      <span key={flag} className="text-[8px] font-black uppercase tracking-widest text-slate-500 bg-slate-50 border border-slate-100 rounded px-2 py-1">
                        {flag}
                      </span>
                    ))}
                  </div>
                </Link>
              ))}
              {!loading && attentionProjects.length === 0 && (
                <div className="px-4 py-10 text-center text-[10px] font-bold uppercase tracking-widest text-emerald-600 flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Producciones sin alertas operativas
                </div>
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
