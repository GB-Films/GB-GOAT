const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAreaStructureChange } = require('./areaStructureChange');
const { createProviderFinanceHandler } = require('./providerFinance');
const base = { action: 'reclassifyAreaExpenses', operationId: '12345678-1234-1234-1234-123456789012', projectId: 'structure', kind: 'expense',
  itemId: 'paid', fromArea: 'Arte', fromSubcategory: 'Vestuario', targetArea: 'Campo', targetSubcategory: 'Comidas', expectedRevision: 0 };
test('classification input cannot smuggle monetary edits or foreign document paths', async () => {
  const call = createAreaStructureChange({ db: null });
  for (const input of [{ ...base, total: 1 }, { ...base, paymentHistory: [] }, { ...base, projectId: '../other' }, { ...base, operationId: 'bad' },
    { ...base, expectedRevision: -1 }, { ...base, targetArea: '__proto__' }, { ...base, beforeExpenseId: 'bad/path' },
    { ...base, kind: 'subcategory', itemId: undefined, budget: null }]) await assert.rejects(call({ uid: 'operator', email: 'operator@example.test' }, input), { code: 'invalid-argument' });
});

test('paid area classification preserves the native financial model, access and concurrent payments', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async t => {
  assert(process.env.GCLOUD_PROJECT?.startsWith('demo-'));
  const { initializeApp, deleteApp } = require('firebase-admin/app'), { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT }, 'area-structure-tests'), db = getFirestore(app), root = db.doc('projects/structure');
  const handler = createProviderFinanceHandler({ db, timestamp: () => FieldValue.serverTimestamp(), verifyFile: () => { throw Error('Classification must not replace files'); } });
  const auth = uid => ({ uid, token: { email: `${uid}@example.test`, email_verified: true } });
  const run = (data = {}, uid = 'operator') => handler({ auth: auth(uid), data: { ...base, ...data } });
  const rename = { kind: 'subcategory', itemId: undefined, targetArea: 'Arte', targetSubcategory: 'Escénico', budget: { assigned: true, amount: 300, notes: 'Mismo presupuesto', expected: JSON.stringify([true, 300, 'Conservar']) } };
  const cleanInput = data => Object.fromEntries(Object.entries({ ...base, ...data }).filter(([, value]) => value !== undefined));
  const groupRun = (data = {}, uid = 'operator') => handler({ auth: auth(uid), data: cleanInput({ ...rename, ...data }) });
  const allocation = { projectId: 'structure', collectionName: 'areaExpenses', itemId: 'paid', area: 'Arte', subcategory: 'Vestuario', amountCents: 10000 };
  const foreignAllocation = { projectId: 'other', collectionName: 'areaExpenses', itemId: 'foreign', area: 'External', amountCents: 9000 };
  const seed = async () => {
    await db.recursiveDelete(root);
    await root.set({ createdBy: 'owner', activeAreas: ['Arte', 'Campo', 'Post'], categories: ['Arte', 'Campo', 'Post'], budgetRevision: 0,
      categoryBudgets: { Arte: 5000, Campo: 5000, Post: 2000 }, areaExpenseSubcategories: { Arte: ['Vestuario', 'Utilería'], Campo: ['Comidas'], Post: ['Edición'] },
      areaExpenseSubcategoryBudgets: { 'Arte||Vestuario': { area: 'Arte', subcategory: 'Vestuario', budget: 300, budgetAssigned: true, notes: 'Conservar' }, 'Campo||Comidas': 100 } });
    for (const uid of ['operator', 'both', 'limited', 'excluded', 'reader', 'lead']) {
      await db.doc(`users/${uid}`).set({ email: `${uid}@example.test`, role: uid === 'operator' ? 'admin' : 'colaborador' });
      await root.collection('collaborators').doc(`${uid}@example.test`).set({ email: `${uid}@example.test`, role: uid === 'lead' ? 'jefe_produccion' : 'jefe_area',
        allowedTabs: ['areas'], allowedCategories: ['limited', 'lead'].includes(uid) ? ['Arte'] : ['Arte', 'Campo'],
        canEditBudgetAreas: uid !== 'reader', excludedSubcategories: uid === 'excluded' ? ['Campo||Comidas'] : [] });
    }
    await root.collection('collaborators').doc('follower@example.test').set({ email: 'follower@example.test', role: 'jefe_area', allowedTabs: ['areas'], canEditBudgetAreas: true,
      allowedCategories: [], allowedSubcategories: ['Arte||Vestuario'], excludedSubcategories: ['Arte||Vestuario', 'Post||Edición'] });
    await root.collection('areaExpenses').doc('paid').set({ area: 'Arte', subcategory: 'Vestuario', order: 0, providerId: 'worker', providerName: 'Synthetic provider',
      description: 'Servicio original', quantity: 1, unitPrice: 100, total: 100, paid: true, paymentLocked: true, paymentAuthorIds: ['someone', 'operator'],
      thirdPartyPayoutRequired: true, invoice: { path: 'original.pdf', sha256: 'original' }, invoices: [{ path: 'extra.pdf' }],
      sharedInvoices: [{ id: 'invoice', amountCents: 10000, fileHidden: true }], sharedReceipts: [{ id: 'other', amountCents: 1 }], sharedPaymentIds: ['payment'],
      paymentHistory: [{ id: 'simple', amount: 50, createdBy: 'someone', cashMovementId: 'cash', cashAccount: 'general', method: 'caja_efectivo', receipt: { path: 'receipt.pdf' } },
        { id: 'shared-payment', sharedRecordId: 'payment', amount: 50, method: 'otro', thirdPartyAuthorizationId: 'authority' }], updatedAt: new Date('2026-01-01T12:00:00Z') });
    await root.collection('areaExpenses').doc('unpaid').set({ area: 'Arte', subcategory: 'Vestuario', order: 1, total: 200, description: 'Otro gasto' });
    await root.collection('areaExpenses').doc('utility').set({ area: 'Arte', subcategory: 'Utilería', order: 0, total: 25 });
    await root.collection('areaExpenses').doc('target').set({ area: 'Campo', subcategory: 'Comidas', order: 0, total: 10 });
    await root.collection('cashMovements').doc('cash').set({ type: 'pago', area: 'Arte', subcategory: 'Vestuario', collectionName: 'areaExpenses', itemId: 'paid', paymentId: 'simple', amount: 50,
      cashAccount: 'general', fromUserEmail: 'tomas@granberta.com', createdBy: 'someone', date: '2026-01-01', receipt: { path: 'receipt.pdf' } });
    await root.collection('cashMovements').doc('reimbursement').set({ type: 'reintegro', area: 'Arte', collectionName: 'areaExpenses', itemId: 'paid', amount: 10, createdBy: 'someone' });
    await root.collection('cashMovements').doc('shared-general').set({ type: 'pago', cashAccount: 'general', sharedRecordId: 'payment', amount: 50, notes: 'Operación distribuida' });
    await db.doc('providerFinancialRecords/invoice').set({ kind: 'invoice', status: 'active', providerId: 'worker', fingerprint: 'fiscal-original', file: { path: 'invoice.pdf', sha256: 'invoice-sha' },
      allocations: [allocation, foreignAllocation], settlements: { payment: [{ ...allocation, amountCents: 5000, invoiceId: 'invoice' }] } });
    await db.doc('providerFinancialRecords/payment').set({ kind: 'payment', status: 'active', providerId: 'worker', fingerprint: 'payment-original', thirdPartyAuthorizationId: 'authority',
      allocations: [{ ...allocation, amountCents: 5000, invoiceId: 'invoice' }], settlements: {}, payeeCuit: '20111111112', reference: 'original-reference', file: { path: 'receipt-shared.pdf' } });
    await db.doc('providerFinancialRecords/other').set({ kind: 'other', status: 'active', providerId: 'worker', fingerprint: 'other-original', allocations: [{ ...allocation, amountCents: 1 }] });
    await db.doc('providerFinanceProjectIndex/structure').set({ records: { invoice: [{ area: 'Arte', collectionName: 'areaExpenses' }], payment: [{ area: 'Arte', collectionName: 'areaExpenses' }],
      other: [{ area: 'Arte', collectionName: 'areaExpenses' }], retained: [{ area: 'Post', collectionName: 'areaExpenses' }] }, managedAreas: ['Arte', 'Post'], budgetAreas: [] });
    await db.doc('providerFinanceProviderIndex/worker').set({ keep: 'provider-index-original' });
    await db.doc('providerFinanceProjectIndex/other').set({ records: { invoice: [{ area: 'External', collectionName: 'areaExpenses' }] }, keep: 'other-project-index' });
    await db.doc('providerPortalDeclarations/authority').set({ kind: 'third_party', status: 'active', proof: { complete: true, signedPdfSha256: 'signed-original' }, content: { workKeys: ['structure/areaExpenses/paid'] } });
  };
  const get = async path => (await db.doc(path).get()).data();
  const financial = value => JSON.parse(JSON.stringify(value, (key, entry) => ['area', 'subcategory', 'order', 'updatedAt'].includes(key) ? undefined : entry));
  const capture = async () => ({ expense: await get('projects/structure/areaExpenses/paid'), cash: await get('projects/structure/cashMovements/cash'),
    invoice: await get('providerFinancialRecords/invoice'), payment: await get('providerFinancialRecords/payment'), authority: await get('providerPortalDeclarations/authority'),
    aggregateCash: await get('projects/structure/cashMovements/shared-general'), foreignIndex: await get('providerFinanceProjectIndex/other') });
  const unchanged = async before => {
    const after = await capture();
    for (const key of ['expense', 'cash', 'invoice', 'payment']) assert.deepEqual(financial(after[key]), financial(before[key]), key + ' financial fields preserved');
    for (const key of ['authority', 'aggregateCash', 'foreignIndex']) assert.deepEqual(after[key], before[key], key + ' preserved byte-for-byte');
  };
  try {
    await t.test('rename paid group keeps payment history, files, fiscal keys, authorizations and exact row IDs', async () => {
      await seed(); const before = await capture();
      const first = await groupRun(); assert.equal(first.repeated, false); assert.equal(first.affectedExpenses, 2);
      assert.equal((await get('projects/structure/areaExpenses/paid')).subcategory, 'Escénico');
      assert.deepEqual((await get('projects/structure')).areaExpenseSubcategories.Arte, ['Escénico', 'Utilería']);
      assert.deepEqual((await get('projects/structure/collaborators/follower@example.test')).excludedSubcategories, ['Arte||Escénico', 'Post||Edición']);
      await unchanged(before); assert.equal((await root.collection('activityLog').get()).size, 1);
      assert.equal((await groupRun()).repeated, true); assert.equal((await root.get()).data().budgetRevision, 1);
      await assert.rejects(groupRun({ targetSubcategory: 'Otro nombre' }), { code: 'failed-precondition' });
    });
    await t.test('a paid expense can move to another area with its cash metadata and shared indices', async () => {
      await seed(); const before = await capture(); await run({ beforeExpenseId: 'target' });
      const moved = await get('projects/structure/areaExpenses/paid'); assert.equal(moved.area, 'Campo'); assert.equal(moved.subcategory, 'Comidas'); assert.equal(moved.order, 0);
      assert.equal((await get('projects/structure/areaExpenses/target')).order, 1); assert.equal((await get('projects/structure/cashMovements/reimbursement')).area, 'Campo');
      assert.equal((await get('providerFinancialRecords/invoice')).allocations[0].area, 'Campo');
      assert.deepEqual((await get('providerFinancialRecords/invoice')).allocations[1], before.invoice.allocations[1]);
      assert.equal((await get('providerFinancialRecords/invoice')).settlements.payment[0].area, 'Campo');
      assert.deepEqual((await get('providerFinanceProjectIndex/structure')).managedAreas.sort(), ['Campo', 'Post']);
      assert.equal((await get('providerFinanceProviderIndex/worker')).keep, 'provider-index-original'); await unchanged(before);
    });
    await t.test('whole paid group can move across categories and carry its budget and explicit permissions', async () => {
      await seed(); const before = await capture(); await groupRun({ budget: undefined, targetArea: 'Campo', targetSubcategory: 'Vestuario', beforeSubcategory: 'Comidas' });
      const project = await get('projects/structure'); assert.deepEqual(project.areaExpenseSubcategories.Arte, ['Utilería']); assert.deepEqual(project.areaExpenseSubcategories.Campo, ['Vestuario', 'Comidas']);
      assert.equal(project.areaExpenseSubcategoryBudgets['Campo||Vestuario'].budget, 300); assert.equal(project.areaExpenseSubcategoryBudgets['Arte||Vestuario'], undefined);
      assert.equal((await get('projects/structure/areaExpenses/unpaid')).area, 'Campo'); assert.equal((await get('projects/structure/areaExpenses/paid')).area, 'Campo');
      assert.deepEqual((await get('projects/structure/collaborators/follower@example.test')).allowedSubcategories, ['Campo||Vestuario']); await unchanged(before);
    });
    await t.test('dragging a whole group below another changes order alone, including paid rows', async () => {
      await seed(); const before = await capture(); await groupRun({ budget: undefined, targetSubcategory: 'Vestuario', beforeSubcategory: null });
      assert.deepEqual((await get('projects/structure')).areaExpenseSubcategories.Arte, ['Utilería', 'Vestuario']); assert.deepEqual(await capture(), before);
    });
    await t.test('the default group and a case-only rename work with paid rows and keep their existing budget', async () => {
      await seed();
      await root.update({ areaExpenseSubcategories: { Arte: ['Sin subcategoria', 'Utilería'], Campo: ['Comidas'] }, areaExpenseSubcategoryBudgets: { 'Arte||': { area: 'Arte', budget: 300, budgetAssigned: true } } });
      await root.collection('areaExpenses').doc('paid').update({ subcategory: '' });
      await root.collection('areaExpenses').doc('unpaid').update({ subcategory: '' });
      await groupRun({ fromSubcategory: '', budget: { ...rename.budget, expected: JSON.stringify([true, 300, '']) } });
      assert.equal((await get('projects/structure/areaExpenses/paid')).subcategory, 'Escénico');
      assert.equal((await get('projects/structure')).areaExpenseSubcategoryBudgets['Arte||Escénico'].budget, 300);
      await seed(); await groupRun({ targetSubcategory: 'VESTUARIO' });
      assert.deepEqual((await get('projects/structure')).areaExpenseSubcategories.Arte, ['VESTUARIO', 'Utilería']);
    });
    await t.test('a missing derived project index is rebuilt without replacing provider metadata', async () => {
      await seed(); await db.doc('providerFinanceProjectIndex/structure').delete(); await run();
      assert.deepEqual((await get('providerFinanceProjectIndex/structure')).managedAreas, ['Campo']);
      assert.equal((await get('providerFinanceProviderIndex/worker')).keep, 'provider-index-original');
    });
    await t.test('moving an assigned group obeys the same detailed/internal-estimate budget limit as the UI', async () => {
      await seed(); await root.update({ 'categoryBudgets.Campo': FieldValue.delete() });
      const { BANI_PROVIDER_ID } = require('./crmBaniPost');
      await root.collection('budgetItems').doc('detail').set({ area: 'Campo', total: 1000 });
      await root.collection('budgetItems').doc('estimate').set({ area: 'Campo', total: 50, providerId: BANI_PROVIDER_ID, economicNature: 'internal_estimate' });
      const before = await capture();
      await assert.rejects(groupRun({ budget: undefined, targetArea: 'Campo', targetSubcategory: 'Vestuario' }), /presupuesto.*supera/);
      assert.deepEqual(await capture(), before); assert.equal((await root.collection('activityLog').get()).size, 0);
    });
    await t.test('editors need both scopes and budget managers retain their existing limits', async () => {
      for (const uid of ['limited', 'excluded', 'reader']) { await seed(); await assert.rejects(run({}, uid), { code: 'permission-denied' }); assert.equal((await root.collection('activityLog').get()).size, 0); }
      await seed(); await run({}, 'both'); assert.equal((await get('projects/structure/areaExpenses/paid')).area, 'Campo');
      await seed(); await groupRun({}, 'lead'); assert.equal((await get('projects/structure/areaExpenses/paid')).subcategory, 'Escénico');
      await seed(); await groupRun({ budget: undefined, targetSubcategory: 'Vestuario', beforeSubcategory: null }, 'both');
      assert.deepEqual((await root.get()).data().areaExpenseSubcategories.Arte, ['Utilería', 'Vestuario']);
      await seed(); await root.collection('collaborators').doc('lead@example.test').update({ excludedSubcategories: ['Arte||Utilería'] });
      await assert.rejects(groupRun({}, 'lead'), { code: 'permission-denied' });
    });
    await t.test('category editors can rename and move complete paid groups while retaining budgets and financial identity', async () => {
      await seed(); const before = await capture();
      await groupRun({ budget: undefined }, 'both');
      assert.equal((await get('projects/structure/areaExpenses/paid')).subcategory, 'Escénico');
      assert.deepEqual((await root.get()).data().areaExpenseSubcategoryBudgets['Arte||Escénico'], { area: 'Arte', subcategory: 'Escénico', budget: 300, budgetAssigned: true, notes: 'Conservar' });
      await unchanged(before);
      await seed(); const original = await capture();
      await groupRun({ budget: undefined, targetArea: 'Campo', targetSubcategory: 'Vestuario', beforeSubcategory: 'Comidas' }, 'both');
      assert.equal((await get('projects/structure/areaExpenses/paid')).area, 'Campo');
      assert.equal((await get('projects/structure/areaExpenses/unpaid')).area, 'Campo');
      assert.equal((await root.get()).data().areaExpenseSubcategoryBudgets['Campo||Vestuario'].budget, 300);
      assert((await get('projects/structure/collaborators/follower@example.test')).excludedSubcategories.includes('Campo||Vestuario'));
      await unchanged(original);
    });
    await t.test('whole-group changes require both parent category grants, edit access and no exclusion of the moved group', async () => {
      for (const scenario of ['destination', 'source', 'reader', 'tab', 'excluded-source', 'excluded-target', 'explicit-only']) {
        await seed();
        const ref = root.collection('collaborators').doc('both@example.test');
        if (scenario === 'destination') await ref.update({ allowedCategories: ['Arte'] });
        if (scenario === 'source') await ref.update({ allowedCategories: ['Campo'] });
        if (scenario === 'reader') await ref.update({ canEditBudgetAreas: false });
        if (scenario === 'tab') await ref.update({ allowedTabs: ['resumen'] });
        if (scenario === 'excluded-source') await ref.update({ excludedSubcategories: ['Arte||Vestuario'] });
        if (scenario === 'excluded-target') await ref.update({ excludedSubcategories: ['Campo||Vestuario'] });
        if (scenario === 'explicit-only') await ref.update({ allowedCategories: [], allowedSubcategories: ['Arte||Vestuario', 'Campo||Vestuario'] });
        const before = await capture();
        await assert.rejects(groupRun({ budget: undefined, targetArea: 'Campo', targetSubcategory: 'Vestuario' }, 'both'), { code: 'permission-denied' }, scenario);
        assert.deepEqual(await capture(), before); assert.equal((await root.collection('activityLog').get()).size, 0);
      }
      await seed(); await root.collection('collaborators').doc('both@example.test').update({ excludedSubcategories: ['Arte||Utilería'] });
      await groupRun({ budget: undefined }, 'both');
      assert.equal((await get('projects/structure/areaExpenses/utility')).subcategory, 'Utilería');
    });
    await t.test('organizing categories does not grant budget editing rights', async () => {
      await seed(); const before = await capture();
      await assert.rejects(groupRun({}, 'both'), { code: 'permission-denied' });
      assert.deepEqual(await capture(), before); assert.equal((await root.collection('activityLog').get()).size, 0);
      await groupRun({ budget: undefined }, 'both');
      assert.equal((await root.get()).data().areaExpenseSubcategoryBudgets['Arte||Escénico'].budget, 300);
    });
    await t.test('stale structure, changed source, duplicate names, invalid budget and foreign links fail atomically', async () => {
      const cases = [() => run({ expectedRevision: 1 }), () => run({ fromSubcategory: 'Ya no existe' }), () => run({ targetArea: 'Inactiva' }),
        () => groupRun({ targetSubcategory: 'Utilería' }), () => groupRun({ budget: { ...rename.budget, amount: 6000 } }),
        () => groupRun({ budget: { ...rename.budget, expected: JSON.stringify([true, 100, '']) } })];
      for (const attempt of cases) { await seed(); const before = await capture(); await assert.rejects(attempt()); assert.deepEqual(await capture(), before); assert.equal((await root.collection('activityLog').get()).size, 0); }
      await seed(); await db.doc('providerFinancialRecords/foreign').set({ status: 'active', providerId: 'worker', allocations: [foreignAllocation] });
      await root.collection('areaExpenses').doc('paid').update({ sharedInvoices: [{ id: 'foreign' }] }); const before = await capture();
      await assert.rejects(run(), /comprobante vinculado no corresponde/); assert.deepEqual(await capture(), before);
      await seed(); await assert.rejects(handler({ auth: { ...auth('operator'), token: { email: 'operator@example.test', email_verified: false } }, data: base }), { code: 'permission-denied' });
    });
    await t.test('classification concurrent with payment append preserves that payment rather than reporting a false EXPENSE_CHANGED', async () => {
      await seed(); const ref = root.collection('areaExpenses').doc('paid');
      await Promise.all([run(), db.runTransaction(async tx => { const snapshot = await tx.get(ref); tx.update(ref, { paymentHistory: [...snapshot.data().paymentHistory, { id: 'concurrent', amount: 1, createdBy: 'someone' }], updatedAt: FieldValue.serverTimestamp() }); })]);
      const data = (await ref.get()).data(); assert.equal(data.area, 'Campo'); assert.equal(data.paymentHistory.filter(p => p.id === 'concurrent').length, 1); assert.equal(data.total, 100);
    });
    await t.test('different concurrent moves cannot silently overwrite one another', async () => {
      await seed(); const results = await Promise.allSettled([run(), run({ operationId: '22345678-1234-1234-1234-123456789012', targetArea: 'Post', targetSubcategory: 'Edición' })]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal((await root.collection('activityLog').get()).size, 1);
    });
  } finally { await deleteApp(app); }
});
