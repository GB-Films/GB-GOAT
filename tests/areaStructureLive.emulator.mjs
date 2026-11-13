import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { applyAreaLocations, liveAreaProjectPatch, reconcileAreaExpenseSnapshot } from '../src/lib/areaStructureLive.ts';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { createProviderFinanceHandler } = require('./providerFinance.js');
const projectId = process.env.GCLOUD_PROJECT;
if (!projectId?.startsWith('demo-') || !process.env.FIRESTORE_EMULATOR_HOST) throw Error('Synthetic Firestore emulator required');
const env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const app = initializeApp({ projectId }, 'area-live-observers'), db = getFirestore(app), root = db.doc('projects/live');
const handler = createProviderFinanceHandler({ db, timestamp: () => FieldValue.serverTimestamp(), verifyFile: () => assert.fail('no files are replaced') });
const stops = [], observers = [];
const waiters = new Set();
let failure;
const changed = () => { for (const check of waiters) check(); };
const failed = error => { failure = error; changed(); };
const waitFor = predicate => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => finish(Error('Live update did not arrive')), 12000);
  const finish = error => { clearTimeout(timeout); waiters.delete(check); error ? reject(error) : resolve(); };
  const check = () => { if (failure) finish(failure); else if (predicate()) finish(); };
  waiters.add(check); check();
});
let operation = 0;
const run = (revision, fromArea, fromSubcategory, targetArea, targetSubcategory, beforeExpenseId) => handler({
  auth: { uid: 'editor', token: { email: 'editor@example.test', email_verified: true } },
  data: { action: 'reclassifyAreaExpenses', projectId: 'live', operationId: `${String(++operation).padStart(8, '0')}-1234-1234-1234-123456789012`,
    kind: 'expense', itemId: 'paid', expectedRevision: revision, fromArea, fromSubcategory, targetArea, targetSubcategory,
    ...(beforeExpenseId ? { beforeExpenseId } : {}) },
});
try {
  await root.set({ createdBy: 'admin', collaboratorEmails: ['editor@example.test', 'reader@example.test'], budgetRevision: 0,
    categories: ['Arte', 'Campo'], activeAreas: ['Arte', 'Campo'], areaExpenseSubcategories: { Arte: ['Vestuario', 'Utilería'], Campo: ['Comidas'] } });
  for (const uid of ['admin', 'editor', 'reader']) {
    await db.doc(`users/${uid}`).set({ email: `${uid}@example.test`, role: uid === 'admin' ? 'admin' : 'colaborador' });
    if (uid !== 'admin') await root.collection('collaborators').doc(`${uid}@example.test`).set({ email: `${uid}@example.test`,
      role: 'jefe_area', allowedTabs: ['areas'], allowedCategories: ['Arte', 'Campo'], canEditBudgetAreas: uid === 'editor' });
  }
  await root.collection('areaExpenses').doc('paid').set({ area: 'Arte', subcategory: 'Vestuario', order: 0, total: 100,
    paid: true, paymentLocked: true, paymentHistory: [{ id: 'original', amount: 100, createdBy: 'admin' }], invoice: { path: 'synthetic.pdf' } });
  await root.collection('areaExpenses').doc('other').set({ area: 'Arte', subcategory: 'Vestuario', order: 1, total: 20 });
  // A second browser belonging to an administrator and one belonging to a scoped collaborator.
  for (const uid of ['admin', 'editor']) {
    const client = env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
    const view = { revision: -1, expenses: [], permissions: [] }; observers.push(view);
    stops.push(onSnapshot(doc(client, 'projects/live'), snapshot => { view.revision = liveAreaProjectPatch(snapshot.data()).budgetRevision; changed(); }, failed));
    stops.push(onSnapshot(collection(client, 'projects/live/areaExpenses'), snapshot => {
      view.expenses = reconcileAreaExpenseSnapshot(view.expenses, snapshot.docs.map(row => ({ ...row.data(), id: row.id }))); changed();
    }, failed));
    stops.push(onSnapshot(collection(client, 'projects/live/collaborators'), snapshot => { view.permissions = snapshot.docs.map(row => ({ ...row.data(), id: row.id })); changed(); }, failed));
  }
  await waitFor(() => observers.every(view => view.revision === 0 && view.expenses.length === 2 && view.permissions.length === 2));
  const destinations = [['Arte', 'Vestuario'], ['Arte', 'Utilería'], ['Campo', 'Comidas']];
  let fromArea = 'Arte', fromGroup = 'Vestuario';
  for (let index = 0; index < destinations.length; index++) {
    const [area, group] = destinations[index];
    const ack = await run(index, fromArea, fromGroup, area, group);
    const actor = observers[1]; actor.expenses = applyAreaLocations(actor.expenses, ack.view.expenses);
    assert.equal(actor.expenses.find(row => row.id === 'paid').area, area, 'the actor can apply the committed response immediately');
    await waitFor(() => observers.every(view => view.revision === index + 1 && view.expenses.find(row => row.id === 'paid')?.area === area
      && view.expenses.find(row => row.id === 'paid')?.subcategory === group && view.expenses.find(row => row.id === 'paid')?.areaStructureRevision === index + 1));
    for (const view of observers) {
      const row = view.expenses.find(row => row.id === 'paid');
      assert.equal(row.paymentHistory[0].id, 'original'); assert.equal(row.invoice.path, 'synthetic.pdf'); assert.equal(row.total, 100);
    }
    fromArea = area; fromGroup = group;
  }
  await root.collection('collaborators').doc('editor@example.test').update({ excludedSubcategories: ['Arte||Vestuario'] });
  await waitFor(() => observers.every(view => view.permissions.find(row => row.id === 'editor@example.test')?.excludedSubcategories?.includes('Arte||Vestuario')));
  await assert.rejects(run(3, 'Campo', 'Comidas', 'Arte', 'Vestuario'), { code: 'permission-denied' });
  assert.equal((await root.get()).data().budgetRevision, 3);
  await root.collection('collaborators').doc('editor@example.test').update({ excludedSubcategories: [], allowedCategories: [], allowedSubcategories: ['Campo||Comidas', 'Arte||Utilería'] });
  await waitFor(() => observers.every(view => view.permissions.find(row => row.id === 'editor@example.test')?.allowedSubcategories?.length === 2));
  await run(3, 'Campo', 'Comidas', 'Arte', 'Utilería');
  await waitFor(() => observers.every(view => view.revision === 4 && view.expenses.find(row => row.id === 'paid')?.area === 'Arte'));
  console.log('Live admin/collaborator observers passed: reorder, same-area move, cross-area move, current permissions and unchanged payment/invoice.');
} finally {
  stops.forEach(stop => stop());
  await env.cleanup(); await deleteApp(app);
}
