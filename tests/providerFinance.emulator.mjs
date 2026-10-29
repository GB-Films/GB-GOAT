import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const { createProviderFinanceHandler } = require('../functions/providerFinance');
const projectId = 'demo-goat-provider-finance';
const env = await initializeTestEnvironment({ projectId,
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  storage: { rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8') },
});
const app = admin.initializeApp({ projectId });
const db = app.firestore();
const context = env.authenticatedContext('admin', { email_verified: true, email: 'admin@example.test' });
const editor = env.authenticatedContext('editor', { email_verified: true, email: 'editor@example.test' });
const stranger = env.authenticatedContext('stranger', { email_verified: true, email: 'stranger@example.test' });
const call = createProviderFinanceHandler({ db, timestamp: () => admin.firestore.FieldValue.serverTimestamp(), verifyFile: async (_provider, _id, file) => ({ ...file, contentType: 'application/pdf', sha256: file.testHash || 'a'.repeat(64) }), readFile: async () => 'JVBERg==' });
const request = data => ({ auth: { uid: 'admin', token: { email: 'admin@example.test' } }, data });
const expenseRef = index => db.doc(`projects/project${index}/areaExpenses/expense`);
const allocations = [300, 450, 450].map((amount, index) => ({ projectId: `project${index}`, collectionName: 'areaExpenses', itemId: 'expense', amount }));
const invoice = { action: 'create', id: 'invoice1', kind: 'invoice', providerId: 'supplier', date: '2026-10-15', issuerName: 'Emisor prueba', issuerCuit: '20000000001', recipientCuit: '30000000002', number: 'C 00001-00000123', net: 1200, total: 1200, allocations, file: { path: 'test-original', fileName: 'original.pdf' } };
const pay = (id, amounts = [300, 450, 450]) => ({ action: 'create', id, reference: id, kind: 'payment', providerId: 'supplier', date: '2026-10-21', net: amounts.reduce((a, b) => a + b, 0), total: amounts.reduce((a, b) => a + b, 0), payeeName: 'Otro beneficiario', method: 'transfer', account: 'Cuenta prueba', allocations: allocations.map((row, i) => ({ ...row, amount: amounts[i], invoiceId: 'invoice1' })) });
try {
  await env.withSecurityRulesDisabled(async seed => {
    const store = seed.firestore();
    await setDoc(doc(store, 'users/admin'), { role: 'admin', email: 'admin@example.test' });
    await setDoc(doc(store, 'users/editor'), { role: 'jefe_produccion', email: 'editor@example.test' });
    await setDoc(doc(store, 'providers/supplier'), { name: 'Prestador prueba' });
    for (let i = 0; i < 3; i++) {
      await setDoc(doc(store, `projects/project${i}`), { name: `Proyecto ${i}`, activeAreas: ['Post'], collaboratorEmails: ['editor@example.test'] });
      await setDoc(doc(store, `projects/project${i}/collaborators/editor@example.test`), { role: 'jefe_produccion', canEditBudgetAreas: true, allowedCategories: ['Post'], allowedTabs: ['areas'] });
      await setDoc(doc(store, `projects/project${i}/areaExpenses/expense`), { providerId: 'supplier', providerName: 'Prestador prueba', total: allocations[i].amount, unitPrice: allocations[i].amount, quantity: 1, area: 'Post', subcategory: '', paymentHistory: [], paymentAuthorIds: [], paymentLocked: false });
    }
  });
  await assert.rejects(call({ auth: { uid: 'editor', token: { email: 'editor@example.test' } }, data: invoice }), /Sólo administradores/);
  await call(request(invoice));
  assert.equal((await call(request({ action: 'download', id: 'invoice1' }))).base64, 'JVBERg==');
  const scopedEditor = data => call({ auth: { uid: 'editor', token: { email: 'editor@example.test', email_verified: true } }, data });
  await assert.rejects(scopedEditor({ action: 'download', id: 'invoice1' }));
  const scope = { projectId: 'project0', collectionName: 'areaExpenses', itemId: 'expense' };
  assert.equal((await scopedEditor({ action: 'download', id: 'invoice1', ...scope })).base64, 'JVBERg==');
  const visible = await scopedEditor({ action: 'projectDocuments', projectId: 'project0', recordIds: ['invoice1'] });
  assert.equal(visible.records.length, 1); assert.equal(visible.records[0].allocations.length, 1);
  assert.equal(visible.records[0].file.path, undefined, 'shared metadata does not return a permanent link or raw storage path');
  await assert.rejects(scopedEditor({ action: 'download', id: 'invoice1', ...scope, itemId: 'foreign' }), /ajeno/);
  await assert.rejects(call({ auth: { uid: 'stranger', token: { email: 'stranger@example.test', email_verified: true } }, data: { action: 'download', id: 'invoice1', ...scope } }), /acceso/);
  assert.deepEqual(await call(request(invoice)), { id: 'invoice1', status: 'active' });
  await assert.rejects(call(request({ ...invoice, id: 'duplicate' })), /ya está registrada/);
  assert.equal((await expenseRef(0).get()).data().total, 300);
  assert.equal((await expenseRef(0).get()).data().paymentHistory.length, 0);
  assert.equal((await expenseRef(0).get()).data().sharedInvoices[0].amountCents, 30000);
  for (const firestore of [context.firestore(), editor.firestore()]) {
    const row = doc(firestore, 'projects/project0/areaExpenses/expense');
    await assertFails(updateDoc(row, { sharedInvoices: [] }));
    await assertFails(updateDoc(row, { providerId: 'changed' }));
    await assertFails(updateDoc(row, { total: 1 }));
    await assertFails(deleteDoc(row));
  }
  await assertSucceeds(updateDoc(doc(editor.firestore(), 'projects/project0/areaExpenses/expense'), { description: 'Edición operativa permitida' }));
  await assertFails(getDoc(doc(editor.firestore(), 'providerFinancialRecords/invoice1')));
  await assertFails(getDoc(doc(stranger.firestore(), 'projects/project0/areaExpenses/expense')));
  await assertSucceeds(getDoc(doc(context.firestore(), 'providerFinancialRecords/invoice1')));
  await assertFails(updateDoc(doc(context.firestore(), 'providerFinancialRecords/invoice1'), { netCents: 1 }));
  await assertFails(deleteDoc(doc(context.firestore(), 'providers/supplier')));
  await assertFails(deleteDoc(doc(context.firestore(), 'projects/project0')));
  await assertFails(updateDoc(doc(context.firestore(), 'projects/project0/areaExpenses/expense'), { invoice: { url: 'https://example.test/duplicate.pdf' } }));
  await assertFails(updateDoc(doc(context.firestore(), 'projects/project0'), { activeAreas: [] }));
  await assertSucceeds(updateDoc(doc(context.firestore(), 'projects/project0'), { activeAreas: ['Post', 'Nueva área'] }));

  const concurrent = await Promise.allSettled([call(request(pay('payment1'))), call(request(pay('payment2')))]);
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  const paymentId = concurrent[0].status === 'fulfilled' ? 'payment1' : 'payment2';
  await call(request(pay(paymentId)));
  for (let i = 0; i < 3; i++) {
    const expense = (await expenseRef(i).get()).data();
    assert.equal(expense.paymentHistory.length, 1);
    assert.equal(expense.paymentHistory[0].amount, allocations[i].amount);
    assert.equal(expense.paid, true);
  }
  await assert.rejects(call(request({ action: 'cancel', id: 'invoice1', reason: 'Corrección' })), /Primero anulá los pagos/);
  await assertFails(updateDoc(doc(context.firestore(), 'projects/project0/areaExpenses/expense'), { paymentHistory: [], paid: false }));
  await call(request({ action: 'cancel', id: paymentId, reason: 'Pago de prueba anulado' }));
  assert.equal((await expenseRef(0).get()).data().paymentHistory.length, 0);
  assert.equal((await expenseRef(0).get()).data().paid, false);
  await call(request({ action: 'cancel', id: 'invoice1', reason: 'Corregir distribución' }));
  assert.equal((await expenseRef(0).get()).data().sharedInvoices?.length || 0, 0);
  await call(request({ ...invoice, id: 'replacement' }));
  assert.equal((await db.doc('providerFinancialRecords/invoice1').get()).data().status, 'cancelled');

  const partial = pay('partial', [30, 45, 45]);
  partial.allocations.forEach(row => { row.invoiceId = 'replacement'; });
  await call(request(partial));
  await assert.rejects(call(request({ ...partial, id: 'duplicate-reference' })), /referencia de pago ya/);
  // A scoped producer can still append a normal payment without rewriting the shared one.
  const current = (await expenseRef(0).get()).data();
  console.log('CHECK: ordinary SDK payment append');
  await assertSucceeds(updateDoc(doc(editor.firestore(), expenseRef(0).path), {
    paymentHistory: [...current.paymentHistory, { id: 'ordinary', amount: 1, method: 'otro', createdBy: 'editor', createdByEmail: 'editor@example.test' }],
    paymentAuthorIds: [...current.paymentAuthorIds, 'editor'], paymentLocked: true,
  }));
  // A reviewed third-party destination must not be bypassed by an ordinary SDK upload/payment.
  console.log('PASS: ordinary SDK payment append');
  await expenseRef(0).update({ thirdPartyPayoutRequired: true });
  const guarded = (await expenseRef(0).get()).data();
  for (const store of [context.firestore(), editor.firestore()]) {
    const target = doc(store, expenseRef(0).path);
    await assertFails(updateDoc(target, { thirdPartyPayoutRequired: false }));
    await assertFails(updateDoc(target, { invoice: { url: 'https://example.test/bypass.pdf' } }));
    await assertFails(updateDoc(target, { paymentHistory: [...guarded.paymentHistory, { id: 'bypass', amount: 1, method: 'otro', createdBy: 'editor', createdByEmail: 'editor@example.test' }], paymentAuthorIds: guarded.paymentAuthorIds, paymentLocked: true }));
    await assertFails(deleteDoc(target));
  }
  console.log('CHECK: operative metadata edit with third-party destination');
  await assertSucceeds(updateDoc(doc(editor.firestore(), expenseRef(0).path), { operationalNote: 'Edición permitida con tercero' }));
  const newExpense = { providerId: 'supplier', area: 'Post', subcategory: '', total: 1, paymentHistory: [], paymentAuthorIds: [], paymentLocked: false, createdBy: 'admin', createdByEmail: 'admin@example.test' };
  await assertFails(setDoc(doc(context.firestore(), 'projects/project0/areaExpenses/injected-flag'), { ...newExpense, thirdPartyPayoutRequired: false }));
  await assertSucceeds(setDoc(doc(context.firestore(), 'projects/project0/areaExpenses/ordinary-create'), newExpense));
  await expenseRef(0).update({ thirdPartyPayoutRequired: false });
  await call(request({ action: 'cancel', id: 'partial', reason: 'Revertir parte compartida' }));
  assert.equal((await expenseRef(0).get()).data().paymentHistory[0].id, 'ordinary');
  // Remove only the synthetic ordinary payment with emulator-admin to reset this fixture.
  await expenseRef(0).update({ paymentHistory: [], paid: false });

  const cashPayment = pay('cash1');
  cashPayment.allocations.forEach(row => { row.invoiceId = 'replacement'; });
  await call(request({ ...cashPayment, method: 'cash', cashProjectId: 'project0' }));
  const movements = await db.collectionGroup('cashMovements').get();
  assert.equal(movements.size, 1);
  assert.equal(movements.docs[0].data().amount, 1200);
  await assertFails(deleteDoc(doc(context.firestore(), movements.docs[0].ref.path)));
  await call(request({ action: 'cancel', id: 'cash1', reason: 'Anulación global de prueba' }));
  assert.equal((await db.collectionGroup('cashMovements').get()).size, 0);

  // Simple uploads bind the original file to pending work, without fiscal fields.
  await db.doc('providers/simple').set({ type: 'persona', name: 'Persona de prueba' });
  for (let index = 0; index < 4; index++) {
    await db.doc(`projects/simple${index}`).set({ name: `Simple ${index}`, activeAreas: ['Post'] });
    await db.doc(`projects/simple${index}/areaExpenses/work`).set({ providerId: 'simple', area: 'Post', total: 100,
      paymentHistory: [], ...(index === 1 ? { sharedInvoices: [{ id: 'previous', amountCents: 2500 }] } : {}),
      ...(index === 2 ? { invoice: { path: 'legacy-invoice.pdf' } } : {}) });
  }
  const simple = (id, amounts = [100, 75], hash = 'a') => ({ action: 'create', id, kind: 'invoice', providerId: 'simple', documentOnly: true, date: '2026-10-28',
    file: { path: `simple/${id}/original.pdf`, fileName: 'original.pdf', testHash: hash.repeat(64) },
    allocations: amounts.map((amount, index) => ({ projectId: `simple${index}`, collectionName: 'areaExpenses', itemId: 'work', amount })) });
  const originalCosts = [0, 1].map(async index => (await db.doc(`projects/simple${index}/areaExpenses/work`).get()).data().total);
  await call(request(simple('simple-invoice')));
  assert.deepEqual(await call(request(simple('simple-invoice'))), { id: 'simple-invoice', status: 'active' });
  const documentary = (await db.doc('providerFinancialRecords/simple-invoice').get()).data();
  assert.equal(documentary.netArsCents, 17500); assert.equal(documentary.totalCents, null); assert.equal(documentary.number, '');
  assert.equal(documentary.title, 'original.pdf'); assert.equal(documentary.fiscalKey, undefined);
  for (const index of [0, 1]) {
    const expense = (await db.doc(`projects/simple${index}/areaExpenses/work`).get()).data();
    assert.equal(expense.total, await originalCosts[index]); assert.equal(expense.paymentHistory.length, 0);
  }
  await assert.rejects(call(request(simple('duplicate-file'))), /archivo ya está cargado/);
  const legacySimple = simple('legacy-simple', [100], 'b'); legacySimple.allocations[0].projectId = 'simple2';
  await assert.rejects(call(request(legacySimple)), /factura anterior/);
  const stale = simple('stale-simple', [10], 'c'); stale.allocations[0].projectId = 'simple3';
  await assert.rejects(call(request(stale)), /Cambió el saldo/);
  const racing = ['race-one', 'race-two'].map((id, index) => { const input = simple(id, [100], index ? 'd' : 'e'); input.allocations[0].projectId = 'simple3'; return input; });
  const raced = await Promise.allSettled(racing.map(input => call(request(input))));
  assert.equal(raced.filter(result => result.status === 'fulfilled').length, 1);
  await call(request({ action: 'cancel', id: 'simple-invoice', reason: 'Corregir adjunto de prueba' }));
  await call(request(simple('simple-replacement')));
  const receipt = { ...simple('simple-receipt'), kind: 'other' };
  await call(request(receipt));
  assert.equal((await db.doc('providerFinancialRecords/simple-receipt').get()).data().kind, 'other');
  await assert.rejects(call({ auth: { uid: 'editor', token: { email: 'editor@example.test' } }, data: simple('forbidden') }), /Sólo administradores/);
  await assertFails(getDoc(doc(context.firestore(), 'providerDocumentKeys/unknown')));
  await db.doc('projects/simple4').set({ name: 'Trabajo con tercero', activeAreas: ['Post'] });
  await db.doc('projects/simple4/areaExpenses/work').set({ providerId: 'simple', area: 'Post', total: 10, thirdPartyPayoutRequired: true, paymentHistory: [] });
  const thirdParty = { ...simple('simple-authorized', [10], 'f'), thirdPartyAuthorizationId: 'simple-authority' };
  thirdParty.allocations[0].projectId = 'simple4';
  const party = { name: 'Emisor autorizado', cuit: '20333333334', holderCuit: '20333333334', cbu: '0000000000000000000000' };
  await db.doc('providerPortalDeclarations/simple-authority').set({ providerId: 'simple', kind: 'third_party', status: 'active', proof: { complete: true, signedPdfSha256: 'test' }, contentHash: 'test', effectiveRoles: ['invoice', 'payment'], content: { termsVersion: 'third-party-v4', validity: 'until_revoked', party, workKeys: ['simple4/areaExpenses/work'] } });
  await assert.rejects(call(request({ ...thirdParty, thirdPartyAuthorizationId: '' })), /requiere la autorización/);
  await call(request(thirdParty));
  assert.deepEqual(await call(request(thirdParty)), { id: 'simple-authorized', status: 'active' });
  const thirdInvoice = (await db.doc('providerFinancialRecords/simple-authorized').get()).data();
  assert.equal(thirdInvoice.issuerCuit, party.cuit); assert.equal(thirdInvoice.thirdPartyAuthorization.party.name, party.name);
  const invalidScope = { ...simple('wrong-authority', [100], 'b'), thirdPartyAuthorizationId: 'simple-authority' };
  invalidScope.allocations[0].projectId = 'simple2';
  await assert.rejects(call(request(invalidScope)), /no incluye todos/);
  console.log('Simple uploads: pending balances, no fiscal fiction, no payment/cost mutation, duplicate files, concurrency, legacy invoices, cancellation and admin boundary verified.');

  // Private shared originals: authenticated admin download, immutable after commit.
  const path = 'providerFinance/supplier/staged/original.pdf';
  const file = ref(context.storage(), path);
  const metadata = { contentType: 'application/pdf', customMetadata: { providerId: 'supplier', recordId: 'staged', uploadedBy: 'admin@example.test' } };
  await assertSucceeds(uploadBytes(file, new Uint8Array([37, 80, 68, 70]), metadata));
  await assertSucceeds(getBytes(file));
  await assertFails(getBytes(ref(editor.storage(), path)));
  await assertFails(uploadBytes(ref(editor.storage(), 'providerFinance/supplier/no/original.pdf'), new Uint8Array([1]), metadata));
  await assertFails(uploadBytes(file, new Uint8Array([2]), metadata));
  await db.doc('providerFinancialRecords/staged').set({ providerId: 'supplier', status: 'active' });
  await assertFails(deleteObject(file));
  // All shared document kinds are readable by a project member, but the
  // original/global record and unrelated projects remain private.
  await db.doc('projects/document-scope').set({ collaboratorEmails: ['editor@example.test'] });
  const documentExpense = db.doc('projects/document-scope/areaExpenses/row');
  await documentExpense.set({ providerId: 'supplier', sharedInvoices: [{ id: 'scope-invoice' }], sharedReceipts: [{ id: 'scope-other' }], paymentHistory: [{ id: 'scope-payment', sharedRecordId: 'scope-payment', amount: 1 }] });
  for (const kind of ['invoice', 'payment', 'other']) {
    const recordId = `scope-${kind}`;
    await db.doc(`providerFinancialRecords/${recordId}`).set({ providerId: 'supplier', status: 'active', kind, file: { path: `mock-${kind}`, fileName: `${kind}.pdf`, contentType: 'application/pdf' },
      allocations: [{ projectId: 'document-scope', collectionName: 'areaExpenses', itemId: 'row' }, { projectId: 'private-other-project', collectionName: 'areaExpenses', itemId: 'private' }] });
    const input = { action: 'download', id: recordId, projectId: 'document-scope', collectionName: 'areaExpenses', itemId: 'row' };
    assert.equal((await scopedEditor(input)).base64, 'JVBERg==');
    await assert.rejects(scopedEditor({ ...input, projectId: 'project0' }), /ajeno/);
  }
  const scopedList = await scopedEditor({ action: 'projectDocuments', projectId: 'document-scope', recordIds: ['scope-invoice', 'scope-payment', 'scope-other'] });
  assert.equal(scopedList.records.length, 3);
  assert(scopedList.records.every(record => record.allocations.length === 1 && record.allocations[0].projectId === 'document-scope'));
  await db.doc('projects/document-scope').update({ collaboratorEmails: [] });
  await assert.rejects(scopedEditor({ action: 'download', id: 'scope-payment', projectId: 'document-scope', collectionName: 'areaExpenses', itemId: 'row' }), /acceso/);
  const { testOwnPaymentCorrections } = await import('./ownPaymentCorrection.flow.mjs');
  const { paymentCorrectionSnapshot } = require('../functions/paymentCorrectionSnapshot');
  await testOwnPaymentCorrections({ db, call, snapshot: paymentCorrectionSnapshot });
  console.log('Shared provider finance: exact applications, idempotency, concurrent payments, cancellation, single cash outflow and private immutable files verified.');
} finally { await env.cleanup(); await app.delete(); }
