export const GENERAL_CASH_ACCOUNT = 'general' as const;

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
