import { collection, query, getDocs, or, where } from 'firebase/firestore';
import { db } from './firebase';
import { getPaymentTotal } from './projectFinance';
import { getProviderExpenseDocuments, uniqueProviderDocuments } from './providerDocuments';
import { financialDocumentsForExpense } from './providerFinancialRecords';
import { isInternalBudgetEstimate } from './internalBudgetEstimate';
import { providerFinanceRequest } from './providerFinance';
export async function loadProviderDetail(provider: any, profile: any) {

  const projectsRef = collection(db, 'projects');
  const projectsQuery = profile.role === 'admin'
    ? query(projectsRef)
    : query(
        projectsRef,
        or(
          where('createdBy', '==', profile.uid),
          where('collaboratorEmails', 'array-contains', String(profile.email || '').trim().toLowerCase())
        )
      );
  const [projectSnapshot, sharedRecordsSnapshot] = await Promise.all([
    getDocs(projectsQuery),
    profile.role === 'admin' ? getDocs(query(collection(db, 'providerFinancialRecords'), where('providerId', '==', provider.id))) : Promise.resolve(null),
  ]);
  const sharedRecords = sharedRecordsSnapshot?.docs.map(row => ({ ...row.data(), id: row.id })) || [];
  const projects = projectSnapshot.docs.map((item) => ({ id: item.id, ...item.data() as any }));
  const lines: any[] = [];

  await Promise.all(projects.map(async (project) => {
    const [budgetSnap, areaSnap] = await Promise.all([
      getDocs(collection(db, 'projects', project.id, 'budgetItems')),
      getDocs(collection(db, 'projects', project.id, 'areaExpenses')),
    ]);

    const activeAreas = Array.isArray(project.activeAreas) ? project.activeAreas : [];

    const pushLine = (item: any, source: 'Presupuesto Principal' | 'Gestion por Areas') => {
      if (isInternalBudgetEstimate(item)) return;
      if ((source === 'Presupuesto Principal') === activeAreas.includes(item.area)) return;
      (Array.isArray(item.paymentHistory) ? item.paymentHistory : []).forEach((payment: any, index: number) => {
        if (payment.method !== 'tercero' || payment.thirdPartyPayerId !== provider.id) return;
        const reimbursed = (Array.isArray(payment.reimbursements) ? payment.reimbursements : [])
          .reduce((sum: number, entry: any) => sum + (Number(entry.amount) || 0), 0);
        const amount = Number(payment.amount) || 0;
        lines.push({
          id: `${project.id}-${source}-${item.id}-reintegro-${payment.id || index}`,
          projectId: project.id, projectName: project.name || 'Sin nombre',
          area: item.area || 'Sin area', source: 'Reintegro a tercero',
          description: `Reintegro por ${item.description || 'gasto'}`,
          total: amount, paid: reimbursed, debt: Math.max(0, amount - reimbursed),
          paymentDate: item.paymentDate || '',
          payments: (payment.reimbursements || []).map((entry: any) => ({ id: entry.id, amount: entry.amount, detail: entry.detail || '', date: entry.date, loadedBy: entry.createdByEmail || '' })),
          invoiceDocuments: [], otherReceiptDocuments: [],
          paymentReceiptDocuments: getProviderExpenseDocuments({paymentHistory:payment.reimbursements}).paymentReceiptDocuments,
        });
      });
      if (item.providerId !== provider.id) return;
      const paid = getPaymentTotal(item);
      const payments = Array.isArray(item.paymentHistory)
        ? item.paymentHistory.map((payment: any, index: number) => ({
            id: payment.id || index,
            amount: Number(payment.amount) || 0,
            detail: payment.detail || '',
            date: payment.date || '',
            loadedBy: payment.createdByName || payment.paidByName || payment.createdByEmail || payment.paidByEmail || '',
          }))
        : [];
      const total = Number(item.total) || 0;
      lines.push({
        id: `${project.id}-${source}-${item.id}`,
        expenseId: item.id, collectionName: source === 'Presupuesto Principal' ? 'budgetItems' : 'areaExpenses',
        item,
        projectId: project.id,
        projectName: project.name || 'Sin nombre',
        area: item.area || 'Sin area',
        source,
        description: item.description || 'Sin descripcion',
        total,
        paid,
        debt: Math.max(0, total - paid),
        paymentDate: item.paymentDate || '',
        payments,
        ...getProviderExpenseDocuments(item),
      });
    };

    budgetSnap.docs.forEach((item) => pushLine({ id: item.id, ...item.data() }, 'Presupuesto Principal'));
    areaSnap.docs.forEach((item) => pushLine({ id: item.id, ...item.data() }, 'Gestion por Areas'));
  }));

  if (profile.role !== 'admin') await Promise.all(projects.map(async project => {
    const references = lines.filter(line => line.projectId === project.id).flatMap(line => [
      ...(line.item?.sharedInvoices || []).map((record: any) => record.id),
      ...(line.item?.sharedReceipts || []).map((record: any) => record.id),
      ...(line.item?.paymentHistory || []).map((payment: any) => payment.sharedRecordId),
    ]).filter(Boolean);
    const ids = [...new Set(references)];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const response = await providerFinanceRequest({ action: 'projectDocuments', projectId: project.id, recordIds: ids.slice(offset, offset + 100) }) as { records: any[] };
      sharedRecords.push(...response.records);
    }
  }));
  for (const line of lines) line.sharedDocuments = financialDocumentsForExpense(sharedRecords, line);
  const projectMap = new Map<string, any>();
  lines.forEach((line) => {
    if (!projectMap.has(line.projectId)) {
      projectMap.set(line.projectId, {
        id: line.projectId,
        name: line.projectName,
        total: 0,
        paid: 0,
        debt: 0,
        invoices: 0,
        receipts: 0,
        invoiceDocuments: [], otherReceiptDocuments: [], paymentReceiptDocuments: [], sharedInvoiceIds: [], sharedReceiptIds: [],
      });
    }
    const row = projectMap.get(line.projectId);
    row.total += line.total;
    row.paid += line.paid;
    row.debt += line.debt;
    row.invoiceDocuments = uniqueProviderDocuments([...row.invoiceDocuments, ...line.invoiceDocuments]);
    row.otherReceiptDocuments = uniqueProviderDocuments([...row.otherReceiptDocuments, ...line.otherReceiptDocuments]);
    row.paymentReceiptDocuments = uniqueProviderDocuments([...row.paymentReceiptDocuments, ...line.paymentReceiptDocuments]);
    row.sharedInvoiceIds = [...new Set([...row.sharedInvoiceIds, ...(line.item?.sharedInvoices || []).map((entry: any) => entry.id)])];
    row.sharedReceiptIds = [...new Set([...row.sharedReceiptIds, ...(line.item?.sharedReceipts || []).map((entry: any) => entry.id), ...(line.item?.sharedPaymentIds || [])])];
    row.invoices = row.invoiceDocuments.length + row.sharedInvoiceIds.length;
    row.receipts = row.otherReceiptDocuments.length + row.paymentReceiptDocuments.length + row.sharedReceiptIds.length;
  });

  const totals = Array.from(projectMap.values()).reduce((acc, line) => ({
    total: acc.total + line.total,
    paid: acc.paid + line.paid,
    debt: acc.debt + line.debt,
    invoices: acc.invoices + line.invoices,
    receipts: acc.receipts + line.receipts,
  }), { total: 0, paid: 0, debt: 0, invoices: 0, receipts: 0 });

  totals.invoices = uniqueProviderDocuments(lines.flatMap(line => line.invoiceDocuments)).length + new Set(lines.flatMap(line => (line.item?.sharedInvoices || []).map((entry: any) => entry.id))).size;
  totals.receipts = uniqueProviderDocuments(lines.flatMap(line => [...line.otherReceiptDocuments, ...line.paymentReceiptDocuments])).length + new Set(lines.flatMap(line => [...(line.item?.sharedReceipts || []).map((entry: any) => entry.id), ...(line.item?.sharedPaymentIds || [])])).size;

  return {
    provider,
    loading: false,
    projects: Array.from(projectMap.values()).sort((a, b) => b.total - a.total),
    totals,
    lines: lines.sort((a, b) => a.projectName.localeCompare(b.projectName, 'es')),
  };
}
