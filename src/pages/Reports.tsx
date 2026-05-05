import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BarChart3, Building2, CalendarDays, Download, FileSpreadsheet, Layers3, ReceiptText, Wallet } from 'lucide-react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cn } from '../lib/utils';
import { buildPaymentBuckets, formatDateKey, formatPeriodLabel, formatScheduleDate, getOverdueLines, getTodayLines, getUnscheduledLines, sumDebt, type PaymentScheduleLine, type PaymentScheduleView } from '../lib/paymentSchedule';

type ReportView = 'resumen' | 'proyectos' | 'proveedores' | 'areas' | 'pagos';

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
  paymentDate?: any;
  source: 'area' | 'budget';
}

interface ProjectReport {
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
  areaBudgets: Record<string, number>;
}

interface ProviderReport {
  key: string;
  name: string;
  total: number;
  paid: number;
  debt: number;
  items: number;
  projects: string[];
}

interface AreaReport {
  key: string;
  area: string;
  budget: number;
  spent: number;
  debt: number;
  projects: string[];
}

const reportTabs: Array<{ id: ReportView; label: string; icon: any }> = [
  { id: 'resumen', label: 'Resumen', icon: BarChart3 },
  { id: 'proyectos', label: 'Proyectos', icon: FileSpreadsheet },
  { id: 'proveedores', label: 'Proveedores', icon: Building2 },
  { id: 'areas', label: 'Areas', icon: Layers3 },
  { id: 'pagos', label: 'Proyección de Pagos', icon: CalendarDays },
];

const formatCurrency = (value: number) => `$${Math.round(value || 0).toLocaleString('es-AR')}`;

const formatPercent = (value: number) => `${Math.round(value || 0)}%`;

const getPaymentTotal = (item: any) => {
  const history = Array.isArray(item.paymentHistory) ? item.paymentHistory : [];
  return history.reduce((acc: number, payment: any) => acc + (Number(payment.amount) || 0), 0);
};

const getItemTotal = (item: any) => Number(item.total) || 0;

const csvEscape = (value: unknown) => {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};

const downloadCsv = (filename: string, rows: Array<Record<string, unknown>>) => {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const body = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n');
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const buildProjectReport = (project: any, budgetItems: any[], areaExpenses: any[]): ProjectReport => {
  const activeAreas = Array.isArray(project.activeAreas) ? project.activeAreas : [];
  const standaloneBudgetItems = budgetItems.filter((item) => !activeAreas.includes(item.area));
  const committedBudget = budgetItems.reduce((acc, item) => acc + getItemTotal(item), 0);
  const budgetTotal = Number(project.budgetTotal) || committedBudget;
  const areaBudgets = budgetItems.reduce((acc: Record<string, number>, item) => {
    const area = item.area || 'Sin area';
    acc[area] = (acc[area] || 0) + getItemTotal(item);
    return acc;
  }, {});

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
        paymentDate: item.paymentDate,
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
        paymentDate: item.paymentDate,
        source: 'budget' as const,
      };
    }),
  ];

  const spent = payableLines.reduce((acc, line) => acc + line.total, 0);
  const paid = payableLines.reduce((acc, line) => acc + line.paid, 0);
  const debt = payableLines.reduce((acc, line) => acc + line.debt, 0);
  const usagePercent = budgetTotal > 0 ? (spent / budgetTotal) * 100 : 0;

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
    unpaidLines: payableLines.filter((line) => line.debt > 0.01).length,
    payableLines,
    areaBudgets,
  };
};

export default function Reports() {
  const [projects, setProjects] = useState<ProjectReport[]>([]);
  const [activeView, setActiveView] = useState<ReportView>('resumen');
  const [loading, setLoading] = useState(true);
  const [paymentProjectionView, setPaymentProjectionView] = useState<PaymentScheduleView>('week');
  const [paymentProjectionAnchor, setPaymentProjectionAnchor] = useState(() => formatDateKey(new Date()));
  const [paymentProjectFilter, setPaymentProjectFilter] = useState('all');
  const [selectedPaymentBucketKey, setSelectedPaymentBucketKey] = useState<string | null>(null);

  useEffect(() => {
    const fetchReports = async () => {
      setLoading(true);
      try {
        const projectsSnap = await getDocs(query(collection(db, 'projects'), orderBy('createdAt', 'desc')));
        const projectRows = projectsSnap.docs.map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() as any }));

        const reports = await Promise.all(
          projectRows.map(async (project) => {
            const [budgetSnap, expensesSnap] = await Promise.all([
              getDocs(collection(db, 'projects', project.id, 'budgetItems')),
              getDocs(collection(db, 'projects', project.id, 'areaExpenses')),
            ]);

            const budgetItems = budgetSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }));
            const areaExpenses = expensesSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }));
            return buildProjectReport(project, budgetItems, areaExpenses);
          })
        );

        setProjects(reports);
      } catch (error) {
        console.error('Error loading reports:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchReports();
  }, []);

  const totals = useMemo(() => {
    const budget = projects.reduce((acc, project) => acc + project.budgetTotal, 0);
    const spent = projects.reduce((acc, project) => acc + project.spent, 0);
    const paid = projects.reduce((acc, project) => acc + project.paid, 0);
    const debt = projects.reduce((acc, project) => acc + project.debt, 0);
    const overBudget = projects.reduce((acc, project) => acc + project.overBudget, 0);
    const usagePercent = budget > 0 ? (spent / budget) * 100 : 0;

    return { budget, spent, paid, debt, overBudget, usagePercent };
  }, [projects]);

  const providerReports = useMemo(() => {
    const map = new Map<string, ProviderReport>();

    projects.forEach((project) => {
      project.payableLines.forEach((line) => {
        const key = line.providerId || line.providerName || 'sin-proveedor';
        const name = line.providerName || 'Sin proveedor asignado';

        if (!map.has(key)) {
          map.set(key, { key, name, total: 0, paid: 0, debt: 0, items: 0, projects: [] });
        }

        const item = map.get(key)!;
        item.total += line.total;
        item.paid += line.paid;
        item.debt += line.debt;
        item.items += 1;
        if (!item.projects.includes(project.name)) item.projects.push(project.name);
      });
    });

    return Array.from(map.values()).sort((a, b) => b.debt - a.debt);
  }, [projects]);

  const areaReports = useMemo(() => {
    const map = new Map<string, AreaReport>();

    projects.forEach((project) => {
      project.payableLines.forEach((line) => {
        const key = line.area || 'Sin area';
        if (!map.has(key)) {
          map.set(key, { key, area: key, budget: 0, spent: 0, debt: 0, projects: [] });
        }
        const item = map.get(key)!;
        item.spent += line.total;
        item.debt += line.debt;
        if (!item.projects.includes(project.name)) item.projects.push(project.name);
      });
    });

    projects.forEach((project) => {
      Object.entries(project.areaBudgets).forEach(([area, amount]) => {
        if (!map.has(area)) {
          map.set(area, { key: area, area, budget: 0, spent: 0, debt: 0, projects: [] });
        }
        const item = map.get(area)!;
        item.budget += Number(amount) || 0;
        if (!item.projects.includes(project.name)) {
          item.projects.push(project.name);
        }
      });
    });

    return Array.from(map.values()).sort((a, b) => b.spent - a.spent);
  }, [projects]);

  const paymentScheduleLines = useMemo<PaymentScheduleLine[]>(() => (
    projects.flatMap((project) => (
      project.payableLines.map((line) => ({
        id: `${project.id}-${line.source}-${line.id}`,
        projectId: project.id,
        projectName: project.name,
        area: line.area || 'Sin area',
        providerName: line.providerName || 'Sin proveedor asignado',
        description: line.description || 'Movimiento',
        total: line.total,
        paid: line.paid,
        debt: line.debt,
        paymentDate: line.paymentDate,
        source: line.source === 'area' ? 'Gestion por Areas' : 'Presupuesto Principal',
      }))
    ))
    .filter((line) => line.debt > 0.01)
  ), [projects]);

  const filteredPaymentScheduleLines = useMemo(() => (
    paymentProjectFilter === 'all'
      ? paymentScheduleLines
      : paymentScheduleLines.filter((line) => line.projectId === paymentProjectFilter)
  ), [paymentProjectFilter, paymentScheduleLines]);

  const paymentProjectionBuckets = useMemo(() => (
    buildPaymentBuckets(filteredPaymentScheduleLines, paymentProjectionAnchor, paymentProjectionView)
  ), [filteredPaymentScheduleLines, paymentProjectionAnchor, paymentProjectionView]);

  const selectedPaymentBucket = useMemo(() => {
    if (paymentProjectionBuckets.length === 0) return null;
    return paymentProjectionBuckets.find((bucket) => bucket.key === selectedPaymentBucketKey)
      || paymentProjectionBuckets.find((bucket) => bucket.isToday)
      || paymentProjectionBuckets[0];
  }, [paymentProjectionBuckets, selectedPaymentBucketKey]);

  const paymentProjectionStats = useMemo(() => {
    const periodLines = paymentProjectionBuckets.flatMap((bucket) => bucket.lines);
    const todayLines = getTodayLines(filteredPaymentScheduleLines);
    const overdueLines = getOverdueLines(filteredPaymentScheduleLines);
    const unscheduledLines = getUnscheduledLines(filteredPaymentScheduleLines);

    return {
      periodLines,
      periodDebt: sumDebt(periodLines),
      todayLines,
      todayDebt: sumDebt(todayLines),
      overdueLines,
      overdueDebt: sumDebt(overdueLines),
      unscheduledLines,
      unscheduledDebt: sumDebt(unscheduledLines),
    };
  }, [filteredPaymentScheduleLines, paymentProjectionBuckets]);

  const paymentByProject = useMemo(() => {
    const selectedProjects = paymentProjectFilter === 'all'
      ? projects
      : projects.filter((project) => project.id === paymentProjectFilter);
    const periodLines = paymentProjectionBuckets.flatMap((bucket) => bucket.lines);

    return selectedProjects.map((project) => {
      const lines = filteredPaymentScheduleLines.filter((line) => line.projectId === project.id);
      const todayLines = getTodayLines(lines);
      const overdueLines = getOverdueLines(lines);
      const unscheduledLines = getUnscheduledLines(lines);
      const projectPeriodLines = periodLines.filter((line) => line.projectId === project.id);

      return {
        id: project.id,
        name: project.name,
        today: sumDebt(todayLines),
        period: sumDebt(projectPeriodLines),
        overdue: sumDebt(overdueLines),
        unscheduled: sumDebt(unscheduledLines),
        items: lines.length,
      };
    })
    .filter((row) => row.today > 0 || row.period > 0 || row.overdue > 0 || row.unscheduled > 0)
    .sort((a, b) => b.period - a.period || b.overdue - a.overdue);
  }, [filteredPaymentScheduleLines, paymentProjectFilter, paymentProjectionBuckets, projects]);

  const attentionProjects = useMemo(() => (
    projects
      .filter((project) => project.overBudget > 0 || project.debt > 0 || project.usagePercent >= 85)
      .sort((a, b) => b.overBudget - a.overBudget || b.debt - a.debt || b.usagePercent - a.usagePercent)
      .slice(0, 8)
  ), [projects]);

  const exportProjects = () => downloadCsv('reporte-proyectos.csv', projects.map((project) => ({
    Proyecto: project.name,
    Cliente: project.clientName || '',
    Estado: project.status,
    Presupuesto: project.budgetTotal,
    Gastado: project.spent,
    Pagado: project.paid,
    Deuda: project.debt,
    Uso: formatPercent(project.usagePercent),
    Excedido: project.overBudget,
    Pendientes: project.unpaidLines,
  })));

  const exportProviders = () => downloadCsv('reporte-proveedores.csv', providerReports.map((provider) => ({
    Proveedor: provider.name,
    Total: provider.total,
    Pagado: provider.paid,
    Deuda: provider.debt,
    Partidas: provider.items,
    Proyectos: provider.projects.join(' / '),
  })));

  const exportAreas = () => downloadCsv('reporte-areas.csv', areaReports.map((area) => ({
    Area: area.area,
    Presupuesto: area.budget,
    Gastado: area.spent,
    Deuda: area.debt,
    Proyectos: area.projects.join(' / '),
  })));


  const exportPayments = () => downloadCsv('proyeccion-pagos.csv', filteredPaymentScheduleLines.map((line) => ({
    Fecha: line.paymentDate ? formatScheduleDate(line.paymentDate) : 'Sin fecha',
    Proyecto: line.projectName || '',
    Proveedor: line.providerName,
    Area: line.area,
    Concepto: line.description,
    Fuente: line.source || '',
    Total: line.total,
    Pagado: line.paid,
    Pendiente: line.debt,
  })));

  return (
    <div className="max-w-full mx-auto space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">Gestion ejecutiva</div>
          <h1 className="text-2xl font-light text-slate-900 leading-none">
            Reportes: <span className="font-bold text-black">Finanzas y Produccion</span>
          </h1>
          <p className="text-xs text-slate-500 mt-2 max-w-2xl">
            Consolidado de presupuesto, gasto real, pagos, deuda y desvio para tomar decisiones sin entrar proyecto por proyecto.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportProjects} className="px-3 py-2 bg-black text-white text-[10px] font-bold uppercase tracking-widest rounded flex items-center gap-2">
            <Download className="w-3 h-3" />
            Proyectos CSV
          </button>
          <button onClick={exportProviders} className="px-3 py-2 bg-white border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest rounded flex items-center gap-2 hover:border-black">
            <Download className="w-3 h-3" />
            Proveedores CSV
          </button>
          <button onClick={exportAreas} className="px-3 py-2 bg-white border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest rounded flex items-center gap-2 hover:border-black">
            <Download className="w-3 h-3" />
            Areas CSV
          </button>
          <button onClick={exportPayments} className="px-3 py-2 bg-white border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest rounded flex items-center gap-2 hover:border-black">
            <Download className="w-3 h-3" />
            Pagos CSV
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {[
          { label: 'Presupuesto', value: formatCurrency(totals.budget), icon: FileSpreadsheet },
          { label: 'Gastado', value: formatCurrency(totals.spent), icon: ReceiptText },
          { label: 'Pagado', value: formatCurrency(totals.paid), icon: Wallet },
          { label: 'Deuda', value: formatCurrency(totals.debt), icon: AlertTriangle },
          { label: 'Uso global', value: formatPercent(totals.usagePercent), icon: BarChart3 },
        ].map((item) => (
          <div key={item.label} className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[9px] text-slate-400 font-bold uppercase mb-1 tracking-wider">{item.label}</div>
                <div className="text-xl font-black text-slate-900 leading-none">{loading ? '...' : item.value}</div>
              </div>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-slate-50">
                <item.icon className="w-4 h-4 text-slate-500" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <nav className="flex gap-2 p-1 bg-slate-100 rounded-lg overflow-x-auto">
        {reportTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveView(tab.id)}
            className={cn(
              "px-4 py-2 text-[10px] uppercase font-bold tracking-widest rounded-md transition-all whitespace-nowrap flex items-center gap-2",
              activeView === tab.id ? "bg-white text-black shadow-sm" : "text-slate-400 hover:text-slate-700"
            )}
          >
            <tab.icon className="w-3 h-3" />
            {tab.label}
          </button>
        ))}
      </nav>

      {activeView === 'resumen' && (
        <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_0.9fr] gap-4">
          <section className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900">Proyectos que requieren atencion</h2>
              <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mt-0.5">Excesos, deuda pendiente o consumo alto</p>
            </div>
            <div className="divide-y divide-slate-100">
              {attentionProjects.map((project) => (
                <Link key={project.id} to={`/proyectos/${project.id}`} className="block px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">{project.name}</div>
                      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-1">{project.status} / {project.clientName || 'Sin cliente'}</div>
                    </div>
                    <div className={cn("text-[10px] font-black px-2 py-1 rounded border", project.overBudget > 0 ? "bg-rose-50 text-rose-700 border-rose-100" : "bg-yellow-50 text-yellow-700 border-yellow-100")}>
                      {formatPercent(project.usagePercent)}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-bold">
                    <span className="text-slate-400">Gastado <b className="text-slate-800">{formatCurrency(project.spent)}</b></span>
                    <span className="text-slate-400">Pagado <b className="text-emerald-600">{formatCurrency(project.paid)}</b></span>
                    <span className="text-slate-400">Debe <b className="text-rose-600">{formatCurrency(project.debt)}</b></span>
                  </div>
                </Link>
              ))}
              {!loading && attentionProjects.length === 0 && (
                <div className="px-4 py-10 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">Sin alertas financieras</div>
              )}
            </div>
          </section>

          <section className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900">Distribucion por estado</h2>
              <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mt-0.5">Cantidad y gasto por etapa</p>
            </div>
            <div className="divide-y divide-slate-100">
              {['Presupuesto', 'Pre Produccion', 'Rodaje', 'Post', 'Aprobado'].map((status) => {
                const normalized = status === 'Pre Produccion' ? 'Pre Producción' : status;
                const rows = projects.filter((project) => project.status === normalized);
                const spent = rows.reduce((acc, project) => acc + project.spent, 0);
                return (
                  <div key={status} className="px-4 py-3 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs font-bold text-slate-900">{status}</div>
                      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-300">{rows.length} proyectos</div>
                    </div>
                    <div className="text-right text-xs font-black text-slate-700">{formatCurrency(spent)}</div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {activeView === 'proyectos' && (
        <ReportTable
          emptyLabel="No hay proyectos para reportar"
          headers={['Proyecto', 'Estado', 'Presupuesto', 'Gastado', 'Pagado', 'Deuda', 'Uso']}
          rows={projects.map((project) => ({
            key: project.id,
            cells: [
              <Link to={`/proyectos/${project.id}`} className="font-bold text-slate-900 hover:underline">{project.name}<div className="text-[9px] uppercase tracking-widest text-slate-300">{project.clientName || 'Sin cliente'}</div></Link>,
              project.status,
              formatCurrency(project.budgetTotal),
              formatCurrency(project.spent),
              formatCurrency(project.paid),
              <span className={project.debt > 0 ? 'text-rose-600 font-black' : 'text-emerald-600 font-black'}>{formatCurrency(project.debt)}</span>,
              formatPercent(project.usagePercent),
            ],
          }))}
        />
      )}

      {activeView === 'proveedores' && (
        <ReportTable
          emptyLabel="No hay proveedores con movimientos"
          headers={['Proveedor', 'Proyectos', 'Total', 'Pagado', 'Deuda', 'Partidas']}
          rows={providerReports.map((provider) => ({
            key: provider.key,
            cells: [
              <span className="font-bold text-slate-900">{provider.name}</span>,
              provider.projects.join(' / '),
              formatCurrency(provider.total),
              formatCurrency(provider.paid),
              <span className={provider.debt > 0 ? 'text-rose-600 font-black' : 'text-emerald-600 font-black'}>{formatCurrency(provider.debt)}</span>,
              provider.items,
            ],
          }))}
        />
      )}

      {activeView === 'areas' && (
        <ReportTable
          emptyLabel="No hay areas con movimientos"
          headers={['Area', 'Proyectos', 'Presupuesto usado', 'Gastado', 'Deuda']}
          rows={areaReports.map((area) => ({
            key: area.key,
            cells: [
              <span className="font-bold text-slate-900">{area.area}</span>,
              area.projects.join(' / '),
              formatCurrency(area.budget),
              formatCurrency(area.spent),
              <span className={area.debt > 0 ? 'text-rose-600 font-black' : 'text-emerald-600 font-black'}>{formatCurrency(area.debt)}</span>,
            ],
          }))}
        />
      )}


      {activeView === 'pagos' && (
        <div className="space-y-4">
          <section className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h2 className="text-sm font-black text-slate-900">Proyección de Pagos</h2>
                <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mt-1">
                  Todos los proyectos · {formatPeriodLabel(paymentProjectionAnchor, paymentProjectionView)}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select
                  value={paymentProjectFilter}
                  onChange={(event) => {
                    setPaymentProjectFilter(event.target.value);
                    setSelectedPaymentBucketKey(null);
                  }}
                  className="px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg text-xs font-bold focus:outline-none focus:border-black"
                >
                  <option value="all">Todos los proyectos</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
                <div className="flex p-1 bg-slate-100 rounded-lg">
                  {(['week', 'month'] as PaymentScheduleView[]).map((view) => (
                    <button
                      key={view}
                      type="button"
                      onClick={() => {
                        setPaymentProjectionView(view);
                        setSelectedPaymentBucketKey(null);
                      }}
                      className={cn(
                        "flex-1 px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-widest transition-all",
                        paymentProjectionView === view ? "bg-white text-black shadow-sm" : "text-slate-400 hover:text-slate-700"
                      )}
                    >
                      {view === 'week' ? 'Semana' : 'Mes'}
                    </button>
                  ))}
                </div>
                <input
                  type="date"
                  value={paymentProjectionAnchor}
                  onChange={(event) => {
                    setPaymentProjectionAnchor(event.target.value);
                    setSelectedPaymentBucketKey(null);
                  }}
                  className="px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg text-xs font-bold focus:outline-none focus:border-black"
                />
              </div>
            </div>

            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 border-b border-slate-100">
              {[
                { label: 'A pagar hoy', value: paymentProjectionStats.todayDebt, count: paymentProjectionStats.todayLines.length, tone: 'text-slate-900' },
                { label: paymentProjectionView === 'week' ? 'A pagar semana' : 'A pagar mes', value: paymentProjectionStats.periodDebt, count: paymentProjectionStats.periodLines.length, tone: 'text-blue-700' },
                { label: 'Vencidos', value: paymentProjectionStats.overdueDebt, count: paymentProjectionStats.overdueLines.length, tone: 'text-rose-600' },
                { label: 'Sin fecha', value: paymentProjectionStats.unscheduledDebt, count: paymentProjectionStats.unscheduledLines.length, tone: 'text-amber-600' },
                { label: 'Total proyectado', value: sumDebt(filteredPaymentScheduleLines), count: filteredPaymentScheduleLines.length, tone: 'text-slate-900' },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-slate-100 bg-slate-50/50 p-4">
                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{item.label}</div>
                  <div className={cn("mt-1 text-xl font-black font-mono", item.tone)}>{formatCurrency(item.value)}</div>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-slate-300 mt-1">{item.count} pagos</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px]">
              <div className="p-4 border-b xl:border-b-0 xl:border-r border-slate-100">
                <div className="h-64 rounded-xl border border-slate-100 bg-gradient-to-b from-slate-50 to-white p-4 flex items-end gap-2 overflow-x-auto">
                  {paymentProjectionBuckets.map((bucket) => {
                    const maxTotal = Math.max(...paymentProjectionBuckets.map((item) => item.total), 1);
                    const isSelected = selectedPaymentBucket?.key === bucket.key;
                    const height = bucket.total > 0 ? Math.max(12, (bucket.total / maxTotal) * 170) : 6;
                    return (
                      <button
                        key={bucket.key}
                        type="button"
                        onClick={() => setSelectedPaymentBucketKey(bucket.key)}
                        className="min-w-[82px] flex-1 h-full flex flex-col justify-end items-center gap-2 group"
                        title={`${bucket.label}: ${formatCurrency(bucket.total)}`}
                      >
                        <div className="text-[9px] font-black text-slate-500 font-mono">{formatCurrency(bucket.total)}</div>
                        <div
                          className={cn(
                            "w-full rounded-t-xl transition-all border",
                            isSelected ? "bg-slate-900 border-slate-900" : bucket.isToday ? "bg-blue-600 border-blue-600" : "bg-slate-300 border-slate-300 group-hover:bg-slate-500 group-hover:border-slate-500"
                          )}
                          style={{ height }}
                        />
                        <div className="text-center">
                          <div className={cn("text-[9px] font-black uppercase tracking-widest", isSelected ? "text-slate-900" : "text-slate-400")}>{bucket.shortLabel}</div>
                          <div className="text-[8px] text-slate-300 font-bold uppercase tracking-widest">{bucket.count} pagos</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <aside className="p-4 bg-slate-50/50">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h3 className="text-xs font-black text-slate-900">{selectedPaymentBucket?.label || 'Sin selección'}</h3>
                    <p className="text-[9px] uppercase font-bold tracking-widest text-slate-400">Pagos dentro del rango seleccionado</p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-black font-mono text-slate-900">{formatCurrency(selectedPaymentBucket?.total || 0)}</div>
                    <div className="text-[9px] uppercase font-bold tracking-widest text-slate-300">Total</div>
                  </div>
                </div>
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {(selectedPaymentBucket?.lines || []).map((line) => (
                    <div key={line.id} className="rounded-lg border border-slate-100 bg-white p-3">
                      <div className="flex justify-between gap-3">
                        <div className="min-w-0">
                          <Link to={`/proyectos/${line.projectId}`} className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-black truncate block">
                            {line.projectName}
                          </Link>
                          <div className="text-xs font-black text-slate-900 truncate">{line.providerName}</div>
                          <div className="text-[10px] text-slate-500 truncate">{line.description}</div>
                          <div className="text-[9px] uppercase font-bold tracking-widest text-slate-300 mt-1">{line.area} · {line.source}</div>
                        </div>
                        <div className="text-right text-xs font-black font-mono text-rose-600 whitespace-nowrap">{formatCurrency(line.debt)}</div>
                      </div>
                    </div>
                  ))}
                  {selectedPaymentBucket && selectedPaymentBucket.lines.length === 0 && (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">
                      Sin pagos programados
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </section>

          <ReportTable
            emptyLabel="No hay proyección de pagos por proyecto"
            headers={['Proyecto', 'Hoy', paymentProjectionView === 'week' ? 'Semana' : 'Mes', 'Vencidos', 'Sin fecha', 'Partidas']}
            rows={paymentByProject.map((row) => ({
              key: row.id,
              cells: [
                <Link to={`/proyectos/${row.id}`} className="font-bold text-slate-900 hover:underline">{row.name}</Link>,
                formatCurrency(row.today),
                <span className="font-black text-blue-700">{formatCurrency(row.period)}</span>,
                <span className={row.overdue > 0 ? 'text-rose-600 font-black' : 'text-slate-400'}>{formatCurrency(row.overdue)}</span>,
                <span className={row.unscheduled > 0 ? 'text-amber-600 font-black' : 'text-slate-400'}>{formatCurrency(row.unscheduled)}</span>,
                row.items,
              ],
            }))}
          />
        </div>
      )}
    </div>
  );
}

function ReportTable({
  headers,
  rows,
  emptyLabel,
}: {
  headers: string[];
  rows: Array<{ key: string; cells: ReactNode[] }>;
  emptyLabel: string;
}) {
  return (
    <section className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              {headers.map((header) => (
                <th key={header} className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-400">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.key} className="hover:bg-slate-50/60 transition-colors">
                {row.cells.map((cell, index) => (
                  <td key={index} className="px-4 py-3 text-xs text-slate-600 max-w-[320px] truncate">{cell}</td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={headers.length} className="px-4 py-10 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300">
                  {emptyLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
