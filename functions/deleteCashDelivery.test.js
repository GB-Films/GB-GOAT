const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCashSubdeliveryHandler, availablePersonalCents } = require('./cashSubdelivery');
const actorEmail = 'tomas@granberta.com', recipient = 'delete-recipient@example.test';
const request = (data = {}, auth = { uid: 'custodian', token: { email: actorEmail } }) => ({ auth, data: { action: 'deleteDelivery', projectId: 'cash-delete', movementId: 'funds', ...data } });

test('deletion rejects missing identity, forged money/actor fields and malformed paths before reading', async () => {
  const handler = createCashSubdeliveryHandler({ db: null });
  await assert.rejects(handler(request({}, null)), { code: 'unauthenticated' });
  for (const input of [{ amount: 1 }, { recipientEmail: actorEmail }, { deletedBy: 'other' }, { projectId: '../p' }, { movementId: '../funds' }, { movementId: '' }]) {
    await assert.rejects(handler(request(input)), { code: 'invalid-argument' });
  }
  await assert.rejects(handler(request({}, { uid: 'admin', token: { email: 'admin@example.test' } })), { code: 'permission-denied' });
});

test('delivery deletion uses live ledger, permissions, immutable audit and serializes competing operations', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async t => {
  assert(process.env.GCLOUD_PROJECT?.startsWith('demo-'));
  const { initializeApp, deleteApp } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT }, 'cash-delivery-deletion-tests'), db = getFirestore(app);
  const root = db.collection('projects').doc('cash-delete'), movements = root.collection('cashMovements'), audits = root.collection('activityLog');
  const handler = createCashSubdeliveryHandler({ db, timestamp: () => FieldValue.serverTimestamp() });
  const fund = (amount = 100, other = {}) => ({ type: 'entrega', status: 'confirmed', cashAccount: 'general', amount, toUserEmail: recipient, ...other });
  const outgoing = (type, other = {}) => ({ type, cashAccount: 'personal', amount: 100, fromUserEmail: recipient, ...other });
  const seed = async (rows = { funds: fund() }) => {
    await db.recursiveDelete(root);
    await root.set({ createdBy: 'owner', cashSubdeliveryRevision: 0 });
    await db.doc('users/custodian').set({ email: actorEmail, role: 'admin', displayName: 'Synthetic custodian' });
    await db.doc('users/deletion-recipient').set({ email: recipient, role: 'colaborador' });
    await root.collection('collaborators').doc(recipient).set({ email: recipient, role: 'jefe_area' });
    await Promise.all(Object.entries(rows).map(([id, row]) => movements.doc(id).set(row)));
  };
  const assertUnchanged = async before => {
    assert.deepEqual((await movements.get()).docs.map(d => ({ id: d.id, ...d.data() })), before);
    assert.equal((await audits.get()).size, 0); assert.equal((await root.get()).data().cashSubdeliveryRevision, 0);
  };
  try {
    for (const [name, spend] of [
      ['payment', outgoing('pago')], ['reimbursement', outgoing('reintegro')],
      ['pending transfer', outgoing('transferencia', { status: 'pending', toUserEmail: 'other@example.test' })],
      ['confirmed transfer', outgoing('transferencia', { status: 'confirmed', toUserEmail: 'other@example.test' })],
      ['historical transfer', outgoing('transferencia', { toUserEmail: 'other@example.test' })],
      ['pending return', outgoing('devolucion', { status: 'pending', cashAccount: 'general' })],
      ['confirmed return', outgoing('devolucion', { status: 'confirmed', cashAccount: 'general' })],
    ]) await t.test(`blocks funds needed by ${name}, with no partial writes`, async () => {
      await seed({ funds: fund(), spend }); const before = (await movements.get()).docs.map(d => ({ id: d.id, ...d.data() }));
      await assert.rejects(handler(request()), error => error.code === 'failed-precondition' && /saldo restante no alcanza/.test(error.message));
      await assertUnchanged(before);
    });
    await t.test('pending incoming funds cannot back outgoing payments', async () => {
      await seed({ funds: fund(), pending: fund(100, { status: 'pending' }), spend: outgoing('pago') });
      await assert.rejects(handler(request()), { code: 'failed-precondition' }); assert.equal((await movements.get()).size, 3);
    });
    await t.test('other confirmed funds can cover commitments exactly; audit and retry preserve all other rows', async () => {
      await seed({ funds: fund(), other: fund(100), spend: outgoing('pago') });
      const before = (await movements.doc('funds').get()).data(), retained = (await movements.doc('spend').get()).data();
      const replies = await Promise.all([handler(request()), handler(request())]); assert.equal(replies.filter(x => x.repeated).length, 1);
      assert.equal((await movements.doc('funds').get()).exists, false); assert.deepEqual((await movements.doc('spend').get()).data(), retained);
      const audit = (await audits.get()).docs; assert.equal(audit.length, 1); assert.deepEqual(audit[0].data().before, before);
      assert.equal(audit[0].data().balanceAfterCents, 0); assert.equal(audit[0].data().deletedBy, 'custodian'); assert.equal((await root.get()).data().cashSubdeliveryRevision, 1);
    });
    await t.test('unused pending/legacy funds, cancelled reservations and cent precision remain usable', async () => {
      for (const status of ['pending', undefined]) {
        await seed({ funds: status ? fund(100, { status }) : { type: 'entrega', amount: 100, toUserEmail: recipient }, cancelled: outgoing('transferencia', { status: 'cancelled' }) });
        assert.equal((await handler(request())).repeated, false);
      }
      await seed({ funds: fund(0.02), other: fund(0.01), spend: outgoing('pago', { amount: 0.01 }) });
      assert.equal((await handler(request())).repeated, false);
    });
    await t.test('roles, project restrictions and immutable types are enforced on the server', async () => {
      await seed();
      await root.update({ generalCashDeliveryBlockedEmails: [actorEmail] }); await assert.rejects(handler(request()), { code: 'permission-denied' });
      await root.update({ generalCashDeliveryBlockedEmails: [] });
      await db.doc('users/custodian').update({ role: 'colaborador' }); await assert.rejects(handler(request()), { code: 'permission-denied' });
      await root.collection('collaborators').doc(actorEmail).set({ role: 'admin' }); assert.equal((await handler(request())).repeated, false);
      await seed(); await db.doc('users/custodian').update({ email: 'different@example.test' }); await assert.rejects(handler(request()), { code: 'permission-denied' });
      await seed(); await assert.rejects(handler(request({ projectId: 'foreign' })), { code: 'permission-denied' });
      for (const replacement of [outgoing('pago'), fund(100, { subdelivery: true }), fund(100, { sharedRecordId: 'invoice' }), fund(100, { toUserEmail: '' }), fund(1.005)]) {
        await seed({ funds: replacement }); await assert.rejects(handler(request()), { code: 'failed-precondition' }); assert.equal((await audits.get()).size, 0);
      }
    });
    await t.test('a missing delivery is not silently treated as an audited deletion; recreated IDs are protected', async () => {
      await seed({}); await assert.rejects(handler(request()), { code: 'not-found' });
      await movements.doc('funds').set(fund()); await handler(request()); await movements.doc('funds').set(fund(20));
      await assert.rejects(handler(request()), { code: 'failed-precondition' }); assert.equal((await movements.doc('funds').get()).data().amount, 20);
    });
    await t.test('two deletions cannot both spend the same remaining backing', async () => {
      await seed({ funds: fund(), other: fund(), spend: outgoing('pago') });
      const results = await Promise.allSettled([handler(request()), handler(request({ movementId: 'other' }))]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'failed-precondition').length, 1);
      assert.equal((await audits.get()).size, 1); assert.equal(availablePersonalCents((await movements.get()).docs.map(d => d.data()), recipient), 0);
    });
    await t.test('concurrent personal delivery and deletion cannot consume the same backing', async () => {
      await seed({ funds: fund(100, { toUserEmail: actorEmail }), other: fund(100, { toUserEmail: actorEmail }) });
      const transfer = { auth: request().auth, data: { projectId: root.id, requestId: '12345678-1234-1234-1234-123456789012', toUserEmail: recipient, amount: 150, receiptVersion: 1 } };
      const results = await Promise.allSettled([handler(request()), handler(transfer)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'failed-precondition').length, 1, JSON.stringify(results.map(r => r.status === 'rejected' ? { code: r.reason.code, message: r.reason.message } : r.value)));
      assert(availablePersonalCents((await movements.get()).docs.map(d => d.data()), actorEmail) >= 0); assert.equal((await root.get()).data().cashSubdeliveryRevision, 1);
    });
  } finally { await deleteApp(app); }
});
