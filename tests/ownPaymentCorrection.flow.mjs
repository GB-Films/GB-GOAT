import assert from 'node:assert/strict';
export async function testOwnPaymentCorrections({ db, call, snapshot }) {
  const projectId = 'own-corrections', root = db.doc(`projects/${projectId}`);
  const auth = (uid = 'editor') => ({ uid, token: { email: `${uid}@example.test`, email_verified: true } });
  await root.set({ name: 'Proyecto ficticio', activeAreas: ['Post'], collaboratorEmails: ['editor@example.test', 'viewer@example.test'] });
  for (const uid of ['editor', 'viewer']) {
    await db.doc(`users/${uid}`).set({ role: 'colaborador', email: `${uid}@example.test` });
    await root.collection('collaborators').doc(`${uid}@example.test`).set({ role: 'jefe_produccion', canEditBudgetAreas: true, allowedTabs: ['areas'], allowedCategories: ['Post'] });
  }
  const other = { id: 'other', amount: 40, date: '2026-10-20', detail: 'Otro autor', method: 'otro', createdBy: 'admin', createdByEmail: 'admin@example.test' };
  const own = { id: 'own', amount: 20, date: '2026-10-20', detail: 'Original', method: 'otro', createdBy: 'editor', createdByEmail: 'editor@example.test' };
  const expenseRef = root.collection('areaExpenses').doc('expense');
  await expenseRef.set({ providerId: 'supplier', area: 'Post', subcategory: '', total: 100, paymentHistory: [other, own], paymentLocked: true, paymentAuthorIds: ['admin', 'editor'] });
  const request = { action: 'correctOwnPayment', projectId, collectionName: 'areaExpenses', itemId: 'expense', paymentId: 'own', attemptId: 'first', expected: snapshot(own), amount: 30, date: '2026-10-29', detail: 'Corregido' };
  const invoke = (input = request, uid = 'editor') => call({ auth: auth(uid), data: input });
  const corrected = await invoke();
  assert.equal(corrected.paymentHistory[1].amount, 30); assert.deepEqual(corrected.paymentHistory[0], other);
  assert.equal((await invoke()).repeated, true);
  const audit = (await root.collection('activityLog').doc('own-payment-first').get()).data();
  assert.equal(audit.before.createdBy, 'editor'); assert.equal(audit.after.createdBy, 'editor'); assert.equal(audit.oldAmount, 20); assert.equal(audit.amount, 30);
  await assert.rejects(invoke({ ...request, amount: 31 }), /intento/);
  await assert.rejects(invoke({ ...request, attemptId: 'stale' }), /cambió/);
  await assert.rejects(invoke({ ...request, attemptId: 'foreign', paymentId: 'other', expected: snapshot(other) }), /cargaste vos/);
  await assert.rejects(invoke({ ...request, attemptId: 'other-actor' }, 'viewer'), /cargaste vos/);
  const fresh = { ...request, attemptId: 'new', expected: snapshot(corrected.paymentHistory[1]) };
  for (const amount of [-1, 0, 1.001, 61, Infinity]) await assert.rejects(invoke({ ...fresh, amount }));
  await assert.rejects(call({ auth: { ...auth(), token: { ...auth().token, email_verified: false } }, data: fresh }), /Verificá/);
  await root.collection('collaborators').doc('editor@example.test').update({ allowedCategories: [] });
  await assert.rejects(invoke(fresh), /área/);
  await root.collection('collaborators').doc('editor@example.test').update({ allowedCategories: ['Post'] });
  await expenseRef.update({ paymentHistory: [other, { ...own, cashMovementId: 'cash', cashAccount: 'personal', paidByEmail: 'editor@example.test', method: 'caja_efectivo' }] });
  await root.collection('cashMovements').doc('delivery').set({ type: 'entrega', amount: 50, toUserEmail: 'editor@example.test', status: 'confirmed' });
  await root.collection('cashMovements').doc('cash').set({ type: 'pago', amount: 20, fromUserEmail: 'editor@example.test', cashAccount: 'personal', collectionName: 'areaExpenses', itemId: 'expense', paymentId: 'own' });
  const cashPayment = (await expenseRef.get()).data().paymentHistory[1];
  const cashRequest = { ...request, attemptId: 'cash-limit', expected: snapshot(cashPayment), amount: 51 };
  await assert.rejects(invoke(cashRequest), /saldo disponible de tu caja/);
  await invoke({ ...cashRequest, attemptId: 'cash-ok', amount: 35 });
  assert.equal((await root.collection('cashMovements').doc('cash').get()).data().amount, 35);
  assert.equal((await expenseRef.get()).data().paymentHistory[0].amount, 40);
  await root.collection('cashMovements').doc('cash').update({ fromUserEmail: 'viewer@example.test' });
  const latest = (await expenseRef.get()).data().paymentHistory[1];
  await assert.rejects(invoke({ ...request, attemptId: 'foreign-box', expected: snapshot(latest) }), /caja|vínculo/);
  await root.update({ collaboratorEmails: ['viewer@example.test'] }); await root.collection('collaborators').doc('editor@example.test').delete();
  await assert.rejects(invoke({ ...request, attemptId: 'removed', expected: snapshot(latest) }), /acceso/);
  const parallelRoot = db.doc('projects/own-parallel');
  await parallelRoot.set({ collaboratorEmails: ['editor@example.test'], activeAreas: ['Post'] });
  await parallelRoot.collection('collaborators').doc('editor@example.test').set({ role: 'jefe_produccion', canEditBudgetAreas: true, allowedTabs: ['areas'], allowedCategories: ['Post'] });
  await parallelRoot.collection('cashMovements').doc('delivery').set({ type: 'entrega', amount: 50, toUserEmail: 'editor@example.test', status: 'confirmed' });
  const attempts = [];
  for (const [index, amount] of [20, 10].entries()) {
    const payment = { ...own, id: `p${index}`, amount, cashMovementId: `m${index}`, cashAccount: 'personal', paidByEmail: 'editor@example.test', method: 'caja_efectivo' };
    await parallelRoot.collection('areaExpenses').doc(`e${index}`).set({ providerId: 'supplier', area: 'Post', subcategory: '', total: 100, paymentHistory: [payment] });
    await parallelRoot.collection('cashMovements').doc(`m${index}`).set({ type: 'pago', amount, fromUserEmail: 'editor@example.test', cashAccount: 'personal', collectionName: 'areaExpenses', itemId: `e${index}`, paymentId: payment.id });
    attempts.push({ ...request, projectId: 'own-parallel', itemId: `e${index}`, paymentId: payment.id, attemptId: `parallel-${index}`, expected: snapshot(payment), amount: amount + 15 });
  }
  const simultaneous = await Promise.allSettled(attempts.map(attempt => invoke(attempt)));
  assert.equal(simultaneous.filter(result => result.status === 'fulfilled').length, 1, 'two corrections cannot spend the same available cash');
  console.log('PASS: own payment corrections preserve foreign history, validate live author/scope/cash, audit atomically and reject stale, repeated-with-changes, excessive and revoked requests.');
}
