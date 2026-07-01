import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BarChart3, Building2, CalendarDays, DollarSign, Download, FileSpreadsheet, FileText, Layers3, ReceiptText, Wallet } from 'lucide-react';
import { collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { deleteObject, ref } from 'firebase/storage';
import { db, storage } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { buildPaymentCalendarDays, formatDateKey, formatPeriodLabel, formatScheduleDate, getOverdueLines, getTodayLines, getUnscheduledLines, sumDebt, type PaymentScheduleLine } from '../lib/paymentSchedule';
import { formatIdentifier, inferLegacyIdentifiers, normalizeProviderText, providerDisplayName, providerMatchesSearch } from '../lib/providerConstants';
import { PaymentModal } from './project-detail/PaymentModal';
import type { Payment, PaymentCollection } from './project-detail/types';

type ReportView = 'resumen' | 'proyectos' | 'proveedores' | 'areas' | 'pagos';

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
        invoice: item.invoice,
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

const recalculateProjectTotals = (project: ProjectReport): ProjectReport => {
  const spent = project.payableLines.reduce((acc, line) => acc + line.total, 0);
  const paid = project.payableLines.reduce((acc, line) => acc + line.paid, 0);
  const debt = project.payableLines.reduce((acc, line) => acc + line.debt, 0);
  const usagePercent = project.budgetTotal > 0 ? (spent / project.budgetTotal) * 100 : 0;

  return {
    ...project,
    spent,
    paid,
    debt,
    usagePercent,
    overBudget: Math.max(0, spent - project.budgetTotal),
    unpaidLines: project.payableLines.filter((line) => line.debt > 0.01).length,
  };
};

export default function Reports() {
  const { user, profile } = useAuth();
  const [projects, setProjects] = useState<ProjectReport[]>([]);
  const [activeView, setActiveView] = useState<ReportView>('resumen');
  const [loading, setLoading] = useState(true);
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

  const canEditPaymentRecord = () => true;

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

      await updateDoc(doc(db, 'projects', selectedPaymentLine.projectId, selectedPaymentLine.collectionName, selectedPaymentLine.item.id), {
        paymentHistory: updatedHistory,
        paid: isFullyPaid,
        updatedAt: serverTimestamp(),
      });

      if (paymentToDelete.receipt?.path) {
        deleteObject(ref(storage, paymentToDelete.receipt.path)).catch(() => {});
      }

      if (paymentToDelete.cashMovementId) {
        await deleteDoc(doc(db, 'projects', selectedPaymentLine.projectId, 'cashMovements', paymentToDelete.cashMovementId));
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
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between border-b border-slate-200 pb-6">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">GB GOAT / Reportes</div>
          <h1 className="text-2xl font-bold text-black leading-none">Finanzas y producción</h1>
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
        canUseCashBox={false}
        cashBoxBalance={0}
        paymentType={selectedPaymentLine?.collectionName || 'areaExpenses'}
        isDeletingPayment={isDeletingPayment}
        canEditExistingPayments
        currentUserEmail={currentUserEmail}
        currentUserId={user?.uid || ''}
        currentUserName={currentUserName}
        currentUserRole="admin"
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
