type SubcategoryBudgetEntry = number | {
  area?: string;
  budget?: number;
  budgetAssigned?: boolean;
};

const toCents = (value: unknown) => Math.max(0, Math.round((Number(value) || 0) * 100));

export const getSubcategoryBudgetCapacity = (
  categoryBudget: number,
  entries: Record<string, SubcategoryBudgetEntry>,
  area: string,
  currentKey = '',
) => {
  const categoryCents = toCents(categoryBudget);
  const assignedElsewhereCents = Object.entries(entries).reduce((sum, [key, entry]) => {
    if (key === currentKey) return sum;
    const entryArea = typeof entry === 'object' && entry?.area ? entry.area : key.split('||')[0];
    if (entryArea !== area) return sum;
    const amount = typeof entry === 'number' ? entry : entry?.budget;
    if (typeof entry === 'object' && entry?.budgetAssigned === false) return sum;
    return sum + toCents(amount);
  }, 0);

  return {
    categoryBudget: categoryCents / 100,
    assignedElsewhere: assignedElsewhereCents / 100,
    available: Math.max(0, categoryCents - assignedElsewhereCents) / 100,
    exceeds: (requested: number) => toCents(requested) + assignedElsewhereCents > categoryCents,
  };
};
