import assert from 'node:assert/strict';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';

export async function testPortalInvoiceUpload({ db, portal, request, sign, env, assertFails, createProviderPortalHandler, deps }) {
  const providerId = 'invoice-supplier', projectId = 'invoice-project';
  const actor = data => portal(request('invoice-user', 'invoice@example.test', data));
  const memberRef = db.doc(`providerPortalUsers/invoice-user/memberships/${providerId}`);
  await db.doc(`providers/${providerId}`).set({ type: 'persona', name: 'Ficticio', email: 'invoice@example.test' });
  await memberRef.set({ status: 'active', email: 'invoice@example.test', providerId });
  await db.doc(`projects/${projectId}`).set({ name: 'Proyecto ficticio', activeAreas: ['Campo'] });
  const file = n => ({ base64: Buffer.from(`%PDF-fictitious-${n}`).toString('base64'), contentType: 'application/pdf', fileName: 'factura.pdf' });
  const base = { providerId, area: 'Campo', description: 'Servicio', total: 100, paid: true, paymentHistory: [{ id: 'paid', amount: 100, createdBy: 'producer' }], paymentLocked: true };
  const expenseRef = (id, collection = 'areaExpenses') => db.doc(`projects/${projectId}/${collection}/${id}`);
  const input = (id, n = id, collection = 'areaExpenses') => ({ action: 'uploadInvoice', providerId, workKey: `${projectId}/${collection}/${id}`, attemptId: `attempt-${id}`, file: file(n) });
  for (const [id, record] of Object.entries({ empty: {}, legacy: { invoice: { path: 'original/producer.pdf', uploadedBy: 'producer' } },
    array: { invoices: [{ url: 'private-admin-link', uploadedBy: 'admin' }] }, shared: { sharedInvoices: [{ id: 'active-shared' }] },
    third: { thirdPartyPayoutRequired: true }, race: {}, parallel: {}, revoked: {}, moved: {}, foreign: { providerId: 'someone-else' } })) await expenseRef(id).set({ ...base, ...record });
  const before = (await expenseRef('empty').get()).data();
  assert.equal((await actor(input('empty'))).uploaded, true);
  const saved = (await expenseRef('empty').get()).data();
  const { invoices, updatedAt, ...financial } = saved;
  assert.deepEqual(financial, before, 'upload never changes money, payment history, identity or locks');
  assert.equal(invoices.length, 1); assert.equal(invoices[0].uploadedByUid, 'invoice-user');
  assert.equal((await actor({ ...input('empty'), attemptId: 'retry-other-id' })).resumed, true);
  assert.equal((await expenseRef('empty').get()).data().invoices.length, 1);
  await assert.rejects(actor(input('empty', 'another-file')), e => e.code === 'already-exists');
  for (const id of ['legacy', 'array', 'shared']) {
    const prior = (await expenseRef(id).get()).data();
    await assert.rejects(actor(input(id)), e => e.code === 'already-exists');
    assert.deepEqual((await expenseRef(id).get()).data(), prior);
  }
  await assert.rejects(actor(input('third')), /tercero/);
  await assert.rejects(actor(input('foreign')), e => e.code === 'permission-denied');
  await expenseRef('mirror', 'budgetItems').set(base);
  await assert.rejects(actor(input('mirror', 'mirror', 'budgetItems')), /cambió de área/);
  await expenseRef('budget', 'budgetItems').set({ ...base, area: 'Arte' });
  assert.equal((await actor(input('budget', 'budget', 'budgetItems'))).uploaded, true);

  // A producer wins the race while bytes are being stored; the final transaction must preserve that invoice.
  const racingPortal = createProviderPortalHandler({ ...deps, sign: { ...sign, storeInvoice: async args => {
    const stored = await sign.storeInvoice(args);
    await expenseRef('race').update({ invoice: { path: 'original/concurrent-producer.pdf', uploadedBy: 'producer' } });
    return stored;
  } } });
  await assert.rejects(racingPortal(request('invoice-user', 'invoice@example.test', input('race'))), e => e.code === 'already-exists');
  assert.equal((await expenseRef('race').get()).data().invoices, undefined);
  const parallel = await Promise.allSettled([actor(input('parallel', 'one')), actor(input('parallel', 'two'))]);
  assert.equal(parallel.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(parallel.find(r => r.status === 'rejected').reason.code, 'already-exists');
  assert.equal((await expenseRef('parallel').get()).data().invoices.length, 1);
  const revokeDuringUpload = createProviderPortalHandler({ ...deps, sign: { ...sign, storeInvoice: async args => {
    const stored = await sign.storeInvoice(args); await memberRef.update({ status: 'revoked' }); return stored;
  } } });
  await assert.rejects(revokeDuringUpload(request('invoice-user', 'invoice@example.test', input('revoked'))), e => e.code === 'permission-denied');
  assert.equal((await expenseRef('revoked').get()).data().invoices, undefined);
  await memberRef.update({ status: 'active' });
  const moveDuringUpload = createProviderPortalHandler({ ...deps, sign: { ...sign, storeInvoice: async args => {
    const stored = await sign.storeInvoice(args); await db.doc(`projects/${projectId}`).update({ activeAreas: [] }); return stored;
  } } });
  await assert.rejects(moveDuringUpload(request('invoice-user', 'invoice@example.test', input('moved'))), /cambió de área/);
  assert.equal((await expenseRef('moved').get()).data().invoices, undefined);
  await db.doc(`projects/${projectId}`).update({ activeAreas: ['Campo'] });
  const stale = request('invoice-user', 'invoice@example.test', input('moved')); stale.auth.token.auth_time = 1;
  await assert.rejects(portal(stale), e => e.code === 'unauthenticated');

  // Even a direct SDK call cannot remove/replace a producer's or the supplier's files.
  const sdk = env.authenticatedContext('invoice-user', { email: 'invoice@example.test', email_verified: true });
  for (const id of ['legacy', 'array', 'empty']) {
    await assertFails(updateDoc(doc(sdk.firestore(), expenseRef(id).path), { invoice: null, invoices: [] }));
    await assertFails(deleteDoc(doc(sdk.firestore(), expenseRef(id).path)));
  }
  await assertFails(deleteObject(ref(sdk.storage(), invoices[0].path)));
  await assert.rejects(actor({ ...input('empty'), action: 'deleteInvoice' }), /Acción desconocida/);
  await db.doc(`providerPortalUsers/another-representative/memberships/${providerId}`).set({ status: 'active', email: 'another@example.test' });
  await assert.rejects(portal(request('another-representative', 'another@example.test', input('empty'))), e => e.code === 'already-exists');
  const overview = await actor({ action: 'overview', providerId });
  for (const id of ['legacy', 'array', 'shared', 'empty']) assert.equal(overview.works.find(w => w.expenseId === id).hasInvoice, true);
  const downloaded = await actor({ action: 'download', providerId, workKey: input('empty').workKey, kind: 'invoice', index: 0 });
  assert.equal(downloaded.base64, file('empty').base64);
  console.log('PASS portal invoice uploads: empty work only, existing legacy/array/shared protected, paid history intact, exact retries, concurrent producers/uploads, revocation/area races, stale session, SDK deletion denied and original download.');
}
