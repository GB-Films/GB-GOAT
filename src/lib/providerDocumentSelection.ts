import { getExpenseInvoices } from './invoices';
import { moneyCents } from './sharedAllocations';
import { isInternalBudgetEstimate } from './internalBudgetEstimate';

export function documentProjectChoices(lines: any[], kind: 'invoice' | 'other', records: any[] = []) {
  const projects = new Map<string, { id: string; name: string; amountCents: number; lines: { projectId: string; collectionName: string; itemId: string; amount: number }[] }>();
  for (const line of lines) {
    if (isInternalBudgetEstimate(line.item)) continue;
    if (!line.expenseId || !['budgetItems', 'areaExpenses'].includes(line.collectionName)) continue;
    const stored = (line.item?.sharedInvoices || []).reduce((sum: number, row: any) => sum + row.amountCents, 0);
    const live = records.filter(record => record.kind === 'invoice' && record.status === 'active').flatMap(record => record.allocations || [])
      .filter(row => row.projectId === line.projectId && row.collectionName === line.collectionName && row.itemId === line.expenseId)
      .reduce((sum: number, row: any) => sum + row.amountCents, 0);
    const amountCents = kind === 'invoice' ? getExpenseInvoices(line.item).length ? 0 : Math.max(0, moneyCents(line.total) - Math.max(stored, live)) : moneyCents(line.total);
    if (amountCents <= 0) continue;
    const project = projects.get(line.projectId) || { id: line.projectId, name: line.projectName, amountCents: 0, lines: [] };
    project.amountCents += amountCents;
    project.lines.push({ projectId: line.projectId, collectionName: line.collectionName, itemId: line.expenseId, amount: amountCents / 100 });
    projects.set(line.projectId, project);
  }
  return [...projects.values()];
}

export function allocateProviderDocument(lines: any[], kind: 'invoice' | 'other', projectIds: string[], records: any[] = []) {
  const projects = documentProjectChoices(lines, kind, records);
  if (!projectIds.length) throw Error('Seleccioná al menos un proyecto.');
  if (projectIds.some(id => !projects.some(project => project.id === id))) throw Error('Cambió el saldo de un proyecto. Revisá la selección.');
  const allocations = projects.filter(project => projectIds.includes(project.id)).flatMap(project => project.lines);
  if (allocations.length > 30) throw Error('Elegí menos proyectos: esta carga abarca más de 30 movimientos.');
  return allocations;
}
