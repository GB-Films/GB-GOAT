import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { doc, getDoc, updateDoc, deleteDoc, setDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { assertFails } from '@firebase/rules-unit-testing';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { createAreaStructureChange } = require('../functions/areaStructureChange');

export async function testDeleteUnpaidAreaExpense({ db, admin, call, env }) {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Synthetic tests require a local emulator.');
  const projectId = 'unpaid-invoiced-deletion', collectionName = 'areaExpenses';
  await db.doc(`projects/${projectId}`).set({ name: 'Proyecto ficticio', activeAreas: ['Post', 'Old', 'New'], areaExpenseSubcategories: { Post: ['Extras'], Old: ['Extras'], New: ['Extras'] } });
  await db.doc(`projects/${projectId}/collaborators/editor@example.test`).set({ role: 'jefe_produccion', canEditBudgetAreas: true, allowedCategories: ['Post'], allowedTabs: ['areas'] });
  const invoke = (data, uid = 'admin') => call({ auth: { uid, token: { email: uid === 'admin' ? 'agustin@granberta.com' : `${uid}@example.test`, email_verified: true } }, data });
  const rowRef = itemId => db.doc(`projects/${projectId}/areaExpenses/${itemId}`);
  const scope = itemId => ({ projectId, itemId });
  const preview = (itemId, uid) => invoke({ action: 'previewDeleteUnpaidAreaExpense', ...scope(itemId) }, uid);
  const deletion = (itemId, p) => ({ action: 'deleteUnpaidAreaExpense', ...scope(itemId), operationId: randomUUID(), expectedFingerprint: p.fingerprint });
  const seed = async (itemId, extra = {}) => rowRef(itemId).set({ providerId: 'supplier', area: 'Post', subcategory: 'Extras', description: 'Gasto ficticio', total: 100, paid: false, paymentHistory: [], ...extra });
  const invoices = Array.from({ length: 24 }, (_, i) => ({ id: `document-${i}`, path: `synthetic/${i}.pdf`, fileName: `${i}.pdf` }));
  await seed('historical', { paymentLocked: true, invoice: invoices[0], invoices });
  const before = (await rowRef('historical').get()).data();
  assert.equal((await preview('historical')).invoiceCount, 24, 'primary and array references are deduplicated');
  await assert.rejects(preview('historical', 'editor'), /No tenés permiso/);
  const request = deletion('historical', await preview('historical'));
  assert.equal((await invoke(request)).deleted, true);
  assert.equal((await rowRef('historical').get()).exists, false);
  const auditRef = db.doc(`projects/${projectId}/activityLog/unpaid-expense-deleted-${request.operationId}`);
  const audit = (await auditRef.get()).data();
  assert.deepEqual(audit.previousDocument, before); assert.equal(audit.invoiceCount, 24);
  assert.equal((await invoke(request)).repeated, true);
  await assert.rejects(invoke({ ...request, operationId: randomUUID() }), /ya fue eliminada/);
  const client = env.authenticatedContext('admin', { email: 'agustin@granberta.com', email_verified: true }).firestore();
  await assertFails(updateDoc(doc(client, auditRef.path), { previousDocument: {} }));
  await assertFails(deleteDoc(doc(client, auditRef.path)));

  // Reported shape: no paid flag, no payments, an ordinary invoice, and an authorization to use a third party.
  // The authorization alone blocks the legacy browser delete, even for an administrator.
  const reportedShape = { providerId: 'supplier', area: 'Post', subcategory: '', paymentHistory: [], paymentLocked: false,
    thirdPartyPayoutRequired: true, total: 100, invoice: invoices[0], invoices: [invoices[0]] };
  await rowRef('authorized-duplicate').set(reportedShape);
  const legacyBatch = writeBatch(client);
  legacyBatch.delete(doc(client, rowRef('authorized-duplicate').path));
  legacyBatch.set(doc(client, `projects/${projectId}/activityLog/legacy-attempt`), { action: 'expense_rows_deleted', collectionName,
    itemId: 'authorized-duplicate', paymentCount: 0, previousDocuments: {}, deletedBy: 'admin', deletedByEmail: 'agustin@granberta.com',
    deletedByName: 'Administrador ficticio', deletedByRole: 'admin', createdAt: serverTimestamp() });
  await assertFails(legacyBatch.commit());
  assert.equal((await rowRef('authorized-duplicate').get()).exists, true);
  const reportedPreview = await preview('authorized-duplicate');
  assert.equal(reportedPreview.invoiceCount, 1);
  const reportedDeletion = deletion('authorized-duplicate', reportedPreview);
  await invoke(reportedDeletion);
  assert.equal((await rowRef('authorized-duplicate').get()).exists, false);
  const retained = (await db.doc(`projects/${projectId}/activityLog/unpaid-expense-deleted-${reportedDeletion.operationId}`).get()).data();
  assert.deepEqual(retained.previousDocument, reportedShape); assert.equal(retained.invoiceCount, 1);

  await seed('ordinary', { invoices: [invoices[0]] });
  await assert.rejects(preview('ordinary', 'stranger'), /acceso/);
  const own = deletion('ordinary', await preview('ordinary', 'editor'));
  await db.doc(`projects/${projectId}/collaborators/editor@example.test`).update({ excludedSubcategories: ['Post||Extras'] });
  await assert.rejects(invoke(own, 'editor'), /No tenés permiso/);
  await db.doc(`projects/${projectId}/collaborators/editor@example.test`).update({ excludedSubcategories: [] });
  await rowRef('ordinary').update({ invoices: [invoices[0], invoices[1]] });
  await assert.rejects(invoke(own, 'editor'), /facturas cambiaron/);
  assert.equal((await rowRef('ordinary').get()).exists, true);
  await invoke(deletion('ordinary', await preview('ordinary', 'editor')), 'editor');
  await seed('authorized-third-party', { thirdPartyPayoutRequired: true, invoices: [invoices[0]] });
  await assert.rejects(preview('authorized-third-party', 'editor'), /No tenés permiso/);
  await invoke(deletion('authorized-third-party', await preview('authorized-third-party')));
  for (const [itemId, extra] of Object.entries({ paid: { paid: true }, zeroPayment: { paymentHistory: [{ id: 'p', amount: 0 }] }, sharedPayment: { sharedPaymentIds: ['payment'] }, protectedPayment: { sharedPaymentRecords: [{ id: 'p' }] } })) {
    await seed(itemId, extra); await assert.rejects(preview(itemId), /pagos registrados/); assert.equal((await rowRef(itemId).get()).exists, true);
  }
  await seed('payment-race'); const paymentRace = deletion('payment-race', await preview('payment-race'));
  await rowRef('payment-race').update({ paymentHistory: [{ id: 'new-payment', amount: 1 }] });
  await assert.rejects(invoke(paymentRace), /pagos registrados/);
  await seed('cash'); const cashRequest = deletion('cash', await preview('cash'));
  const cashRef = db.doc(`projects/${projectId}/cashMovements/orphan`);
  await cashRef.set({ itemId: 'cash', collectionName, type: 'pago', amount: 5, cashAccount: 'general' });
  const cashBefore = (await cashRef.get()).data();
  await assert.rejects(invoke(cashRequest), /vinculado en Cajas/); assert.deepEqual((await cashRef.get()).data(), cashBefore);

  // Removing one row never cancels a shared fiscal original or another row.
  const recordId = 'invoice-delete-test', recordRef = db.doc(`providerFinancialRecords/${recordId}`);
  const a = { projectId, collectionName, itemId: 'native-a', area: 'Old', amountCents: 3000 }, b = { ...a, itemId: 'native-b', area: 'Post', amountCents: 7000 };
  const original = { providerId: 'supplier', kind: 'invoice', status: 'active', netArsCents: 10000, netCents: 10000, totalCents: 10000, allocations: [a, b], settlements: {}, file: { path: 'synthetic-shared-original.pdf', fileName: 'original.pdf' } };
  await recordRef.set(original);
  await seed('native-a', { area: 'Old', sharedInvoices: [{ id: recordId, amountCents: 3000 }], thirdPartyPayoutRequired: true });
  await seed('native-b', { sharedInvoices: [{ id: recordId, amountCents: 7000 }] });
  await invoke({ action: 'create', id: 'paid-other-native-row', kind: 'payment', providerId: 'supplier', date: '2026-11-13',
    net: 70, total: 70, payeeName: 'Prestador ficticio', method: 'transfer', account: 'cuenta-ficticia', reference: 'paid-other-native-row',
    allocations: [{ projectId, collectionName, itemId: 'native-b', amount: 70, invoiceId: recordId }] });
  const remainingBefore = (await rowRef('native-b').get()).data();
  const indexRef = db.doc(`providerFinanceProjectIndex/${projectId}`);
  await indexRef.set({ records: { [recordId]: [a, b].map(({ area, collectionName }) => ({ area, collectionName })), unrelated: [{ area: 'New', collectionName }] }, managedAreas: ['Old', 'Post', 'New'], budgetAreas: [], extraPreserved: true });
  await assert.rejects(preview('native-b', 'editor'), /No tenés permiso/);
  const target = deletion('native-a', await preview('native-a'));
  const originalSettlements = (await recordRef.get()).data().settlements;
  await recordRef.update({ settlements: { ...originalSettlements, payment: [a] } });
  await assert.rejects(invoke(target), /pagos aplicados/);
  await recordRef.update({ settlements: originalSettlements });
  await invoke(deletion('native-a', await preview('native-a')));
  const after = (await recordRef.get()).data();
  assert.deepEqual(after.allocations, original.allocations); assert.deepEqual(after.file, original.file); assert.equal(after.status, 'active'); assert.equal(after.netArsCents, 10000);
  assert.deepEqual(after.detachedExpenseKeys, [`${projectId}/${collectionName}/native-a`]);
  assert.deepEqual((await rowRef('native-b').get()).data(), remainingBefore);
  assert.deepEqual((await indexRef.get()).data().records[recordId], [{ area: 'Post', collectionName }]);
  assert.equal((await indexRef.get()).data().extraPreserved, true);
  assert.equal((await invoke({ action: 'projectDocuments', projectId, recordIds: [recordId] })).records[0].distinctExpenseCount, 1);
  await assert.rejects(invoke({ action: 'download', id: recordId, projectId, collectionName, itemId: 'native-a' }, 'editor'), /ajeno/);
  assert.equal((await invoke({ action: 'download', id: recordId, projectId, collectionName, itemId: 'native-b' }, 'editor')).base64, 'JVBERg==');
  await assertFails(updateDoc(doc(client, recordRef.path), { detachedExpenseKeys: [] }));
  await assertFails(setDoc(doc(client, `projects/${projectId}/areaExpenses/native-a`), { ...before, sharedInvoices: [{ id: recordId }] }));
  // Later organization of the remaining row must not reintroduce the deleted area.
  const reorganize = createAreaStructureChange({ db, timestamp: () => admin.firestore.FieldValue.serverTimestamp() });
  await reorganize({ uid: 'admin', email: 'agustin@granberta.com' }, { action: 'reclassifyAreaExpenses', projectId, operationId: randomUUID(), kind: 'expense', itemId: 'native-b', fromArea: 'Post', fromSubcategory: 'Extras', targetArea: 'New', targetSubcategory: 'Extras', expectedRevision: 0 });
  assert.deepEqual((await indexRef.get()).data().records[recordId], [{ area: 'New', collectionName }]);
  await assert.rejects(invoke({ action: 'cancel', id: recordId, reason: 'Intento ficticio con pago ajeno vigente' }), /anulá los pagos/);
  await invoke({ action: 'cancel', id: 'paid-other-native-row', reason: 'Reversión ficticia del pago de la otra fila' });
  await invoke({ action: 'cancel', id: recordId, reason: 'Anulación ficticia después de borrar una fila sin pagos' });
  assert.equal((await recordRef.get()).data().status, 'cancelled');
  assert.equal((await rowRef('native-a').get()).exists, false);
  assert.equal(((await rowRef('native-b').get()).data().sharedInvoices || []).length, 0);
  // Complete detachment clears the project index and keeps the original cancellable.
  await seed('single', { sharedInvoices: [{ id: 'single-delete-invoice', amountCents: 10000 }] });
  await db.doc('providerFinancialRecords/single-delete-invoice').set({ ...original, allocations: [{ ...b, itemId: 'single', amountCents: 10000 }] });
  await indexRef.set({ records: { 'single-delete-invoice': [{ area: 'Post', collectionName }] }, managedAreas: ['Post'], budgetAreas: [] });
  await invoke(deletion('single', await preview('single')));
  assert.deepEqual((await indexRef.get()).data().records, {});
  await invoke({ action: 'cancel', id: 'single-delete-invoice', reason: 'Anulación ficticia de original sin aplicaciones vigentes' });
  assert.equal((await db.doc('providerFinancialRecords/single-delete-invoice').get()).data().status, 'cancelled');
  console.log('PASS unpaid invoiced row deletion: 24 invoices, historical flags, exact confirmation, live permissions, payments/cash/settlement guards, shared original preservation, active counts/download/cancel/reclassification and immutable idempotent audit.');
}
