export type ExpenseCollectionName = 'budgetItems' | 'areaExpenses';

interface CashMovementReference {
  type?: string;
  collectionName?: ExpenseCollectionName;
  itemId?: string;
}

interface ExpenseItem {
  id: string;
}

export type CashMovementTarget<T extends ExpenseItem = ExpenseItem> =
  | { status: 'not-payment' }
  | { status: 'unlinked' }
  | { status: 'missing'; collectionName: ExpenseCollectionName; itemId: string }
  | { status: 'found'; collectionName: ExpenseCollectionName; item: T };

export const resolveCashMovementTarget = <T extends ExpenseItem>(
  movement: CashMovementReference,
  budgetItems: T[],
  areaExpenses: T[],
): CashMovementTarget<T> => {
  if (movement.type !== 'pago') return { status: 'not-payment' };
  if (!movement.collectionName || !movement.itemId) return { status: 'unlinked' };

  const items = movement.collectionName === 'budgetItems' ? budgetItems : areaExpenses;
  const item = items.find((candidate) => candidate.id === movement.itemId);

  if (!item) {
    return {
      status: 'missing',
      collectionName: movement.collectionName,
      itemId: movement.itemId,
    };
  }

  return {
    status: 'found',
    collectionName: movement.collectionName,
    item,
  };
};
