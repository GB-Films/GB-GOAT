import { canAccessGeneralCash } from './generalCashAccess';

export const GENERAL_CASH_ACCOUNT = 'general' as const;

export type PaymentCashBoxOption = {
  id: 'personal' | 'general';
  account: 'personal' | 'general';
  label: string;
  balance: number;
  unlimited: boolean;
  ownerEmail: string;
  ownerName: string;
};

export const buildPaymentCashBoxOptions = ({
  isProjectAdmin,
  hasPersonalCashBox,
  personalBalance,
  currentUserEmail,
  currentUserName,
}: {
  isProjectAdmin: boolean;
  hasPersonalCashBox: boolean;
  personalBalance: number;
  currentUserEmail: string;
  currentUserName: string;
}): PaymentCashBoxOption[] => {
  const options: PaymentCashBoxOption[] = [];

  // La caja entregada al usuario debe quedar antes que la general, incluso si
  // quien registra el pago también es administrador del proyecto.
  if (hasPersonalCashBox) {
    options.push({
      id: 'personal',
      account: 'personal',
      label: currentUserName ? `Caja asignada a ${currentUserName}` : 'Mi caja asignada',
      balance: personalBalance,
      unlimited: false,
      ownerEmail: currentUserEmail,
      ownerName: currentUserName,
    });
  }

  if (isProjectAdmin && canAccessGeneralCash(currentUserEmail)) {
    options.push({
      id: 'general',
      account: 'general',
      label: 'Caja General',
      balance: 0,
      unlimited: true,
      ownerEmail: currentUserEmail,
      ownerName: currentUserName,
    });
  }

  return options;
};

export const isGeneralCashMovement = (movement?: any | null) => (
  movement?.cashAccount === GENERAL_CASH_ACCOUNT || movement?.type === 'entrega' || movement?.type === 'devolucion'
);

export const calculateCashBalances = (movements: any[]): Map<string, number> => {
  const balances = new Map<string, number>();
  const email = (value: unknown) => String(value || '').trim().toLowerCase();
  for (const movement of movements) {
    if (movement.status === 'cancelled') continue;
    if (movement.type === 'entrega' && movement.status === 'pending') continue;
    if (movement.type === 'devolucion' && movement.status !== 'confirmed') continue;
    const amount = Number(movement.amount) || 0;
    const toEmail = email(movement.toUserEmail);
    const fromEmail = email(movement.fromUserEmail);
    // Una devolución entra al registro de Caja General, no a la caja personal del administrador.
    if (toEmail && movement.type !== 'devolucion' && !(movement.type === 'transferencia' && movement.status === 'pending')) balances.set(toEmail, (balances.get(toEmail) || 0) + amount);
    if (fromEmail && (movement.type === 'devolucion' || !isGeneralCashMovement(movement))) {
      balances.set(fromEmail, (balances.get(fromEmail) || 0) - amount);
    }
  }
  return balances;
};

export const isPendingCashReceipt = (movement: { type: string; status?: string }) =>
  (movement.type === 'entrega' || movement.type === 'transferencia') && movement.status === 'pending';

export type CashBoxSummary = { balance: number; available: number; pendingOutgoing: number; pendingIncoming: number };

// The displayed balance moves on receipt. Spending checks keep using the
// reserved balance above, so pending funds can never be spent a second time.
export const calculateCashBoxSummaries = (movements: any[]): Map<string, CashBoxSummary> => {
  const availableBalances = calculateCashBalances(movements);
  const transfers = new Map<string, number>(), returns = new Map<string, number>(), incoming = new Map<string, number>();
  const add = (map: Map<string, number>, value: unknown, amount: number) => {
    const email = String(value || '').trim().toLowerCase();
    if (email) map.set(email, (map.get(email) || 0) + amount);
  };
  for (const movement of movements) {
    if (movement.status !== 'pending') continue;
    const amount = Math.round((Number(movement.amount) || 0) * 100);
    if (movement.type === 'transferencia') add(transfers, movement.fromUserEmail, amount);
    if (movement.type === 'devolucion') add(returns, movement.fromUserEmail, amount);
    if (isPendingCashReceipt(movement)) add(incoming, movement.toUserEmail, amount);
  }
  const emails = new Set([...availableBalances.keys(), ...transfers.keys(), ...returns.keys(), ...incoming.keys()]);
  return new Map([...emails].map(email => {
    const availableCents = Math.round((availableBalances.get(email) || 0) * 100);
    const reservedTransfers = transfers.get(email) || 0, reservedReturns = returns.get(email) || 0;
    return [email, { balance: (availableCents + reservedTransfers) / 100, available: (availableCents - reservedReturns) / 100,
      pendingOutgoing: (reservedTransfers + reservedReturns) / 100, pendingIncoming: (incoming.get(email) || 0) / 100 }];
  }));
};

export const calculateGeneralCashSummary = (movements: any[]) => {
  const generalMovements = movements.filter(isGeneralCashMovement);
  const confirmedDeliveries = generalMovements
    .filter((movement) => movement.type === 'entrega' && movement.status !== 'pending')
    .reduce((total, movement) => total + (Number(movement.amount) || 0), 0);
  const pendingDeliveries = generalMovements
    .filter((movement) => movement.type === 'entrega' && movement.status === 'pending')
    .reduce((total, movement) => total + (Number(movement.amount) || 0), 0);
  const directPayments = generalMovements
    .filter((movement) => movement.type === 'pago' || movement.type === 'reintegro')
    .reduce((total, movement) => total + (Number(movement.amount) || 0), 0);
  const confirmedReturns = generalMovements
    .filter((movement) => movement.type === 'devolucion' && movement.status === 'confirmed')
    .reduce((total, movement) => total + (Number(movement.amount) || 0), 0);
  const pendingReturns = generalMovements
    .filter((movement) => movement.type === 'devolucion' && movement.status === 'pending')
    .reduce((total, movement) => total + (Number(movement.amount) || 0), 0);

  return {
    movements: generalMovements,
    confirmedDeliveries,
    pendingDeliveries,
    directPayments,
    confirmedReturns,
    pendingReturns,
    totalOut: confirmedDeliveries + directPayments - confirmedReturns,
  };
};
