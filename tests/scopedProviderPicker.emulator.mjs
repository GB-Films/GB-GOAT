import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteField, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const { createProviderFinanceHandler } = require('../functions/providerFinance');
const projectId = 'demo-goat-scoped-provider-picker';
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/);
const env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
const app = admin.initializeApp({ projectId });
const db = app.firestore();
const finance = createProviderFinanceHandler({ db, timestamp: admin.firestore.FieldValue.serverTimestamp });
const claims = uid => ({ email: `${uid}@example.test`, email_verified: true });
const call = (action, input, uid = 'producer') => finance({ auth: { uid, token: claims(uid) }, data: { action, projectId: 'film', ...input } });
const lookup = (itemId, query = 'alvarez andrea', extras = {}, uid) => call('searchScopedExpenseProviders', { itemId, query, expectedUpdatedAt: null, ...extras }, uid);
const assign = (itemId, extras = {}, uid) => call('assignScopedExpenseProvider', { itemId, providerId: 'new-supplier', expectedUpdatedAt: null, ...extras }, uid);
const row = extra => ({ area: 'Arte', subcategory: 'Utilería', description: 'Diseño', providerId: '', providerName: '', total: 50,
  paymentHistory: [], paymentAuthorIds: [], paymentLocked: false, paid: false, createdBy: 'owner', createdByEmail: claims('owner').email, ...extra });
const source = item => db.doc(`projects/film/areaExpenses/${item}`);
const grant = { role: 'jefe_produccion', allowedTabs: ['areas', 'proveedores'], allowedCategories: ['Arte'],
  canEditBudgetAreas: true, excludedSubcategories: ['Arte||Vestuario'] };
const supplier = { type: 'persona', name: 'Andrea', lastName: 'Álvarez', bankAccount_cbu: '1111111111111111111111',
  bankAccount_alias: 'cuenta.privada', bankAccount_holder: 'Nombre privado', dni: '12345678', cuit: '20123456789',
  email: 'privado@example.test', phone: '123456789', registeredExtra: 'secreto' };

try {
  const receipt = { id: 'native', path: 'projects/film/areaExpenses/editable/comprobantes/native.pdf', fileName: 'native.pdf' };
  await Promise.all([
    ...['producer', 'owner', 'observer', 'no-write', 'outsider', 'area-lead', 'project-admin'].map(uid =>
      db.doc(`users/${uid}`).set({ role: uid === 'owner' ? 'admin' : 'colaborador', email: claims(uid).email })),
    db.doc('projects/film').set({ createdBy: 'owner', collaboratorEmails: [claims('producer').email],
      categories: ['Arte', 'Post'], activeAreas: ['Arte'], budgetRevision: 0 }),
    db.doc('projects/other').set({ createdBy: 'owner', categories: ['Arte'], activeAreas: ['Arte'] }),
    ...Object.entries({ producer: grant, observer: { ...grant, allowedTabs: ['proveedores'] }, 'no-write': { ...grant, canEditBudgetAreas: false },
      'area-lead': { ...grant, role: 'jefe_area' }, 'project-admin': { ...grant, role: 'admin' } }).map(([uid, access]) =>
      db.doc(`projects/film/collaborators/${claims(uid).email}`).set(access)),
    db.doc('projects/other/areaExpenses/editable').set(row({ providerId: 'new-supplier', invoices: [receipt] })),
    db.doc('projects/film/budgetItems/budget-only').set(row({ area: 'Post' })),
    db.doc('providers/new-supplier').set(supplier),
    db.doc('providers/established').set({ ...supplier, name: 'Alicia', lastName: 'Sol', email: 'previo@example.test' }),
    db.doc('providers/corp').set({ ...supplier, type: 'empresa', businessName: 'Música del Sur' }),
    ...Array.from({ length: 22 }, (_, index) => db.doc(`providers/common-${index}`).set({ type: 'empresa', businessName: `Proveedor común ${index}` })),
    source('editable').set(row({ otherReceipts: [receipt] })),
    source('prior').set(row({ providerId: 'established', providerName: 'Alicia Sol' })),
    source('legacy-call').set(row()),
    source('racing').set(row()),
    source('rule-write').set(row()),
    source('excluded').set(row({ subcategory: 'Vestuario', providerId: 'new-supplier' })),
    source('inactive').set(row({ area: 'Post' })),
    source('paid').set(row({ paymentHistory: [{ amount: 20 }], paymentLocked: true })),
    source('legacy-paid').set(row({ paid: true })),
    source('shared').set(row({ sharedInvoices: [{ id: 'shared' }] })),
    source('authority').set(row({ thirdPartyPayoutRequired: true })),
    source('linked').set(row({ providerInviteLink: { token: 'linked-invite', status: 'pending' } })),
    source('provisional').set(row({ providerId: 'established' })),
    db.doc('providerInvites/linked-invite').set({ projectId: 'film', collectionName: 'areaExpenses', expenseId: 'linked', status: 'pending', used: false }),
    db.doc('providerInvites/provisional-invite').set({ projectId: 'film', collectionName: 'areaExpenses', expenseId: 'provisional', status: 'pending', used: false,
      provisionalProviderId: 'established' }),
  ]);
  assert.deepEqual((await lookup('editable')).providers, [{ id: 'new-supplier', name: 'Andrea Álvarez' }]);
  assert.deepEqual((await lookup('editable', 'musica sur')).providers, [{ id: 'corp', name: 'Música del Sur' }]);
  assert.deepEqual((await lookup('editable', '12345678')).providers, []);
  assert.deepEqual((await lookup('editable', 'privado')).providers, []);
  assert.deepEqual((await lookup('editable', 'Al')).providers, []);
  assert.equal((await lookup('editable', 'proveedor comun')).providers.length, 20);

  for (const itemId of ['excluded', 'inactive', 'no-row', 'budget-only']) {
    await assert.rejects(lookup(itemId), { code: 'permission-denied' });
    await assert.rejects(assign(itemId), { code: 'permission-denied' });
  }
  for (const uid of ['observer', 'no-write', 'outsider', 'area-lead', 'project-admin', 'owner']) {
    await assert.rejects(lookup('editable', 'alvarez', {}, uid), { code: 'permission-denied' });
    await assert.rejects(assign('editable', {}, uid), { code: 'permission-denied' });
  }
  await assert.rejects(lookup('editable', 'alvarez', { projectId: 'other' }), { code: 'permission-denied' });
  await assert.rejects(assign('editable', { projectId: 'other' }), { code: 'permission-denied' });
  for (const action of ['searchScopedExpenseProviders', 'assignScopedExpenseProvider']) {
    const data = { action, projectId: 'film', itemId: 'editable', expectedUpdatedAt: null, query: 'alvarez', providerId: 'new-supplier' };
    await assert.rejects(finance({ data }), { code: 'unauthenticated' });
    await assert.rejects(finance({ auth: { uid: 'producer', token: { ...claims('producer'), email_verified: false } }, data }), { code: 'permission-denied' });
  }
  for (const itemId of ['paid', 'legacy-paid', 'shared', 'authority', 'linked', 'provisional']) {
    await assert.rejects(lookup(itemId), { code: 'failed-precondition' });
    await assert.rejects(assign(itemId), { code: 'failed-precondition' });
  }
  await assert.rejects(call('editScopedAreaExpense', { itemId: 'linked', expectedUpdatedAt: null, updates: {
    providerId: 'new-supplier', providerName: 'Andrea Álvarez', providerInviteLink: null,
  } }), /enlace de alta/);
  assert.equal((await db.doc('providerInvites/linked-invite').get()).data().status, 'pending');
  assert.equal((await db.doc('providerInvites/provisional-invite').get()).data().status, 'pending');
  await assert.rejects(assign('editable', { providerId: 'not-found' }), /ya no está disponible/);

  const { expense, provider } = await assign('editable', { providerName: 'Nombre falsificado', area: 'Post' });
  assert.deepEqual(provider, { id: 'new-supplier', name: 'Andrea Álvarez' });
  assert.equal(expense.providerName, provider.name);
  const saved = (await source('editable').get()).data();
  assert.equal(saved.providerIdentityOnly, true);
  assert.equal(saved.area, 'Arte');
  assert.equal(saved.total, 50);
  assert.deepEqual(saved.otherReceipts, [receipt]);
  assert.deepEqual(saved.paymentHistory, []);
  await assert.rejects(assign('editable'), /gasto cambió/);
  await assert.rejects(lookup('editable'), /gasto cambió/);
  const concurrent = await Promise.allSettled([assign('racing'), assign('racing', { providerId: 'corp' })]);
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(concurrent.find(result => result.status === 'rejected').reason.code, 'failed-precondition');

  const producer = env.authenticatedContext('producer', claims('producer')).firestore();
  const projectAdmin = env.authenticatedContext('project-admin', claims('project-admin')).firestore();
  const owner = env.authenticatedContext('owner', claims('owner')).firestore();
  const rowPath = itemId => `projects/film/areaExpenses/${itemId}`;
  await assertFails(getDoc(doc(producer, 'providers/new-supplier')));
  await assertFails(getDocs(collection(producer, 'providers')));
  await assertSucceeds(getDoc(doc(owner, 'providers/new-supplier')));
  await assertFails(updateDoc(doc(producer, rowPath('rule-write')), { providerId: 'new-supplier' }));
  await assertFails(updateDoc(doc(producer, rowPath('rule-write')), { providerId: 'new-supplier', providerIdentityOnly: true }));
  await assertFails(updateDoc(doc(producer, rowPath('editable')), { providerIdentityOnly: deleteField() }));
  await assertFails(updateDoc(doc(projectAdmin, rowPath('editable')), { providerIdentityOnly: false }));
  const creation = row({ providerId: 'new-supplier', createdBy: 'producer', createdByEmail: claims('producer').email });
  await assertFails(setDoc(doc(producer, rowPath('new')), creation));
  await assertSucceeds(setDoc(doc(producer, rowPath('new')), { ...creation, providerIdentityOnly: true }));
  await assertFails(updateDoc(doc(projectAdmin, 'projects/film/budgetItems/budget-only'), { providerId: 'new-supplier' }));
  await assertSucceeds(updateDoc(doc(projectAdmin, 'projects/film/budgetItems/budget-only'), { providerId: 'new-supplier', providerIdentityOnly: true }));
  await call('editScopedAreaExpense', { itemId: 'legacy-call', expectedUpdatedAt: null, updates: { providerId: 'new-supplier', providerName: 'Andrea Álvarez' } });
  assert.equal((await source('legacy-call').get()).data().providerIdentityOnly, true);

  for (const { providers } of [await call('projectScopedSnapshot'), await call('scopedProviderCatalog')]) {
    const restricted = providers.find(item => item.id === 'new-supplier');
    assert.deepEqual(restricted, { id: 'new-supplier', type: 'persona', name: 'Andrea', lastName: 'Álvarez' });
    assert.equal(providers.find(item => item.id === 'established').email, 'previo@example.test');
  }
  assert.equal((await call('projectScopedSnapshot', {}, 'owner')).providers.find(item => item.id === 'new-supplier').bankAccount_cbu, supplier.bankAccount_cbu);
  await assert.rejects(call('projectScopedAttachment', { projectId: 'other', collectionName: 'areaExpenses',
    itemId: 'editable', kind: 'invoices', fileId: 'native' }), { code: 'permission-denied' });
  console.log('PASS scoped provider picker, restrictions, concurrency and post-assignment privacy');
} finally {
  await env.cleanup();
  await app.delete();
}
