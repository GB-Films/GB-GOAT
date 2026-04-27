import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clapperboard, DollarSign, ReceiptText, TrendingUp, Wallet } from 'lucide-react';
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
}

interface ProviderBalance {
  key: string;
  name: string;
  total: number;
  paid: number;
  debt: number;
  items: number;
  projects: string[];
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

  const totals = useMemo(() => {
    const budget = projects.reduce((acc, project) => acc + project.budgetTotal, 0);
    const committed = projects.reduce((acc, project) => acc + project.committedBudget, 0);
    const spent = projects.reduce((acc, project) => acc + project.spent, 0);
    const paid = projects.reduce((acc, project) => acc + project.paid, 0);
    const debt = projects.reduce((acc, project) => acc + project.debt, 0);
    const overBudgetProjects = projects.filter((project) => project.overBudget > 0).length;
    const riskProjects = projects.filter((project) => project.usagePercent >= 85 && project.overBudget === 0).length;

    return { budget, committed, spent, paid, debt, overBudgetProjects, riskProjects };
  }, [projects]);

  const providerBalances = useMemo(() => {
    const map = new Map<string, ProviderBalance>();

    projects.forEach((project) => {
      project.payableLines.forEach((line) => {
        if (line.debt <= 0.01) return;
        const key = line.providerId || line.providerName || 'sin-proveedor';
        const name = line.providerName || 'Sin proveedor asignado';

        if (!map.has(key)) {
          map.set(key, {
            key,
            name,
            total: 0,
            paid: 0,
            debt: 0,
            items: 0,
            projects: [],
          });
        }

        const balance = map.get(key)!;
        balance.total += line.total;
        balance.paid += line.paid;
        balance.debt += line.debt;
        balance.items += 1;
        if (!balance.projects.includes(project.name)) {
          balance.projects.push(project.name);
        }
      });
    });

    return Array.from(map.values()).sort((a, b) => b.debt - a.debt);
  }, [projects]);

  const projectAlerts = useMemo(() => {
    return [...projects]
      .filter((project) => project.debt > 0 || project.usagePercent >= 85)
      .sort((a, b) => {
        if (a.overBudget !== b.overBudget) return b.overBudget - a.overBudget;
        if (a.debt !== b.debt) return b.debt - a.debt;
        return b.usagePercent - a.usagePercent;
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
          <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">Global / Gestion ejecutiva</div>
          <h1 className="text-2xl font-light text-slate-900 leading-none">
            Dashboard: <span className="font-bold text-black">Producciones y Finanzas</span>
          </h1>
        </div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {profile?.role === 'admin' ? 'Vista administracion' : 'Vista colaborador'}
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {[
          { label: 'Proyectos activos', value: projects.length.toString(), icon: Clapperboard, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Presupuesto total', value: formatCompactCurrency(totals.budget), icon: DollarSign, color: 'text-slate-900', bg: 'bg-slate-50' },
          { label: 'Gastado registrado', value: formatCompactCurrency(totals.spent), icon: ReceiptText, color: 'text-purple-600', bg: 'bg-purple-50' },
          { label: 'Total pagado', value: formatCompactCurrency(totals.paid), icon: Wallet, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Deuda pendiente', value: formatCompactCurrency(totals.debt), icon: AlertTriangle, color: totals.debt > 0 ? 'text-rose-600' : 'text-emerald-600', bg: totals.debt > 0 ? 'bg-rose-50' : 'bg-emerald-50' },
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

      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_0.9fr] gap-4">
        <section className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Saldos globales por proveedor</h2>
              <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mt-0.5">Deuda consolidada de todos los proyectos visibles</p>
            </div>
            <div className="text-right">
              <div className="text-[9px] uppercase font-bold tracking-widest text-slate-400">Pendiente</div>
              <div className="text-base font-black text-rose-600">{formatCompactCurrency(totals.debt)}</div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-400">Proveedor</th>
                  <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-400">Proyectos</th>
                  <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-400 text-right">Total</th>
                  <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-400 text-right">Pagado</th>
                  <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-400 text-right">Debe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {providerBalances.slice(0, 8).map((balance) => (
                  <tr key={balance.key} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3">
                      <div className="text-xs font-bold text-slate-900 uppercase">{balance.name}</div>
                      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-300">{balance.items} partidas abiertas</div>
                    </td>
                    <td className="px-4 py-3 max-w-[260px]">
                      <div className="text-[10px] font-medium text-slate-500 truncate">
                        {balance.projects.join(' / ')}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-bold text-slate-500">{formatCurrency(balance.total)}</td>
                    <td className="px-4 py-3 text-right text-xs font-bold text-emerald-600">{formatCurrency(balance.paid)}</td>
                    <td className="px-4 py-3 text-right text-sm font-black text-rose-600">{formatCurrency(balance.debt)}</td>
                  </tr>
                ))}
                {!loading && providerBalances.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">
                      No hay deudas pendientes registradas
                    </td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">
                      Calculando saldos...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900">Alertas de produccion</h2>
            <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mt-0.5">
              Presupuesto, deuda y avance financiero
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {projectAlerts.map((project) => (
              <Link key={project.id} to={`/proyectos/${project.id}`} className="block px-4 py-3 hover:bg-slate-50 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 truncate">{project.name}</div>
                    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-1">
                      {project.status} / {project.unpaidLines} pendientes
                    </div>
                  </div>
                  <div className={cn(
                    'text-[10px] font-black px-2 py-1 rounded border',
                    project.overBudget > 0
                      ? 'bg-rose-50 text-rose-700 border-rose-100'
                      : project.usagePercent >= 85
                        ? 'bg-yellow-50 text-yellow-700 border-yellow-100'
                        : 'bg-slate-50 text-slate-500 border-slate-100'
                  )}>
                    {project.usagePercent}%
                  </div>
                </div>
                <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      project.overBudget > 0 ? 'bg-rose-500' : project.usagePercent >= 85 ? 'bg-yellow-400' : 'bg-emerald-500'
                    )}
                    style={{ width: `${Math.min(project.usagePercent, 100)}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-between text-[10px] font-bold text-slate-400">
                  <span>Gastado {formatCompactCurrency(project.spent)}</span>
                  <span className={project.debt > 0 ? 'text-rose-600' : 'text-emerald-600'}>
                    Debe {formatCompactCurrency(project.debt)}
                  </span>
                </div>
              </Link>
            ))}
            {!loading && projectAlerts.length === 0 && (
              <div className="px-4 py-10 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">
                Sin alertas financieras
              </div>
            )}
            {loading && (
              <div className="px-4 py-10 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">
                Analizando proyectos...
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Resumen por proyecto</h2>
            <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mt-0.5">Presupuesto, gasto registrado, pagos y deuda</p>
          </div>
          <TrendingUp className="w-4 h-4 text-slate-300" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-400">Proyecto</th>
                <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-400">Estado</th>
                <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-400 text-right">Presupuesto</th>
                <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-400 text-right">Gastado</th>
                <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-400 text-right">Pagado</th>
                <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-400 text-right">Deuda</th>
                <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-400 text-right">Uso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projects.slice(0, 10).map((project) => (
                <tr key={project.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-3">
                    <Link to={`/proyectos/${project.id}`} className="text-xs font-bold text-slate-900 hover:underline">
                      {project.name}
                    </Link>
                    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-300">{project.clientName || 'Sin cliente'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 bg-slate-50 border border-slate-100 rounded px-2 py-1">
                      {project.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-xs font-bold text-slate-500">{formatCurrency(project.budgetTotal)}</td>
                  <td className="px-4 py-3 text-right text-xs font-bold text-slate-700">{formatCurrency(project.spent)}</td>
                  <td className="px-4 py-3 text-right text-xs font-bold text-emerald-600">{formatCurrency(project.paid)}</td>
                  <td className="px-4 py-3 text-right text-xs font-black text-rose-600">{formatCurrency(project.debt)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn(
                      'text-[10px] font-black',
                      project.overBudget > 0 ? 'text-rose-600' : project.usagePercent >= 85 ? 'text-yellow-600' : 'text-slate-500'
                    )}>
                      {project.usagePercent}%
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && projects.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">
                    No hay proyectos visibles
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">Pipeline operativo</div>
          <h2 className="text-lg font-bold text-slate-900">Estado de producciones</h2>
        </div>

        <DragDropContext onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2 min-h-[420px] items-start">
            {PROJECT_STATUSES.map((status, i) => {
              const columnProjects = getProjectsByStatus(status);
              const columnBudget = columnProjects.reduce((sum, project) => sum + project.budgetTotal, 0);

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
                    <div className="text-sm font-bold text-slate-900 leading-none">
                      {formatCompactCurrency(columnBudget)}
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
                          columnProjects.map((project, index) => (
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
                                      <div className="flex justify-between items-center text-[9px] font-bold">
                                        <span className="text-slate-900">{formatCompactCurrency(project.budgetTotal)}</span>
                                        <span className={project.debt > 0 ? 'text-rose-600' : 'text-emerald-600'}>
                                          {formatCompactCurrency(project.debt)}
                                        </span>
                                      </div>
                                      <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                                        <div
                                          className={cn(
                                            'h-full rounded-full',
                                            project.overBudget > 0 ? 'bg-rose-500' : project.usagePercent >= 85 ? 'bg-yellow-400' : 'bg-slate-900'
                                          )}
                                          style={{ width: `${Math.min(project.usagePercent, 100)}%` }}
                                        />
                                      </div>
                                    </div>
                                  </Link>
                                </div>
                              )}
                            </DraggableComponent>
                          ))
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
      </section>
    </div>
  );
}
