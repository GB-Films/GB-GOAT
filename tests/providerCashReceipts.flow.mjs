import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function testProviderCashReceipts({ db, admin, deps, manage, portal, request, sign, signActual, env, assertFails, getDoc, setDoc, doc, createProviderPortalAdminHandler, createProviderPortalHandler }) {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw Error('Local emulators required for synthetic receipts.');
  const projectId = 'cash-receipt-test', providerId = 'cash-receipt-supplier';
  await db.doc(`projects/${projectId}`).set({ name: 'Proyecto ficticio de recibos', activeAreas: ['Arte'], createdBy: 'receipt-owner' });
  await db.doc('users/receipt-operator').set({ role: 'colaborador', email: 'receipt-operator@example.test' });
  await db.doc(`projects/${projectId}/collaborators/receipt-operator@example.test`).set({ role: 'jefe_area', allowedTabs: ['areas'], allowedCategories: ['Arte'], canEditBudgetAreas: true });
  await db.doc(`providers/${providerId}`).set({ type: 'persona', name: 'Persona ficticia', lastName: 'Recibos', dni: '12345678', cuit: '20123456786', portalAccessEmail: 'own@example.test', personalGoogleAccount: { uid: 'own', email: 'own@example.test' } });
  await db.doc(`providerPortalUsers/own/memberships/${providerId}`).set({ providerId, email: 'own@example.test', status: 'active' });
  const phase = value => console.log(`cash receipt phase: ${value}`);
  const call = async (input, uid = 'admin') => {
    try { return await manage(request(uid, uid === 'admin' ? 'admin@example.test' : `${uid}@example.test`, input)); }
    catch (error) { console.log(`cash receipt call: ${input.action}, ${input.itemId || ''}, ${error.code || ''}, ${error.message}`); throw error; }
  };
  const own = input => portal(request('own', 'own@example.test', { providerId, ...input }));
  const scope = itemId => ({ projectId, collectionName: 'areaExpenses', itemId, paymentId: `pay-${itemId}` });
  const rowRef = itemId => db.doc(`projects/${projectId}/areaExpenses/${itemId}`);
  const cashRef = itemId => db.doc(`projects/${projectId}/cashMovements/cash-${itemId}`);
  async function seed(itemId, patch = {}) {
    const payment = { id: `pay-${itemId}`, amount: 1500, date: admin.firestore.Timestamp.fromDate(new Date('2026-11-13T16:00:00Z')), method: 'caja_efectivo', cashAccount: 'personal', cashBoxLabel: 'Caja Persona ficticia', cashMovementId: `cash-${itemId}`, createdBy: 'receipt-operator', createdByEmail: 'receipt-operator@example.test', createdByName: 'Operador ficticio', paidByEmail: 'receipt-operator@example.test', paidByName: 'Operador ficticio', detail: 'Efectivo de prueba', type: 'total', ...patch };
    await rowRef(itemId).set({ providerId, description: 'Trabajo ficticio', area: 'Arte', subcategory: 'Utilería', total: 1500, paid: true, paymentHistory: [payment] });
    await cashRef(itemId).set({ type: 'pago', amount: 1500, cashAccount: payment.cashAccount, paymentId: payment.id, collectionName: 'areaExpenses', itemId, createdByEmail: payment.paidByEmail });
  }
  async function inputFor(itemId, extra = {}, handler = call) {
    const source = await handler({ action: 'cashReceiptSource', ...scope(itemId) });
    return { action: 'requestCashReceipt', ...scope(itemId), attemptId: randomUUID(), expectedFingerprint: source.source.fingerprint, parts: { ars: 500, usd: 1, rate: 1000 }, ...extra };
  }
  await seed('main');
  const input = await inputFor('main');
  const nativeBefore = { item: (await rowRef('main').get()).data(), cash: (await cashRef('main').get()).data() };
  await assert.rejects(call(input, 'other'), /acceso/);
  const operator = input => call(input, 'receipt-operator');
  assert.equal((await operator({ action: 'cashReceiptSource', ...scope('main') })).canRequest, true);
  await db.doc(`projects/${projectId}/collaborators/receipt-operator@example.test`).update({ excludedSubcategories: ['Arte||Utilería'] });
  await assert.rejects(operator(input), /permiso de edición/);
  await db.doc(`projects/${projectId}/collaborators/receipt-operator@example.test`).update({ excludedSubcategories: [] });
  await db.doc('teamAccessEmails/receipt-operator@example.test').set({ status: 'pending' });
  await assert.rejects(operator(input), /alta de equipo/);
  await db.doc('teamAccessEmails/receipt-operator@example.test').delete();
  await assert.rejects(call({ ...input, parts: { ars: 499, usd: 1, rate: 1000 } }), /deben coincidir/);
  await assert.rejects(call({ ...input, expectedFingerprint: 'stale' }), /pago cambió/);
  await seed('transfer', { method: 'otro' });
  await assert.rejects(call({ action: 'cashReceiptSource', ...scope('transfer') }), /Sólo se puede/);
  await db.doc(`providers/${providerId}`).update({ dni: '' });
  await assert.rejects(call(input), /Falta el DNI/);
  await db.doc(`providers/${providerId}`).update({ dni: '12345678', portalAccessEmail: '', personalGoogleAccount: admin.firestore.FieldValue.delete() });
  await assert.rejects(call(input), /completar su alta/);
  await db.doc(`providers/${providerId}`).update({ portalAccessEmail: 'own@example.test', personalGoogleAccount: { uid: 'own', email: 'own@example.test' } });
  await db.doc(`providerAdministrativeRecords/${providerId}`).set({ providerId, version: 'administrative-provider-v1', status: 'active' });
  await assert.rejects(call(input), /ficha es administrativa/);
  await db.doc(`providerAdministrativeRecords/${providerId}`).delete();
  phase('concurrent preparation');
  const [receipt, repeated] = await Promise.all([operator(input), operator({ ...input, attemptId: randomUUID() })]);
  assert.equal(receipt.id, repeated.id, 'parallel attempts produce one canonical receipt');
  assert.equal(receipt.status, 'requested'); assert.equal(receipt.content.payment.amountCents, 150000);
  assert.deepEqual(receipt.content.parts, { arsCents: 50000, usdCents: 100, rate: 1000 });
  assert.equal((await db.collection('providerCashReceipts').where('paymentKey', '==', (await db.doc(`providerCashReceipts/${receipt.id}`).get()).data().paymentKey).get()).size, 1);
  await assert.rejects(operator({ ...input, parts: { ars: 1500, usd: 0, rate: 0 } }), /Ya hay un recibo/);
  const listed = (await own({ action: 'myDocuments' })).documents.find(d => d.documentId === receipt.id);
  assert.equal(listed.declarationKind, 'cash_receipt'); assert.equal(listed.goatProjectId, projectId); assert.equal(listed.requiredDni, '12345678');
  assert.equal((await sign.list({ email: 'other@example.test' })).some(d => d.documentId === receipt.id), false);
  const original = await call({ action: 'cashReceiptFile', receiptId: receipt.id, artifact: 'original' });
  assert.equal(Buffer.from(original.base64, 'base64').subarray(0, 5).toString(), '%PDF-');
  assert.equal((await own({ action: 'completeCashReceipt', receiptId: receipt.id })).status, 'pending_signature');
  await assert.rejects(portal(request('other', 'other@example.test', { action: 'completeCashReceipt', providerId, receiptId: receipt.id })), /No representás/);
  await signActual(receipt);
  phase('native signature completed');
  assert.equal((await own({ action: 'completeCashReceipt', receiptId: receipt.id })).status, 'signed');
  assert.equal((await own({ action: 'completeCashReceipt', receiptId: receipt.id })).status, 'signed');
  assert.deepEqual((await rowRef('main').get()).data(), nativeBefore.item, 'requesting and signing never change payment history');
  assert.deepEqual((await cashRef('main').get()).data(), nativeBefore.cash, 'requesting and signing never change cash');
  assert.equal((await db.collection(`projects/${projectId}/activityLog`).where('action', '==', 'cash_receipt_signed').get()).size, 1);
  await seed('general', { cashAccount: 'general', cashBoxLabel: 'Caja General' });
  const generalBefore = (await cashRef('general').get()).data();
  const dollars = await call(await inputFor('general', { parts: { ars: 0, usd: 1, rate: 1500 } }));
  assert.equal(dollars.content.payment.cashAccount, 'general');
  await signActual(dollars);
  assert.equal((await own({ action: 'completeCashReceipt', receiptId: dollars.id })).status, 'signed');
  assert.deepEqual((await cashRef('general').get()).data(), generalBefore);
  const signedFile = await call({ action: 'cashReceiptFile', receiptId: receipt.id, artifact: 'signed' });
  assert.equal(Buffer.from(signedFile.base64, 'base64').subarray(0, 5).toString(), '%PDF-');
  const projectDocument = (await call({ action: 'projectDocuments', projectId })).documents.find(d => d.id === receipt.id);
  assert.equal(projectDocument.source, 'cash_receipt'); assert.equal(projectDocument.artifactsReady, true);
  assert.deepEqual(await call({ action: 'projectFile', projectId, source: 'cash_receipt', documentId: receipt.id, artifact: 'signed' }), signedFile);
  await assert.rejects(call({ action: 'projectFile', projectId: 'project', source: 'cash_receipt', documentId: receipt.id, artifact: 'signed' }), /fuera del alcance/);
  for (const uid of ['admin', 'own', 'other']) {
    const sdk = env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
    await assertFails(getDoc(doc(sdk, `providerCashReceipts/${receipt.id}`)));
    await assertFails(setDoc(doc(sdk, `providerCashReceipts/${receipt.id}`), { status: 'signed' }));
    await assertFails(setDoc(doc(sdk, 'providerCashReceiptKeys/injected'), { receiptId: receipt.id }));
  }
  phase('permissions and accounting preservation passed; cancel signed receipt');
  await operator({ action: 'cancelCashReceipt', receiptId: receipt.id, reason: 'Corrección ficticia del desglose' });
  phase('signed receipt canceled');
  assert.equal((await own({ action: 'myDocuments' })).documents.find(d => d.documentId === receipt.id).status, 'cancelled');
  assert.deepEqual(await call({ action: 'cashReceiptFile', receiptId: receipt.id, artifact: 'signed' }), signedFile, 'canceling retains the signed evidence');
  await assert.rejects(own({ action: 'completeCashReceipt', receiptId: receipt.id }), /antecedente/);
  const replacementInput = await inputFor('main', { parts: { ars: 1500, usd: 0, rate: 0 } });
  const replacement = await operator(replacementInput);
  phase('replacement requested');
  assert.notEqual(replacement.id, receipt.id);
  await operator({ action: 'cancelCashReceipt', receiptId: replacement.id, reason: 'Anulación ficticia' });
  await assert.rejects(operator(replacementInput), /anulada/);
  phase('canceled retry rejected; try native canceled document');
  await assert.rejects(signActual(replacement), /Documento sin vigencia/);
  phase('native canceled document rejected');

  // Resume a preparation after a transient failure, without duplicate requests/PDFs.
  await seed('retry'); let failOnce = true;
  const retryManage = createProviderPortalAdminHandler({ ...deps, sign: { ...sign, prepare: async r => { if (failOnce) { failOnce = false; throw Error('synthetic transient failure'); } return sign.prepare(r); } } });
  const retryCall = data => retryManage(request('admin', 'admin@example.test', data));
  const retryInput = await inputFor('retry');
  await assert.rejects(retryCall(retryInput), /synthetic transient/);
  const resumed = await retryCall({ ...retryInput, attemptId: randomUUID() });
  phase('transient preparation resumed');
  assert.equal(resumed.status, 'requested');
  assert.equal((await call({ action: 'cashReceiptSource', ...scope('retry') })).receipts.length, 1);
  // Changes during preparation or verification cannot certify another payment.
  await seed('changed');
  const changingManage = createProviderPortalAdminHandler({ ...deps, sign: { ...sign, prepare: async r => { const row = (await rowRef('changed').get()).data(); await rowRef('changed').update({ paymentHistory: [{ ...row.paymentHistory[0], detail: 'Changed before remote preparation completes' }] }); return sign.prepare(r); } } });
  const changed = await changingManage(request('admin', 'admin@example.test', await inputFor('changed')));
  assert.equal(changed.status, 'replaced');
  phase('changed preparation rejected');
  await assert.rejects(signActual(changed), /Documento sin vigencia/);
  await seed('cancel-race');
  const cancelingManage = createProviderPortalAdminHandler({ ...deps, sign: { ...sign, prepare: async r => { await call({ action: 'cancelCashReceipt', receiptId: r.id, reason: 'Canceled during preparation' }); return sign.prepare(r); } } });
  const canceled = await cancelingManage(request('admin', 'admin@example.test', await inputFor('cancel-race')));
  assert.equal(canceled.status, 'cancelled'); await assert.rejects(signActual(canceled), /Documento sin vigencia/);
  phase('concurrent cancellation preserved');
  await seed('verify-race');
  const verification = await call(await inputFor('verify-race'));
  await signActual(verification);
  const changedPortal = createProviderPortalHandler({ ...deps, sign: { ...sign, verify: async (...args) => { const proof = await sign.verify(...args); await cashRef('verify-race').update({ amount: 1400 }); return proof; } } });
  await assert.rejects(changedPortal(request('own', 'own@example.test', { action: 'completeCashReceipt', providerId, receiptId: verification.id })), /cambió mientras firmabas/);
  assert.equal((await db.doc(`providerCashReceipts/${verification.id}`).get()).data().status, 'requested');
  // An unchanged payment may move among categories without invalidating its receipt.
  await rowRef('retry').update({ area: 'Otra', subcategory: 'Nueva' });
  assert.equal((await own({ action: 'myDocuments' })).documents.find(d => d.documentId === resumed.id).status, 'pending');
  await db.doc(`providerPortalUsers/own/memberships/${providerId}`).update({ status: 'revoked' });
  await assert.rejects(own({ action: 'completeCashReceipt', receiptId: resumed.id }), /No representás/);
  console.log('PASS cash receipts: cash-only; exact ARS/USD/mixed; author/area/team/identity gates; native Sign signature/artifacts; idempotency; cancellation; preparation/verification races; SDK denial; no accounting changes.');
}
