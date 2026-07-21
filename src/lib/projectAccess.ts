export type ProjectRole = 'admin' | 'jefe_produccion' | 'jefe_area';

export const PROJECT_TAB_IDS = [
  'resumen',
  'presupuesto',
  'areas',
  'cajas',
  'saldos',
  'documentos',
  'resultado',
  'proveedores',
  'equipo',
  'permisos',
] as const;

export const DEFAULT_AREA_LEAD_TABS = ['resumen', 'areas', 'cajas', 'saldos', 'documentos', 'proveedores'];
export const DEFAULT_PRODUCTION_LEAD_TABS = [...DEFAULT_AREA_LEAD_TABS, 'permisos'];

export type ProjectAccess = {
  role?: ProjectRole | string;
  allowedTabs?: unknown;
  allowedCategories?: unknown;
  allowedSubcategories?: unknown;
  canEditBudgetAreas?: boolean;
  canViewBudgetTotals?: boolean;
};

export const asStringArray = (value: unknown): string[] => (
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
);

export const normalizeProjectRole = (role: unknown): ProjectRole => {
  if (role === 'admin' || role === 'jefe_produccion' || role === 'jefe_area') return role;
  return 'jefe_area';
};

export const normalizeAllowedTabs = (allowedTabs: unknown, role?: ProjectRole | string) => {
  const normalizedRole = normalizeProjectRole(role);
  const normalized = asStringArray(allowedTabs).filter((tabId) => (
    (PROJECT_TAB_IDS as readonly string[]).includes(tabId)
  ));

  if (normalizedRole === 'admin') return normalized.length ? normalized : [...PROJECT_TAB_IDS];
  if (normalizedRole === 'jefe_produccion' && normalized.length === 0) return [...DEFAULT_PRODUCTION_LEAD_TABS];

  const looksLikeLegacyDefault = normalized.includes('presupuesto') && !normalized.includes('saldos');
  if (looksLikeLegacyDefault) {
    return Array.from(new Set([
      ...normalized.filter((tabId) => tabId !== 'presupuesto'),
      'saldos',
      'documentos',
      'proveedores',
    ]));
  }

  const looksLikeCurrentDefault = normalized.includes('areas')
    && normalized.includes('saldos')
    && !normalized.includes('presupuesto');
  if (looksLikeCurrentDefault && (!normalized.includes('proveedores') || !normalized.includes('documentos'))) {
    return Array.from(new Set([...normalized, 'documentos', 'proveedores']));
  }
  if (looksLikeCurrentDefault && !normalized.includes('cajas')) {
    return Array.from(new Set([...normalized, 'cajas']));
  }

  return normalized.length ? normalized : [...DEFAULT_AREA_LEAD_TABS];
};

export const getDefaultCollaboratorPermissions = (
  role: ProjectRole,
  categories: string[],
  selectedCategories?: string[],
) => {
  const chosenCategories = selectedCategories?.length ? selectedCategories : categories.slice(0, 1);

  if (role === 'admin') {
    return {
      allowedTabs: [...PROJECT_TAB_IDS],
      allowedCategories: categories,
      canEditBudgetAreas: true,
      canViewBudgetTotals: true,
    };
  }

  return {
    allowedTabs: role === 'jefe_produccion'
      ? [...DEFAULT_PRODUCTION_LEAD_TABS]
      : [...DEFAULT_AREA_LEAD_TABS],
    allowedCategories: chosenCategories,
    canEditBudgetAreas: true,
    canViewBudgetTotals: false,
  };
};

export const cleanAreaExpenseSubcategory = (value: unknown) => String(value || '').trim();

export const areaSubcategoryKey = (area: unknown, subcategory: unknown) => (
  `${String(area || '').trim()}||${cleanAreaExpenseSubcategory(subcategory)}`
);

export const areaFromSubcategoryKey = (key: string) => key.split('||')[0] || '';

export const canEditProjectArea = (
  isProjectAdmin: boolean,
  access: ProjectAccess | null | undefined,
  area?: string | null,
) => Boolean(
  area
  && (
    isProjectAdmin
    || (
      access?.canEditBudgetAreas === true
      && asStringArray(access.allowedCategories).includes(area)
      && asStringArray(access.allowedTabs).includes('areas')
    )
  )
);

export const canEditProjectSubcategory = (
  isProjectAdmin: boolean,
  access: ProjectAccess | null | undefined,
  area?: string | null,
  subcategory?: string | null,
) => {
  if (canEditProjectArea(isProjectAdmin, access, area)) return true;
  const normalizedSubcategory = cleanAreaExpenseSubcategory(subcategory);
  return Boolean(
    area
    && normalizedSubcategory
    && access?.canEditBudgetAreas === true
    && asStringArray(access.allowedTabs).includes('areas')
    && asStringArray(access.allowedSubcategories).includes(areaSubcategoryKey(area, normalizedSubcategory))
  );
};

export const canEditExistingPayment = (isProjectAdmin: boolean) => isProjectAdmin;

