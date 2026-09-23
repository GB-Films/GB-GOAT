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
  paid?: boolean;
  paymentHistory?: Array<{ amount: number }>;
  [key: string]: unknown;
};

const sameVersion = (a?: ExpenseRecord['updatedAt'], b?: ExpenseRecord['updatedAt']) => (
  !a || !b || !Number.isInteger(b.seconds)
    || (a.seconds === b.seconds && a.nanoseconds === b.nanoseconds)
);

export const hasRecordedPayment = (expense: Pick<ExpenseRecord, 'paymentLocked' | 'paymentHistory' | 'paid'>) => (
  expense.paymentLocked === true || expense.paid === true
    || (Array.isArray(expense.paymentHistory) && expense.paymentHistory.length > 0)
);

export const sameExpenseVersion = sameVersion;

const PAYMENT_TARGET_FIELDS = [
  'area', 'subcategory', 'providerId', 'providerName', 'description',
  'unit', 'quantity', 'unitPrice', 'total',
] as const;

type PaymentTarget = Partial<Record<(typeof PAYMENT_TARGET_FIELDS)[number], unknown>>;

export function samePaymentTarget(
  opened: PaymentTarget,
  latest: PaymentTarget,
) {
  return PAYMENT_TARGET_FIELDS.every((key) => (
    opened[key] === latest[key]
  ));
}

type PaymentRecord = {
  id?: string;
  amount: number;
  detail?: string;
  cashMovementId?: string;
  createdByEmail?: string;
  date?: unknown;
  receipt?: { path?: string } | null;
};

const dateKey = (value: unknown) => {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && 'seconds' in value) {
    const timestamp = value as { seconds: number; nanoseconds?: number };
    return timestamp.seconds * 1000 + Math.floor((timestamp.nanoseconds || 0) / 1e6);
  }
  return String(value ?? '');
};

const samePaymentRecord = (opened: PaymentRecord, latest: PaymentRecord) => (
  opened.id === latest.id
  && opened.cashMovementId === latest.cashMovementId
  && toMoneyCents(opened.amount) === toMoneyCents(latest.amount)
  && opened.createdByEmail === latest.createdByEmail
  && opened.detail === latest.detail
  && opened.receipt?.path === latest.receipt?.path
  && dateKey(opened.date) === dateKey(latest.date)
);

export function findCurrentPayment<T extends PaymentRecord>(
  history: T[], selected: T, selectedIndex: number,
): { payment: T; index: number } {
  const index = selected.id
    ? history.findIndex((payment) => payment.id === selected.id)
    : selectedIndex;
  if (index < 0 || !history[index] || !samePaymentRecord(selected, history[index])) {
    throw new Error('PAYMENT_CHANGED');
  }
  return { payment: history[index], index };
}

export function assertCashPaymentLink(
  movement: { type?: string; collectionName?: string; itemId?: string; paymentId?: string; amount?: number },
  expected: { collectionName: string; itemId: string; payment: PaymentRecord },
) {
  if (movement.type !== 'pago' || movement.collectionName !== expected.collectionName
    || movement.itemId !== expected.itemId || movement.paymentId !== expected.payment.id
    || toMoneyCents(movement.amount || 0) !== toMoneyCents(expected.payment.amount)) {
    throw new Error('CASH_LINK_MISMATCH');
  }
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
  const hasPayment = hasRecordedPayment(latest);
  if (hasPayment && FINANCIAL_IDENTITY_FIELDS.some((field) => field in updates)) {
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
