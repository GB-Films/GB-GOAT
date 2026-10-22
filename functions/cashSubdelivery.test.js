const { test } = require('node:test');
const assert = require('node:assert/strict');
const { availablePersonalCents, createCashSubdeliveryHandler } = require('./cashSubdelivery');
const request = (data = {}, uid = 'admin') => ({ auth: { uid, token: { email: `${uid}@example.test` } }, data: { projectId: 'p', requestId: '12345678-1234-1234-1234-123456789012', toUserEmail: 'recipient@example.test', amount: 50, notes: '', ...data } });

test('personal balance excludes General payments/pending deliveries, reserves returns and handles transfers once', () => {
  const rows = [
    { type: 'entrega', status: 'confirmed', amount: 300, toUserEmail: 'admin@example.test' },
    { type: 'entrega', status: 'pending', amount: 100, toUserEmail: 'admin@example.test' },
    { type: 'transferencia', amount: 20, fromUserEmail: 'admin@example.test', toUserEmail: 'recipient@example.test' },
    { type: 'pago', cashAccount: 'general', amount: 900, fromUserEmail: 'admin@example.test' },
    { type: 'pago', cashAccount: 'personal', amount: 30, fromUserEmail: 'admin@example.test' },
    { type: 'devolucion', status: 'pending', amount: 40, fromUserEmail: 'admin@example.test' },
    { type: 'devolucion', status: 'cancelled', amount: 50, fromUserEmail: 'admin@example.test' },
  ];
  assert.equal(availablePersonalCents(rows, 'admin@example.test'), 21000);
  assert.equal(availablePersonalCents(rows, 'recipient@example.test'), 2000);
  assert.throws(() => availablePersonalCents([{ type: 'entrega', amount: Infinity, toUserEmail: 'admin@example.test' }], 'admin@example.test'), { code: 'failed-precondition' });
});

test('subdelivery input rejects forged source/role, missing auth and malformed values before reading data', async () => {
  const handler = createCashSubdeliveryHandler({ db: null });
  await assert.rejects(handler({ data: {} }), { code: 'unauthenticated' });
  for (const input of [{ fromUserEmail: 'other@example.test' }, { cashAccount: 'general' }, { role: 'admin' }, { projectId: '../p' }, { amount: -1 }, { amount: 0 }, { amount: Infinity }, { amount: 1e14 }, { amount: 1.001 }, { amount: '50' }, { notes: 'x'.repeat(1001) }, { toUserEmail: 'bad/path@example.test' }, { requestId: 'bad' }, { toUserEmail: 'admin@example.test' }]) await assert.rejects(handler(request(input)), { code: 'invalid-argument' });
});

test('real transactions enforce roles, live balance, immutable identity, retry and concurrent spend', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  assert.ok(process.env.GCLOUD_PROJECT?.startsWith('demo-'));
  const { initializeApp, deleteApp } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT }, 'cash-subdelivery-tests');
  const db = getFirestore(app);
  try {
    const root = db.collection('projects').doc('p');
    await root.set({ createdBy: 'owner', generalCashDeliveryBlockedEmails: ['admin@example.test'] });
    for (const uid of ['admin', 'manager', 'lead', 'recipient', 'owner']) await db.collection('users').doc(uid).set({ email: `${uid}@example.test`, role: uid === 'admin' ? 'admin' : 'colaborador' });
    for (const [uid, role] of [['manager', 'admin'], ['lead', 'jefe_produccion'], ['recipient', 'jefe_area']]) await root.collection('collaborators').doc(`${uid}@example.test`).set({ email: `${uid}@example.test`, role });
    const handler = createCashSubdeliveryHandler({ db, timestamp: () => FieldValue.serverTimestamp() });
    for (const uid of ['lead', 'recipient', 'outsider']) await assert.rejects(handler(request({ toUserEmail: 'admin@example.test' }, uid)), { code: 'permission-denied' });
    await assert.rejects(handler(request()), { code: 'failed-precondition' });
    await root.collection('cashMovements').doc('funds').set({ type: 'entrega', status: 'confirmed', amount: 100, toUserEmail: 'admin@example.test' });
    const first = await handler(request());
    assert.equal((await handler(request())).repeated, true);
    assert.equal((await root.collection('cashMovements').get()).size, 2);
    await assert.rejects(handler(request({ amount: 49 })), { code: 'already-exists' });
    const saved = (await root.collection('cashMovements').doc(first.id).get()).data();
    assert.equal(saved.fromUserEmail, 'admin@example.test'); assert.equal(saved.cashAccount, 'personal'); assert.equal(saved.subdelivery, true);
    const results = await Promise.allSettled(['22345678-1234-1234-1234-123456789012', '32345678-1234-1234-1234-123456789012'].map(requestId => handler(request({ requestId, amount: 40 }))));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'failed-precondition').length, 1);
    for (const uid of ['manager', 'owner']) {
      await root.collection('cashMovements').doc(`fund-${uid}`).set({ type: 'entrega', status: 'confirmed', amount: 30, toUserEmail: `${uid}@example.test` });
      assert.equal((await handler(request({ requestId: uid === 'owner' ? '42345678-1234-1234-1234-123456789012' : '52345678-1234-1234-1234-123456789012', amount: 20, toUserEmail: uid === 'manager' ? 'owner@example.test' : 'recipient@example.test' }, uid))).repeated, false);
    }
    await assert.rejects(handler(request({ projectId: 'another-project', requestId: '62345678-1234-1234-1234-123456789012' })), { code: 'permission-denied' });
    await assert.rejects(handler(request({ toUserEmail: 'outsider@example.test', requestId: '72345678-1234-1234-1234-123456789012' })), { code: 'permission-denied' });
    const ledger = (await root.collection('cashMovements').get()).docs.map(doc => doc.data());
    assert.equal(ledger.filter(row => row.type === 'entrega').length, 3);
    assert.equal(availablePersonalCents(ledger, 'admin@example.test'), 1000);
  } finally { await deleteApp(app); }
});
