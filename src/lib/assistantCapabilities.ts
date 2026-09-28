import {
  PROJECT_TAB_IDS,
  areaFromSubcategoryKey,
  asStringArray,
  canEditProjectArea,
  canEditProjectSubcategory,
  normalizeAllowedTabs,
  normalizeProjectRole,
  type ProjectAccess,
  type ProjectRole,
} from './projectAccess';
import { PROVIDER_CREATE_ROLES, PROVIDER_UPDATE_ROLES, hasGlobalRole, type GlobalRole } from './roles';

export type AssistantProjectRole = 'owner' | ProjectRole;

export type AssistantAreaScope = {
  area: string;
  canEditArea: boolean;
  canEditSubcategories: string[];
};

export type AssistantCapabilities = {
  projectId: string;
  projectName: string;
  globalRole: GlobalRole | null;
  isAppAdmin: boolean;
  isProjectOwner: boolean;
  isProjectAdmin: boolean;
  isProductionLead: boolean;
  role: AssistantProjectRole | null;
  tabs: string[];
  activeAreas: string[];
  areas: AssistantAreaScope[];
  access: {
    canEditBudgetAreas: boolean;
    allowedTabs: string[];
    allowedCategories: string[];
    allowedSubcategories: string[];
  };
  can: {
    viewProject: boolean;
    viewResults: boolean;
    editMainBudget: boolean;
    activateAreas: boolean;
    deleteAreas: boolean;
    manageSubcategoryBudgets: boolean;
    correctPayments: boolean;
    manageCollaborators: boolean;
    assignCollaboratorAreas: boolean;
    uploadDocuments: boolean;
    seeFullCash: boolean;
    createProviders: boolean;
    editProviders: boolean;
  };
};

type BuildAssistantCapabilitiesInput = {
  projectId: string;
  projectName?: string;
  projectCreatedBy?: string;
  categories?: unknown;
  activeAreas?: unknown;
  userId?: string;
  globalRole?: string | null;
  collaborator?: ProjectAccess | null;
};

const GLOBAL_ROLES: readonly GlobalRole[] = ['admin', 'ayudante_admin', 'jefe_produccion', 'colaborador'];

const toGlobalRole = (role: unknown): GlobalRole | null => (
  typeof role === 'string' && (GLOBAL_ROLES as readonly string[]).includes(role) ? role as GlobalRole : null
);

// Traduce los permisos reales de la app (rol global, propiedad del proyecto y
// documento de colaborador) al alcance con el que trabaja el asistente. Es la
// única fuente para filtrar herramientas y para redactar el contexto del bot.
export const buildAssistantCapabilities = ({
  projectId,
  projectName = '',
  projectCreatedBy = '',
  categories,
  activeAreas,
  userId = '',
  globalRole = null,
  collaborator = null,
}: BuildAssistantCapabilitiesInput): AssistantCapabilities => {
  const normalizedGlobalRole = toGlobalRole(globalRole);
  const isAppAdmin = normalizedGlobalRole === 'admin';
  const isProjectOwner = Boolean(userId && projectCreatedBy && userId === projectCreatedBy);
  const projectRole = collaborator ? normalizeProjectRole(collaborator.role) : null;
  const isProjectAdmin = isAppAdmin || isProjectOwner || projectRole === 'admin';
  const isProductionLead = projectRole === 'jefe_produccion';

  const access = {
    canEditBudgetAreas: isProjectAdmin || collaborator?.canEditBudgetAreas === true,
    allowedTabs: asStringArray(collaborator?.allowedTabs),
    allowedCategories: asStringArray(collaborator?.allowedCategories),
    allowedSubcategories: asStringArray(collaborator?.allowedSubcategories),
  };

  const tabs = isProjectAdmin
    ? [...PROJECT_TAB_IDS]
    : collaborator
      ? normalizeAllowedTabs(collaborator.allowedTabs, projectRole ?? undefined)
        .filter((tabId) => tabId !== 'resultado')
      : [];
  const activeAreaList = asStringArray(activeAreas);
  const categoriesList = asStringArray(categories);

  const areas: AssistantAreaScope[] = categoriesList
    .filter((area) => (
      isProjectAdmin
      || access.allowedCategories.includes(area)
      || access.allowedSubcategories.some((key) => areaFromSubcategoryKey(key) === area)
    ))
    .map((area) => ({
      area,
      canEditArea: canEditProjectArea(isProjectAdmin, access, area),
      canEditSubcategories: access.allowedSubcategories
        .filter((key) => areaFromSubcategoryKey(key) === area)
        .map((key) => key.split('||')[1] || '')
        .filter(Boolean),
    }));

  return {
    projectId,
    projectName,
    globalRole: normalizedGlobalRole,
    isAppAdmin,
    isProjectOwner,
    isProjectAdmin,
    isProductionLead,
    role: isProjectOwner ? 'owner' : projectRole,
    tabs,
    activeAreas: activeAreaList,
    areas,
    access,
    can: {
      viewProject: isProjectAdmin || Boolean(collaborator),
      viewResults: isProjectAdmin,
      editMainBudget: isProjectAdmin,
      activateAreas: isProjectAdmin,
      deleteAreas: isProjectAdmin,
      manageSubcategoryBudgets: tabs.includes('areas') && (isProjectAdmin || isProductionLead),
      correctPayments: isProjectAdmin,
      manageCollaborators: isProjectAdmin,
      assignCollaboratorAreas: isProjectAdmin || isProductionLead,
      uploadDocuments: isProjectAdmin || (isProductionLead && tabs.includes('documentos')),
      seeFullCash: isProjectAdmin || isProductionLead,
      createProviders: hasGlobalRole(normalizedGlobalRole, PROVIDER_CREATE_ROLES),
      editProviders: hasGlobalRole(normalizedGlobalRole, PROVIDER_UPDATE_ROLES),
    },
  };
};

export const canAssistantEditArea = (capabilities: AssistantCapabilities, area?: string | null) => (
  canEditProjectArea(capabilities.isProjectAdmin, capabilities.access, area)
);

export const canAssistantEditSubcategory = (
  capabilities: AssistantCapabilities,
  area?: string | null,
  subcategory?: string | null,
) => canEditProjectSubcategory(capabilities.isProjectAdmin, capabilities.access, area, subcategory);

export const canAssistantManagePayment = (
  capabilities: AssistantCapabilities,
  collectionName: 'budgetItems' | 'areaExpenses',
  item: { area?: string | null; subcategory?: string | null },
) => {
  if (collectionName === 'budgetItems') {
    return capabilities.can.editMainBudget && !capabilities.activeAreas.includes(String(item.area || ''));
  }
  return capabilities.can.editMainBudget
    || canAssistantEditSubcategory(capabilities, item.area, item.subcategory);
};

export const canAssistantCreateProviderInvite = (
  capabilities: AssistantCapabilities,
  collectionName: 'budgetItems' | 'areaExpenses',
  item: { area?: string | null; subcategory?: string | null },
) => canAssistantManagePayment(capabilities, collectionName, item);

export const canAssistantDeleteAreaExpense = (
  capabilities: AssistantCapabilities,
  expense: { area?: string | null; subcategory?: string | null; paymentLocked?: boolean; paid?: boolean; paymentHistory?: unknown[] },
) => {
  const hasRecordedPayment = expense.paymentLocked === true
    || expense.paid === true
    || (Array.isArray(expense.paymentHistory) && expense.paymentHistory.length > 0);
  return !hasRecordedPayment && canAssistantEditSubcategory(capabilities, expense.area, expense.subcategory);
};

const ROLE_LABELS: Record<AssistantProjectRole, string> = {
  owner: 'dueño del proyecto',
  admin: 'administrador del proyecto',
  jefe_produccion: 'jefe de producción',
  jefe_area: 'jefe de área',
};

// Texto listo para el prompt del sistema: dice quién es el usuario, qué puede
// ver y qué puede hacer, para que el bot no prometa acciones fuera de alcance.
export const describeAssistantScope = (capabilities: AssistantCapabilities) => {
  const lines: string[] = [];
  lines.push(`Proyecto: ${capabilities.projectName || capabilities.projectId}`);
  if (capabilities.isAppAdmin) lines.push('Rol global: administrador de la aplicación.');
  lines.push(`Rol en el proyecto: ${capabilities.role ? ROLE_LABELS[capabilities.role] : 'sin rol asignado'}.`);

  const tabs = capabilities.tabs.length > 0 ? capabilities.tabs.join(', ') : 'ninguna';
  lines.push(`Pestañas habilitadas: ${tabs}.`);

  if (capabilities.areas.length === 0) {
    lines.push('Áreas habilitadas: ninguna.');
  } else {
    lines.push(`Áreas habilitadas: ${capabilities.areas.map((scope) => (
      scope.canEditArea
        ? `${scope.area} (completa)`
        : `${scope.area} (subcategorías: ${scope.canEditSubcategories.join(', ') || 'solo lectura'})`
    )).join('; ')}.`);
  }

  const abilities = [
    capabilities.can.editMainBudget && 'editar el presupuesto principal',
    capabilities.can.activateAreas && 'activar áreas',
    capabilities.can.deleteAreas && 'eliminar áreas con su información',
    capabilities.can.manageSubcategoryBudgets && 'crear y editar subcategorías con presupuesto',
    capabilities.can.correctPayments && 'corregir o eliminar pagos registrados',
    capabilities.can.manageCollaborators && 'gestionar colaboradores y permisos',
    capabilities.can.assignCollaboratorAreas && 'asignar áreas a colaboradores',
    capabilities.can.uploadDocuments && 'subir documentos del proyecto',
    capabilities.can.seeFullCash && 'ver la caja de todo el equipo',
    capabilities.can.createProviders && 'crear proveedores en la base global',
    capabilities.can.editProviders && 'editar proveedores de la base global',
  ].filter(Boolean) as string[];
  lines.push(`Puede: ${abilities.length > 0 ? abilities.join('; ') : 'solo consultar información'}.`);
  if (!capabilities.can.viewResults) {
    lines.push('No puede ver Resultado ni los totales globales del proyecto.');
  }
  return lines.join('\n');
};
