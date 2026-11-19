const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const deps = createRequire(require.resolve('../functions/package.json'));
const { Firestore, FieldValue } = deps('@google-cloud/firestore');
const { createProviderFinanceHandler } = require('../functions/providerFinance');

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/);

test('scoped finance releases only verified originals whose applications are all readable', async () => {
  const db = new Firestore({ projectId: 'demo-goat-scoped-files' });
  const ownInvoice = 'projects/p/areas/arte/facturas/invoice.pdf';
  const ownPayment = 'projects/p/areaExpenses/visible/comprobantes/receipt.pdf';
  const mixedInvoice = 'providerFinance/supplier/mixedInvoice/historical.pdf';
  const mixedPayment = 'providerFinance/supplier/mixedPayment/historical.pdf';
  const singleInvoice = 'providerFinance/supplier/singleInvoice/single.pdf';
  const unrelated = 'projects/p/areaExpenses/hidden/comprobantes/secret.pdf';
  const portalInvoice = 'providerPortalUploads/supplier/upload/invoice.pdf';
  const historicalDocument = 'projects/p/documents/manual/original.pdf';
  const originalReads = [];
  let invoiceCollection = 'areaExpenses', paymentId = 'native';
  const scoped = createProviderFinanceHandler({
    db, timestamp: FieldValue.serverTimestamp, bucketName: () => 'fake-bucket',
    readFile: async ({ path, projectAttachment }) => {
      originalReads.push(path);
      return projectAttachment ? { base64: 'JVBERg==', contentType: 'application/pdf', fileName: path.split('/').pop() } : 'JVBERg==';
    },
    readMetadata: async path => path === ownInvoice
      ? { projectId: 'p', collectionName: invoiceCollection, expenseId: 'visible' }
      : path === ownPayment ? { projectId: 'p', collectionName: 'areaExpenses', itemId: 'visible', paymentId } : null,
  });
  const call = (action, fields = {}) => scoped({
    auth: { uid: 'producer', token: { email: 'producer@example.test', email_verified: true } },
    data: { action, projectId: 'p', ...fields },
  });
  const rowRef = itemId => db.doc('projects/p/areaExpenses/' + itemId);
  const allocation = itemId => ({ projectId: 'p', collectionName: 'areaExpenses', itemId, amountCents: itemId === 'visible' ? 10000 : 999999 });
  const row = { providerId: 'supplier', total: 100, area: 'Arte', description: 'Trabajo' };
  const file = (path, fileName = 'original.pdf') => ({ path, fileName, contentType: 'application/pdf' });
  const secret = 'TITULAR FUERA DE ALCANCE';
  const financeRecord = (kind, path, ...items) => ({
    kind, providerId: 'supplier', status: 'active', file: file(path, secret), issuerName: secret,
    totalCents: 999999, allocations: items.map(allocation),
  });
  const payment = (id, sharedRecordId, receipt) => ({
    id, ...(sharedRecordId && { sharedRecordId }), amount: 50, detail: secret, receipt,
  });
  const invoiceMarker = value => 'https://firebasestorage.googleapis.com/v0/b/fake-bucket/o/' + encodeURIComponent(value) + '?alt=media&token=fake';
  const open = (kind, index = 0) => call('projectScopedAttachment', { collectionName: 'areaExpenses', itemId: 'visible', kind, index });
  try {
    await Promise.all([
      db.doc('users/producer').set({ role: 'jefe_produccion' }),
      db.doc('projects/p').set({ name: 'Proyecto', activeAreas: ['Arte', 'Producción'], collaboratorEmails: ['producer@example.test'] }),
      db.doc('projects/p/collaborators/producer@example.test').set({ allowedTabs: ['areas'], allowedCategories: ['Arte'] }),
      db.doc('providers/supplier').set({ name: 'Proveedor de prueba' }),
      db.doc('providerPortalInvoiceUploads/upload').set({ providerId: 'supplier', path: portalInvoice, workKey: 'p/areaExpenses/visible', status: 'complete' }),
      rowRef('visible').set({
        ...row, invoices: [{ url: invoiceMarker(ownInvoice) }, file(mixedInvoice, secret), file(singleInvoice),
          { ...file(portalInvoice), portalUploadId: 'upload' }],
        sharedInvoices: [{ id: 'mixedInvoice', amountCents: 10000, issuerName: secret }, { id: 'singleInvoice', amountCents: 10000 }],
        paymentHistory: [payment('shared-mixed', 'mixedPayment', file(mixedPayment, secret)), { ...payment('native', null, file(ownPayment)), detail: 'Pago propio' },
          { ...payment('foreign', null, file(unrelated, secret)), detail: 'Adjunto histórico' }],
      }),
      rowRef('hidden').set({
        ...row, area: 'Producción', total: 9999.99, description: secret,
        sharedInvoices: [{ id: 'mixedInvoice', amountCents: 999999 }], paymentHistory: [{ amount: 9999.99, sharedRecordId: 'mixedPayment' }],
      }),
      db.doc('providerFinancialRecords/mixedInvoice').set(financeRecord('invoice', mixedInvoice, 'visible', 'hidden')),
      db.doc('providerFinancialRecords/mixedPayment').set(financeRecord('payment', mixedPayment, 'visible', 'hidden')),
      db.doc('providerFinancialRecords/singleInvoice').set({ ...financeRecord('invoice', singleInvoice, 'visible'), issuerName: 'Proveedor de prueba', totalCents: 10000 }),
    ]);
    const overview = await call('projectScopedSnapshot');
    assert.deepEqual(overview.areaExpenses.map(expense => expense.id), ['visible']);
    const serialized = JSON.stringify(overview);
    for (const value of [secret, '999999', 'firebasestorage.googleapis.com', unrelated, mixedPayment, mixedInvoice]) assert(!serialized.includes(value), value);
    const documents = await call('projectDocuments', { recordIds: ['mixedInvoice', 'mixedPayment', 'singleInvoice'] });
    assert.deepEqual(documents.records.map(record => record.id), ['singleInvoice']);
    for (const recordId of ['mixedInvoice', 'mixedPayment']) {
      await assert.rejects(call('download', { id: recordId, collectionName: 'areaExpenses', itemId: 'visible' }), { code: 'permission-denied' });
    }
    await assert.rejects(open('invoices', 1), { code: 'permission-denied' });
    await assert.rejects(open('payment', 0), { code: 'permission-denied' });
    await assert.rejects(open('payment', 2), { code: 'permission-denied' });
    assert.deepEqual(originalReads, []);
    for (const [kind, index] of [['invoices', 0], ['invoices', 2], ['invoices', 3], ['payment', 1]]) {
      const result = await open(kind, index);
      assert.equal(result.base64, 'JVBERg==');
      assert.equal(result.path, undefined);
    }
    assert.deepEqual(originalReads, [ownInvoice, singleInvoice, portalInvoice, ownPayment]);
    invoiceCollection = undefined;
    assert.equal((await open('invoices', 0)).base64, 'JVBERg==');
    await db.doc('projects/p/budgetItems/visible').set({ ...row, area: 'Producción' });
    await assert.rejects(open('invoices', 0), { code: 'permission-denied' });
    invoiceCollection = 'budgetItems';
    await assert.rejects(open('invoices', 0), { code: 'permission-denied' });

    paymentId = undefined;
    assert.equal((await open('payment', 1)).base64, 'JVBERg==');
    const original = (await rowRef('visible').get()).data();
    await rowRef('visible').update({
      invoices: [...original.invoices, file(ownPayment)],
      paymentHistory: [...original.paymentHistory, payment('second-reference', null, file(ownPayment))],
    });
    assert.equal((await open('invoices', original.invoices.length)).base64, 'JVBERg==');
    await assert.rejects(open('payment', 1), { code: 'permission-denied' });

    const acl = db.doc('projects/p/collaborators/producer@example.test');
    await acl.update({ allowedTabs: ['areas', 'documentos'] });
    invoiceCollection = 'areaExpenses';
    await db.doc('projects/p/projectDocuments/insurance').set({ ...file(ownInvoice), area: 'Arte', family: 'seguros' });
    const openInsurance = () => call('projectScopedAttachment', { collectionName: 'projectDocuments', itemId: 'insurance', kind: 'document' });
    assert.equal((await openInsurance()).base64, 'JVBERg==');
    await rowRef('visible').update({ area: 'Producción' });
    await assert.rejects(openInsurance(), { code: 'permission-denied' });
    await rowRef('visible').update({ area: 'Arte', invoices: [...original.invoices, file(historicalDocument)] });
    await db.doc('projects/p/projectDocuments/manual').set({ ...file(historicalDocument), area: 'Arte', family: 'seguros' });
    assert.equal((await open('invoices', original.invoices.length)).base64, 'JVBERg==');
    await db.doc('projects/p/projectDocuments/manual').update({ area: 'Producción' });
    await assert.rejects(open('invoices', original.invoices.length), { code: 'permission-denied' });
  } finally {
    await db.terminate();
  }
});
