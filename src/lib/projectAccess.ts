export type ProjectRole = 'admin' | 'jefe_produccion' | 'jefe_area';

export const PROJECT_TAB_IDS = [
  'resumen',
  'presupuesto',
  'areas',
  'cajas',
  'saldos',
  'administracion',
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
  excludedSubcategories?: unknown;
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
      excludedSubcategories: [],
      canEditBudgetAreas: true,
      canViewBudgetTotals: true,
    };
  }

  return {
    allowedTabs: role === 'jefe_produccion'
      ? [...DEFAULT_PRODUCTION_LEAD_TABS]
      : [...DEFAULT_AREA_LEAD_TABS],
    allowedCategories: chosenCategories,
    excludedSubcategories: [],
    canEditBudgetAreas: true,
    canViewBudgetTotals: false,
  };
};

export const cleanAreaExpenseSubcategory = (value: unknown) => String(value || '').trim();

export const areaSubcategoryKey = (area: unknown, subcategory: unknown) => (
  `${String(area || '').trim()}||${cleanAreaExpenseSubcategory(subcategory)}`
);

export const areaFromSubcategoryKey = (key: string) => key.split('||')[0] || '';

export const canViewProjectSubcategory = (
  admin: boolean,
  access: ProjectAccess | null | undefined,
  area?: string | null,
  subcategory?: string | null,
) => {
  if (admin) return true;
  if (!area) return false;
  const key = areaSubcategoryKey(area, subcategory);
  if (asStringArray(access?.excludedSubcategories).includes(key)) return false;
  return asStringArray(access?.allowedCategories).includes(area)
    || (Boolean(cleanAreaExpenseSubcategory(subcategory)) && asStringArray(access?.allowedSubcategories).includes(key));
};

export const hasFullProjectAreaAccess = (
  admin: boolean,
  access: ProjectAccess | null | undefined,
  area?: string | null,
) => Boolean(area && (admin || (
  asStringArray(access?.allowedCategories).includes(area)
  && !asStringArray(access?.excludedSubcategories).some(key => areaFromSubcategoryKey(key) === area)
)));

export function toggleProjectAreaAccess(access: ProjectAccess, area: string) {
  const selected = asStringArray(access.allowedCategories).includes(area);
  return {
    allowedCategories: selected ? asStringArray(access.allowedCategories).filter(a => a !== area) : [...asStringArray(access.allowedCategories), area],
    allowedSubcategories: asStringArray(access.allowedSubcategories).filter(key => areaFromSubcategoryKey(key) !== area),
    excludedSubcategories: asStringArray(access.excludedSubcategories).filter(key => areaFromSubcategoryKey(key) !== area),
  };
}

export function toggleProjectSubcategoryAccess(access: ProjectAccess, area: string, subcategory: string) {
  const key = areaSubcategoryKey(area, subcategory);
  const inherited = asStringArray(access.allowedCategories).includes(area);
  const selected = canViewProjectSubcategory(false, access, area, subcategory);
  const explicit = asStringArray(access.allowedSubcategories).filter(k => k !== key);
  const excluded = asStringArray(access.excludedSubcategories).filter(k => k !== key);
  return {
    allowedCategories: asStringArray(access.allowedCategories),
    allowedSubcategories: !inherited && !selected ? [...explicit, key] : explicit,
    excludedSubcategories: inherited && selected ? [...excluded, key] : excluded,
  };
}

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
      && hasFullProjectAreaAccess(false, access, area)
    )
  )
);

export const canEditProjectSubcategory = (
  isProjectAdmin: boolean,
  access: ProjectAccess | null | undefined,
  area?: string | null,
  subcategory?: string | null,
) => Boolean(area && (isProjectAdmin || (
  access?.canEditBudgetAreas === true
  && asStringArray(access.allowedTabs).includes('areas')
  && canViewProjectSubcategory(false, access, area, subcategory)
)));

export const canEditExistingPayment = (isProjectAdmin: boolean, payment?: { id?: string; sharedRecordId?: string; createdBy?: string; createdByEmail?: string }, uid = '', email = '') =>
  isProjectAdmin || Boolean(payment?.id && !payment.sharedRecordId && uid && email && payment.createdBy === uid && payment.createdByEmail === email);

