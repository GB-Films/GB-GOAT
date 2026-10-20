export const DEFAULT_BUDGET_CATEGORIES = [
  'Ejecutiva', 'Producción', 'Dirección', 'Guion', 'Arte', 'Vestuario',
  'Maquillaje', 'Fotografía', 'Sonido', 'Logística', 'Post-producción', 'Varios',
];

// Older projects may store [] while displaying the default template. Once a
// category edit is saved, an empty list is intentional and must stay empty.
export function resolveBudgetCategories(project: { categories?: unknown; executiveCategoryDefaultApplied?: unknown; activeAreas?: unknown }) {
  const saved = Array.isArray(project.categories) ? project.categories.filter((value): value is string => typeof value === 'string' && value.length > 0) : [];
  const initialized = project.executiveCategoryDefaultApplied === true;
  const categories = saved.length || initialized ? [...saved] : [...DEFAULT_BUDGET_CATEGORIES];
  if (!initialized && saved.length && !saved.some(value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes('ejecutiv'))) categories.unshift('Ejecutiva');
  // An active area's expenses must remain visible, even in inconsistent legacy data.
  const active = Array.isArray(project.activeAreas) ? project.activeAreas.filter((value): value is string => typeof value === 'string' && value.length > 0) : [];
  return [...new Set([...categories, ...active])];
}

export function categoryDeletionPlan(project: Parameters<typeof resolveBudgetCategories>[0], area: string) {
  if (Array.isArray(project.activeAreas) && project.activeAreas.includes(area)) throw new Error('CATEGORY_ACTIVE');
  return { categories: resolveBudgetCategories(project).filter(category => category !== area), executiveCategoryDefaultApplied: true };
}
