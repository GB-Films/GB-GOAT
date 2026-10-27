import type { CashMovement } from '../pages/project-detail/types';
import { normalizeEmail } from './identity';

export function cashMovementDate(value: any): Date | null {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate()
    : typeof value.seconds === 'number' ? new Date(value.seconds * 1000)
      : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`)
        : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function sortCashMovements(movements: CashMovement[]): CashMovement[] {
  const time = (movement: CashMovement) => (cashMovementDate(movement.date) || cashMovementDate(movement.createdAt))?.getTime() || 0;
  return [...movements].sort((a, b) => time(b) - time(a)
    || (cashMovementDate(b.createdAt)?.getTime() || 0) - (cashMovementDate(a.createdAt)?.getTime() || 0)
    || a.id.localeCompare(b.id));
}

type CashExpense = { id: string; providerName?: string; description?: string };

export function resolveCashBoxSelection(requested: string, admin: boolean, ownEmail: string, emails: string[]) {
  const own = normalizeEmail(ownEmail);
  if (!admin) return emails.includes(own) ? own : '';
  if (requested === 'all' || requested === 'general' || emails.includes(requested)) return requested;
  return 'all';
}

export function cashMovementCashbox(movement: CashMovement, people: Array<{ email: string; displayName?: string }> = []) {
  const person = (name?: string, email?: string) => ({
    name: name || people.find(person => normalizeEmail(person.email) === normalizeEmail(email))?.displayName || email || 'Sin identificar',
    email,
  });
  const from = movement.type === 'entrega' || movement.cashAccount === 'general' && (movement.type === 'pago' || movement.type === 'reintegro')
    ? { name: 'Caja General', email: undefined } : person(movement.fromUserName, movement.fromUserEmail);
  const to = movement.type === 'devolucion' ? { name: 'Caja General', email: undefined } : person(movement.toUserName, movement.toUserEmail);
  const betweenBoxes = movement.type === 'entrega' || movement.type === 'devolucion' || movement.type === 'transferencia';
  return { name: betweenBoxes ? `${from.name} → ${to.name}` : from.name,
    email: betweenBoxes ? [from.email, to.email].filter(Boolean).join(' → ') : from.email };
}

export function cashLedgerEntry(movement: CashMovement, account: string, budgetItems: CashExpense[], areaExpenses: CashExpense[]) {
  const overview = account === 'all';
  const general = account === 'general' || overview;
  const incoming = general ? movement.type === 'devolucion' : normalizeEmail(movement.toUserEmail) === normalizeEmail(account) && movement.type !== 'devolucion';
  const pending = (movement.type === 'entrega' || movement.type === 'devolucion') && movement.status === 'pending';
  const cancelled = movement.type === 'devolucion' && movement.status === 'cancelled';
  const items = movement.collectionName === 'budgetItems' ? budgetItems : movement.collectionName === 'areaExpenses' ? areaExpenses : [];
  const expense = items.find(item => item.id === movement.itemId);
  const label = movement.type === 'entrega' ? (general || pending ? 'Entrega de caja' : 'Caja recibida')
    : movement.type === 'devolucion' ? (general && !overview && !pending && !cancelled ? 'Devolución recibida' : 'Devolución de caja')
      : movement.type === 'transferencia' ? (overview ? 'Transferencia' : incoming ? 'Transferencia recibida' : 'Transferencia enviada')
        : movement.type === 'reintegro' ? 'Reintegro' : 'Pago';
  const person = (name?: string, email?: string) => ({ name: name || email || 'Sin identificar', email: name && name !== email ? email : undefined });
  const counterparty: { name: string; email?: string } = movement.type === 'entrega'
    ? general ? person(movement.toUserName, movement.toUserEmail) : { name: 'Caja General', email: movement.createdByName || movement.createdByEmail }
    : movement.type === 'devolucion'
      ? general ? person(movement.fromUserName, movement.fromUserEmail) : { name: 'Caja General', email: movement.toUserName || movement.toUserEmail }
      : movement.type === 'transferencia'
        ? incoming ? person(movement.fromUserName, movement.fromUserEmail) : person(movement.toUserName, movement.toUserEmail)
        : movement.type === 'reintegro'
          ? { name: movement.thirdPartyPayerName || 'Persona acreedora' }
          : { name: expense?.providerName || (movement as CashMovement & { providerName?: string }).providerName || 'Sin proveedor registrado' };
  const description = [movement.description || expense?.description, movement.notes].filter((value, index, values) => value && values.indexOf(value) === index).join(' · ');
  const date = cashMovementDate(movement.date) || cashMovementDate(movement.createdAt);
  return {
    label, counterparty, description: description || '—', pending, cancelled,
    date: date?.toLocaleDateString('es-AR') || '—',
    signedAmount: (incoming ? 1 : -1) * (Number(movement.amount) || 0),
  };
}
