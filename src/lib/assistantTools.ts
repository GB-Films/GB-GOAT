import {
  canAssistantEditArea,
  canAssistantEditSubcategory,
  describeAssistantScope,
  type AssistantCapabilities,
} from './assistantCapabilities';
import { listAssistantHelpTopics, searchAssistantHelp } from './assistantHelp';
import {
  findProjectByReference,
  type AssistantProjectFinance,
  type AssistantProjectHandle,
} from './assistantData';
import { calculateCashBalances, calculateGeneralCashSummary } from './cashBoxes';
import { buildPaymentCalendarDays, getOverdueLines, getTodayLines, getUnscheduledLines, sumDebt } from './paymentSchedule';
import { hasRecordedPayment, sameExpenseVersion, samePaymentTarget } from './expenseEdits';
import { buildLinkedProviderInviteExpiration } from './providerInvites';
import { Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { normalizeEmail } from './identity';
import { storage } from './firebase';
import { getExpenseInvoices } from './invoices';
import { sanitizeFileName } from './files';
import { validateMaxUploadSize } from './uploadLimits';
import { calculateProjectResult } from './projectFinance';
import { collection, doc, getDocs, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { cleanAreaExpenseSubcategory } from './projectAccess';

export type AssistantBudgetItem = {
  id: string;
  area: string;
  providerId?: string;
  subcategory?: string;
  providerName?: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
  total?: number;
  paid?: boolean;
  paymentDate?: string;
  paymentHistory?: any[];
  paymentLocked?: boolean;
  order?: number;
  updatedAt?: any;
  createdAt?: any;
  providerInviteLink?: { token?: string; link?: string; status?: string } | null;
};

export type AssistantAreaExpense = AssistantBudgetItem & { subcategory?: string };

export type AssistantCashMovement = {
  id: string;
  type: string;
  amount?: number;
  status?: string;
  fromUserEmail?: string;
  toUserEmail?: string;
  fromUserName?: string;
  toUserName?: string;
  date?: any;
};

export type AssistantProvider = {
  id: string;
  name?: string;
  lastName?: string;
  businessName?: string;
  fullName?: string;
  type?: string;
  category?: string;
  cuit?: string;
  email?: string;
  phone?: string;
  address?: string;
  bankAccount_alias?: string;
  bankAccount_cbu?: string;
};

export type AssistantCollaborator = {
  email: string;
  displayName?: string;
  role?: string;
  allowedCategories?: string[];
  allowedSubcategories?: string[];
};

export type AssistantProjectDocument = {
  id: string;
  family?: string;
  type?: string;
  subtype?: string;
  title?: string;
  providerName?: string;
  area?: string;
  expirationDate?: string;
  notes?: string;
  fileName?: string;
  originalFileName?: string;
  url?: string;
  uploadedBy?: string;
  createdAt?: any;
};

export type AssistantProjectContext = {
  projectId: string;
  projectName: string;
  userEmail: string;
  capabilities: AssistantCapabilities;
  meta: {
    clientName?: string;
    companyName?: string;
    brandName?: string;
    status?: string;
    budgetTotal?: number;
    shootingStartDate?: string;
    shootingEndDate?: string;
    location?: string;
    projectCode?: string;
    resultIncidences?: Record<string, unknown>;
    areaExpenseSubcategories?: Record<string, string[]>;
    areaExpenseSubcategoryBudgets?: Record<string, any>;
  };
  categories: string[];
  activeAreas: string[];
  budgetItems: AssistantBudgetItem[];
  areaExpenses: AssistantAreaExpense[];
  cashMovements: AssistantCashMovement[];
  collaborators: AssistantCollaborator[];
  documents: AssistantProjectDocument[];
};

export type AssistantTool = {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  // Las acciones que escriben datos no se ejecutan solas: la app pide
  // confirmación y recién ahí corre `run`.
  requiresConfirmation?: boolean;
  summarize?: (args: any) => string;
  run: (args: any) => unknown | Promise<unknown>;
};

export type AssistantToolsOptions = {
  listProjects: () => Promise<AssistantProjectHandle[]>;
  loadProject: (projectId: string) => Promise<AssistantProjectContext | null>;
  loadProviders?: () => Promise<AssistantProvider[]>;
  loadProjectFinance?: (projectId: string) => Promise<AssistantProjectFinance | null>;
  loadClients?: () => Promise<Array<{ id: string; businessName?: string; contactName?: string; email?: string; phone?: string; cuit?: string }>>;
  loadUsers?: () => Promise<Array<{ id: string; email?: string; displayName?: string; role?: string }>>;
  getPendingFile?: () => File | null;
  canAccessProviders?: boolean;
  isAppAdmin?: boolean;
  currentProjectId?: string | null;
  userId?: string;
  userEmail?: string;
  enableActions?: boolean;
};

const asText = (value: unknown) => String(value || '').toLowerCase();
const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;
const limitOf = (value: unknown, fallback = 20, max = 50) => Math.max(1, Math.min(max, Number(value) || fallback));

const hasPayment = (item: { paid?: boolean; paymentLocked?: boolean; paymentHistory?: any[] }) => (
  item.paid === true || item.paymentLocked === true
  || (Array.isArray(item.paymentHistory) && item.paymentHistory.length > 0)
);

const paidAmount = (item: { total?: number; paid?: boolean; paymentHistory?: any[] }) => {
  if (Array.isArray(item.paymentHistory) && item.paymentHistory.length > 0) {
    return item.paymentHistory.reduce((total, payment) => total + (Number(payment?.amount) || 0), 0);
  }
  // Filas legacy: marcadas como pagadas sin historial de pagos.
  return item.paid === true ? Number(item.total) || 0 : 0;
};

const matchesText = (item: AssistantBudgetItem, text: string) => (
  !text
  || [item.providerName, item.description, item.area, (item as AssistantAreaExpense).subcategory]
    .filter(Boolean)
    .some((value) => asText(value).includes(text))
);

const providerLabel = (provider: AssistantProvider) => (
  provider.fullName
  || provider.businessName
  || [provider.name, provider.lastName].filter(Boolean).join(' ').trim()
  || provider.id
);

const compactItem = (item: AssistantBudgetItem, subcategory?: string) => ({
  id: item.id,
  area: item.area,
  ...(subcategory !== undefined ? { subcategory: cleanAreaExpenseSubcategory(subcategory) } : {}),
  proveedor: item.providerName || '',
  descripcion: item.description || '',
  cantidad: Number(item.quantity) || 0,
  precioUnitario: round2(Number(item.unitPrice) || 0),
  total: round2(Number(item.total) || 0),
  pagado: hasPayment(item),
  montoPagado: round2(paidAmount(item)),
  saldo: round2(Math.max(0, (Number(item.total) || 0) - paidAmount(item))),
  fechaPago: item.paymentDate || '',
});

const projectOptionsSchema = (extra: Record<string, unknown> = {}) => ({
  type: 'object' as const,
  properties: {
    proyecto: { type: 'string', description: 'Nombre o id del proyecto. Si se omite, usa el proyecto abierto en pantalla.' },
    ...extra,
  },
});

const generateAssistantInviteToken = () => {
  const bytes = new Uint8Array(20);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const buildAssistantInviteLink = (token: string) => {
  const baseUrl = ((import.meta as any).env?.BASE_URL || '/');
  return `${window.location.origin}${baseUrl}#/alta-proveedor/${token}`;
};

// Herramientas de sólo lectura: cada una resuelve el proyecto pedido, lo carga
// con la sesión del usuario (las reglas de Firestore son el filtro real) y
// devuelve sólo lo que ese usuario puede ver.
export const buildAssistantTools = ({
  listProjects,
  loadProject,
  loadProviders,
  loadProjectFinance,
  loadClients,
  loadUsers,
  getPendingFile,
  canAccessProviders = false,
  isAppAdmin = false,
  currentProjectId = null,
  userId = '',
  userEmail = '',
  enableActions = true,
}: AssistantToolsOptions): AssistantTool[] => {
  let projectsCache: AssistantProjectHandle[] | null = null;
  const projectCache = new Map<string, AssistantProjectContext | null>();
  let providersCache: AssistantProvider[] | null = null;

  const getProjects = async () => {
    if (!projectsCache) projectsCache = await listProjects();
    return projectsCache;
  };

  const getProjectContext = async (projectId: string) => {
    if (!projectCache.has(projectId)) projectCache.set(projectId, await loadProject(projectId));
    return projectCache.get(projectId) || null;
  };

  const getProviders = async () => {
    if (!loadProviders) return [] as AssistantProvider[];
    if (!providersCache) providersCache = await loadProviders();
    return providersCache;
  };

  const resolveProject = async (reference: unknown): Promise<{ context: AssistantProjectContext } | { error: string }> => {
    const projects = await getProjects();
    const raw = String(reference || '').trim();
    let target = findProjectByReference(projects, raw);
    if (!target && !raw) {
      if (currentProjectId) {
        target = projects.find((project) => project.id === currentProjectId)
          || { id: currentProjectId, name: 'proyecto abierto' };
      } else if (projects.length === 1) {
        target = projects[0];
      }
    }
    if (!target) {
      const names = projects.map((project) => project.name).slice(0, 12).join(', ');
      return {
        error: raw
          ? `No encontré el proyecto "${raw}".`
          : `Decime de qué proyecto hablamos. Tenés disponibles: ${names || 'ninguno'}.`,
      };
    }
    const context = await getProjectContext(target.id);
    if (!context) return { error: `No tenés acceso al proyecto "${target.name || target.id}".` };
    return { context };
  };

  const visibleBudgetItems = (context: AssistantProjectContext) => (
    context.budgetItems.filter((item) => (
      context.capabilities.isProjectAdmin || context.capabilities.access.allowedCategories.includes(item.area)
    ))
  );

  const visibleAreaExpenses = (context: AssistantProjectContext) => (
    context.areaExpenses.filter((expense) => {
      if (context.capabilities.isProjectAdmin) return true;
      if (context.capabilities.access.allowedCategories.includes(expense.area)) return true;
      const subcategory = cleanAreaExpenseSubcategory(expense.subcategory);
      return Boolean(subcategory && context.capabilities.access.allowedSubcategories.includes(`${expense.area}||${subcategory}`));
    })
  );

  const tools: AssistantTool[] = [
    {
      name: 'listar_proyectos',
      description: 'Lista los proyectos a los que el usuario tiene acceso.',
      parameters: { type: 'object', properties: {} },
      run: async () => {
        const projects = await getProjects();
        return {
          total: projects.length,
          proyectos: projects.map((project) => ({
            id: project.id,
            nombre: project.name,
            cliente: project.clientName || '',
          })),
        };
      },
    },
    {
      name: 'detalle_proyecto',
      description: 'Muestra el rol del usuario en un proyecto, sus pestañas y áreas habilitadas.',
      parameters: projectOptionsSchema(),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const { capabilities } = resolved.context;
        return {
          proyecto: resolved.context.projectName || resolved.context.projectId,
          resumen: describeAssistantScope(capabilities),
          areas: capabilities.areas.map((scope) => ({
            area: scope.area,
            acceso: scope.canEditArea ? 'completa' : scope.canEditSubcategories,
          })),
        };
      },
    },
    {
      name: 'resumen_proyecto',
      description: 'Devuelve los totales de un proyecto: presupuesto, gastos de áreas, pagos y saldos dentro del alcance del usuario.',
      parameters: projectOptionsSchema(),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        const budgetItems = visibleBudgetItems(context);
        const areaExpenses = visibleAreaExpenses(context);
        const budgetTotal = budgetItems.reduce((total, item) => total + (Number(item.total) || 0), 0);
        const expenseTotal = areaExpenses.reduce((total, item) => total + (Number(item.total) || 0), 0);
        const paidTotal = [...budgetItems, ...areaExpenses].reduce((total, item) => total + paidAmount(item), 0);
        return {
          proyecto: context.projectName || context.projectId,
          presupuestoPrincipal: round2(budgetTotal),
          partidas: budgetItems.length,
          gastosDeAreas: round2(expenseTotal),
          gastosCargados: areaExpenses.length,
          pagosRegistrados: round2(paidTotal),
          saldoPendiente: round2(budgetTotal + expenseTotal - paidTotal),
          areasActivas: context.activeAreas,
          areasVisibles: context.capabilities.areas.map((scope) => scope.area),
        };
      },
    },
    {
      name: 'datos_proyecto',
      description: 'Devuelve los datos generales del proyecto: cliente, empresa, marca, estado, fechas de rodaje, locación y presupuesto estimado.',
      parameters: projectOptionsSchema(),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        return {
          proyecto: context.projectName || context.projectId,
          cliente: context.meta.clientName || '',
          empresa: context.meta.companyName || '',
          marca: context.meta.brandName || '',
          estado: context.meta.status || '',
          codigo: context.meta.projectCode || '',
          rodajeDesde: context.meta.shootingStartDate || '',
          rodajeHasta: context.meta.shootingEndDate || '',
          locacion: context.meta.location || '',
          presupuestoEstimado: round2(Number(context.meta.budgetTotal) || 0),
        };
      },
    },
    {
      name: 'resultado_proyecto',
      description: 'Devuelve el Resultado del proyecto: venta, costos por área, incidencias (imprevistos, impuestos, financiación), costo total, margen estimado y margen final con porcentaje. Sólo administradores del proyecto.',
      parameters: projectOptionsSchema(),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        if (!context.capabilities.can.viewResults) {
          return { error: 'El usuario no tiene permiso para ver el Resultado de este proyecto.' };
        }
        const result = calculateProjectResult(
          {
            categories: context.categories,
            budgetTotal: context.meta.budgetTotal,
            resultIncidences: context.meta.resultIncidences || {},
          },
          context.budgetItems,
          context.areaExpenses,
        );
        const incidenceLabels: Record<string, string> = {
          imprevistos: 'Imprevistos',
          impuestos: 'Impuestos',
          financiacion: 'Financiación',
          margen: 'Margen',
        };
        const incidencias = Object.entries(context.meta.resultIncidences || {}).map(([id, value]) => ({
          incidencia: incidenceLabels[id] || id,
          porcentaje: Number(value) || 0,
          monto: round2(Number(context.meta.budgetTotal || 0) * ((Number(value) || 0) / 100)),
        }));
        return {
          proyecto: context.projectName || context.projectId,
          venta: round2(result.saleValue),
          costosPorArea: result.categoryTotals.map((entry) => ({ area: entry.area, costo: round2(entry.total) })),
          costosDirectos: round2(result.directCostTotal),
          incidencias,
          incidenciasDeGasto: round2(result.expenseIncidenceTotal),
          costoTotal: round2(result.totalCost),
          margenEstimado: round2(result.estimatedMargin),
          margen: round2(result.margin),
          margenPorcentaje: Math.round(result.marginPercent * 10) / 10,
          nota: 'El margen incluye la incidencia de margen cargada y los costos directos por área (gastos reales si el área tiene movimientos, si no el presupuesto asignado).',
        };
      },
    },
    {
      name: 'resumen_area',
      description: 'Devuelve el asignado, gastado y saldo de un área, con el detalle de sus subcategorías.',
      parameters: projectOptionsSchema({ area: { type: 'string', description: 'Nombre del área' } }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        const area = String(args?.area || '').trim();
        const scope = context.capabilities.areas.find((entry) => asText(entry.area) === asText(area));
        if (!scope) return { error: 'El usuario no tiene acceso a esa área.' };
        const assigned = visibleBudgetItems(context).filter((item) => item.area === scope.area);
        const expenses = visibleAreaExpenses(context).filter((item) => item.area === scope.area);
        const groups = new Map<string, { subcategoria: string; gastado: number; gastos: number }>();
        expenses.forEach((expense) => {
          const subcategory = cleanAreaExpenseSubcategory(expense.subcategory);
          const key = subcategory || 'sin-subcategoria';
          const current = groups.get(key) || { subcategoria: subcategory || 'Sin subcategoría', gastado: 0, gastos: 0 };
          current.gastado = round2(current.gastado + (Number(expense.total) || 0));
          current.gastos += 1;
          groups.set(key, current);
        });
        const assignedTotal = assigned.reduce((total, item) => total + (Number(item.total) || 0), 0);
        const spentTotal = expenses.reduce((total, item) => total + (Number(item.total) || 0), 0);
        return {
          proyecto: context.projectName || context.projectId,
          area: scope.area,
          asignado: round2(assignedTotal),
          gastado: round2(spentTotal),
          saldo: round2(assignedTotal - spentTotal),
          partidas: assigned.length,
          gastosCargados: expenses.length,
          puedeEditar: scope.canEditArea ? 'area completa' : scope.canEditSubcategories,
          subcategorias: Array.from(groups.values()),
        };
      },
    },
    {
      name: 'listar_partidas',
      description: 'Lista partidas del presupuesto principal de un proyecto, con filtro opcional por área o texto.',
      parameters: projectOptionsSchema({
        area: { type: 'string' },
        texto: { type: 'string', description: 'Texto a buscar en proveedor o descripción' },
        limite: { type: 'number' },
      }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        const area = asText(args?.area);
        const text = asText(args?.texto);
        const rows = visibleBudgetItems(context)
          .filter((item) => (!area || asText(item.area) === area) && matchesText(item, text))
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .slice(0, limitOf(args?.limite))
          .map((item) => compactItem(item));
        return { proyecto: context.projectName || context.projectId, total: rows.length, partidas: rows };
      },
    },
    {
      name: 'listar_gastos_area',
      description: 'Lista gastos cargados en Gestión por Áreas de un proyecto, con filtro por área, subcategoría o texto.',
      parameters: projectOptionsSchema({
        area: { type: 'string' },
        subcategoria: { type: 'string' },
        texto: { type: 'string' },
        limite: { type: 'number' },
      }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        const area = asText(args?.area);
        const subcategory = cleanAreaExpenseSubcategory(args?.subcategoria);
        const text = asText(args?.texto);
        const rows = visibleAreaExpenses(context)
          .filter((item) => (
            (!area || asText(item.area) === area)
            && (!subcategory || cleanAreaExpenseSubcategory(item.subcategory) === subcategory)
            && matchesText(item, text)
          ))
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .slice(0, limitOf(args?.limite))
          .map((item) => compactItem(item, item.subcategory));
        return { proyecto: context.projectName || context.projectId, total: rows.length, gastos: rows };
      },
    },
    {
      name: 'pagos_pendientes',
      description: 'Lista los gastos con saldo pendiente de un proyecto, ordenados por fecha de pago programada.',
      parameters: projectOptionsSchema({ area: { type: 'string' }, limite: { type: 'number' } }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        const area = asText(args?.area);
        const rows = [...visibleBudgetItems(context), ...visibleAreaExpenses(context)]
          .filter((item) => !area || asText(item.area) === area)
          .filter((item) => (Number(item.total) || 0) - paidAmount(item) > 0.009)
          .sort((a, b) => String(a.paymentDate || '9999').localeCompare(String(b.paymentDate || '9999')))
          .slice(0, limitOf(args?.limite))
          .map((item) => compactItem(item, (item as AssistantAreaExpense).subcategory));
        return { proyecto: context.projectName || context.projectId, total: rows.length, pendientes: rows };
      },
    },
    {
      name: 'pagos_proximos',
      description: 'Lista los pagos pendientes con fecha programada: vencidos y los que vencen en los próximos días (por defecto 30).',
      parameters: projectOptionsSchema({
        area: { type: 'string' },
        dias: { type: 'number', description: 'Cantidad de días hacia adelante (por defecto 30)' },
        limite: { type: 'number' },
      }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        if (!context.capabilities.tabs.includes('saldos')) {
          return { error: 'El usuario no tiene acceso a la pestaña Finanzas en este proyecto.' };
        }
        const area = asText(args?.area);
        const days = Math.max(1, Math.min(180, Number(args?.dias) || 30));
        const today = new Date();
        const limit = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
        const todayKey = today.toISOString().slice(0, 10);
        const limitKey = limit.toISOString().slice(0, 10);

        const rows = [...visibleBudgetItems(context), ...visibleAreaExpenses(context)]
          .filter((item) => !area || asText(item.area) === area)
          .filter((item) => (Number(item.total) || 0) - paidAmount(item) > 0.009)
          .filter((item) => {
            const date = String(item.paymentDate || '').slice(0, 10);
            return Boolean(date) && date <= limitKey;
          })
          .sort((a, b) => String(a.paymentDate).localeCompare(String(b.paymentDate)));

        const compact = rows.slice(0, limitOf(args?.limite, 25, 60)).map((item) => ({
          ...compactItem(item, (item as AssistantAreaExpense).subcategory),
          vencido: String(item.paymentDate || '').slice(0, 10) < todayKey,
        }));

        return {
          proyecto: context.projectName || context.projectId,
          hoy: todayKey,
          hasta: limitKey,
          vencidos: compact.filter((row) => row.vencido).length,
          total: compact.length,
          pagos: compact,
        };
      },
    },
    {
      name: 'ir_a_pantalla',
      description: 'Indica a la app que abra una pestaña de un proyecto para el usuario.',
      parameters: projectOptionsSchema({
        pestana: {
          type: 'string',
          enum: ['resumen', 'presupuesto', 'areas', 'cajas', 'saldos', 'documentos', 'resultado', 'proveedores', 'equipo', 'permisos'],
        },
      }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        const tab = String(args?.pestana || '');
        if (!context.capabilities.tabs.includes(tab)) {
          return { error: 'El usuario no tiene acceso a esa pestaña en este proyecto.' };
        }
        return { abrirProyecto: context.projectId, pestana: tab };
      },
    },
  ];

  if (canAccessProviders && loadProviders) {
    tools.push({
      name: 'buscar_proveedores',
      description: 'Busca proveedores en la base global por nombre, CUIT o categoría.',
      parameters: {
        type: 'object',
        properties: { texto: { type: 'string' }, limite: { type: 'number' } },
      },
      run: async (args) => {
        const providers = await getProviders();
        const text = asText(args?.texto);
        const rows = providers
          .filter((provider) => (
            !text
            || [providerLabel(provider), provider.cuit, provider.category]
              .filter(Boolean)
              .some((value) => asText(value).includes(text))
          ))
          .slice(0, limitOf(args?.limite))
          .map((provider) => ({
            id: provider.id,
            nombre: providerLabel(provider),
            tipo: provider.type || '',
            categoria: provider.category || '',
            cuit: provider.cuit || '',
            ...(canAccessProviders ? {
              email: provider.email || '',
              telefono: provider.phone || '',
              direccion: provider.address || '',
              alias: provider.bankAccount_alias || '',
              cbu: provider.bankAccount_cbu || '',
            } : {}),
          }));
        return { total: rows.length, proveedores: rows };
      },
    });
  }

  tools.push({
    name: 'listar_colaboradores',
    description: 'Lista los colaboradores de un proyecto con su rol y áreas asignadas (sólo si el usuario puede verlos).',
    parameters: projectOptionsSchema(),
    run: async (args) => {
      const resolved = await resolveProject(args?.proyecto);
      if ('error' in resolved) return resolved;
      const context = resolved.context;
      if (context.collaborators.length === 0) {
        return { error: 'El usuario no tiene permiso para ver los colaboradores de este proyecto.' };
      }
      return {
        proyecto: context.projectName || context.projectId,
        colaboradores: context.collaborators.map((collaborator) => ({
          email: collaborator.email,
          nombre: collaborator.displayName || collaborator.email,
          rol: collaborator.role || '',
          areas: Array.isArray(collaborator.allowedCategories) ? collaborator.allowedCategories : [],
          subcategorias: Array.isArray(collaborator.allowedSubcategories) ? collaborator.allowedSubcategories : [],
        })),
      };
    },
  });

  tools.push({
    name: 'resumen_cajas',
    description: 'Resume los movimientos de caja visibles para el usuario en un proyecto.',
    parameters: projectOptionsSchema(),
    run: async (args) => {
      const resolved = await resolveProject(args?.proyecto);
      if ('error' in resolved) return resolved;
      const context = resolved.context;
      if (!context.capabilities.tabs.includes('cajas')) {
        return { error: 'El usuario no tiene acceso a la pestaña Cajas en este proyecto.' };
      }
      const visible = context.cashMovements.filter((movement) => (
        context.capabilities.can.seeFullCash
        || asText(movement.fromUserEmail) === asText(context.userEmail)
        || asText(movement.toUserEmail) === asText(context.userEmail)
      ));
      const totals = visible.reduce((acc, movement) => {
        const key = movement.status || 'sin-estado';
        acc[key] = round2((acc[key] || 0) + (Number(movement.amount) || 0));
        return acc;
      }, {} as Record<string, number>);
      return {
        proyecto: context.projectName || context.projectId,
        movimientos: visible.length,
        totalesPorEstado: totals,
        ultimos: visible.slice(-10).map((movement) => ({
          tipo: movement.type,
          monto: round2(Number(movement.amount) || 0),
          estado: movement.status || '',
          de: movement.fromUserName || movement.fromUserEmail || '',
          para: movement.toUserName || movement.toUserEmail || '',
        })),
      };
    },
  });

  if (enableActions) {
    const findProviderByName = async (name: string) => {
      const text = asText(name).trim();
      if (!text) return null;
      const providers = await getProviders();
      return providers.find((provider) => asText(providerLabel(provider)) === text)
        || providers.find((provider) => asText(providerLabel(provider)).includes(text))
        || null;
    };

    const nextOrder = async (
      projectId: string,
      collectionName: 'budgetItems' | 'areaExpenses',
      area: string,
      subcategory?: string,
    ) => {
      const snapshot = await getDocs(collection(db, 'projects', projectId, collectionName));
      const orders = snapshot.docs
        .map((entry) => entry.data() as AssistantBudgetItem & { subcategory?: string })
        .filter((item) => item.area === area
          && (subcategory === undefined || cleanAreaExpenseSubcategory(item.subcategory) === subcategory))
        .map((item) => Number(item.order) || 0);
      return orders.length > 0 ? Math.max(...orders) + 1 : 0;
    };

    const readAmounts = (args: any) => {
      const quantity = Number(args?.cantidad ?? 1);
      const unitPrice = Number(args?.precioUnitario ?? args?.precio ?? 0);
      return { quantity, unitPrice, total: round2(quantity * unitPrice) };
    };

    const findRow = (context: AssistantProjectContext, reference: unknown) => {
      const text = asText(reference).trim();
      if (!text) return { error: 'Falta decir qué fila hay que tocar (id, proveedor o descripción).' };
      const candidates = [
        ...visibleBudgetItems(context).map((item) => ({ collectionName: 'budgetItems' as const, item })),
        ...visibleAreaExpenses(context).map((item) => ({ collectionName: 'areaExpenses' as const, item })),
      ];
      const byId = candidates.find((entry) => entry.item.id === String(reference).trim());
      if (byId) return byId;
      const matches = candidates.filter((entry) => (
        [entry.item.providerName, entry.item.description, (entry.item as AssistantAreaExpense).subcategory, entry.item.area]
          .filter(Boolean)
          .some((value) => asText(value).includes(text))
      ));
      if (matches.length === 1) return matches[0];
      if (matches.length === 0) return { error: `No encontré ninguna fila que coincida con "${reference}".` };
      return {
        error: `Hay ${matches.length} filas que coinciden con "${reference}". Decime cuál: ${matches.slice(0, 6).map((entry) => (
          `"${entry.item.description || entry.item.providerName || entry.item.id}" (${entry.item.area}${(entry.item as AssistantAreaExpense).subcategory ? ` › ${(entry.item as AssistantAreaExpense).subcategory}` : ''})`
        )).join('; ')}.`,
      };
    };

    const rowLabel = (row: AssistantBudgetItem, subcategory?: string) => (
      `"${row.description || row.providerName || row.id}" (${row.area}${subcategory ? ` › ${subcategory}` : ''})`
    );

    const amountError = (quantity: number, unitPrice: number) => {
      if (!Number.isFinite(quantity) || quantity <= 0) return { error: 'Falta la cantidad (tiene que ser mayor a cero).' };
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) return { error: 'Falta el precio unitario (tiene que ser mayor a cero).' };
      return null;
    };

    tools.push({
      name: 'crear_partida',
      description: 'Crea una partida nueva en el Presupuesto Principal de un proyecto. Siempre requiere confirmación del usuario antes de guardar.',
      requiresConfirmation: true,
      summarize: (args) => {
        const { quantity, unitPrice, total } = readAmounts(args);
        const provider = String(args?.proveedor || '').trim();
        return [
          `Crear partida en ${String(args?.area || '(sin área)').trim()}`,
          `"${String(args?.descripcion || '').trim()}"`,
          provider ? `Proveedor: ${provider}` : '',
          `${quantity} × $${unitPrice.toLocaleString('es-AR')} = $${total.toLocaleString('es-AR')}`,
        ].filter(Boolean).join(' · ');
      },
      parameters: projectOptionsSchema({
        area: { type: 'string', description: 'Área o categoría del presupuesto principal' },
        descripcion: { type: 'string', description: 'Detalle de la partida' },
        proveedor: { type: 'string', description: 'Nombre del proveedor (opcional)' },
        cantidad: { type: 'number', description: 'Cantidad' },
        precioUnitario: { type: 'number', description: 'Precio unitario en pesos' },
      }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        if (!context.capabilities.can.editMainBudget) {
          return { error: 'El usuario no puede editar el presupuesto principal de este proyecto.' };
        }
        const area = String(args?.area || '').trim();
        if (!area || !context.categories.includes(area)) {
          return { error: `El área "${area}" no existe en este proyecto.` };
        }
        if (context.activeAreas.includes(area)) {
          return { error: `El área "${area}" está activa en Gestión por Áreas: ese gasto se carga desde la pestaña Áreas.` };
        }
        const description = String(args?.descripcion || '').trim();
        if (!description) return { error: 'Falta la descripción de la partida.' };
        const { quantity, unitPrice, total } = readAmounts(args);
        const amountsIssue = amountError(quantity, unitPrice);
        if (amountsIssue) return amountsIssue;
        const provider = await findProviderByName(String(args?.proveedor || ''));
        const order = await nextOrder(context.projectId, 'budgetItems', area);
        const itemRef = doc(collection(db, 'projects', context.projectId, 'budgetItems'));

        await runTransaction(db, async (transaction) => {
          const projectRef = doc(db, 'projects', context.projectId);
          const projectSnapshot = await transaction.get(projectRef);
          if (!projectSnapshot.exists()
            || (Array.isArray(projectSnapshot.data().activeAreas) ? projectSnapshot.data().activeAreas : []).includes(area)) {
            throw new Error('El área cambió de estado mientras se guardaba.');
          }
          transaction.set(itemRef, {
            projectId: context.projectId,
            area,
            providerId: provider?.id || '',
            providerName: provider ? providerLabel(provider) : String(args?.proveedor || '').trim(),
            description,
            unit: 'Unidad',
            quantity,
            unitPrice,
            total,
            order,
            invoice: null,
            invoices: [],
            invoiceStatus: null,
            otherReceipts: [],
            paymentHistory: [],
            paid: false,
            paymentLocked: false,
            paymentAuthorIds: [],
            createdBy: userId,
            createdByEmail: userEmail,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          transaction.update(projectRef, {
            budgetRevision: (Number(projectSnapshot.data().budgetRevision) || 0) + 1,
            updatedAt: serverTimestamp(),
          });
        });

        return {
          ok: true,
          mensaje: `Partida creada en ${area}: "${description}" por $${total.toLocaleString('es-AR')}.`,
          partida: { id: itemRef.id, area, descripcion: description, proveedor: provider ? providerLabel(provider) : String(args?.proveedor || '').trim(), cantidad: quantity, precioUnitario: unitPrice, total },
        };
      },
    });

    tools.push({
      name: 'crear_gasto_area',
      description: 'Carga un gasto nuevo en Gestión por Áreas de un proyecto. Siempre requiere confirmación del usuario antes de guardar.',
      requiresConfirmation: true,
      summarize: (args) => {
        const { quantity, unitPrice, total } = readAmounts(args);
        const provider = String(args?.proveedor || '').trim();
        const subcategory = cleanAreaExpenseSubcategory(args?.subcategoria);
        return [
          `Cargar gasto en ${String(args?.area || '(sin área)').trim()}${subcategory ? ` › ${subcategory}` : ''}`,
          `"${String(args?.descripcion || '').trim()}"`,
          provider ? `Proveedor: ${provider}` : '',
          `${quantity} × $${unitPrice.toLocaleString('es-AR')} = $${total.toLocaleString('es-AR')}`,
        ].filter(Boolean).join(' · ');
      },
      parameters: projectOptionsSchema({
        area: { type: 'string', description: 'Área activa en Gestión por Áreas' },
        subcategoria: { type: 'string', description: 'Subcategoría (opcional)' },
        descripcion: { type: 'string', description: 'Detalle del gasto' },
        proveedor: { type: 'string', description: 'Nombre del proveedor (opcional)' },
        cantidad: { type: 'number' },
        precioUnitario: { type: 'number' },
      }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        const area = String(args?.area || '').trim();
        const subcategory = cleanAreaExpenseSubcategory(args?.subcategoria);
        if (!area || !context.categories.includes(area)) {
          return { error: `El área "${area}" no existe en este proyecto.` };
        }
        if (!canAssistantEditSubcategory(context.capabilities, area, subcategory)) {
          return { error: `El usuario no tiene permiso para cargar gastos en ${area}${subcategory ? ` › ${subcategory}` : ''}.` };
        }
        const description = String(args?.descripcion || '').trim();
        if (!description) return { error: 'Falta la descripción del gasto.' };
        const { quantity, unitPrice, total } = readAmounts(args);
        const amountsIssue = amountError(quantity, unitPrice);
        if (amountsIssue) return amountsIssue;
        const provider = await findProviderByName(String(args?.proveedor || ''));
        const order = await nextOrder(context.projectId, 'areaExpenses', area, subcategory);
        const expenseRef = doc(collection(db, 'projects', context.projectId, 'areaExpenses'));

        await runTransaction(db, async (transaction) => {
          transaction.set(expenseRef, {
            projectId: context.projectId,
            area,
            subcategory,
            providerId: provider?.id || '',
            providerName: provider ? providerLabel(provider) : String(args?.proveedor || '').trim(),
            description,
            unit: 'Unidad',
            quantity,
            unitPrice,
            total,
            order,
            invoice: null,
            invoices: [],
            invoiceStatus: null,
            otherReceipts: [],
            paymentHistory: [],
            paid: false,
            paymentLocked: false,
            paymentAuthorIds: [],
            createdBy: userId,
            createdByEmail: userEmail,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });

        return {
          ok: true,
          mensaje: `Gasto cargado en ${area}${subcategory ? ` › ${subcategory}` : ''}: "${description}" por $${total.toLocaleString('es-AR')}.`,
          gasto: { id: expenseRef.id, area, subcategoria: subcategory, descripcion: description, proveedor: provider ? providerLabel(provider) : String(args?.proveedor || '').trim(), cantidad: quantity, precioUnitario: unitPrice, total },
        };
      },
    });

    tools.push({
      name: 'cargar_gastos_lote',
      description: 'Carga varios gastos de Gestión por Áreas de una sola vez (por ejemplo los de una planilla). Siempre requiere confirmación del usuario antes de guardar.',
      requiresConfirmation: true,
      summarize: (args) => {
        const rows = Array.isArray(args?.filas) ? args.filas : [];
        const byArea = new Map<string, number>();
        let total = 0;
        rows.forEach((row: any) => {
          const area = String(row?.area || '(sin área)').trim();
          byArea.set(area, (byArea.get(area) || 0) + 1);
          total += readAmounts(row).total;
        });
        const detail = Array.from(byArea.entries()).map(([area, count]) => `${area}: ${count}`).join(', ');
        const preview = rows.slice(0, 6).map((row: any, index: number) => (
          `${index + 1}. ${String(row?.descripcion || '').trim()}`
          + `${row?.proveedor ? ` — ${String(row.proveedor).trim()}` : ''}`
          + ` — $${readAmounts(row).total.toLocaleString('es-AR')}`
        )).join('\n');
        const extra = rows.length > 6 ? `\n…y ${rows.length - 6} más` : '';
        return `Cargar ${rows.length} gastos en Gestión por Áreas (${detail || 'sin áreas'}) por $${total.toLocaleString('es-AR')}\n${preview}${extra}`;
      },
      parameters: projectOptionsSchema({
        filas: {
          type: 'array',
          description: 'Gastos a cargar',
          items: {
            type: 'object',
            properties: {
              area: { type: 'string' },
              subcategoria: { type: 'string' },
              descripcion: { type: 'string' },
              proveedor: { type: 'string' },
              cantidad: { type: 'number' },
              precioUnitario: { type: 'number' },
            },
            required: ['area', 'descripcion', 'precioUnitario'],
          },
        },
      }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        const rows = Array.isArray(args?.filas) ? args.filas : [];
        if (rows.length === 0) return { error: 'No hay filas para cargar.' };
        if (rows.length > 300) return { error: `Son ${rows.length} filas y el máximo por carga es 300.` };

        const problems: Array<{ fila: number; problema: string }> = [];
        const prepared: Array<{
          area: string;
          subcategory: string;
          description: string;
          quantity: number;
          unitPrice: number;
          total: number;
          providerId: string;
          providerName: string;
        }> = [];

        rows.forEach((row: any, index: number) => {
          const position = index + 1;
          const area = String(row?.area || '').trim();
          const subcategory = cleanAreaExpenseSubcategory(row?.subcategoria);
          const description = String(row?.descripcion || '').trim();
          if (!area || !context.categories.includes(area)) {
            problems.push({ fila: position, problema: `El área "${area || '(vacía)'}" no existe en el proyecto.` });
            return;
          }
          if (!context.activeAreas.includes(area)) {
            problems.push({ fila: position, problema: `El área "${area}" no está activa en Gestión por Áreas.` });
            return;
          }
          if (!canAssistantEditSubcategory(context.capabilities, area, subcategory)) {
            problems.push({ fila: position, problema: `El usuario no tiene permiso para cargar en ${area}${subcategory ? ` › ${subcategory}` : ''}.` });
            return;
          }
          if (!description) {
            problems.push({ fila: position, problema: 'Falta la descripción.' });
            return;
          }
          const { quantity, unitPrice, total } = readAmounts(row);
          const amountsIssue = amountError(quantity, unitPrice);
          if (amountsIssue) {
            problems.push({ fila: position, problema: amountsIssue.error });
            return;
          }
          prepared.push({
            area,
            subcategory,
            description,
            quantity,
            unitPrice,
            total,
            providerId: '',
            providerName: String(row?.proveedor || '').trim(),
          });
        });

        if (problems.length > 0) {
          return {
            error: 'No cargué nada porque hay filas con problemas. Preguntale al usuario cómo resolverlas.',
            problemas: problems.slice(0, 40),
          };
        }

        for (const row of prepared) {
          const provider = await findProviderByName(row.providerName);
          if (provider) {
            row.providerId = provider.id;
            row.providerName = providerLabel(provider);
          }
        }

        const snapshot = await getDocs(collection(db, 'projects', context.projectId, 'areaExpenses'));
        const nextOrder = new Map<string, number>();
        snapshot.docs.forEach((entry) => {
          const item = entry.data() as AssistantAreaExpense;
          const key = `${item.area}||${cleanAreaExpenseSubcategory(item.subcategory)}`;
          nextOrder.set(key, Math.max(nextOrder.get(key) ?? -1, Number(item.order) || 0));
        });

        const refs = prepared.map(() => doc(collection(db, 'projects', context.projectId, 'areaExpenses')));
        await runTransaction(db, async (transaction) => {
          prepared.forEach((row, index) => {
            const key = `${row.area}||${row.subcategory}`;
            const order = (nextOrder.get(key) ?? -1) + 1;
            nextOrder.set(key, order);
            transaction.set(refs[index], {
              projectId: context.projectId,
              area: row.area,
              subcategory: row.subcategory,
              providerId: row.providerId,
              providerName: row.providerName,
              description: row.description,
              unit: 'Unidad',
              quantity: row.quantity,
              unitPrice: row.unitPrice,
              total: row.total,
              order,
              invoice: null,
              invoices: [],
              invoiceStatus: null,
              otherReceipts: [],
              paymentHistory: [],
              paid: false,
              paymentLocked: false,
              paymentAuthorIds: [],
              createdBy: userId,
              createdByEmail: userEmail,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          });
        });

        const total = prepared.reduce((acc, row) => acc + row.total, 0);
        return {
          ok: true,
          mensaje: `Se cargaron ${prepared.length} gastos en Gestión por Áreas por $${round2(total).toLocaleString('es-AR')}.`,
          cargados: prepared.length,
          total: round2(total),
          detalle: prepared.slice(0, 20).map((row) => ({
            area: row.area,
            subcategoria: row.subcategory,
            descripcion: row.description,
            proveedor: row.providerName,
            total: row.total,
          })),
        };
      },
    });

    const canEditRow = (context: AssistantProjectContext, collectionName: 'budgetItems' | 'areaExpenses', row: AssistantBudgetItem & { subcategory?: string }) => (
      collectionName === 'budgetItems'
        ? context.capabilities.can.editMainBudget
        : canAssistantEditSubcategory(context.capabilities, row.area, row.subcategory)
    );

    tools.push({
      name: 'editar_fila',
      description: 'Edita una partida del presupuesto o un gasto de área (descripción, proveedor, cantidad, precio unitario o unidad). Siempre requiere confirmación del usuario.',
      requiresConfirmation: true,
      summarize: (args) => {
        const changes = [
          args?.descripcion !== undefined ? `descripción "${String(args.descripcion)}"` : '',
          args?.proveedor !== undefined ? `proveedor "${String(args.proveedor)}"` : '',
          args?.cantidad !== undefined ? `cantidad ${Number(args.cantidad)}` : '',
          args?.precioUnitario !== undefined ? `precio $${Number(args.precioUnitario).toLocaleString('es-AR')}` : '',
          args?.unidad !== undefined ? `unidad "${String(args.unidad)}"` : '',
        ].filter(Boolean).join(', ');
        return `Editar "${String(args?.fila || '').trim()}": ${changes || 'sin cambios'}`;
      },
      parameters: projectOptionsSchema({
        fila: { type: 'string', description: 'Id de la fila, proveedor o descripción que la identifique' },
        descripcion: { type: 'string' },
        proveedor: { type: 'string' },
        cantidad: { type: 'number' },
        precioUnitario: { type: 'number' },
        unidad: { type: 'string' },
      }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        const found = findRow(context, args?.fila);
        if ('error' in found) return found;
        const { collectionName, item } = found;
        if (!canEditRow(context, collectionName, item)) {
          return { error: 'El usuario no tiene permiso para editar esa fila.' };
        }
        const paid = hasRecordedPayment(item);
        const changesProvider = args?.proveedor !== undefined;
        const changesIdentity = ['descripcion', 'cantidad', 'precioUnitario', 'unidad']
          .some((field) => args?.[field] !== undefined);
        if (paid && changesIdentity) {
          return { error: 'Esa fila tiene pagos registrados: sólo un administrador puede corregir el proveedor, y no se pueden cambiar importes ni descripción.' };
        }
        if (paid && changesProvider && !context.capabilities.isProjectAdmin) {
          return { error: 'Esa fila tiene pagos registrados: sólo un administrador puede corregir el proveedor.' };
        }

        const updates: any = {};
        if (args?.descripcion !== undefined) updates.description = String(args.descripcion).trim();
        if (args?.unidad !== undefined) updates.unit = String(args.unidad).trim() || 'Unidad';
        if (args?.cantidad !== undefined) updates.quantity = Number(args.cantidad);
        if (args?.precioUnitario !== undefined) updates.unitPrice = Number(args.precioUnitario);
        if (updates.quantity !== undefined || updates.unitPrice !== undefined) {
          const quantity = Number(updates.quantity ?? item.quantity ?? 0);
          const unitPrice = Number(updates.unitPrice ?? item.unitPrice ?? 0);
          if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice) || quantity < 0 || unitPrice < 0) {
            return { error: 'Cantidad y precio tienen que ser números mayores o iguales a cero.' };
          }
          updates.total = round2(quantity * unitPrice);
          const paidTotal = Array.isArray(item.paymentHistory)
            ? item.paymentHistory.reduce((acc, payment: any) => acc + (Number(payment?.amount) || 0), 0)
            : 0;
          if (updates.total + 0.009 < paidTotal) {
            return { error: 'El total quedaría por debajo de lo ya pagado. Revisá el importe o los pagos.' };
          }
        }
        if (args?.proveedor !== undefined) {
          const providerName = String(args.proveedor).trim();
          const provider = providerName ? await findProviderByName(providerName) : null;
          if (providerName && !provider) {
            return { error: `No encontré el proveedor "${providerName}" en la base. Escribí el nombre como figura en Proveedores o creálo desde la app.` };
          }
          if (paid && !provider) return { error: 'Una fila con pagos no puede quedar sin proveedor.' };
          updates.providerId = provider?.id || '';
          updates.providerName = provider ? providerLabel(provider) : '';
        }
        if (Object.keys(updates).length === 0) return { error: 'No hay cambios para aplicar.' };

        const rowRef = doc(db, 'projects', context.projectId, collectionName, item.id);
        await runTransaction(db, async (transaction) => {
          const snapshot = await transaction.get(rowRef);
          if (!snapshot.exists()) throw new Error('La fila ya no existe.');
          const latest = snapshot.data();
          if (!sameExpenseVersion(latest.updatedAt, item.updatedAt) || !samePaymentTarget(latest, item)) {
            throw new Error('La fila cambió mientras se editaba.');
          }
          transaction.update(rowRef, { ...updates, updatedAt: serverTimestamp() });
        });
        projectCache.delete(context.projectId);
        return { ok: true, mensaje: `Fila editada: ${rowLabel({ ...item, ...updates }, item.subcategory)}.`, cambios: updates };
      },
    });

    tools.push({
      name: 'mover_fila',
      description: 'Mueve una partida a otra categoría del presupuesto, o un gasto de área a otra área o subcategoría. Siempre requiere confirmación del usuario.',
      requiresConfirmation: true,
      summarize: (args) => (
        `Mover "${String(args?.fila || '').trim()}" a ${String(args?.area || '').trim()}`
        + `${cleanAreaExpenseSubcategory(args?.subcategoria) ? ` › ${cleanAreaExpenseSubcategory(args?.subcategoria)}` : ''}`
      ),
      parameters: projectOptionsSchema({
        fila: { type: 'string' },
        area: { type: 'string', description: 'Área o categoría destino' },
        subcategoria: { type: 'string', description: 'Subcategoría destino (sólo gastos de área)' },
      }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        const found = findRow(context, args?.fila);
        if ('error' in found) return found;
        const { collectionName, item } = found;
        if (!canEditRow(context, collectionName, item)) {
          return { error: 'El usuario no tiene permiso para mover esa fila.' };
        }
        if (hasRecordedPayment(item)) {
          return { error: 'Esa fila tiene pagos registrados y no se puede mover.' };
        }
        const area = String(args?.area || '').trim();
        const subcategory = cleanAreaExpenseSubcategory(args?.subcategoria);
        if (!area || !context.categories.includes(area)) return { error: `El área "${area}" no existe en este proyecto.` };

        if (collectionName === 'budgetItems') {
          if (!context.capabilities.can.editMainBudget) return { error: 'El usuario no puede mover partidas del presupuesto principal.' };
          if (context.activeAreas.includes(area)) {
            return { error: `El área "${area}" está activa en Gestión por Áreas: esa partida se carga desde la sección de áreas.` };
          }
          if (area === item.area) return { error: 'La partida ya está en esa categoría.' };
          const order = await nextOrder(context.projectId, 'budgetItems', area);
          const rowRef = doc(db, 'projects', context.projectId, 'budgetItems', item.id);
          await runTransaction(db, async (transaction) => {
            const projectRef = doc(db, 'projects', context.projectId);
            const projectSnapshot = await transaction.get(projectRef);
            const snapshot = await transaction.get(rowRef);
            if (!projectSnapshot.exists() || !snapshot.exists()) throw new Error('La fila ya no existe.');
            if ((Array.isArray(projectSnapshot.data().activeAreas) ? projectSnapshot.data().activeAreas : []).includes(area)) {
              throw new Error('El área destino quedó activa.');
            }
            transaction.update(rowRef, { area, order, updatedAt: serverTimestamp() });
            transaction.update(projectRef, {
              budgetRevision: (Number(projectSnapshot.data().budgetRevision) || 0) + 1,
              updatedAt: serverTimestamp(),
            });
          });
          projectCache.delete(context.projectId);
          return { ok: true, mensaje: `${rowLabel(item)} se movió a ${area}.` };
        }

        if (!canAssistantEditSubcategory(context.capabilities, area, subcategory)) {
          return { error: `El usuario no tiene permiso para cargar en ${area}${subcategory ? ` › ${subcategory}` : ''}.` };
        }
        const order = await nextOrder(context.projectId, 'areaExpenses', area, subcategory);
        const rowRef = doc(db, 'projects', context.projectId, 'areaExpenses', item.id);
        await runTransaction(db, async (transaction) => {
          const snapshot = await transaction.get(rowRef);
          if (!snapshot.exists()) throw new Error('La fila ya no existe.');
          transaction.update(rowRef, { area, subcategory, order, updatedAt: serverTimestamp() });
        });
        projectCache.delete(context.projectId);
        return { ok: true, mensaje: `${rowLabel(item, item.subcategory)} se movió a ${area}${subcategory ? ` › ${subcategory}` : ''}.` };
      },
    });

    tools.push({
      name: 'borrar_fila',
      description: 'Elimina una partida del presupuesto o un gasto de área. No permite borrar filas con pagos. Siempre requiere confirmación del usuario.',
      requiresConfirmation: true,
      summarize: (args) => `Eliminar "${String(args?.fila || '').trim()}"`,
      parameters: projectOptionsSchema({ fila: { type: 'string' } }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        const found = findRow(context, args?.fila);
        if ('error' in found) return found;
        const { collectionName, item } = found;
        if (!canEditRow(context, collectionName, item)) {
          return { error: 'El usuario no tiene permiso para borrar esa fila.' };
        }
        if (hasRecordedPayment(item)) {
          return { error: 'Esa fila tiene pagos registrados: no se puede borrar. Sólo un administrador puede corregir o eliminar el pago primero.' };
        }
        const rowRef = doc(db, 'projects', context.projectId, collectionName, item.id);
        if (collectionName === 'budgetItems') {
          await runTransaction(db, async (transaction) => {
            const projectRef = doc(db, 'projects', context.projectId);
            const projectSnapshot = await transaction.get(projectRef);
            const snapshot = await transaction.get(rowRef);
            if (!projectSnapshot.exists() || !snapshot.exists()) throw new Error('La fila ya no existe.');
            transaction.delete(rowRef);
            transaction.update(projectRef, {
              budgetRevision: (Number(projectSnapshot.data().budgetRevision) || 0) + 1,
              updatedAt: serverTimestamp(),
            });
          });
        } else {
          await runTransaction(db, async (transaction) => {
            const snapshot = await transaction.get(rowRef);
            if (!snapshot.exists()) throw new Error('La fila ya no existe.');
            transaction.delete(rowRef);
          });
        }
        projectCache.delete(context.projectId);
        return { ok: true, mensaje: `Se eliminó ${rowLabel(item, item.subcategory)}.` };
      },
    });

    tools.push({
      name: 'asignar_proveedor',
      description: 'Asigna un proveedor de la base a una fila (o lo quita si se pide desvincular). Siempre requiere confirmación del usuario.',
      requiresConfirmation: true,
      summarize: (args) => (
        args?.quitar
          ? `Quitar el proveedor de "${String(args?.fila || '').trim()}"`
          : `Asignar ${String(args?.proveedor || '').trim()} a "${String(args?.fila || '').trim()}"`
      ),
      parameters: projectOptionsSchema({
        fila: { type: 'string' },
        proveedor: { type: 'string', description: 'Nombre del proveedor en la base' },
        quitar: { type: 'boolean', description: 'true para desvincular el proveedor actual' },
      }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        const found = findRow(context, args?.fila);
        if ('error' in found) return found;
        const { collectionName, item } = found;
        if (!canEditRow(context, collectionName, item)) {
          return { error: 'El usuario no tiene permiso para cambiar el proveedor de esa fila.' };
        }
        const paid = hasRecordedPayment(item);
        const updates: any = {};
        if (args?.quitar) {
          if (paid) return { error: 'Esa fila tiene pagos registrados: no puede quedar sin proveedor.' };
          updates.providerId = '';
          updates.providerName = '';
        } else {
          const providerName = String(args?.proveedor || '').trim();
          if (!providerName) return { error: 'Falta el nombre del proveedor.' };
          const provider = await findProviderByName(providerName);
          if (!provider) {
            return { error: `No encontré el proveedor "${providerName}" en la base. Escribí el nombre como figura en Proveedores o creálo desde la app.` };
          }
          if (paid && !context.capabilities.isProjectAdmin) {
            return { error: 'Esa fila tiene pagos registrados: sólo un administrador puede corregir el proveedor.' };
          }
          updates.providerId = provider.id;
          updates.providerName = providerLabel(provider);
        }

        const rowRef = doc(db, 'projects', context.projectId, collectionName, item.id);
        const pendingInvite = (item as any).providerInviteLink;
        const inviteRef = pendingInvite?.status === 'pending' && pendingInvite.token
          ? doc(db, 'providerInvites', pendingInvite.token)
          : null;
        await runTransaction(db, async (transaction) => {
          const snapshot = await transaction.get(rowRef);
          if (!snapshot.exists()) throw new Error('La fila ya no existe.');
          const latest = snapshot.data();
          if (!sameExpenseVersion(latest.updatedAt, item.updatedAt) || !samePaymentTarget(latest, item)) {
            throw new Error('La fila cambió mientras se asignaba el proveedor.');
          }
          transaction.update(rowRef, {
            ...updates,
            ...(inviteRef ? { providerInviteLink: null } : {}),
            updatedAt: serverTimestamp(),
          });
          if (inviteRef) {
            transaction.update(inviteRef, {
              status: 'cancelled',
              cancelledAt: serverTimestamp(),
              cancelledBy: userId,
              cancelledByEmail: userEmail,
              updatedAt: serverTimestamp(),
            });
          }
        });
        projectCache.delete(context.projectId);
        return {
          ok: true,
          mensaje: args?.quitar
            ? `Se quitó el proveedor de ${rowLabel(item, item.subcategory)}.`
            : `Proveedor ${updates.providerName} asignado a ${rowLabel(item, item.subcategory)}.`,
        };
      },
    });

    tools.push({
      name: 'generar_link_proveedor',
      description: 'Genera el link de alta de proveedor para una fila sin proveedor (un solo uso, vence en 7 días y se asigna solo a esa fila). Siempre requiere confirmación del usuario.',
      requiresConfirmation: true,
      summarize: (args) => `Generar link de alta de proveedor para "${String(args?.fila || '').trim()}"`,
      parameters: projectOptionsSchema({ fila: { type: 'string' } }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        const found = findRow(context, args?.fila);
        if ('error' in found) return found;
        const { collectionName, item } = found;
        if (!canEditRow(context, collectionName, item)) {
          return { error: 'El usuario no tiene permiso para generar el link en esa fila.' };
        }
        if (item.providerId || item.providerName) {
          return { error: 'Esa fila ya tiene un proveedor asignado.' };
        }
        const existingInvite = (item as any).providerInviteLink;
        if (existingInvite?.status === 'pending' && existingInvite.token) {
          const link = existingInvite.link || buildAssistantInviteLink(existingInvite.token);
          return { ok: true, mensaje: `Ya hay un link pendiente para esa fila: ${link}`, link };
        }

        const token = generateAssistantInviteToken();
        const link = buildAssistantInviteLink(token);
        const days = 7;
        const expiresAt = Timestamp.fromDate(buildLinkedProviderInviteExpiration(days));
        const inviteRef = doc(db, 'providerInvites', token);
        const rowRef = doc(db, 'projects', context.projectId, collectionName, item.id);
        const batch = writeBatch(db);
        batch.set(inviteRef, {
          token,
          status: 'pending',
          used: false,
          mode: 'single_use',
          projectId: context.projectId,
          projectName: context.projectName || '',
          collectionName,
          expenseId: item.id,
          area: item.area || '',
          subcategory: cleanAreaExpenseSubcategory((item as AssistantAreaExpense).subcategory),
          description: item.description || '',
          expiresAt,
          expiresInDays: days,
          createdBy: userId,
          createdByEmail: userEmail,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.update(rowRef, {
          providerInviteLink: {
            token,
            link,
            status: 'pending',
            createdBy: userId,
            createdByEmail: userEmail,
            createdAt: serverTimestamp(),
            expiresAt,
          },
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
        projectCache.delete(context.projectId);
        return {
          ok: true,
          mensaje: `Link de alta generado para ${rowLabel(item, item.subcategory)} (un solo uso, vence en 7 días): ${link}`,
          link,
        };
      },
    });

    const subcategoryKeyOf = (area: string, subcategory: string) => `${area}||${cleanAreaExpenseSubcategory(subcategory)}`;
    const storedSubcategories = (context: AssistantProjectContext, area: string) => {
      const stored = context.meta.areaExpenseSubcategories?.[area];
      return Array.isArray(stored) ? stored.map((item) => cleanAreaExpenseSubcategory(item)).filter(Boolean) : [];
    };
    const writeAudit = (
      transaction: any,
      context: AssistantProjectContext,
      items: Array<{ id: string; area?: string; providerName?: string; total?: number }>,
      collectionName: 'budgetItems' | 'areaExpenses',
      reason: string,
    ) => {
      if (items.length === 0) return;
      const auditRef = doc(collection(db, 'projects', context.projectId, 'activityLog'));
      transaction.set(auditRef, {
        action: 'expense_rows_deleted',
        reason,
        collectionName,
        itemId: items.length === 1 ? items[0].id : '',
        itemCount: items.length,
        itemLabel: `${items.length} filas`,
        area: items.length === 1 ? (items[0].area || '') : '',
        providerName: '',
        amount: round2(items.reduce((acc, item) => acc + (Number(item.total) || 0), 0)),
        paymentCount: 0,
        deletedCashMovementCount: 0,
        deletedBy: userId,
        deletedByEmail: userEmail,
        deletedByName: '',
        deletedByRole: '',
        createdAt: serverTimestamp(),
      });
    };
    const deleteRowsInTransaction = async (
      context: AssistantProjectContext,
      rows: Array<{ id: string; area?: string; total?: number }>,
      collectionName: 'budgetItems' | 'areaExpenses',
      reason: string,
    ) => {
      const projectRef = doc(db, 'projects', context.projectId);
      await runTransaction(db, async (transaction) => {
        const projectSnapshot = await transaction.get(projectRef);
        if (!projectSnapshot.exists()) throw new Error('El proyecto ya no existe.');
        rows.forEach((row) => {
          transaction.delete(doc(db, 'projects', context.projectId, collectionName, row.id));
        });
        writeAudit(transaction, context, rows, collectionName, reason);
        if (collectionName === 'budgetItems') {
          transaction.update(projectRef, {
            budgetRevision: (Number(projectSnapshot.data().budgetRevision) || 0) + 1,
            updatedAt: serverTimestamp(),
          });
        }
      });
    };

    tools.push({
      name: 'crear_categoria',
      description: 'Crea una categoría nueva en el Presupuesto Principal. Siempre requiere confirmación del usuario.',
      requiresConfirmation: true,
      summarize: (args) => `Crear la categoría "${String(args?.categoria || '').trim()}" en Presu Ppal`,
      parameters: projectOptionsSchema({ categoria: { type: 'string' } }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        if (!context.capabilities.can.editMainBudget) return { error: 'El usuario no puede crear categorías en este proyecto.' };
        const name = String(args?.categoria || '').trim();
        if (!name) return { error: 'Falta el nombre de la categoría.' };
        if (context.categories.some((category) => asText(category) === asText(name))) {
          return { error: `Ya existe una categoría "${name}".` };
        }
        await updateDoc(doc(db, 'projects', context.projectId), {
          categories: [...context.categories, name],
          updatedAt: serverTimestamp(),
        });
        projectCache.delete(context.projectId);
        return { ok: true, mensaje: `Categoría "${name}" creada en Presu Ppal.` };
      },
    });

    tools.push({
      name: 'renombrar_categoria',
      description: 'Renombra una categoría del Presupuesto Principal y actualiza sus partidas y permisos. Siempre requiere confirmación.',
      requiresConfirmation: true,
      summarize: (args) => `Renombrar "${String(args?.categoria || '').trim()}" a "${String(args?.nuevoNombre || '').trim()}"`,
      parameters: projectOptionsSchema({ categoria: { type: 'string' }, nuevoNombre: { type: 'string' } }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        if (!context.capabilities.can.editMainBudget) return { error: 'El usuario no puede renombrar categorías en este proyecto.' };
        const current = context.categories.find((category) => asText(category) === asText(args?.categoria));
        if (!current) return { error: `No existe la categoría "${args?.categoria}".` };
        if (context.activeAreas.includes(current)) {
          return { error: `"${current}" está activa en Gestión por Áreas: no se puede renombrar desde Presu Ppal.` };
        }
        const nextName = String(args?.nuevoNombre || '').trim();
        if (!nextName) return { error: 'Falta el nuevo nombre.' };
        if (context.categories.some((category) => category !== current && asText(category) === asText(nextName))) {
          return { error: `Ya existe una categoría "${nextName}".` };
        }
        const items = context.budgetItems.filter((item) => item.area === current);
        if (items.length > 400) return { error: 'La categoría tiene demasiadas filas para renombrarla desde el asistente; hacelo desde la app.' };
        const collaboratorsToUpdate = context.collaborators.filter((collaborator) => (
          (Array.isArray(collaborator.allowedCategories) ? collaborator.allowedCategories : []).includes(current)
          || (Array.isArray(collaborator.allowedSubcategories) ? collaborator.allowedSubcategories : []).some((key) => key.split('||')[0] === current)
        ));

        const projectRef = doc(db, 'projects', context.projectId);
        await runTransaction(db, async (transaction) => {
          const projectSnapshot = await transaction.get(projectRef);
          if (!projectSnapshot.exists()) throw new Error('El proyecto ya no existe.');
          if ((Array.isArray(projectSnapshot.data().activeAreas) ? projectSnapshot.data().activeAreas : []).includes(current)) {
            throw new Error('El área quedó activa mientras se renombraba.');
          }
          items.forEach((item) => {
            transaction.update(doc(db, 'projects', context.projectId, 'budgetItems', item.id), {
              area: nextName,
              updatedAt: serverTimestamp(),
            });
          });
          transaction.update(projectRef, {
            categories: context.categories.map((category) => (category === current ? nextName : category)),
            budgetRevision: (Number(projectSnapshot.data().budgetRevision) || 0) + (items.length > 0 ? 1 : 0),
            updatedAt: serverTimestamp(),
          });
          collaboratorsToUpdate.forEach((collaborator) => {
            transaction.update(doc(db, 'projects', context.projectId, 'collaborators', normalizeEmail(collaborator.email)), {
              allowedCategories: (Array.isArray(collaborator.allowedCategories) ? collaborator.allowedCategories : [])
                .map((category) => (category === current ? nextName : category)),
              allowedSubcategories: (Array.isArray(collaborator.allowedSubcategories) ? collaborator.allowedSubcategories : [])
                .map((key) => (key.split('||')[0] === current ? `${nextName}||${key.split('||')[1] || ''}` : key)),
              updatedAt: serverTimestamp(),
            });
          });
        });
        projectCache.delete(context.projectId);
        return { ok: true, mensaje: `Categoría "${current}" renombrada a "${nextName}".` };
      },
    });

    tools.push({
      name: 'borrar_categoria',
      description: 'Elimina una categoría del Presupuesto Principal con todas sus partidas y permisos. No permite categorías activas ni con pagos. Siempre requiere confirmación.',
      requiresConfirmation: true,
      summarize: (args) => `Eliminar la categoría "${String(args?.categoria || '').trim()}" y todas sus partidas`,
      parameters: projectOptionsSchema({ categoria: { type: 'string' } }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        if (!context.capabilities.can.editMainBudget) return { error: 'El usuario no puede borrar categorías en este proyecto.' };
        const current = context.categories.find((category) => asText(category) === asText(args?.categoria));
        if (!current) return { error: `No existe la categoría "${args?.categoria}".` };
        if (context.activeAreas.includes(current)) {
          return { error: `"${current}" está activa en Gestión por Áreas: primero desactivá o eliminá el área.` };
        }
        const items = context.budgetItems.filter((item) => item.area === current);
        if (items.some((item) => hasRecordedPayment(item))) {
          return { error: `La categoría "${current}" tiene partidas con pagos registrados: no se puede borrar.` };
        }
        if (items.length > 400) return { error: 'La categoría tiene demasiadas partidas para borrarla desde el asistente; hacelo desde la app.' };

        await deleteRowsInTransaction(context, items, 'budgetItems', 'category_deleted');
        await updateDoc(doc(db, 'projects', context.projectId), {
          categories: context.categories.filter((category) => category !== current),
          updatedAt: serverTimestamp(),
        });
        for (const collaborator of context.collaborators) {
          const allowedCategories = Array.isArray(collaborator.allowedCategories) ? collaborator.allowedCategories : [];
          const allowedSubcategories = Array.isArray(collaborator.allowedSubcategories) ? collaborator.allowedSubcategories : [];
          if (!allowedCategories.includes(current) && !allowedSubcategories.some((key) => key.split('||')[0] === current)) continue;
          await updateDoc(doc(db, 'projects', context.projectId, 'collaborators', normalizeEmail(collaborator.email)), {
            allowedCategories: allowedCategories.filter((category) => category !== current),
            allowedSubcategories: allowedSubcategories.filter((key) => key.split('||')[0] !== current),
            updatedAt: serverTimestamp(),
          });
        }
        projectCache.delete(context.projectId);
        return { ok: true, mensaje: `Categoría "${current}" eliminada con ${items.length} partidas.` };
      },
    });

    tools.push({
      name: 'guardar_subcategoria',
      description: 'Crea o edita una subcategoría de un área con su presupuesto y notas (también sirve para renombrarla). Siempre requiere confirmación.',
      requiresConfirmation: true,
      summarize: (args) => {
        const area = String(args?.area || '').trim();
        const name = cleanAreaExpenseSubcategory(args?.subcategoria);
        const original = cleanAreaExpenseSubcategory(args?.subcategoriaOriginal);
        const budget = Number(args?.presupuesto);
        return [
          original ? `Renombrar "${original}" a "${name}"` : `Crear la subcategoría "${name}"`,
          `en ${area}`,
          Number.isFinite(budget) && budget > 0 ? `con presupuesto $${budget.toLocaleString('es-AR')}` : '',
        ].filter(Boolean).join(' ');
      },
      parameters: projectOptionsSchema({
        area: { type: 'string' },
        subcategoria: { type: 'string', description: 'Nombre nuevo, o el mismo si sólo cambia el presupuesto' },
        subcategoriaOriginal: { type: 'string', description: 'Nombre actual, sólo al editar' },
        presupuesto: { type: 'number' },
        notas: { type: 'string' },
      }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        const area = String(args?.area || '').trim();
        if (!area || !context.categories.includes(area)) return { error: `El área "${area}" no existe en este proyecto.` };
        const canManage = (context.capabilities.isProjectAdmin || context.capabilities.isProductionLead)
          && canAssistantEditArea(context.capabilities, area);
        if (!canManage) return { error: `El usuario no tiene permiso para administrar subcategorías en ${area}.` };

        const name = cleanAreaExpenseSubcategory(args?.subcategoria);
        if (!name) return { error: 'Falta el nombre de la subcategoría.' };
        const original = cleanAreaExpenseSubcategory(args?.subcategoriaOriginal);
        const isRename = Boolean(original && asText(original) !== asText(name));
        const existing = storedSubcategories(context, area);
        if ((!original || isRename) && existing.some((item) => asText(item) === asText(name))) {
          return { error: `La subcategoría "${name}" ya existe en ${area}.` };
        }

        const affectedExpenses = isRename
          ? context.areaExpenses.filter((expense) => expense.area === area && cleanAreaExpenseSubcategory(expense.subcategory) === original)
          : [];
        if (affectedExpenses.some((expense) => hasRecordedPayment(expense))) {
          return { error: `La subcategoría "${original}" tiene gastos con pagos registrados: no se puede renombrar.` };
        }
        if (affectedExpenses.length > 400) return { error: 'La subcategoría tiene demasiados gastos para renombrarla desde el asistente.' };

        const budget = Math.max(0, Number(args?.presupuesto) || 0);
        const currentBudgets = { ...(context.meta.areaExpenseSubcategoryBudgets || {}) };
        if (isRename) delete currentBudgets[subcategoryKeyOf(area, original)];
        const nextBudgets = {
          ...currentBudgets,
          [subcategoryKeyOf(area, name)]: {
            area,
            subcategory: name,
            budget,
            notes: String(args?.notas || '').trim(),
            updatedAt: new Date(),
            updatedByEmail: userEmail,
          },
        };
        const nextSubcategories = Array.from(new Set([
          ...existing.filter((item) => !isRename || asText(item) !== asText(original)),
          name,
        ]));
        const oldPermissionKey = isRename ? subcategoryKeyOf(area, original) : '';
        const nextPermissionKey = subcategoryKeyOf(area, name);
        const collaboratorsToUpdate = oldPermissionKey
          ? context.collaborators.filter((collaborator) => (
            Array.isArray(collaborator.allowedSubcategories) && collaborator.allowedSubcategories.includes(oldPermissionKey)
          ))
          : [];

        const projectRef = doc(db, 'projects', context.projectId);
        await runTransaction(db, async (transaction) => {
          const projectSnapshot = await transaction.get(projectRef);
          if (!projectSnapshot.exists()) throw new Error('El proyecto ya no existe.');
          affectedExpenses.forEach((expense) => {
            transaction.update(doc(db, 'projects', context.projectId, 'areaExpenses', expense.id), {
              subcategory: name,
              updatedAt: serverTimestamp(),
            });
          });
          transaction.update(projectRef, {
            areaExpenseSubcategories: {
              ...(context.meta.areaExpenseSubcategories || {}),
              [area]: nextSubcategories,
            },
            areaExpenseSubcategoryBudgets: nextBudgets,
            updatedAt: serverTimestamp(),
          });
          collaboratorsToUpdate.forEach((collaborator) => {
            transaction.update(doc(db, 'projects', context.projectId, 'collaborators', normalizeEmail(collaborator.email)), {
              allowedSubcategories: Array.from(new Set(
                (Array.isArray(collaborator.allowedSubcategories) ? collaborator.allowedSubcategories : [])
                  .map((key) => (key === oldPermissionKey ? nextPermissionKey : key)),
              )),
              updatedAt: serverTimestamp(),
            });
          });
        });
        projectCache.delete(context.projectId);
        return {
          ok: true,
          mensaje: isRename
            ? `Subcategoría "${original}" renombrada a "${name}" en ${area}${affectedExpenses.length > 0 ? ` (${affectedExpenses.length} gastos actualizados)` : ''}.`
            : `Subcategoría "${name}" guardada en ${area} con presupuesto $${budget.toLocaleString('es-AR')}.`,
        };
      },
    });

    tools.push({
      name: 'borrar_subcategoria',
      description: 'Elimina una subcategoría de un área: sus gastos quedan como "Sin subcategoría". Siempre requiere confirmación.',
      requiresConfirmation: true,
      summarize: (args) => `Eliminar la subcategoría "${String(args?.subcategoria || '').trim()}" de ${String(args?.area || '').trim()}`,
      parameters: projectOptionsSchema({ area: { type: 'string' }, subcategoria: { type: 'string' } }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        const area = String(args?.area || '').trim();
        const subcategory = cleanAreaExpenseSubcategory(args?.subcategoria);
        if (!area || !subcategory) return { error: 'Faltan el área o la subcategoría.' };
        const canManage = (context.capabilities.isProjectAdmin || context.capabilities.isProductionLead)
          && canAssistantEditArea(context.capabilities, area);
        if (!canManage) return { error: `El usuario no tiene permiso para administrar subcategorías en ${area}.` };
        const existing = storedSubcategories(context, area);
        if (!existing.some((item) => asText(item) === asText(subcategory))) {
          return { error: `La subcategoría "${subcategory}" no existe en ${area}.` };
        }
        const affectedExpenses = context.areaExpenses.filter((expense) => (
          expense.area === area && cleanAreaExpenseSubcategory(expense.subcategory) === subcategory
        ));
        if (affectedExpenses.some((expense) => hasRecordedPayment(expense))) {
          return { error: `La subcategoría "${subcategory}" tiene gastos con pagos registrados: no se puede eliminar.` };
        }
        const permissionKey = subcategoryKeyOf(area, subcategory);
        const collaboratorsToUpdate = context.collaborators.filter((collaborator) => (
          Array.isArray(collaborator.allowedSubcategories) && collaborator.allowedSubcategories.includes(permissionKey)
        ));
        const nextBudgets = { ...(context.meta.areaExpenseSubcategoryBudgets || {}) };
        delete nextBudgets[permissionKey];

        const projectRef = doc(db, 'projects', context.projectId);
        await runTransaction(db, async (transaction) => {
          const projectSnapshot = await transaction.get(projectRef);
          if (!projectSnapshot.exists()) throw new Error('El proyecto ya no existe.');
          affectedExpenses.forEach((expense) => {
            transaction.update(doc(db, 'projects', context.projectId, 'areaExpenses', expense.id), {
              subcategory: '',
              updatedAt: serverTimestamp(),
            });
          });
          transaction.update(projectRef, {
            areaExpenseSubcategories: {
              ...(context.meta.areaExpenseSubcategories || {}),
              [area]: existing.filter((item) => asText(item) !== asText(subcategory)),
            },
            areaExpenseSubcategoryBudgets: nextBudgets,
            updatedAt: serverTimestamp(),
          });
          collaboratorsToUpdate.forEach((collaborator) => {
            transaction.update(doc(db, 'projects', context.projectId, 'collaborators', normalizeEmail(collaborator.email)), {
              allowedSubcategories: (Array.isArray(collaborator.allowedSubcategories) ? collaborator.allowedSubcategories : [])
                .filter((key) => key !== permissionKey),
              updatedAt: serverTimestamp(),
            });
          });
        });
        projectCache.delete(context.projectId);
        return {
          ok: true,
          mensaje: `Subcategoría "${subcategory}" eliminada de ${area}${affectedExpenses.length > 0 ? `; ${affectedExpenses.length} gastos quedaron sin subcategoría` : ''}.`,
        };
      },
    });

    tools.push({
      name: 'activar_area',
      description: 'Activa una categoría como área de gestión: migra sus partidas sin pagos y la muestra en Gestión por Áreas. Siempre requiere confirmación.',
      requiresConfirmation: true,
      summarize: (args) => `Activar el área "${String(args?.area || '').trim()}"`,
      parameters: projectOptionsSchema({ area: { type: 'string' } }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        if (!context.capabilities.can.activateAreas) return { error: 'El usuario no puede activar áreas en este proyecto.' };
        const area = String(args?.area || '').trim();
        if (!context.categories.includes(area)) return { error: `El área "${area}" no existe en este proyecto.` };
        if (context.activeAreas.includes(area)) return { error: `El área "${area}" ya está activa.` };
        const items = context.budgetItems.filter((item) => item.area === area);
        if (items.some((item) => hasRecordedPayment(item))) {
          return { error: `El área "${area}" tiene partidas con pagos registrados: primero hay que resolver esos pagos.` };
        }
        if (items.length > 380) return { error: 'El área tiene demasiadas partidas para activarla desde el asistente; hacelo desde la app.' };
        const alreadyMigrated = new Set(context.areaExpenses
          .filter((expense) => expense.area === area && (expense as any).sourceBudgetItemId)
          .map((expense) => (expense as any).sourceBudgetItemId));
        const itemsToMigrate = items.filter((item) => !alreadyMigrated.has(item.id));

        const projectRef = doc(db, 'projects', context.projectId);
        const expenseRefs = itemsToMigrate.map(() => doc(collection(db, 'projects', context.projectId, 'areaExpenses')));
        await runTransaction(db, async (transaction) => {
          const projectSnapshot = await transaction.get(projectRef);
          if (!projectSnapshot.exists()) throw new Error('El proyecto ya no existe.');
          const currentActive = Array.isArray(projectSnapshot.data().activeAreas) ? projectSnapshot.data().activeAreas : [];
          if (currentActive.includes(area)) throw new Error('El área ya estaba activa.');
          const itemRefs = itemsToMigrate.map((item) => doc(db, 'projects', context.projectId, 'budgetItems', item.id));
          const snapshots = await Promise.all(itemRefs.map((itemRef) => transaction.get(itemRef)));
          snapshots.forEach((snapshot, index) => {
            if (!snapshot.exists() || !sameExpenseVersion(snapshot.data().updatedAt, itemsToMigrate[index].updatedAt)) {
              throw new Error('Una partida cambió mientras se activaba el área.');
            }
            if (hasRecordedPayment(snapshot.data())) throw new Error('Una partida recibió un pago.');
          });
          itemsToMigrate.forEach((item, index) => {
            transaction.set(expenseRefs[index], {
              projectId: context.projectId,
              area,
              subcategory: '',
              providerId: item.providerId || '',
              providerName: item.providerName || '',
              description: item.description || '',
              unit: (item as any).unit || 'Unidad',
              quantity: Number(item.quantity) || 0,
              unitPrice: Number(item.unitPrice) || 0,
              total: Number(item.total) || 0,
              order: Number(item.order) || index,
              invoice: (item as any).invoice || null,
              invoices: Array.isArray((item as any).invoices) ? (item as any).invoices : [],
              invoiceStatus: (item as any).invoiceStatus || null,
              otherReceipts: Array.isArray((item as any).otherReceipts) ? (item as any).otherReceipts : [],
              paymentHistory: [],
              paid: false,
              paymentDate: item.paymentDate || '',
              paymentLocked: false,
              paymentAuthorIds: [],
              sourceBudgetItemId: item.id,
              createdBy: userId,
              createdByEmail: userEmail,
              migratedFromBudgetAt: serverTimestamp(),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          });
          transaction.update(projectRef, {
            activeAreas: [...currentActive, area],
            updatedAt: serverTimestamp(),
          });
        });
        projectCache.delete(context.projectId);
        return {
          ok: true,
          mensaje: `Área "${area}" activada${itemsToMigrate.length > 0 ? ` con ${itemsToMigrate.length} partidas migradas` : ''}.`,
        };
      },
    });

    tools.push({
      name: 'desactivar_area',
      description: 'Desactiva la gestión de un área: la saca de Gestión por Áreas sin borrar nada. Siempre requiere confirmación.',
      requiresConfirmation: true,
      summarize: (args) => `Desactivar la gestión del área "${String(args?.area || '').trim()}"`,
      parameters: projectOptionsSchema({ area: { type: 'string' } }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        if (!context.capabilities.can.activateAreas) return { error: 'El usuario no puede desactivar áreas en este proyecto.' };
        const area = String(args?.area || '').trim();
        if (!context.activeAreas.includes(area)) return { error: `El área "${area}" no está activa.` };
        await updateDoc(doc(db, 'projects', context.projectId), {
          activeAreas: context.activeAreas.filter((activeArea) => activeArea !== area),
          updatedAt: serverTimestamp(),
        });
        projectCache.delete(context.projectId);
        return {
          ok: true,
          mensaje: `Gestión del área "${area}" desactivada. Los datos quedaron guardados: si se vuelve a activar, reaparecen.`,
        };
      },
    });

    tools.push({
      name: 'eliminar_area',
      description: 'Elimina el área y todo lo cargado en su gestión (gastos, partidas, subcategorías y permisos de subcategoría). La categoría queda para volver a activarla. No permite áreas con pagos. Siempre requiere confirmación.',
      requiresConfirmation: true,
      summarize: (args) => `Eliminar el área "${String(args?.area || '').trim()}" con todo lo cargado`,
      parameters: projectOptionsSchema({ area: { type: 'string' } }),
      run: async (args) => {
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        if (!context.capabilities.can.deleteAreas) return { error: 'El usuario no puede eliminar áreas en este proyecto.' };
        const area = String(args?.area || '').trim();
        if (!context.activeAreas.includes(area)) return { error: `El área "${area}" no está activa.` };
        const areaExpenses = context.areaExpenses.filter((expense) => expense.area === area);
        const budgetItems = context.budgetItems.filter((item) => item.area === area);
        const rows = [...areaExpenses, ...budgetItems];
        if (rows.some((row) => hasRecordedPayment(row))) {
          return { error: `El área "${area}" tiene pagos registrados: no se puede eliminar. Podés desactivarla para que deje de figurar.` };
        }
        if (rows.length > 400) return { error: 'El área tiene demasiadas filas para eliminarla desde el asistente; hacelo desde la app.' };

        const nextSubcategories = { ...(context.meta.areaExpenseSubcategories || {}) };
        delete nextSubcategories[area];
        const nextBudgets = { ...(context.meta.areaExpenseSubcategoryBudgets || {}) };
        Object.keys(nextBudgets).forEach((key) => {
          if (key.split('||')[0] === area) delete nextBudgets[key];
        });
        const collaboratorsToUpdate = context.collaborators.filter((collaborator) => (
          (Array.isArray(collaborator.allowedSubcategories) ? collaborator.allowedSubcategories : [])
            .some((key) => key.split('||')[0] === area)
        ));
        const projectRef = doc(db, 'projects', context.projectId);
        await runTransaction(db, async (transaction) => {
          const projectSnapshot = await transaction.get(projectRef);
          if (!projectSnapshot.exists()) throw new Error('El proyecto ya no existe.');
          areaExpenses.forEach((expense) => {
            transaction.delete(doc(db, 'projects', context.projectId, 'areaExpenses', expense.id));
          });
          if (areaExpenses.length > 0) writeAudit(transaction, context, areaExpenses, 'areaExpenses', 'area_deleted');
          budgetItems.forEach((item) => {
            transaction.delete(doc(db, 'projects', context.projectId, 'budgetItems', item.id));
          });
          if (budgetItems.length > 0) writeAudit(transaction, context, budgetItems, 'budgetItems', 'area_deleted');
          transaction.update(projectRef, {
            activeAreas: context.activeAreas.filter((activeArea) => activeArea !== area),
            areaExpenseSubcategories: nextSubcategories,
            areaExpenseSubcategoryBudgets: nextBudgets,
            ...(budgetItems.length > 0 ? { budgetRevision: (Number(projectSnapshot.data().budgetRevision) || 0) + 1 } : {}),
            updatedAt: serverTimestamp(),
          });
          collaboratorsToUpdate.forEach((collaborator) => {
            transaction.update(doc(db, 'projects', context.projectId, 'collaborators', normalizeEmail(collaborator.email)), {
              allowedSubcategories: (Array.isArray(collaborator.allowedSubcategories) ? collaborator.allowedSubcategories : [])
                .filter((key) => key.split('||')[0] !== area),
              updatedAt: serverTimestamp(),
            });
          });
        });
        projectCache.delete(context.projectId);
        return {
          ok: true,
          mensaje: `Área "${area}" eliminada con ${rows.length} filas. La categoría quedó disponible para volver a activarla.`,
        };
      },
    });

    tools.push({
      name: 'adjuntar_factura',
      description: 'Adjunta el archivo que el usuario compartió en el chat (PDF, JPG o PNG) como factura de una fila de gasto. Siempre requiere confirmación.',
      requiresConfirmation: true,
      summarize: (args) => {
        const pendingName = getPendingFile?.()?.name || 'el archivo adjunto';
        return `Adjuntar "${pendingName}" como factura de "${String(args?.fila || '').trim()}"`;
      },
      parameters: projectOptionsSchema({ fila: { type: 'string', description: 'Id de la fila, proveedor o descripción del gasto' } }),
      run: async (args) => {
        const file = getPendingFile?.() || null;
        if (!file) {
          return { error: 'No hay ningún archivo adjunto en esta conversación. Pedile al usuario que adjunte el PDF (o la imagen) de nuevo.' };
        }
        const resolved = await resolveProject(args?.proyecto);
        if ('error' in resolved) return resolved;
        const context = resolved.context;
        const found = findRow(context, args?.fila);
        if ('error' in found) return found;
        const { collectionName, item } = found;
        const canUpload = collectionName === 'budgetItems'
          ? context.capabilities.can.editMainBudget && !context.activeAreas.includes(item.area)
          : canAssistantEditSubcategory(context.capabilities, item.area, item.subcategory);
        if (!canUpload) return { error: 'El usuario no tiene permiso para adjuntar facturas en esa fila.' };

        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
        const isAllowedByType = allowedTypes.includes(file.type);
        const isAllowedByName = /\.(pdf|jpe?g|png)$/i.test(file.name);
        if (!isAllowedByType && !isAllowedByName) return { error: 'La factura debe ser un PDF, JPG o PNG.' };
        const sizeError = validateMaxUploadSize(file, 'factura');
        if (sizeError) return { error: sizeError };

        const extension = (() => {
          const fromName = String(file.name.split('.').pop() || '').toLowerCase();
          if (['pdf', 'jpg', 'jpeg', 'png'].includes(fromName)) return fromName === 'jpeg' ? 'jpg' : fromName;
          if (file.type === 'image/jpeg') return 'jpg';
          if (file.type === 'image/png') return 'png';
          return 'pdf';
        })();
        const contentType = isAllowedByType
          ? file.type
          : extension === 'jpg' ? 'image/jpeg' : extension === 'png' ? 'image/png' : 'application/pdf';
        const areaFolder = sanitizeFileName(item.area || 'sin-area') || 'sin-area';
        const invoiceId = globalThis.crypto?.randomUUID?.() || `factura-${Date.now()}`;
        const baseName = sanitizeFileName(item.providerName || item.description || item.area || 'factura')
          .replace(/\.[^.]+$/, '')
          .slice(0, 70) || 'factura';
        const fileName = `factura-${baseName}-${String(item.id).slice(0, 8)}-${sanitizeFileName(invoiceId).slice(0, 12)}.${extension}`;
        const path = `projects/${context.projectId}/areas/${areaFolder}/facturas/${fileName}`;
        const uploadScope = context.capabilities.isAppAdmin
          ? 'global_admin'
          : context.capabilities.isProjectOwner
            ? 'project_owner'
            : context.capabilities.isProjectAdmin ? 'project_admin' : 'area_editor';

        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, file, {
          contentType,
          customMetadata: {
            projectId: context.projectId,
            expenseId: item.id,
            collectionName,
            uploadAccessScope: uploadScope,
            area: item.area || '',
            areaFolder,
            originalFileName: file.name,
            uploadedBy: userEmail,
          },
        });
        const url = await getDownloadURL(storageRef);
        const invoice = {
          id: invoiceId,
          fileName,
          originalFileName: file.name,
          url,
          path,
          contentType,
          size: file.size,
          uploadedAt: Timestamp.now(),
          uploadedBy: userEmail,
        };

        const rowRef = doc(db, 'projects', context.projectId, collectionName, item.id);
        await runTransaction(db, async (transaction) => {
          const snapshot = await transaction.get(rowRef);
          if (!snapshot.exists()) throw new Error('La fila ya no existe.');
          const data = snapshot.data();
          const storedInvoices = Array.isArray(data.invoices) ? data.invoices : [];
          const nextStoredInvoices = [...storedInvoices, invoice];
          transaction.update(rowRef, {
            ...(!data.invoice?.url && storedInvoices.length === 0 ? { invoice } : {}),
            invoices: nextStoredInvoices,
            invoiceStatus: 'pendiente',
            updatedAt: serverTimestamp(),
          });
        });
        projectCache.delete(context.projectId);
        return {
          ok: true,
          mensaje: `Factura "${file.name}" adjuntada a ${rowLabel(item, item.subcategory)}. Queda con estado pendiente, como cuando se sube desde la app.`,
          archivo: fileName,
          link: url,
        };
      },
    });
  }

  tools.push({
    name: 'consultar_ayuda',
    description: 'Devuelve la ayuda de GB GOAT: cómo funciona cada pestaña, cómo se cargan los gastos, proveedores, pagos, cajas, permisos y problemas frecuentes. No depende de los permisos del usuario.',
    parameters: {
      type: 'object',
      properties: {
        tema: { type: 'string', description: 'Tema o pregunta, por ejemplo "cargar un gasto", "link de proveedor", "pagos", "permisos"' },
      },
    },
    run: (args) => {
      const sections = searchAssistantHelp(args?.tema);
      const query = String(args?.tema || '').trim();
      return {
        ...(query ? {} : { temasDisponibles: listAssistantHelpTopics() }),
        secciones: sections.map((section) => ({
          id: section.id,
          titulo: section.title,
          contenido: section.content,
        })),
      };
    },
  });

  tools.push({
    name: 'que_puedo_hacer',
    description: 'Explica en lenguaje simple qué puede hacer el usuario en un proyecto (rol, pestañas, áreas) y qué tiene que pedir si le falta algo.',
    parameters: projectOptionsSchema(),
    run: async (args) => {
      const projects = await getProjects();
      const resolved = await resolveProject(args?.proyecto);
      if ('error' in resolved) {
        return {
          error: resolved.error,
          proyectos: projects.map((project) => ({ id: project.id, nombre: project.name })),
          nota: 'Cada proyecto tiene sus propios permisos: pedí el detalle de uno en particular.',
        };
      }

      const context = resolved.context;
      const capabilities = context.capabilities;
      const tabLabels: Record<string, string> = {
        presupuesto: 'Presu Ppal',
        areas: 'Áreas',
        cajas: 'Cajas',
        saldos: 'Finanzas',
        documentos: 'Documentos',
        resultado: 'Resultado',
        proveedores: 'Proveedores',
        equipo: 'Equipo',
        permisos: 'Permisos',
      };
      const missingTabs = Object.keys(tabLabels)
        .filter((tabId) => !capabilities.tabs.includes(tabId))
        .map((tabId) => tabLabels[tabId]);

      return {
        proyecto: context.projectName || context.projectId,
        rol: capabilities.role || 'sin rol asignado',
        resumen: describeAssistantScope(capabilities),
        areas: capabilities.areas.map((scope) => ({
          area: scope.area,
          acceso: scope.canEditArea ? 'completa' : scope.canEditSubcategories,
        })),
        pestanasHabilitadas: capabilities.tabs,
        sinAcceso: missingTabs,
        comoAmpliar: missingTabs.length > 0
          ? `Para tener ${missingTabs.join(', ')} hay que pedirle a un administrador del proyecto que habilite esas pestañas desde Permisos.`
          : 'Tenés acceso a todas las pestañas del proyecto.',
      };
    },
  });

  tools.push({
    name: 'saldos_cajas',
    description: 'Muestra los saldos de caja por responsable, las entregas pendientes de confirmación y el resumen de Caja General.',
    parameters: projectOptionsSchema(),
    run: async (args) => {
      const resolved = await resolveProject(args?.proyecto);
      if ('error' in resolved) return resolved;
      const context = resolved.context;
      if (!context.capabilities.tabs.includes('cajas')) {
        return { error: 'El usuario no tiene acceso a la pestaña Cajas en este proyecto.' };
      }

      const seeAll = context.capabilities.can.seeFullCash;
      const ownEmail = asText(context.userEmail);
      const movements = seeAll
        ? context.cashMovements
        : context.cashMovements.filter((movement) => (
          asText(movement.fromUserEmail) === ownEmail || asText(movement.toUserEmail) === ownEmail
        ));

      const general = calculateGeneralCashSummary(movements);
      const balances = calculateCashBalances(movements);
      const nameByEmail = new Map<string, string>();
      movements.forEach((movement) => {
        const to = asText(movement.toUserEmail);
        const from = asText(movement.fromUserEmail);
        if (to && movement.toUserName) nameByEmail.set(to, movement.toUserName);
        if (from && movement.fromUserName) nameByEmail.set(from, movement.fromUserName);
      });

      return {
        proyecto: context.projectName || context.projectId,
        alcance: seeAll ? 'todo el equipo' : 'sólo la caja del usuario',
        cajaGeneral: {
          salioDeCajaGeneral: round2(general.totalOut),
          entregasConfirmadas: round2(general.confirmedDeliveries),
          entregasPendientesDeConfirmacion: round2(general.pendingDeliveries),
          devolucionesConfirmadas: round2(general.confirmedReturns),
          devolucionesPendientes: round2(general.pendingReturns),
          pagosDirectosDeCajaGeneral: round2(general.directPayments),
        },
        saldosPorResponsable: Array.from(balances.entries())
          .filter(([, balance]) => Math.abs(balance) > 0.009)
          .map(([email, balance]) => ({
            persona: nameByEmail.get(email) || email,
            email,
            saldo: round2(balance),
          }))
          .sort((a, b) => b.saldo - a.saldo),
        entregasPendientes: movements
          .filter((movement) => movement.type === 'entrega' && movement.status === 'pending')
          .map((movement) => ({
            para: movement.toUserName || movement.toUserEmail || '',
            monto: round2(Number(movement.amount) || 0),
          })),
      };
    },
  });

  tools.push({
    name: 'listar_documentos',
    description: 'Lista los documentos del proyecto (contratos, seguros, locaciones, finanzas) con filtros por familia, tipo, área o texto.',
    parameters: projectOptionsSchema({
      familia: { type: 'string', description: 'contratos, seguros, locaciones o finanzas' },
      tipo: { type: 'string' },
      area: { type: 'string' },
      texto: { type: 'string' },
      limite: { type: 'number' },
    }),
    run: async (args) => {
      const resolved = await resolveProject(args?.proyecto);
      if ('error' in resolved) return resolved;
      const context = resolved.context;
      if (!context.capabilities.tabs.includes('documentos')) {
        return { error: 'El usuario no tiene acceso a la pestaña Documentos en este proyecto.' };
      }
      const family = asText(args?.familia);
      const type = asText(args?.tipo);
      const area = asText(args?.area);
      const text = asText(args?.texto);
      const today = new Date().toISOString().slice(0, 10);

      const rows = context.documents
        .filter((document) => (
          (!family || asText(document.family) === family)
          && (!type || asText(document.type) === type || asText(document.subtype) === type)
          && (!area || asText(document.area) === area)
          && (!text || [document.title, document.providerName, document.area, document.notes, document.originalFileName]
            .filter(Boolean)
            .some((value) => asText(value).includes(text)))
        ))
        .slice(0, limitOf(args?.limite, 25, 60))
        .map((document) => ({
          titulo: document.title || document.originalFileName || document.fileName || 'Documento',
          familia: document.family || '',
          tipo: document.type || document.subtype || '',
          area: document.area || '',
          proveedor: document.providerName || '',
          vence: document.expirationDate || '',
          vencido: Boolean(document.expirationDate && String(document.expirationDate).slice(0, 10) < today),
          notas: document.notes || '',
          archivo: document.originalFileName || document.fileName || '',
          link: document.url || '',
        }));

      return {
        proyecto: context.projectName || context.projectId,
        total: rows.length,
        documentos: rows,
        porFamilia: context.documents.reduce((acc, document) => {
          const key = document.family || 'otros';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      };
    },
  });

  if (loadProjectFinance) {
    tools.push({
      name: 'dashboard_proyectos',
      description: 'Resumen general de todos los proyectos visibles para el usuario: presupuesto, gastado, pagado, deuda y alertas por proyecto.',
      parameters: {
        type: 'object',
        properties: {
          estado: { type: 'string', description: 'Filtrar por estado del proyecto (por ejemplo Rodaje, Aprobado)' },
          texto: { type: 'string', description: 'Filtrar por nombre de proyecto o cliente' },
          limite: { type: 'number', description: 'Máximo de proyectos a detallar (por defecto 25)' },
        },
      },
      run: async (args) => {
        const projects = await getProjects();
        const status = asText(args?.estado);
        const text = asText(args?.texto);
        const limit = limitOf(args?.limite, 25, 40);
        const selected = projects
          .filter((project) => !text || asText(project.name).includes(text) || asText(project.clientName || '').includes(text))
          .slice(0, limit + 1);

        const rows: AssistantProjectFinance[] = [];
        for (const project of selected.slice(0, limit)) {
          const finance = await loadProjectFinance(project.id);
          if (!finance) continue;
          if (status && !asText(finance.status).includes(status)) continue;
          rows.push(finance);
        }

        const totals = rows.reduce((acc, row) => ({
          presupuesto: acc.presupuesto + row.budgetTotal,
          gastado: acc.gastado + row.spent,
          pagado: acc.pagado + row.paid,
          deuda: acc.deuda + row.debt,
        }), { presupuesto: 0, gastado: 0, pagado: 0, deuda: 0 });

        const alerts = rows
          .map((row) => {
            const motivos: string[] = [];
            if (row.overBudget > 0.009) motivos.push(`excedido por $${round2(row.overBudget).toLocaleString('es-AR')}`);
            else if (row.usagePercent >= 85) motivos.push(`al ${Math.round(row.usagePercent)}% del presupuesto`);
            if (row.debt > 0.009) motivos.push(`deuda $${round2(row.debt).toLocaleString('es-AR')}`);
            return motivos.length > 0 ? { proyecto: row.name, estado: row.status, motivos } : null;
          })
          .filter(Boolean);

        return {
          proyectosIncluidos: rows.length,
          proyectosVisibles: projects.length,
          recortado: projects.length > limit,
          totales: {
            presupuesto: round2(totals.presupuesto),
            gastado: round2(totals.gastado),
            pagado: round2(totals.pagado),
            deuda: round2(totals.deuda),
          },
          proyectos: rows.map((row) => ({
            nombre: row.name,
            estado: row.status,
            cliente: row.clientName,
            presupuesto: round2(row.budgetTotal),
            gastado: round2(row.spent),
            pagado: round2(row.paid),
            deuda: round2(row.debt),
            usoPorcentaje: Math.round(row.usagePercent * 10) / 10,
            lineasPendientes: row.pendingLines,
          })),
          alertas: alerts,
        };
      },
    });
  }

  tools.push({
    name: 'listar_equipo',
    description: 'Lista el equipo del proyecto: responsable, colaboradores con su rol y el personal cargado por rubro (proveedores asignados a partidas).',
    parameters: projectOptionsSchema(),
    run: async (args) => {
      const resolved = await resolveProject(args?.proyecto);
      if ('error' in resolved) return resolved;
      const context = resolved.context;
      if (!context.capabilities.tabs.includes('equipo')) {
        return { error: 'El usuario no tiene acceso a la pestaña Equipo en este proyecto.' };
      }
      const staffByArea = context.capabilities.areas.map((scope) => ({
        area: scope.area,
        personas: visibleBudgetItems(context)
          .filter((item) => item.area === scope.area && (item.providerName || (item as any).providerId))
          .map((item) => ({
            proveedor: item.providerName || 'Sin asignar',
            detalle: item.description || '',
            total: round2(Number(item.total) || 0),
          })),
      })).filter((group) => group.personas.length > 0);

      return {
        proyecto: context.projectName || context.projectId,
        colaboradores: [...context.collaborators],
        personalPorRubro: staffByArea,
      };
    },
  });

  if (isAppAdmin && loadClients) {
    let clientsCache: Array<{ id: string; businessName?: string; contactName?: string; email?: string; phone?: string; cuit?: string }> | null = null;
    tools.push({
      name: 'listar_clientes',
      description: 'Lista los clientes de la base global (sólo administradores de la aplicación).',
      parameters: {
        type: 'object',
        properties: { texto: { type: 'string' }, limite: { type: 'number' } },
      },
      run: async (args) => {
        if (!clientsCache) clientsCache = await loadClients();
        const text = asText(args?.texto);
        const rows = clientsCache
          .filter((client) => (
            !text
            || [client.businessName, client.contactName, client.email, client.cuit]
              .filter(Boolean)
              .some((value) => asText(value).includes(text))
          ))
          .slice(0, limitOf(args?.limite))
          .map((client) => ({
            id: client.id,
            nombre: client.businessName || client.contactName || client.id,
            contacto: client.contactName || '',
            email: client.email || '',
            telefono: client.phone || '',
            cuit: client.cuit || '',
          }));
        return { total: rows.length, clientes: rows };
      },
    });
  }

  if (isAppAdmin && loadUsers) {
    let usersCache: Array<{ id: string; email?: string; displayName?: string; role?: string }> | null = null;
    tools.push({
      name: 'listar_usuarios',
      description: 'Lista los usuarios dados de alta en la app con su rol global (sólo administradores de la aplicación).',
      parameters: {
        type: 'object',
        properties: { texto: { type: 'string' }, rol: { type: 'string' }, limite: { type: 'number' } },
      },
      run: async (args) => {
        if (!usersCache) usersCache = await loadUsers();
        const text = asText(args?.texto);
        const role = asText(args?.rol);
        const rows = usersCache
          .filter((entry) => (
            (!role || asText(entry.role) === role)
            && (!text || [entry.displayName, entry.email].filter(Boolean).some((value) => asText(value).includes(text)))
          ))
          .slice(0, limitOf(args?.limite))
          .map((entry) => ({
            nombre: entry.displayName || entry.email || entry.id,
            email: entry.email || '',
            rol: entry.role || 'colaborador',
          }));
        return { total: rows.length, usuarios: rows };
      },
    });
  }

  if (isAppAdmin && loadProjectFinance) {
    tools.push({
      name: 'reportes_pagos',
      description: 'Reporte de pagos de todos los proyectos: vencidos, de hoy, del mes en curso y sin fecha programada, con el detalle por proyecto.',
      parameters: {
        type: 'object',
        properties: { limite: { type: 'number', description: 'Máximo de proyectos a analizar (por defecto 25)' } },
      },
      run: async (args) => {
        const projects = await getProjects();
        const limit = limitOf(args?.limite, 25, 40);
        const lines: any[] = [];
        for (const project of projects.slice(0, limit)) {
          const finance = await loadProjectFinance(project.id);
          if (!finance) continue;
          lines.push(...finance.payableLines.filter((line) => line.debt > 0.009));
        }

        const todayLines = getTodayLines(lines as any);
        const overdueLines = getOverdueLines(lines as any);
        const unscheduledLines = getUnscheduledLines(lines as any);
        const calendar = buildPaymentCalendarDays(lines as any, new Date());
        const monthLines = calendar.filter((bucket) => bucket.isCurrentMonth).flatMap((bucket) => bucket.lines);

        const byProject = projects.slice(0, limit).map((project) => {
          const projectLines = lines.filter((line) => line.projectId === project.id);
          return {
            proyecto: project.name,
            vencido: round2(sumDebt(getOverdueLines(projectLines as any))),
            hoy: round2(sumDebt(getTodayLines(projectLines as any))),
            delMes: round2(sumDebt(monthLines.filter((line: any) => line.projectId === project.id))),
            sinFecha: round2(sumDebt(getUnscheduledLines(projectLines as any))),
            lineas: projectLines.length,
          };
        }).filter((row) => row.vencido > 0 || row.hoy > 0 || row.delMes > 0 || row.sinFecha > 0);

        return {
          proyectosAnalizados: Math.min(projects.length, limit),
          proyectosVisibles: projects.length,
          totalPendiente: round2(sumDebt(lines as any)),
          vencidos: { cantidad: overdueLines.length, monto: round2(sumDebt(overdueLines)) },
          deHoy: { cantidad: todayLines.length, monto: round2(sumDebt(todayLines)) },
          mesEnCurso: { cantidad: monthLines.length, monto: round2(sumDebt(monthLines)) },
          sinFechaProgramada: { cantidad: unscheduledLines.length, monto: round2(sumDebt(unscheduledLines)) },
          porProyecto: byProject.slice(0, 20),
        };
      },
    });
  }

  return tools;
};

export const assistantToolsForModel = (tools: AssistantTool[]) => tools.map((tool) => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  },
}));
