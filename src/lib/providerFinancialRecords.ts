export type SharedProviderDocument = { id: string; kind: 'invoice' | 'payment' | 'other'; name: string };

// Project rows refer to the original record; they never copy its file or amount.
export function financialDocumentsForExpense(records: any[], expense: { projectId: string; collectionName: string; expenseId: string; item?: any }): SharedProviderDocument[] {
  return records.filter(record => record.status === 'active' && record.file &&
    !(record.kind === 'payment' && expense.item?.paymentHistory?.some((payment: any) => payment.sharedRecordId === record.id && (payment.receipt?.path || payment.receipt?.url))) &&
    record.allocations?.some((row: any) => row.projectId === expense.projectId && row.collectionName === expense.collectionName && row.itemId === expense.expenseId))
    .map(record => ({ id: record.id, kind: record.kind, name: record.number || record.file.fileName || (record.kind === 'payment' ? 'Comprobante de pago' : 'Comprobante') }));
}

export function filterFinancialRecords(records: any[], kind: string, projectSearch: string) {
  const normalize = (value: string) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const term = normalize(projectSearch);
  return records.filter(record => (kind === 'all' || record.kind === kind) && (!term || record.allocations?.some((row: any) => normalize(row.projectName).includes(term))))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.id).localeCompare(String(b.id)));
}

export function financialRecordProjects(allocations: any[] = []) {
  const projects = new Map<string, { id: string; name: string; amountCents: number; descriptions: string[] }>();
  for (const row of allocations) {
    const project = projects.get(row.projectId) || { id: row.projectId, name: row.projectName || 'Proyecto', amountCents: 0, descriptions: [] };
    project.amountCents += Number(row.amountCents) || 0;
    if (row.description && !project.descriptions.includes(row.description)) project.descriptions.push(row.description);
    projects.set(row.projectId, project);
  }
  return [...projects.values()];
}
