import { collection, doc, getDocFromServer, getDocsFromServer, query, runTransaction, serverTimestamp, where, type Firestore } from 'firebase/firestore';
import { categoryBudgetMap, directCategoryBudget, getCategoryBudget, validCategoryBudget } from './categoryBudgets';
import { resolveBudgetCategories } from './budgetCategories';
import { getSubcategoryBudgetCapacity } from './subcategoryBudget';

export type CategoryBudgetChange = {
  area: string;
  create: boolean;
  amount: number | null;
  expectedAmount: number | null;
};

export function validateCategoryBudgetReplacement(project: any, items: any[], nextBudgets: Record<string, number>) {
  const subcategories = project.areaExpenseSubcategoryBudgets || {};
  const areas = new Set([...resolveBudgetCategories(project), ...Object.keys(subcategories).map(key => subcategories[key]?.area || key.split('||')[0])]);
  for (const area of areas) {
    const capacity = getSubcategoryBudgetCapacity(getCategoryBudget({ categoryBudgets: nextBudgets }, items, area), subcategories, area);
    if (capacity.assignedElsewhere > capacity.categoryBudget) throw Error('SUBCATEGORY_BUDGET_EXCEEDED');
  }
}

export function planCategoryBudgetChange(project: any, items: any[], change: CategoryBudgetChange) {
  const area = change.create ? change.area.trim() : change.area;
  if (!area.trim() || (change.create && area.length > 120)) throw Error('Ingresá un nombre de categoría de hasta 120 caracteres.');
  if (change.amount !== null && !validCategoryBudget(change.amount)) throw Error('Ingresá un presupuesto válido, mayor o igual a cero.');
  const categories = resolveBudgetCategories(project);
  if (change.create ? categories.some(name => name.toLocaleLowerCase() === area.toLocaleLowerCase()) : !categories.includes(area)) {
    throw Error(change.create ? 'Esa categoría ya existe.' : 'La categoría cambió. Volvé a abrirla.');
  }
  if (!change.create && directCategoryBudget(project, area) !== change.expectedAmount) throw Error('El presupuesto cambió. Volvé a abrir la categoría.');
  const entries = { ...categoryBudgetMap(project), ...(change.amount === null ? {} : { [area]: Math.round(change.amount * 100) / 100 }) };
  if (change.amount === null) delete entries[area];
  const next = { ...project, categoryBudgets: entries };
  const capacity = getSubcategoryBudgetCapacity(getCategoryBudget(next, items, area), project.areaExpenseSubcategoryBudgets || {}, area);
  if (capacity.assignedElsewhere > capacity.categoryBudget) throw Error(`El presupuesto no puede ser menor a lo asignado a las subcategorías ($${capacity.assignedElsewhere.toLocaleString('es-AR')}).`);
  return { categoryBudgets: entries, categories: change.create ? [...categories, area] : categories };
}

// Read rows from the server, then fence that snapshot with the shared budget revision.
// The transaction rereads all allocations and subcategory limits on every retry.
export async function saveCategoryBudget(db: Firestore, projectId: string, change: CategoryBudgetChange, actorEmail: string) {
  const ref = doc(db, 'projects', projectId);
  const baseline = await getDocFromServer(ref);
  if (!baseline.exists()) throw Error('El proyecto ya no existe.');
  const rows = await getDocsFromServer(query(collection(ref, 'budgetItems'), where('area', '==', change.create ? change.area.trim() : change.area)));
  return runTransaction(db, async transaction => {
    const latest = await transaction.get(ref);
    if (!latest.exists()) throw Error('El proyecto ya no existe.');
    const project = latest.data();
    if ((project.budgetRevision || 0) !== (baseline.data().budgetRevision || 0)) throw Error('El presupuesto cambió. Volvé a abrir la categoría.');
    const next = planCategoryBudgetChange(project, rows.docs.map(row => row.data()), change);
    const saved = { ...next, executiveCategoryDefaultApplied: true, budgetRevision: (Number(project.budgetRevision) || 0) + 1 };
    transaction.update(ref, { ...saved, categoryBudgetUpdatedByEmail: actorEmail, categoryBudgetUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return saved;
  });
}
