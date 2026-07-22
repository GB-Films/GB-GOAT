export type ProjectExpenseCollection = 'budgetItems' | 'areaExpenses';
export type ProjectExpenseSource = 'budget' | 'area';

export type ProjectExpenseEntry<T = any> = {
  item: T;
  collectionName: ProjectExpenseCollection;
  source: ProjectExpenseSource;
};

export const getItemTotal = (item: any) => Number(item?.total) || 0;

export const getPaymentTotal = (item: any) => {
  const history = Array.isArray(item?.paymentHistory) ? item.paymentHistory : [];
  return history.reduce((total: number, payment: any) => total + (Number(payment?.amount) || 0), 0);
};

export const getItemDebt = (item: any) => Math.max(0, getItemTotal(item) - getPaymentTotal(item));

export const getStandaloneBudgetItems = <T extends { area?: string }>(project: any, budgetItems: T[]) => {
  const activeAreas = Array.isArray(project?.activeAreas) ? project.activeAreas : [];
  return budgetItems.filter((item) => !activeAreas.includes(item.area));
};

export const getProjectExpenseEntries = <T extends { area?: string }>(
  project: any,
  budgetItems: T[],
  areaExpenses: T[],
): Array<ProjectExpenseEntry<T>> => [
  ...areaExpenses.map((item) => ({ item, collectionName: 'areaExpenses' as const, source: 'area' as const })),
  ...getStandaloneBudgetItems(project, budgetItems)
    .map((item) => ({ item, collectionName: 'budgetItems' as const, source: 'budget' as const })),
];

export const calculateProjectResult = (project: any, budgetItems: any[], areaExpenses: any[]) => {
  const configuredCategories = Array.isArray(project?.categories) ? project.categories : [];
  const categories = Array.from(new Set([
    ...configuredCategories,
    ...budgetItems.map((item) => item?.area).filter(Boolean),
    ...areaExpenses.map((item) => item?.area).filter(Boolean),
  ]));
  const categoryTotals = categories
    .map((area) => {
      const assigned = budgetItems
        .filter((item) => item?.area === area)
        .reduce((total, item) => total + getItemTotal(item), 0);
      const actual = areaExpenses
        .filter((item) => item?.area === area)
        .reduce((total, item) => total + getItemTotal(item), 0);
      return { area, total: actual > 0 ? actual : assigned };
    })
    .filter((item) => item.total > 0);

  const saleValue = Number(project?.budgetTotal) || 0;
  const directCostTotal = categoryTotals.reduce((total, item) => total + item.total, 0);
  const resultIncidences = project?.resultIncidences && typeof project.resultIncidences === 'object'
    ? project.resultIncidences
    : {};
  const expenseIncidencePercent = Object.entries(resultIncidences)
    .filter(([incidenceId]) => incidenceId !== 'margen')
    .reduce((total, [, value]) => total + (Number(value) || 0), 0);
  const expenseIncidenceTotal = saleValue * (expenseIncidencePercent / 100);
  const marginIncidencePercent = Number(resultIncidences.margen) || 0;
  const marginIncidence = saleValue * (marginIncidencePercent / 100);
  const totalCost = directCostTotal + expenseIncidenceTotal;
  const estimatedMargin = saleValue - totalCost;
  const margin = estimatedMargin + marginIncidence;
  const marginPercent = saleValue > 0 ? (margin / saleValue) * 100 : 0;

  return {
    saleValue,
    categoryTotals,
    directCostTotal,
    expenseIncidencePercent,
    expenseIncidenceTotal,
    marginIncidencePercent,
    marginIncidence,
    totalCost,
    estimatedMargin,
    margin,
    marginPercent,
  };
};

export const calculateProjectFinance = (project: any, budgetItems: any[], areaExpenses: any[]) => {
  const committedBudget = budgetItems.reduce((total, item) => total + getItemTotal(item), 0);
  const budgetTotal = Number(project?.budgetTotal) || committedBudget;
  const entries = getProjectExpenseEntries(project, budgetItems, areaExpenses);
  const spent = entries.reduce((total, entry) => total + getItemTotal(entry.item), 0);
  const paid = entries.reduce((total, entry) => total + getPaymentTotal(entry.item), 0);
  const debt = entries.reduce((total, entry) => total + getItemDebt(entry.item), 0);
  const usagePercent = budgetTotal > 0 ? (spent / budgetTotal) * 100 : 0;
  const margin = budgetTotal - spent;
  const marginPercent = budgetTotal > 0 ? (margin / budgetTotal) * 100 : 0;

  return {
    budgetTotal,
    committedBudget,
    spent,
    paid,
    debt,
    usagePercent,
    margin,
    marginPercent,
    overBudget: Math.max(0, spent - budgetTotal),
    unpaidLines: entries.filter((entry) => getItemDebt(entry.item) > 0.01).length,
    entries,
  };
};
