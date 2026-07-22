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

  if (isProjectAdmin) {
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
  movement?.cashAccount === GENERAL_CASH_ACCOUNT || movement?.type === 'entrega'
);

export const calculateGeneralCashSummary = (movements: any[]) => {
  const generalMovements = movements.filter(isGeneralCashMovement);
  const confirmedDeliveries = generalMovements
    .filter((movement) => movement.type === 'entrega' && movement.status !== 'pending')
    .reduce((total, movement) => total + (Number(movement.amount) || 0), 0);
  const pendingDeliveries = generalMovements
    .filter((movement) => movement.type === 'entrega' && movement.status === 'pending')
    .reduce((total, movement) => total + (Number(movement.amount) || 0), 0);
  const directPayments = generalMovements
    .filter((movement) => movement.type === 'pago')
    .reduce((total, movement) => total + (Number(movement.amount) || 0), 0);

  return {
    movements: generalMovements,
    confirmedDeliveries,
    pendingDeliveries,
    directPayments,
    totalOut: confirmedDeliveries + directPayments,
  };
};
