const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');

const fail = message => { throw new HttpsError('failed-precondition', message); };
const text = (value, max = 500) => String(value || '').trim().slice(0, max);
const id = value => {
  const result = text(value, 160);
  if (!/^[\w-]{1,160}$/.test(result)) fail('Identificador inválido.');
  return result;
};
const cents = value => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e10) fail('Importe inválido.');
  return Math.round(amount * 100);
};
const key = row => `${row.projectId}/${row.collectionName}/${row.itemId}`;
const list = value => Array.isArray(value) ? value : [];
const paid = row => list(row.paymentHistory).reduce((sum, payment) => sum + cents(payment.amount), 0);
const projectIndex = records => ({
  records,
  managedAreas: [...new Set(Object.values(records).flat().filter(row => row.collectionName === 'areaExpenses').map(row => row.area))],
  budgetAreas: [...new Set(Object.values(records).flat().filter(row => row.collectionName === 'budgetItems').map(row => row.area))],
});
function normalizeRecord(input) {
  if (!['invoice', 'payment', 'other'].includes(input.kind)) fail('Tipo de comprobante inválido.');
  if (input.currency && !['ARS', 'USD'].includes(input.currency)) fail('Moneda inválida.');
  if (list(input.allocations).length > 30) fail('Elegí hasta 30 gastos.');
  const result = {
    providerId: id(input.providerId), kind: input.kind, date: text(input.date, 10),
    notes: text(input.notes, 2000), currency: input.currency === 'USD' ? 'USD' : 'ARS',
    issuerName: text(input.issuerName), issuerCuit: text(input.issuerCuit).replace(/\D/g, ''),
    recipientCuit: text(input.recipientCuit).replace(/\D/g, ''), number: text(input.number, 60).toUpperCase(),
    payeeName: text(input.payeeName), account: text(input.account), method: text(input.method, 30),
    reference: text(input.reference, 160),
    cashProjectId: input.cashProjectId ? id(input.cashProjectId) : '',
    netCents: cents(input.net || 0), totalCents: cents(input.total || 0),
    withheldCents: cents(input.withheld || 0), feeCents: cents(input.fee || 0),
    exchangeRate: input.currency === 'USD' ? Number(input.exchangeRate) : 1,
    allocations: list(input.allocations).map(row => ({
      projectId: id(row.projectId), collectionName: text(row.collectionName), itemId: id(row.itemId),
      amountCents: cents(row.amount), invoiceId: row.invoiceId ? id(row.invoiceId) : '',
    })),
  };
  const date = new Date(result.date + 'T12:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.date) || Number.isNaN(date.getTime())
    || date.toISOString().slice(0, 10) !== result.date) fail('Fecha inválida.');
  if (!(result.exchangeRate > 0 && result.exchangeRate <= 1e6)) fail('Indicá la cotización a pesos.');
  if (result.allocations.length > 30 || new Set(result.allocations.map(key)).size !== result.allocations.length) fail('Elegí hasta 30 gastos, sin repetir filas.');
  if (result.allocations.some(row => !['areaExpenses', 'budgetItems'].includes(row.collectionName) || row.amountCents <= 0)) fail('Aplicación inválida.');
  result.netArsCents = Math.round(result.netCents * result.exchangeRate);
  if (!Number.isSafeInteger(result.netArsCents)) fail('El importe convertido supera el límite permitido.');
  if (input.kind !== 'other') {
    if (!result.allocations.length || result.netArsCents <= 0
      || result.allocations.reduce((sum, row) => sum + row.amountCents, 0) !== result.netArsCents) fail('Las aplicaciones deben sumar exactamente el neto aplicado en pesos.');
    if (result.totalCents <= 0 || result.netCents > result.totalCents + (input.kind === 'payment' ? result.withheldCents : 0)) fail('Revisá neto, total y retenciones.');
  }
  if (input.kind === 'invoice') {
    if (!result.issuerName || result.issuerCuit.length !== 11 || result.recipientCuit.length !== 11
      || !/^(A|B|C|E|FCE-A|FCE-B) \d{5}-\d{8}$/.test(result.number)) fail('Completá emisor, ambos CUIT y número (ejemplo: C 00001-00000123).');
    if (result.allocations.some(row => row.invoiceId)) fail('Una factura se aplica a gastos, no a otras facturas.');
    result.fiscalKey = createHash('sha256').update([result.issuerCuit, result.recipientCuit, result.number].join('|')).digest('hex');
  }
  if (input.kind === 'payment') {
    if (!result.payeeName || !result.account || !result.reference || !['transfer', 'cash'].includes(result.method)) fail('Indicá destinatario, cuenta, referencia única y medio del pago.');
    result.paymentKey = createHash('sha256').update([result.account.toUpperCase(), result.reference.toUpperCase()].join('|')).digest('hex');
    if (result.method === 'cash' && (!result.cashProjectId || result.currency !== 'ARS'
      || !result.allocations.some(row => row.projectId === result.cashProjectId))) fail('El efectivo se registra una sola vez en Caja General de un proyecto aplicado, en pesos.');
  }
  if (input.kind === 'other' && !result.notes) fail('Indicá qué respalda el comprobante.');
  return result;
}

function createProviderFinanceHandler({ db, timestamp, verifyFile, readFile }) {
  return async request => {
    if (!request.auth?.uid || !request.auth.token?.email) throw new HttpsError('unauthenticated', 'Iniciá sesión.');
    const user = await db.doc(`users/${request.auth.uid}`).get();
    if (request.auth.token.email !== 'info@granbertafilms.com' && user.data()?.role !== 'admin') throw new HttpsError('permission-denied', 'Sólo administradores pueden registrar operaciones compartidas.');
    const input = request.data || {};
    const recordId = id(input.id);
    const recordRef = db.doc(`providerFinancialRecords/${recordId}`);
    const actor = { uid: request.auth.uid, email: request.auth.token.email };
    const now = timestamp();
    if (input.action === 'download') {
      const snapshot = await recordRef.get();
      const file = snapshot.data()?.file;
      if (!file || !readFile) fail('El registro no tiene un archivo descargable.');
      return { fileName: file.fileName, contentType: file.contentType, base64: await readFile(file) };
    }
    if (input.action === 'cancel') {
      const reason = text(input.reason, 1000);
      if (!reason) fail('Indicá el motivo de anulación.');
      return db.runTransaction(async tx => {
        const snapshot = await tx.get(recordRef);
        if (!snapshot.exists) fail('No se encontró el registro.');
        const record = snapshot.data();
        if (record.status === 'cancelled') return { id: recordId, status: 'cancelled' };
        if (record.kind === 'invoice' && Object.keys(record.settlements || {}).length) fail('Primero anulá los pagos aplicados a esta factura.');
        const refs = record.allocations.map(row => db.doc(`projects/${key(row)}`));
        const rows = await Promise.all(refs.map(ref => tx.get(ref)));
        const invoiceIds = [...new Set(record.allocations.map(row => row.invoiceId).filter(Boolean))];
        const invoices = await Promise.all(invoiceIds.map(value => tx.get(db.doc(`providerFinancialRecords/${value}`))));
        const projectIds = [...new Set(record.allocations.map(row => row.projectId))];
        const indices = await Promise.all(projectIds.map(value => tx.get(db.doc(`providerFinanceProjectIndex/${value}`))));
        const cashRef = record.cashProjectId && record.kind === 'payment' && record.method === 'cash'
          ? db.doc(`projects/${record.cashProjectId}/cashMovements/shared-${recordId}`) : null;
        const cash = cashRef ? await tx.get(cashRef) : null;
        rows.forEach((snapshot, index) => {
          if (!snapshot.exists) fail('Un gasto fue eliminado: revisá la operación antes de anular.');
          const row = snapshot.data();
          const field = record.kind === 'invoice' ? 'sharedInvoices' : record.kind === 'other' ? 'sharedReceipts' : 'paymentHistory';
          const values = list(row[field]);
          if (!values.some(value => (record.kind === 'payment' ? value.sharedRecordId : value.id) === recordId)) fail('Una aplicación cambió: no se anuló ninguna fila.');
          const next = values.filter(value => (record.kind === 'payment' ? value.sharedRecordId : value.id) !== recordId);
          const updates = { [field]: next, updatedAt: now };
          if (record.kind !== 'payment' && !next.length) updates[field] = FieldValue.delete();
          if (record.kind === 'payment') {
            const ids = list(row.sharedPaymentIds).filter(value => value !== recordId);
            const protectedPayments = next.filter(payment => payment.sharedRecordId);
            updates.sharedPaymentIds = ids.length ? ids : FieldValue.delete();
            updates.sharedPaymentRecords = protectedPayments.length ? protectedPayments : FieldValue.delete();
            updates.paid = paid({ paymentHistory: next }) >= cents(row.total);
            updates.paymentLocked = true;
          }
          tx.update(refs[index], updates);
          tx.set(db.doc(`projects/${record.allocations[index].projectId}/activityLog/${recordId}-cancel-${record.allocations[index].itemId}`), {
            action: 'shared_supplier_record_cancelled', recordId, reason, actor, createdAt: now,
          });
        });
        invoices.forEach(snapshot => {
          if (!snapshot.exists) fail('La factura vinculada ya no existe.');
          const settlements = { ...(snapshot.data().settlements || {}) };
          delete settlements[recordId];
          tx.update(snapshot.ref, { settlements, updatedAt: now });
        });
        if (cashRef) {
          if (!cash.exists || cash.data().sharedRecordId !== recordId) fail('No coincide el movimiento de caja.');
          tx.delete(cashRef);
        }
        indices.forEach(snapshot => {
          const records = { ...(snapshot.data()?.records || {}) }; delete records[recordId];
          tx.set(snapshot.ref, { ...projectIndex(records), updatedAt: now });
        });
        tx.update(recordRef, { status: 'cancelled', cancellation: { reason, actor, at: now }, updatedAt: now });
        return { id: recordId, status: 'cancelled' };
      });
    }
    if (input.action !== 'create') fail('Acción desconocida.');
    const record = normalizeRecord(input);
    const fingerprint = createHash('sha256').update(JSON.stringify({ ...record, filePath: input.file?.path || '' })).digest('hex');
    // Uploads are immutable once committed. Only the caller's staging path is accepted.
    const file = input.file ? await verifyFile(record.providerId, recordId, input.file) : null;
    if (record.kind !== 'payment' && !file) fail('Adjuntá el documento original.');
    return db.runTransaction(async tx => {
      const existing = await tx.get(recordRef);
      if (existing.exists) {
        if (existing.data().fingerprint !== fingerprint) fail('El intento anterior tiene otros datos. Actualizá la ficha.');
        return { id: recordId, status: existing.data().status };
      }
      const provider = await tx.get(db.doc(`providers/${record.providerId}`));
      if (!provider.exists) fail('No existe el proveedor.');
      const fiscalRef = record.fiscalKey ? db.doc(`providerFiscalKeys/${record.fiscalKey}`) : null;
      const fiscal = fiscalRef ? await tx.get(fiscalRef) : null;
      if (fiscal?.exists) {
        const original = await tx.get(db.doc(`providerFinancialRecords/${fiscal.data().recordId}`));
        if (original.data()?.status !== 'cancelled') fail('Esta factura ya está registrada. Buscala en la ficha antes de volver a cargarla.');
      }
      const paymentKeyRef = record.paymentKey ? db.doc(`providerPaymentKeys/${record.paymentKey}`) : null;
      const previousPayment = paymentKeyRef ? await tx.get(paymentKeyRef) : null;
      if (previousPayment?.exists) {
        const original = await tx.get(db.doc(`providerFinancialRecords/${previousPayment.data().recordId}`));
        if (original.data()?.status !== 'cancelled') fail('Esta referencia de pago ya está registrada en esa cuenta.');
      }
      const refs = record.allocations.map(row => db.doc(`projects/${key(row)}`));
      const rows = await Promise.all(refs.map(ref => tx.get(ref)));
      const projectIds = [...new Set(record.allocations.map(row => row.projectId))];
      const projects = await Promise.all(projectIds.map(value => tx.get(db.doc(`projects/${value}`))));
      const indices = await Promise.all(projectIds.map(value => tx.get(db.doc(`providerFinanceProjectIndex/${value}`))));
      const projectMap = new Map(projects.map(snapshot => [snapshot.id, snapshot.data()]));
      const invoiceIds = [...new Set(record.allocations.map(row => row.invoiceId).filter(Boolean))];
      const invoices = await Promise.all(invoiceIds.map(value => tx.get(db.doc(`providerFinancialRecords/${value}`))));
      const invoiceMap = new Map(invoices.map(snapshot => [snapshot.id, snapshot.data()]));
      const allocations = record.allocations.map((allocation, index) => {
        const expense = rows[index].data(), project = projectMap.get(allocation.projectId);
        if (!expense || !project || expense.providerId !== record.providerId) fail('El proveedor o el gasto cambió. Volvé a cargar la ficha.');
        const active = list(project.activeAreas).includes(expense.area);
        if ((allocation.collectionName === 'areaExpenses') !== active) fail('El gasto ya no pertenece a la gestión activa del proyecto.');
        if (allocation.amountCents > cents(expense.total)) fail('La aplicación supera el costo del gasto.');
        if (record.kind === 'payment' && allocation.amountCents + paid(expense) > cents(expense.total)) fail('El pago supera el saldo actual de un gasto.');
        if (record.kind === 'invoice' && allocation.amountCents + list(expense.sharedInvoices).reduce((sum, item) => sum + item.amountCents, 0) > cents(expense.total)) fail('Este gasto ya tiene facturas compartidas por ese importe.');
        if (record.kind === 'invoice' && (expense.invoice?.url || list(expense.invoices).some(invoice => invoice.url))) fail('Este gasto tiene una factura anterior. Revisá y retirala antes de reemplazarla por una compartida.');
        if (allocation.invoiceId) {
          const invoice = invoiceMap.get(allocation.invoiceId);
          const original = invoice?.allocations.find(row => key(row) === key(allocation));
          const settled = Object.values(invoice?.settlements || {}).flat().filter(row => key(row) === key(allocation)).reduce((sum, row) => sum + row.amountCents, 0);
          if (record.kind !== 'payment' || invoice?.kind !== 'invoice' || invoice.providerId !== record.providerId
            || invoice.status !== 'active' || !original || settled + allocation.amountCents > original.amountCents) fail('La aplicación supera el saldo de la factura vinculada.');
        }
        return { ...allocation, area: text(expense.area), projectName: text(project.name), projectCode: text(project.projectCode), description: text(expense.description) };
      });
      allocations.forEach((allocation, index) => {
        const expense = rows[index].data();
        const updates = { updatedAt: now };
        if (record.kind === 'payment') {
          const payment = {
            id: `shared-${recordId}`, sharedRecordId: recordId, amount: allocation.amountCents / 100,
            date: record.date, detail: `${record.notes || 'Pago compartido'} · Destinatario: ${record.payeeName}`,
            method: 'otro', type: 'partial', createdBy: actor.uid, createdByEmail: actor.email,
          };
          updates.paymentHistory = [...list(expense.paymentHistory), payment];
          updates.paymentLocked = true;
          updates.paymentAuthorIds = [...list(expense.paymentAuthorIds), actor.uid];
          updates.sharedPaymentIds = [...list(expense.sharedPaymentIds), recordId];
          updates.sharedPaymentRecords = updates.paymentHistory.filter(entry => entry.sharedRecordId);
          updates.paid = paid({ paymentHistory: updates.paymentHistory }) >= cents(expense.total);
        } else {
          const field = record.kind === 'invoice' ? 'sharedInvoices' : 'sharedReceipts';
          updates[field] = [...list(expense[field]), { id: recordId, amountCents: allocation.amountCents, number: record.number, title: record.notes || record.number, issuerName: record.issuerName }];
        }
        tx.update(refs[index], updates);
        tx.set(db.doc(`projects/${allocation.projectId}/activityLog/${recordId}-${allocation.itemId}`), {
          action: 'shared_supplier_record_created', recordId, kind: record.kind, itemId: allocation.itemId,
          collectionName: allocation.collectionName, amount: allocation.amountCents / 100, actor, createdAt: now,
        });
      });
      invoices.forEach(snapshot => tx.update(snapshot.ref, {
        settlements: { ...(snapshot.data().settlements || {}), [recordId]: allocations.filter(row => row.invoiceId === snapshot.id) }, updatedAt: now,
      }));
      if (record.kind === 'payment' && record.method === 'cash') {
        tx.create(db.doc(`projects/${record.cashProjectId}/cashMovements/shared-${recordId}`), {
          sharedRecordId: recordId, type: 'pago', cashAccount: 'general',
          amount: (record.totalCents + record.feeCents) / 100, date: record.date,
          description: `Pago compartido a ${record.payeeName}`, notes: record.notes,
          fromUserEmail: actor.email, fromUserName: actor.email, createdBy: actor.uid, createdByEmail: actor.email, createdAt: now,
        });
      }
      tx.create(recordRef, { ...record, allocations, file, fingerprint, status: 'active', settlements: {}, createdBy: actor, createdAt: now, updatedAt: now });
      tx.set(db.doc(`providerFinanceProviderIndex/${record.providerId}`), { updatedAt: now });
      indices.forEach(snapshot => tx.set(snapshot.ref, {
        ...projectIndex({ ...(snapshot.data()?.records || {}), [recordId]: allocations.filter(row => row.projectId === snapshot.id).map(row => ({ area: row.area, collectionName: row.collectionName })) }), updatedAt: now,
      }));
      if (fiscalRef) tx.set(fiscalRef, { recordId, previousRecordId: fiscal?.data()?.recordId || '', createdAt: now });
      if (paymentKeyRef) tx.set(paymentKeyRef, { recordId, previousRecordId: previousPayment?.data()?.recordId || '', createdAt: now });
      return { id: recordId, status: 'active' };
    });
  };
}
module.exports = { normalizeRecord, createProviderFinanceHandler };
