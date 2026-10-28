import { normalizeSearchText } from './identity';

export type ProviderPaymentStatus = 'pendiente' | 'parcial' | 'pagado';

export function providerPaymentStatus(balance: { debt: number; paid: number }): ProviderPaymentStatus {
  if (balance.debt <= 0.01) return 'pagado';
  return balance.paid > 0 ? 'parcial' : 'pendiente';
}

export function filterProviderBalances<T extends { name: string; debt: number; paid: number }>(groups: Array<{ area: string; rows: T[] }>, search: string, status: ProviderPaymentStatus | 'all') {
  const term = normalizeSearchText(search);
  return groups.map(group => ({ ...group, rows: group.rows.filter(row => (
    (status === 'all' || providerPaymentStatus(row) === status)
    && (!term || normalizeSearchText(row.name).includes(term))
  )) })).filter(group => group.rows.length > 0);
}

export function invoicePaymentAppearance(total: number, paid: number) {
  const status = providerPaymentStatus({ debt: total - paid, paid });
  if (status === 'pagado') return { status, label: 'Factura pagada', className: 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100' };
  if (status === 'parcial') return { status, label: 'Factura con pago parcial', className: 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100' };
  return { status, label: 'Factura pendiente de pago', className: 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100' };
}
