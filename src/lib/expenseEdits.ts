const toMoneyCents = (value: number) => Math.round((Number(value) || 0) * 100);

const FINANCIAL_IDENTITY_FIELDS = [
  'area', 'subcategory', 'providerId', 'providerName', 'description',
  'unit', 'quantity', 'unitPrice', 'total',
];

type ExpenseRecord = {
  updatedAt?: { seconds: number; nanoseconds: number };
  quantity?: number;
  unitPrice?: number;
  total?: number;
  paymentLocked?: boolean;
  paymentHistory?: Array<{ amount: number }>;
  [key: string]: unknown;
};

const sameVersion = (a?: ExpenseRecord['updatedAt'], b?: ExpenseRecord['updatedAt']) => (
  !a || !b || !Number.isInteger(b.seconds)
    || (a.seconds === b.seconds && a.nanoseconds === b.nanoseconds)
);

export function samePaymentTarget(
  opened: { description?: unknown; providerId?: unknown; total?: unknown; area?: unknown; subcategory?: unknown },
  latest: { description?: unknown; providerId?: unknown; total?: unknown; area?: unknown; subcategory?: unknown },
) {
  return (['description', 'providerId', 'total', 'area', 'subcategory'] as const).every((key) => (
    opened[key] === latest[key]
  ));
}

export function prepareExpenseEdit(
  latest: ExpenseRecord,
  updates: Record<string, unknown>,
  options: { isProjectAdmin: boolean; expectedUpdatedAt?: ExpenseRecord['updatedAt'] },
) {
  if (!sameVersion(latest.updatedAt, options.expectedUpdatedAt)) {
    throw new Error('EXPENSE_CHANGED');
  }

  const history = Array.isArray(latest.paymentHistory) ? latest.paymentHistory : [];
  const hasPayment = latest.paymentLocked === true || history.length > 0;
  if (hasPayment && !options.isProjectAdmin && FINANCIAL_IDENTITY_FIELDS.some((field) => field in updates)) {
    throw new Error('PAID_EXPENSE_LOCKED');
  }

  const next = { ...updates };
  if ('quantity' in next || 'unitPrice' in next) {
    const quantity = Number('quantity' in next ? next.quantity : latest.quantity);
    const unitPrice = Number('unitPrice' in next ? next.unitPrice : latest.unitPrice);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice) || quantity < 0 || unitPrice < 0) {
      throw new Error('INVALID_EXPENSE_AMOUNT');
    }
    next.total = quantity * unitPrice;
  }

  if ('total' in next) {
    const total = Number(next.total);
    const paidCents = history.reduce((sum, payment) => sum + toMoneyCents(payment.amount), 0);
    if (!Number.isFinite(total) || toMoneyCents(total) < paidCents) {
      throw new Error('EXPENSE_BELOW_PAYMENTS');
    }
  }
  return next;
}
