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
const call = createProviderFinanceHandler({ db, timestamp: () => admin.firestore.FieldValue.serverTimestamp(), verifyFile: async (_provider, _id, file) => ({ ...file, contentType: 'application/pdf' }), readFile: async () => 'JVBERg==' });
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
  await assert.rejects(call({ auth: { uid: 'editor', token: { email: 'editor@example.test' } }, data: { action: 'download', id: 'invoice1' } }), /Sólo administradores/);
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
  console.log('Shared provider finance: exact applications, idempotency, concurrent payments, cancellation, single cash outflow and private immutable files verified.');
} finally { await env.cleanup(); await app.delete(); }
