import {
  canAssistantEditSubcategory,
  describeAssistantScope,
  type AssistantCapabilities,
} from './assistantCapabilities';
import { listAssistantHelpTopics, searchAssistantHelp } from './assistantHelp';
import { findProjectByReference, type AssistantProjectHandle } from './assistantData';
import { collection, doc, getDocs, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { cleanAreaExpenseSubcategory } from './projectAccess';

export type AssistantBudgetItem = {
  id: string;
  area: string;
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
};

export type AssistantCollaborator = {
  email: string;
  displayName?: string;
  role?: string;
  allowedCategories?: string[];
  allowedSubcategories?: string[];
};

export type AssistantProjectContext = {
  projectId: string;
  projectName: string;
  userEmail: string;
  capabilities: AssistantCapabilities;
  categories: string[];
  activeAreas: string[];
  budgetItems: AssistantBudgetItem[];
  areaExpenses: AssistantAreaExpense[];
  cashMovements: AssistantCashMovement[];
  collaborators: AssistantCollaborator[];
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
  canAccessProviders?: boolean;
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

// Herramientas de sólo lectura: cada una resuelve el proyecto pedido, lo carga
// con la sesión del usuario (las reglas de Firestore son el filtro real) y
// devuelve sólo lo que ese usuario puede ver.
export const buildAssistantTools = ({
  listProjects,
  loadProject,
  loadProviders,
  canAccessProviders = false,
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
