import { isPendingCashReceipt } from '../../lib/cashBoxes';
import { normalizeEmail } from '../../lib/identity';
import type { CashMovement } from './types';

export function CashReceiptButton({ movement, currentUserEmail, canReceiveGeneralReturn, busy, onConfirmDelivery, onConfirmReturn }: {
  movement: CashMovement; currentUserEmail: string; canReceiveGeneralReturn: boolean; busy: boolean;
  onConfirmDelivery: (movement: CashMovement) => void;
  onConfirmReturn: (movement: CashMovement) => void;
}) {
  if (!normalizeEmail(currentUserEmail) || movement.status !== 'pending' || normalizeEmail(movement.toUserEmail) !== normalizeEmail(currentUserEmail)
    || !(isPendingCashReceipt(movement) || movement.type === 'devolucion' && canReceiveGeneralReturn)) return null;
  return <button type="button" disabled={busy}
    onClick={() => (movement.type === 'devolucion' ? onConfirmReturn : onConfirmDelivery)(movement)}
    className="rounded-md bg-amber-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
    {busy ? 'Confirmando…' : 'Confirmar recepción'}
  </button>;
}
