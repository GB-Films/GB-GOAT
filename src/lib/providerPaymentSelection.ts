import { moneyCents } from './sharedAllocations';

export type PayableProviderLine = {
  projectId: string; projectName: string; collectionName: string; expenseId: string;
  description: string; debt: number;
};

export function payableProviderLines(lines: PayableProviderLine[]) {
  return lines.filter(line => line.expenseId && line.collectionName
    && Number.isFinite(line.debt) && moneyCents(line.debt) > 0);
}

export function paymentProjectChoices(lines: PayableProviderLine[]) {
  const projects = new Map<string, { id: string; name: string; balanceCents: number; lines: PayableProviderLine[] }>();
  for (const line of payableProviderLines(lines)) {
    const project = projects.get(line.projectId) || { id: line.projectId, name: line.projectName, balanceCents: 0, lines: [] };
    project.balanceCents += moneyCents(line.debt); project.lines.push(line);
    projects.set(line.projectId, project);
  }
  return [...projects.values()];
}

// Partial payments follow the order shown, with no repeated amounts per row.
export function allocateProviderPayment(lines: PayableProviderLine[], projectIds: string[], amount: number, invoices: any[] = []) {
  const selected = paymentProjectChoices(lines).filter(project => projectIds.includes(project.id)).flatMap(project => project.lines);
  let remaining = moneyCents(amount);
  const balance = selected.reduce((sum, line) => sum + moneyCents(line.debt), 0);
  if (!Number.isFinite(amount) || remaining <= 0 || remaining > balance) throw Error('El importe debe ser mayor a cero y no superar el saldo seleccionado.');
  const allocations = [];
  for (const line of selected) {
    if (!remaining) break;
    const amountCents = Math.min(remaining, moneyCents(line.debt));
    const sameExpense = (row: any) => row.projectId === line.projectId && row.collectionName === line.collectionName && row.itemId === line.expenseId;
    const linked = invoices.filter(invoice => invoice.kind === 'invoice' && invoice.status === 'active'
      && invoice.allocations.some(sameExpense));
    const invoice = linked.length === 1 ? linked[0] : null;
    const invoiceBalance = invoice ? invoice.allocations.filter(sameExpense).reduce((sum: number, row: any) => sum + row.amountCents, 0)
      - (Object.values(invoice.settlements || {}).flat() as any[]).filter(sameExpense).reduce((sum: number, row: any) => sum + row.amountCents, 0) : 0;
    allocations.push({ projectId: line.projectId, collectionName: line.collectionName, itemId: line.expenseId,
      amount: amountCents / 100, invoiceId: invoiceBalance >= amountCents ? invoice.id : '' });
    remaining -= amountCents;
  }
  if (allocations.length > 30) throw Error('Este pago abarca más de 30 gastos. Elegí menos proyectos y registralos en otro pago.');
  return allocations;
}
