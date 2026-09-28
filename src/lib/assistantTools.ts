import {
  cleanAreaExpenseSubcategory,
} from './projectAccess';
import type { AssistantCapabilities } from './assistantCapabilities';

type Money = number;

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
  providers: AssistantProvider[];
};

export type AssistantTool = {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  run: (args: any) => unknown;
};

const asText = (value: unknown) => String(value || '').toLowerCase();

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

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

const limitOf = (value: unknown, fallback = 20, max = 50) => (
  Math.max(1, Math.min(max, Number(value) || fallback))
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

export const buildAssistantTools = (context: AssistantProjectContext): AssistantTool[] => {
  const { capabilities } = context;
  const visibleBudgetItems = (): AssistantBudgetItem[] => (
    context.budgetItems.filter((item) => (
      capabilities.isProjectAdmin || capabilities.access.allowedCategories.includes(item.area)
    ))
  );
  const visibleAreaExpenses = (): AssistantAreaExpense[] => (
    context.areaExpenses.filter((expense) => {
      if (capabilities.isProjectAdmin) return true;
      if (capabilities.access.allowedCategories.includes(expense.area)) return true;
      const subcategory = cleanAreaExpenseSubcategory(expense.subcategory);
      return Boolean(
        subcategory
        && capabilities.access.allowedSubcategories.includes(`${expense.area}||${subcategory}`),
      );
    })
  );
  const visibleCollaborators = capabilities.can.manageCollaborators || capabilities.tabs.includes('permissions')
    ? context.collaborators
    : [];
  const providerAccess = capabilities.tabs.includes('proveedores') || capabilities.can.createProviders;

  const tools: AssistantTool[] = [
    {
      name: 'resumen_proyecto',
      description: 'Devuelve los totales del proyecto: presupuesto principal, gastos por área, pagos registrados y saldos, dentro del alcance del usuario.',
      parameters: { type: 'object', properties: {} },
      run: () => {
        const budgetItems = visibleBudgetItems();
        const areaExpenses = visibleAreaExpenses();
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
          areasActivas: context.activeAreas,
          areasVisibles: capabilities.areas.map((scope) => scope.area),
        };
      },
    },
    {
      name: 'resumen_area',
      description: 'Devuelve el asignado, gastado y saldo de un área, con el detalle de sus subcategorías.',
      parameters: {
        type: 'object',
        properties: { area: { type: 'string', description: 'Nombre del área' } },
        required: ['area'],
      },
      run: (args) => {
        const area = String(args?.area || '').trim();
        const scope = capabilities.areas.find((entry) => asText(entry.area) === asText(area));
        if (!scope) return { error: 'El usuario no tiene acceso a esa área.' };
        const assigned = visibleBudgetItems().filter((item) => item.area === scope.area);
        const expenses = visibleAreaExpenses().filter((item) => item.area === scope.area);
        const groups = new Map<string, { subcategoria: string; presupuesto: number; gastado: number; gastos: number }>();
        expenses.forEach((expense) => {
          const subcategory = cleanAreaExpenseSubcategory(expense.subcategory);
          const key = subcategory || 'sin-subcategoria';
          const current = groups.get(key) || { subcategoria: subcategory || 'Sin subcategoría', presupuesto: 0, gastado: 0, gastos: 0 };
          current.gastado = round2(current.gastado + (Number(expense.total) || 0));
          current.gastos += 1;
          groups.set(key, current);
        });
        const assignedTotal = assigned.reduce((total, item) => total + (Number(item.total) || 0), 0);
        const spentTotal = expenses.reduce((total, item) => total + (Number(item.total) || 0), 0);
        return {
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
      description: 'Lista partidas del presupuesto principal, con filtro opcional por área o texto.',
      parameters: {
        type: 'object',
        properties: {
          area: { type: 'string' },
          texto: { type: 'string', description: 'Texto a buscar en proveedor o descripción' },
          limite: { type: 'number' },
        },
      },
      run: (args) => {
        const area = asText(args?.area);
        const text = asText(args?.texto);
        const rows = visibleBudgetItems()
          .filter((item) => (!area || asText(item.area) === area) && matchesText(item, text))
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .slice(0, limitOf(args?.limite))
          .map((item) => compactItem(item));
        return { total: rows.length, partidas: rows };
      },
    },
    {
      name: 'listar_gastos_area',
      description: 'Lista gastos cargados en Gestión por Áreas, con filtro opcional por área, subcategoría o texto.',
      parameters: {
        type: 'object',
        properties: {
          area: { type: 'string' },
          subcategoria: { type: 'string' },
          texto: { type: 'string' },
          limite: { type: 'number' },
        },
      },
      run: (args) => {
        const area = asText(args?.area);
        const subcategory = cleanAreaExpenseSubcategory(args?.subcategoria);
        const text = asText(args?.texto);
        const rows = visibleAreaExpenses()
          .filter((item) => (
            (!area || asText(item.area) === area)
            && (!subcategory || cleanAreaExpenseSubcategory(item.subcategory) === subcategory)
            && matchesText(item, text)
          ))
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .slice(0, limitOf(args?.limite))
          .map((item) => compactItem(item, item.subcategory));
        return { total: rows.length, gastos: rows };
      },
    },
    {
      name: 'pagos_pendientes',
      description: 'Lista los gastos con saldo pendiente, ordenados por fecha de pago programada.',
      parameters: {
        type: 'object',
        properties: {
          area: { type: 'string' },
          limite: { type: 'number' },
        },
      },
      run: (args) => {
        const area = asText(args?.area);
        const rows = [...visibleBudgetItems(), ...visibleAreaExpenses()]
          .filter((item) => !area || asText(item.area) === area)
          .filter((item) => (Number(item.total) || 0) - paidAmount(item) > 0.009)
          .sort((a, b) => String(a.paymentDate || '9999').localeCompare(String(b.paymentDate || '9999')))
          .slice(0, limitOf(args?.limite))
          .map((item) => compactItem(item, (item as AssistantAreaExpense).subcategory));
        return { total: rows.length, pendientes: rows };
      },
    },
  ];

  if (providerAccess) {
    tools.push({
      name: 'buscar_proveedores',
      description: 'Busca proveedores en la base global por nombre, CUIT o categoría.',
      parameters: {
        type: 'object',
        properties: { texto: { type: 'string' }, limite: { type: 'number' } },
      },
      run: (args) => {
        const text = asText(args?.texto);
        const rows = context.providers
          .filter((provider) => (
            !text
            || [providerLabel(provider), provider.cuit, provider.category].filter(Boolean).some((value) => asText(value).includes(text))
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

  if (visibleCollaborators.length > 0) {
    tools.push({
      name: 'listar_colaboradores',
      description: 'Lista los colaboradores del proyecto con su rol y áreas asignadas.',
      parameters: { type: 'object', properties: {} },
      run: () => ({
        colaboradores: visibleCollaborators.map((collaborator) => ({
          email: collaborator.email,
          nombre: collaborator.displayName || collaborator.email,
          rol: collaborator.role || '',
          areas: Array.isArray(collaborator.allowedCategories) ? collaborator.allowedCategories : [],
          subcategorias: Array.isArray(collaborator.allowedSubcategories) ? collaborator.allowedSubcategories : [],
        })),
      }),
    });
  }

  if (capabilities.tabs.includes('cajas')) {
    tools.push({
      name: 'resumen_cajas',
      description: 'Resume los movimientos de caja visibles para el usuario (entregas, devoluciones, pagos y reintegros).',
      parameters: { type: 'object', properties: {} },
      run: () => {
        const visible = context.cashMovements.filter((movement) => (
          capabilities.can.seeFullCash
          || asText(movement.fromUserEmail) === asText(context.userEmail)
          || asText(movement.toUserEmail) === asText(context.userEmail)
        ));
        const totals = visible.reduce((acc, movement) => {
          const key = movement.status || 'sin-estado';
          acc[key] = round2((acc[key] || 0) + (Number(movement.amount) || 0));
          return acc;
        }, {} as Record<string, Money>);
        return {
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
  }

  tools.push({
    name: 'ir_a_pantalla',
    description: 'Indica a la app que abra una pestaña del proyecto para el usuario.',
    parameters: {
      type: 'object',
      properties: {
        pestana: {
          type: 'string',
          enum: ['resumen', 'presupuesto', 'areas', 'cajas', 'saldos', 'documentos', 'resultado', 'proveedores', 'equipo', 'permisos'],
        },
      },
      required: ['pestana'],
    },
    run: (args) => {
      const tab = String(args?.pestana || '');
      if (!capabilities.tabs.includes(tab)) return { error: 'El usuario no tiene acceso a esa pestaña.' };
      return { abrirPestana: tab };
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
