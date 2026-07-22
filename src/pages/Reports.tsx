import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BarChart3, CalendarDays, DollarSign, Download, FileSpreadsheet, FileText, ReceiptText, Search, Wallet } from 'lucide-react';
import { collection, doc, getDocs, orderBy, query, serverTimestamp, writeBatch } from 'firebase/firestore';
import { deleteObject, ref } from 'firebase/storage';
import { db, storage } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { buildPaymentCalendarDays, formatDateKey, formatPeriodLabel, formatScheduleDate, getOverdueLines, getTodayLines, getUnscheduledLines, sumDebt, type PaymentScheduleLine } from '../lib/paymentSchedule';
import { formatIdentifier, inferLegacyIdentifiers, normalizeProviderText, providerDisplayName, providerMatchesSearch } from '../lib/providerConstants';
import { PaymentModal } from './project-detail/PaymentModal';
import type { Payment, PaymentCollection } from './project-detail/types';
import { calculateProjectFinance, calculateProjectResult, getItemTotal, getPaymentTotal, getStandaloneBudgetItems } from '../lib/projectFinance';
import { PageHeader } from '../components/PageHeader';
import { getPrimaryExpenseInvoice } from '../lib/invoices';

type ReportView = 'resumen' | 'proyectos' | 'pagos';

interface PayableLine {
  id: string;
  projectId: string;
  projectName: string;
  projectStatus: string;
  collectionName: PaymentCollection;
  item: any;
  area: string;
  providerId?: string;
  providerName?: string;
  providerCuit?: string;
  cbu?: string;
  description?: string;
  total: number;
  paid: number;
  debt: number;
  paymentDate?: any;
  invoice?: any;
  source: 'area' | 'budget';
}

type ReportPaymentScheduleLine = PaymentScheduleLine & {
  collectionName: PaymentCollection;
  item: any;
  invoice?: any;
  providerCuit?: string;
};

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
  margin: number;
  marginPercent: number;
  overBudget: number;
  unpaidLines: number;
  payableLines: PayableLine[];
}

const reportTabs: Array<{ id: ReportView; label: string; icon: any }> = [
  { id: 'resumen', label: 'Resumen', icon: BarChart3 },
  { id: 'proyectos', label: 'Proyectos', icon: FileSpreadsheet },
  { id: 'pagos', label: 'Proyección de Pagos', icon: CalendarDays },
];

const formatCurrency = (value: number) => `$${Math.round(value || 0).toLocaleString('es-AR')}`;

const formatPercent = (value: number) => `${Math.round(value || 0)}%`;

const findProviderForLine = (item: any, providerById: Map<string, any>, providers: any[]) => {
  if (item.providerId && providerById.has(item.providerId)) return providerById.get(item.providerId);
  const providerName = normalizeProviderText(item.providerName);
  if (!providerName) return null;

  const exactMatches = providers.filter((provider) => normalizeProviderText(providerDisplayName(provider)) === providerName);
  if (exactMatches.length === 1) return exactMatches[0];

  const searchMatches = providers.filter((provider) => providerMatchesSearch(provider, item.providerName || ''));
  return searchMatches.length === 1 ? searchMatches[0] : null;
};

const getProviderPaymentDetails = (item: any, providerById: Map<string, any>, providers: any[]) => {
  const provider = findProviderForLine(item, providerById, providers);
  const providerIdentifiers = inferLegacyIdentifiers(provider || item);
  return {
    providerCuit: provider?.cuit || providerIdentifiers.cuitNormalized || item.providerCuit || '',
    cbu: provider?.bankAccount_cbu || provider?.bankAccount || item.cbu || item.bankAccount_cbu || item.bankAccount || '',
  };
};

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

const buildProjectReport = (
  project: any,
  budgetItems: any[],
  areaExpenses: any[],
  providerById: Map<string, any>,
  providers: any[],
): ProjectReport => {
  const standaloneBudgetItems = getStandaloneBudgetItems(project, budgetItems);
  const finance = calculateProjectFinance(project, budgetItems, areaExpenses);
  const result = calculateProjectResult(project, budgetItems, areaExpenses);
  const payableLines: PayableLine[] = [
    ...areaExpenses.map((item) => {
      const total = getItemTotal(item);
      const paid = getPaymentTotal(item);
      const providerDetails = getProviderPaymentDetails(item, providerById, providers);
      return {
        id: item.id,
        projectId: project.id,
        projectName: project.name || 'Sin nombre',
        projectStatus: project.status || 'Presupuesto',
        collectionName: 'areaExpenses' as const,
        item,
        area: item.area || 'Sin area',
        providerId: item.providerId,
        providerName: item.providerName,
        providerCuit: providerDetails.providerCuit,
        cbu: providerDetails.cbu,
        description: item.description,
        total,
        paid,
        debt: Math.max(0, total - paid),
        paymentDate: item.paymentDate,
        invoice: getPrimaryExpenseInvoice(item),
        source: 'area' as const,
      };
    }),
    ...standaloneBudgetItems.map((item) => {
      const total = getItemTotal(item);
      const paid = getPaymentTotal(item);
      const providerDetails = getProviderPaymentDetails(item, providerById, providers);
      return {
        id: item.id,
        projectId: project.id,
        projectName: project.name || 'Sin nombre',
        projectStatus: project.status || 'Presupuesto',
        collectionName: 'budgetItems' as const,
        item,
        area: item.area || 'Sin area',
        providerId: item.providerId,
        providerName: item.providerName,
        providerCuit: providerDetails.providerCuit,
        cbu: providerDetails.cbu,
        description: item.description,
        total,
        paid,
        debt: Math.max(0, total - paid),
        paymentDate: item.paymentDate,
        invoice: getPrimaryExpenseInvoice(item),
        source: 'budget' as const,
      };
    }),
  ];

  return {
    id: project.id,
    name: project.name || 'Sin nombre',
    status: project.status || 'Presupuesto',
    clientName: project.clientName,
    budgetTotal: finance.budgetTotal,
    committedBudget: finance.committedBudget,
    spent: result.totalCost,
    paid: finance.paid,
    debt: finance.debt,
    usagePercent: result.saleValue > 0 ? (result.totalCost / result.saleValue) * 100 : 0,
    margin: result.margin,
    marginPercent: result.marginPercent,
    overBudget: Math.max(0, result.totalCost - result.saleValue),
    unpaidLines: finance.unpaidLines,
    payableLines,
  };
};

const recalculateProjectTotals = (project: ProjectReport): ProjectReport => {
  const paid = project.payableLines.reduce((acc, line) => acc + line.paid, 0);
  const debt = project.payableLines.reduce((acc, line) => acc + line.debt, 0);

  return {
    ...project,
    paid,
    debt,
    unpaidLines: project.payableLines.filter((line) => line.debt > 0.01).length,
  };
};

export default function Reports() {
  const { user, profile } = useAuth();
  const [projects, setProjects] = useState<ProjectReport[]>([]);
  const [activeView, setActiveView] = useState<ReportView>('resumen');
  const [loading, setLoading] = useState(true);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectStatusFilter, setProjectStatusFilter] = useState('all');
  const [paymentProjectionAnchor, setPaymentProjectionAnchor] = useState(() => formatDateKey(new Date()));
  const [paymentProjectFilter, setPaymentProjectFilter] = useState('all');
  const [selectedPaymentBucketKey, setSelectedPaymentBucketKey] = useState<string | null>(null);
  const [expandedPaymentLineId, setExpandedPaymentLineId] = useState<string | null>(null);
  const [copiedPaymentLineId, setCopiedPaymentLineId] = useState<string | null>(null);
  const [selectedPaymentLine, setSelectedPaymentLine] = useState<ReportPaymentScheduleLine | null>(null);
  const [isDeletingPayment, setIsDeletingPayment] = useState<number | null>(null);

  useEffect(() => {
    const fetchReports = async () => {
      setLoading(true);
      try {
        const [projectsSnap, providersSnap] = await Promise.all([
          getDocs(query(collection(db, 'projects'), orderBy('createdAt', 'desc'))),
          getDocs(collection(db, 'providers')),
        ]);
        const projectRows = projectsSnap.docs.map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() as any }));
        const providers = providersSnap.docs.map((providerDoc) => ({ id: providerDoc.id, ...providerDoc.data() }));
        const providerById = new Map(providers.map((provider) => [provider.id, provider]));

        const reports = await Promise.all(
          projectRows.map(async (project) => {
            const [budgetSnap, expensesSnap] = await Promise.all([
              getDocs(collection(db, 'projects', project.id, 'budgetItems')),
              getDocs(collection(db, 'projects', project.id, 'areaExpenses')),
            ]);

            const budgetItems = budgetSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }));
            const areaExpenses = expensesSnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }));
            return buildProjectReport(project, budgetItems, areaExpenses, providerById, providers);
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
    const usagePercent = budget > 0 ? (spent / budget) * 100 : 0;
    const margin = projects.reduce((acc, project) => acc + project.margin, 0);
    const marginPercent = budget > 0 ? (margin / budget) * 100 : 0;

    return { budget, spent, paid, debt, usagePercent, margin, marginPercent };
  }, [projects]);

  const projectStatuses = useMemo(() => Array.from(new Set(projects.map((project) => project.status))).sort(), [projects]);
  const filteredProjects = useMemo(() => {
    const search = projectSearch.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesStatus = projectStatusFilter === 'all' || project.status === projectStatusFilter;
      const matchesSearch = !search || `${project.name} ${project.clientName || ''}`.toLowerCase().includes(search);
      return matchesStatus && matchesSearch;
    });
  }, [projectSearch, projectStatusFilter, projects]);

  const paymentScheduleLines = useMemo<ReportPaymentScheduleLine[]>(() => (
    projects.flatMap((project) => (
      project.payableLines.map((line) => ({
        id: `${project.id}-${line.source}-${line.id}`,
        projectId: project.id,
        projectName: project.name,
        collectionName: line.collectionName,
        item: line.item,
        area: line.area || 'Sin area',
        providerName: line.providerName || 'Sin proveedor asignado',
        providerCuit: line.providerCuit,
        cbu: line.cbu,
        description: line.description || 'Movimiento',
        total: line.total,
        paid: line.paid,
        debt: line.debt,
        paymentDate: line.paymentDate,
        source: line.source === 'area' ? 'Gestion por Areas' : 'Presupuesto Principal',
        invoice: line.invoice,
      }))
    ))
    .filter((line) => line.debt > 0.01)
  ), [projects]);

  const filteredPaymentScheduleLines = useMemo(() => (
    paymentProjectFilter === 'all'
      ? paymentScheduleLines
      : paymentScheduleLines.filter((line) => line.projectId === paymentProjectFilter)
  ), [paymentProjectFilter, paymentScheduleLines]);

  const paymentProjectionCalendarDays = useMemo(() => (
    buildPaymentCalendarDays(filteredPaymentScheduleLines, paymentProjectionAnchor)
  ), [filteredPaymentScheduleLines, paymentProjectionAnchor]);

  const selectedPaymentBucket = useMemo(() => {
    if (paymentProjectionCalendarDays.length === 0) return null;
    return paymentProjectionCalendarDays.find((bucket) => bucket.key === selectedPaymentBucketKey)
      || paymentProjectionCalendarDays.find((bucket) => bucket.isToday)
      || paymentProjectionCalendarDays.find((bucket) => bucket.isCurrentMonth)
      || paymentProjectionCalendarDays[0];
  }, [paymentProjectionCalendarDays, selectedPaymentBucketKey]);

  const paymentProjectionStats = useMemo(() => {
    const periodLines = paymentProjectionCalendarDays
      .filter((bucket) => bucket.isCurrentMonth)
      .flatMap((bucket) => bucket.lines);
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
  }, [filteredPaymentScheduleLines, paymentProjectionCalendarDays]);

  const paymentByProject = useMemo(() => {
    const selectedProjects = paymentProjectFilter === 'all'
      ? projects
      : projects.filter((project) => project.id === paymentProjectFilter);
    const periodLines = paymentProjectionCalendarDays
      .filter((bucket) => bucket.isCurrentMonth)
      .flatMap((bucket) => bucket.lines);

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
  }, [filteredPaymentScheduleLines, paymentProjectFilter, paymentProjectionCalendarDays, projects]);

  const currentUserEmail = (user?.email || '').trim().toLowerCase();
  const currentUserName = profile?.displayName || user?.displayName || currentUserEmail;

  const updatePaymentState = (
    itemId: string,
    collectionName: PaymentCollection,
    updatedHistory: Payment[],
    isFullyPaid: boolean
  ) => {
    setProjects((currentProjects) => currentProjects.map((project) => {
      if (selectedPaymentLine?.projectId && project.id !== selectedPaymentLine.projectId) return project;
      let didUpdateLine = false;
      const nextPayableLines = project.payableLines.map((line) => {
        if (line.id !== itemId || line.collectionName !== collectionName) return line;
        didUpdateLine = true;

        const paid = updatedHistory.reduce((acc, payment) => acc + (Number(payment.amount) || 0), 0);
        const debt = Math.max(0, line.total - paid);
        const nextItem = {
          ...line.item,
          paymentHistory: updatedHistory,
          paid: isFullyPaid,
        };

        return {
          ...line,
          item: nextItem,
          paid,
          debt,
        };
      });

      if (!didUpdateLine) return project;
      return recalculateProjectTotals({ ...project, payableLines: nextPayableLines });
    }));

    setSelectedPaymentLine((current) => {
      if (!current || current.item?.id !== itemId || current.collectionName !== collectionName) return current;
      const paid = updatedHistory.reduce((acc, payment) => acc + (Number(payment.amount) || 0), 0);
      const debt = Math.max(0, current.total - paid);
      return {
        ...current,
        paid,
        debt,
        item: {
          ...current.item,
          paymentHistory: updatedHistory,
          paid: isFullyPaid,
        },
      };
    });
  };

  const canEditPaymentRecord = () => profile?.role === 'admin';

  const deletePaymentFromSelectedLine = async (paymentIndex: number) => {
    if (!selectedPaymentLine?.projectId || !selectedPaymentLine.item?.id) return;
    if (!window.confirm('¿Borrar definitivamente este registro de pago?')) return;

    setIsDeletingPayment(paymentIndex);

    try {
      const currentHistory = Array.isArray(selectedPaymentLine.item.paymentHistory)
        ? [...selectedPaymentLine.item.paymentHistory]
        : [];
      const paymentToDelete = currentHistory[paymentIndex];
      if (!paymentToDelete) throw new Error('Índice de pago no válido.');

      const updatedHistory = currentHistory.filter((payment: Payment, index: number) => {
        if (paymentToDelete.id) return payment.id !== paymentToDelete.id;
        return index !== paymentIndex;
      });
      const totalPaid = updatedHistory.reduce((acc: number, payment: Payment) => acc + (Number(payment.amount) || 0), 0);
      const isFullyPaid = totalPaid >= ((Number(selectedPaymentLine.item.total) || 0) - 0.01);

      const batch = writeBatch(db);
      batch.update(doc(db, 'projects', selectedPaymentLine.projectId, selectedPaymentLine.collectionName, selectedPaymentLine.item.id), {
        paymentHistory: updatedHistory,
        paid: isFullyPaid,
        updatedAt: serverTimestamp(),
      });
      if (paymentToDelete.cashMovementId) {
        batch.delete(doc(db, 'projects', selectedPaymentLine.projectId, 'cashMovements', paymentToDelete.cashMovementId));
      }
      batch.set(doc(collection(db, 'projects', selectedPaymentLine.projectId, 'activityLog')), {
        action: 'payment_deleted',
        collectionName: selectedPaymentLine.collectionName,
        itemId: selectedPaymentLine.item.id,
        itemLabel: selectedPaymentLine.item.description || selectedPaymentLine.item.providerName || '',
        paymentId: paymentToDelete.id || '',
        amount: Number(paymentToDelete.amount) || 0,
        deletedCashMovementCount: paymentToDelete.cashMovementId ? 1 : 0,
        deletedBy: user?.uid || '',
        deletedByEmail: currentUserEmail,
        deletedByName: currentUserName,
        deletedByRole: profile?.role || 'colaborador',
        createdAt: serverTimestamp(),
      });
      await batch.commit();

      if (paymentToDelete.receipt?.path) {
        deleteObject(ref(storage, paymentToDelete.receipt.path)).catch(() => {});
      }

      updatePaymentState(selectedPaymentLine.item.id, selectedPaymentLine.collectionName, updatedHistory, isFullyPaid);
    } catch (error: any) {
      console.error('Error deleting payment:', error);
      alert('Error al eliminar el pago: ' + (error.message || 'Error desconocido'));
    } finally {
      setIsDeletingPayment(null);
    }
  };

  const attentionProjects = useMemo(() => (
    projects
      .filter((project) => project.margin <= 0 || project.marginPercent < 20)
      .sort((a, b) => a.marginPercent - b.marginPercent || a.margin - b.margin)
      .slice(0, 8)
  ), [projects]);

  const exportProjects = () => downloadCsv('reporte-proyectos.csv', projects.map((project) => ({
    Proyecto: project.name,
    Cliente: project.clientName || '',
    Estado: project.status,
    Presupuesto: project.budgetTotal,
    Gastos: project.spent,
    Margen: project.margin,
    'Margen %': formatPercent(project.marginPercent),
    Pagado: project.paid,
    Deuda: project.debt,
    Pendientes: project.unpaidLines,
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
      <PageHeader
        eyebrow="GB GOAT / Reportes"
        title="Márgenes de proyectos"
        actions={<>
          <button onClick={exportProjects} className="px-3 py-2 bg-black text-white text-[10px] font-bold uppercase tracking-widest rounded flex items-center gap-2">
            <Download className="w-3 h-3" />
            Proyectos CSV
          </button>
          <button onClick={exportPayments} className="px-3 py-2 bg-white border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest rounded flex items-center gap-2 hover:border-black">
            <Download className="w-3 h-3" />
            Pagos CSV
          </button>
        </>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {[
          { label: 'Presupuesto', value: formatCurrency(totals.budget), icon: FileSpreadsheet },
          { label: 'Gastos', value: formatCurrency(totals.spent), icon: ReceiptText },
          { label: 'Margen', value: formatCurrency(totals.margin), icon: Wallet, tone: totals.margin < 0 ? 'text-rose-600' : 'text-emerald-700' },
          { label: 'Margen %', value: formatPercent(totals.marginPercent), icon: BarChart3, tone: totals.marginPercent < 0 ? 'text-rose-600' : 'text-emerald-700' },
          { label: 'Deuda', value: formatCurrency(totals.debt), icon: AlertTriangle },
        ].map((item) => (
          <div key={item.label} className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[9px] text-slate-400 font-bold uppercase mb-1 tracking-wider">{item.label}</div>
                <div className={cn("text-xl font-black leading-none", item.tone || 'text-slate-900')}>{loading ? '...' : item.value}</div>
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
              <h2 className="text-sm font-bold text-slate-900">Márgenes a revisar</h2>
              <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mt-0.5">Proyectos sin margen o por debajo del 20%</p>
            </div>
            <div className="divide-y divide-slate-100">
              {attentionProjects.map((project) => (
                <Link key={project.id} to={`/proyectos/${project.id}`} className="block px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">{project.name}</div>
                      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-1">{project.status} / {project.clientName || 'Sin cliente'}</div>
                    </div>
                    <div className={cn("text-[10px] font-black px-2 py-1 rounded border", project.margin < 0 ? "bg-rose-50 text-rose-700 border-rose-100" : "bg-yellow-50 text-yellow-700 border-yellow-100")}>
                      {formatPercent(project.marginPercent)}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-bold">
                    <span className="text-slate-400">Presupuesto <b className="text-slate-800">{formatCurrency(project.budgetTotal)}</b></span>
                    <span className="text-slate-400">Gastos <b className="text-slate-800">{formatCurrency(project.spent)}</b></span>
                    <span className="text-slate-400">Margen <b className={project.margin < 0 ? 'text-rose-600' : 'text-emerald-700'}>{formatCurrency(project.margin)}</b></span>
                  </div>
                </Link>
              ))}
              {!loading && attentionProjects.length === 0 && (
                <div className="px-4 py-10 text-center text-[10px] font-bold uppercase tracking-widest text-emerald-600">Todos los proyectos conservan al menos 20% de margen</div>
              )}
            </div>
          </section>

          <section className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900">Margen por estado</h2>
              <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mt-0.5">Presupuesto, gastos y resultado por etapa</p>
            </div>
            <div className="divide-y divide-slate-100">
              {projectStatuses.map((status) => {
                const rows = projects.filter((project) => project.status === status);
                const budget = rows.reduce((acc, project) => acc + project.budgetTotal, 0);
                const spent = rows.reduce((acc, project) => acc + project.spent, 0);
                const margin = rows.reduce((acc, project) => acc + project.margin, 0);
                const marginPercent = budget > 0 ? (margin / budget) * 100 : 0;
                return (
                  <div key={status} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs font-bold text-slate-900">{status}</div>
                      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-300">{rows.length} proyectos</div>
                    </div>
                    <div className={cn("text-right text-xs font-black", margin < 0 ? 'text-rose-600' : 'text-emerald-700')}>{formatCurrency(margin)} · {formatPercent(marginPercent)}</div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      <span>Presupuesto <b className="text-slate-700">{formatCurrency(budget)}</b></span>
                      <span>Gastos <b className="text-slate-700">{formatCurrency(spent)}</b></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {activeView === 'proyectos' && (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded border border-slate-100 bg-slate-50 px-3 py-2">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input
                value={projectSearch}
                onChange={(event) => setProjectSearch(event.target.value)}
                placeholder="Buscar proyecto o cliente..."
                className="w-full bg-transparent text-xs font-bold text-slate-700 outline-none placeholder:text-slate-300"
              />
            </div>
            <select
              value={projectStatusFilter}
              onChange={(event) => setProjectStatusFilter(event.target.value)}
              className="rounded border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-black"
            >
              <option value="all">Todos los estados</option>
              {projectStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <div className="px-2 text-[9px] font-black uppercase tracking-widest text-slate-400">{filteredProjects.length} proyectos</div>
          </div>
          <ReportTable
            emptyLabel="No hay proyectos que coincidan con los filtros"
            headers={['Proyecto', 'Estado', 'Presupuesto', 'Gastos', 'Margen', 'Margen %', 'Deuda']}
            rows={filteredProjects.map((project) => ({
              key: project.id,
              cells: [
                <Link to={`/proyectos/${project.id}`} className="font-bold text-slate-900 hover:underline">{project.name}<div className="text-[9px] uppercase tracking-widest text-slate-300">{project.clientName || 'Sin cliente'}</div></Link>,
                project.status,
                formatCurrency(project.budgetTotal),
                formatCurrency(project.spent),
                <span className={project.margin < 0 ? 'text-rose-600 font-black' : 'text-emerald-700 font-black'}>{formatCurrency(project.margin)}</span>,
                <span className={project.marginPercent < 0 ? 'text-rose-600 font-black' : project.marginPercent < 20 ? 'text-amber-600 font-black' : 'text-emerald-700 font-black'}>{formatPercent(project.marginPercent)}</span>,
                <span className={project.debt > 0 ? 'text-rose-600 font-black' : 'text-slate-400 font-black'}>{formatCurrency(project.debt)}</span>,
              ],
            }))}
          />
        </div>
      )}


      {activeView === 'pagos' && (
        <div className="space-y-4">
          <section className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h2 className="text-sm font-black text-slate-900">Proyección de Pagos</h2>
                <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mt-1">
                  Todos los proyectos · {formatPeriodLabel(paymentProjectionAnchor, 'month')}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <select
                  value={paymentProjectFilter}
                  onChange={(event) => {
                    setPaymentProjectFilter(event.target.value);
                    setSelectedPaymentBucketKey(null);
                    setExpandedPaymentLineId(null);
                  }}
                  className="px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg text-xs font-bold focus:outline-none focus:border-black"
                >
                  <option value="all">Todos los proyectos</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const anchor = new Date(`${paymentProjectionAnchor}T12:00:00`);
                    setPaymentProjectionAnchor(formatDateKey(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1)));
                    setSelectedPaymentBucketKey(null);
                    setExpandedPaymentLineId(null);
                  }}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-[10px] font-black uppercase tracking-widest hover:border-black"
                >
                  Anterior
                </button>
                <label className="relative px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg text-xs font-bold text-slate-900 text-center cursor-pointer">
                  {formatPeriodLabel(paymentProjectionAnchor, 'month')}
                  <input
                    type="month"
                    value={paymentProjectionAnchor.slice(0, 7)}
                    onChange={(event) => {
                      setPaymentProjectionAnchor(`${event.target.value}-01`);
                      setSelectedPaymentBucketKey(null);
                      setExpandedPaymentLineId(null);
                    }}
                    className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const anchor = new Date(`${paymentProjectionAnchor}T12:00:00`);
                    setPaymentProjectionAnchor(formatDateKey(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1)));
                    setSelectedPaymentBucketKey(null);
                    setExpandedPaymentLineId(null);
                  }}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-[10px] font-black uppercase tracking-widest hover:border-black"
                >
                  Siguiente
                </button>
              </div>
            </div>

            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 border-b border-slate-100">
              {[
                { label: 'A pagar hoy', value: paymentProjectionStats.todayDebt, count: paymentProjectionStats.todayLines.length, tone: 'text-slate-900' },
                { label: 'A pagar mes', value: paymentProjectionStats.periodDebt, count: paymentProjectionStats.periodLines.length, tone: 'text-blue-700' },
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
                <div className="rounded-xl border border-slate-100 bg-white overflow-hidden">
                  <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-100">
                    {['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'].map((day) => (
                      <div key={day} className="px-2 py-2 text-center text-[9px] font-black uppercase tracking-widest text-slate-400">{day}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7">
                    {paymentProjectionCalendarDays.map((day) => {
                      const isSelected = selectedPaymentBucket?.key === day.key;
                      const hasPayments = day.count > 0;
                      const isHeavy = day.total >= paymentProjectionStats.periodDebt / 4 && paymentProjectionStats.periodDebt > 0;
                      return (
                        <button
                          key={day.key}
                          type="button"
                          onClick={() => {
                            setSelectedPaymentBucketKey(day.key);
                            setExpandedPaymentLineId(null);
                          }}
                          className={cn(
                            "min-h-[90px] border-r border-b border-slate-100 p-2 text-left transition-all hover:bg-slate-50",
                            !day.isCurrentMonth && "bg-slate-50/60 text-slate-300",
                            isSelected && "ring-2 ring-inset ring-slate-900 bg-white",
                            day.isToday && "bg-blue-50",
                            hasPayments && !isSelected && (isHeavy ? "bg-rose-50 hover:bg-rose-100" : "bg-amber-50 hover:bg-amber-100")
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={cn(
                              "inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black",
                              day.isToday ? "bg-blue-600 text-white" : "text-slate-700"
                            )}>
                              {day.dayNumber}
                            </span>
                            {hasPayments && <span className="text-[9px] font-black text-rose-600">{day.count}</span>}
                          </div>
                          {hasPayments && (
                            <div className="mt-3">
                              <div className="text-[10px] font-black font-mono text-slate-900">{formatCurrency(day.total)}</div>
                              <div className="mt-1 h-1.5 rounded-full bg-white/80 overflow-hidden">
                                <div
                                  className={cn("h-full rounded-full", isHeavy ? "bg-rose-500" : "bg-amber-500")}
                                  style={{ width: `${Math.min(100, Math.max(12, (day.total / Math.max(paymentProjectionStats.periodDebt, 1)) * 100))}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <aside className="p-4 bg-slate-50/50 flex min-h-[520px] flex-col">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h3 className="text-xs font-black text-slate-900">{selectedPaymentBucket ? formatScheduleDate(selectedPaymentBucket.date) : 'Sin seleccion'}</h3>
                    <p className="text-[9px] uppercase font-bold tracking-widest text-slate-400">Proveedores a pagar en el dia</p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-black font-mono text-slate-900">{formatCurrency(selectedPaymentBucket?.total || 0)}</div>
                    <div className="text-[9px] uppercase font-bold tracking-widest text-slate-300">Total</div>
                  </div>
                </div>
                <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
                  {(selectedPaymentBucket?.lines || []).map((line) => {
                    const reportLine = line as ReportPaymentScheduleLine;
                    const isExpanded = expandedPaymentLineId === reportLine.id;
                    return (
                    <div
                      key={reportLine.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpandedPaymentLineId(isExpanded ? null : reportLine.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setExpandedPaymentLineId(isExpanded ? null : reportLine.id);
                        }
                      }}
                      className={cn(
                        "w-full cursor-pointer rounded-lg border bg-white p-3 text-left transition-all",
                        isExpanded ? "border-slate-900 shadow-sm" : "border-slate-100 hover:border-slate-300"
                      )}
                    >
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
                      {isExpanded && (
                        <div className="mt-3 space-y-2 rounded-lg border border-slate-100 bg-slate-50 p-2">
                          <div>
                            <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Proyecto</div>
                            <Link
                              to={`/proyectos/${reportLine.projectId}`}
                              onClick={(event) => event.stopPropagation()}
                              className="mt-1 block truncate text-[10px] font-black uppercase tracking-widest text-slate-700 hover:text-black hover:underline"
                            >
                              {reportLine.projectName || 'Proyecto sin nombre'}
                            </Link>
                          </div>
                          {[
                            { label: 'CUIT', value: reportLine.providerCuit || '' },
                            { label: 'CBU / Alias', value: reportLine.cbu || '' },
                          ].map((copyItem) => (
                            <div key={copyItem.label}>
                              <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{copyItem.label}</div>
                              <div className="mt-1 flex items-center justify-between gap-2">
                                <span className="min-w-0 truncate font-mono text-[10px] font-bold text-slate-700">
                                  {copyItem.label === 'CUIT' && copyItem.value ? formatIdentifier(copyItem.value) : copyItem.value || 'No especificado'}
                                </span>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (!copyItem.value) return;
                                    void navigator.clipboard?.writeText(copyItem.value);
                                    setCopiedPaymentLineId(`${reportLine.id}-${copyItem.label}`);
                                    window.setTimeout(() => setCopiedPaymentLineId(null), 1800);
                                  }}
                                  disabled={!copyItem.value}
                                  className={cn(
                                    "shrink-0 rounded border px-2 py-1 text-[9px] font-black uppercase tracking-widest transition-colors",
                                    copiedPaymentLineId === `${reportLine.id}-${copyItem.label}`
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                      : copyItem.value
                                        ? "border-slate-200 bg-white text-slate-700 hover:border-black"
                                        : "border-slate-100 bg-white text-slate-300 cursor-not-allowed"
                                  )}
                                >
                                  {copiedPaymentLineId === `${reportLine.id}-${copyItem.label}` ? 'Copiado' : 'Copiar'}
                                </button>
                              </div>
                            </div>
                          ))}
                          <div className="flex flex-wrap gap-2 pt-1">
                            {reportLine.invoice?.url && (
                              <a
                                href={reportLine.invoice.url}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(event) => event.stopPropagation()}
                                className="inline-flex items-center gap-1 rounded border border-emerald-100 bg-emerald-50 px-2 py-1.5 text-[9px] font-black uppercase tracking-widest text-emerald-700 hover:bg-emerald-600 hover:text-white"
                                title={reportLine.invoice.fileName || 'Ver factura'}
                              >
                                <FileText className="h-3 w-3" />
                                Factura
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedPaymentLine({
                                  ...reportLine,
                                  item: { ...reportLine.item, __paymentCollection: reportLine.collectionName },
                                });
                                setIsDeletingPayment(null);
                              }}
                              className="inline-flex items-center gap-1 rounded border border-slate-900 bg-white px-2 py-1.5 text-[9px] font-black uppercase tracking-widest text-slate-900 hover:bg-slate-900 hover:text-white"
                            >
                              <DollarSign className="h-3 w-3" />
                              Cargar pago
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    );
                  })}
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
            headers={['Proyecto', 'Hoy', 'Mes', 'Vencidos', 'Sin fecha', 'Partidas']}
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
      <PaymentModal
        projectId={selectedPaymentLine?.projectId}
        item={selectedPaymentLine?.item || null}
        isOpen={Boolean(selectedPaymentLine)}
        canManagePayments={Boolean(selectedPaymentLine)}
        cashBoxOptions={[]}
        paymentType={selectedPaymentLine?.collectionName || 'areaExpenses'}
        isDeletingPayment={isDeletingPayment}
        canEditExistingPayments={profile?.role === 'admin'}
        currentUserEmail={currentUserEmail}
        currentUserId={user?.uid || ''}
        currentUserName={currentUserName}
        currentUserRole={profile?.role || 'colaborador'}
        canEditPaymentRecord={canEditPaymentRecord}
        onClose={() => setSelectedPaymentLine(null)}
        onPaymentStateChange={updatePaymentState}
        onDeletePayment={deletePaymentFromSelectedLine}
      />
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
