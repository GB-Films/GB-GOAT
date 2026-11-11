import type { PaymentCashBoxOption } from './cashBoxes';

export type CashMovementKind = 'entrega' | 'transferencia' | 'devolucion';
type MovementAccess = { hasAssignedCashBox: boolean; canDeliver: boolean; canTransfer: boolean; canReturn: boolean };
export function cashMovementOptions(access: MovementAccess) {
  const own = { kind: 'transferencia' as const, label: 'Transferir desde mi caja asignada' };
  const general = { kind: 'entrega' as const, label: 'Entregar desde Caja General' };
  const options: { kind: CashMovementKind; label: string }[] = [];
  if (access.hasAssignedCashBox && access.canTransfer) options.push(own);
  if (access.canDeliver) options.push(general);
  if (!access.hasAssignedCashBox && access.canTransfer) options.push(own);
  if (access.canReturn) options.push({ kind: 'devolucion', label: 'Devolver a Caja General' });
  return options;
}

const owns = (option: PaymentCashBoxOption, email: string) => option.account === 'personal'
  && option.ownerEmail.trim().toLowerCase() === email.trim().toLowerCase();
export function prioritizeAssignedCashBox(options: PaymentCashBoxOption[], email: string) {
  return [...options].sort((a, b) => Number(owns(b, email)) - Number(owns(a, email)));
}
export function resolvePaymentCashBoxChoice(options: PaymentCashBoxOption[], email: string, requested = '') {
  if (options.some(option => option.id === requested)) return requested;
  return options.find(option => owns(option, email))?.id || options[0]?.id || '';
}
