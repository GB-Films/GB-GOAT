import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const { createProviderFinanceHandler } = require('../functions/providerFinance');
const { createProviderPortalAdminHandler } = require('../functions/providerPortalAdmin');
const { createProviderPortalHandler } = require('../functions/providerPortal');
const projectId = 'demo-goat-scope-rules';
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/);
assert.match(process.env.FIREBASE_STORAGE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/);
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  storage: { rules: readFileSync('storage.rules', 'utf8') },
});
const app = admin.initializeApp({ projectId, storageBucket: projectId + '.appspot.com' });
const db = app.firestore();
const timestamp = admin.firestore.FieldValue.serverTimestamp;
const adminEmail = 'tomas@granberta.com', producerEmail = 'producer@example.test';
const claims = email => ({ email, email_verified: true, firebase: { sign_in_provider: 'google.com' } });
const owner = env.authenticatedContext('owner', claims(adminEmail)), producer = env.authenticatedContext('producer', claims(producerEmail));
const outsider = env.authenticatedContext('outsider', claims('outsider@example.test'));
const auth = { uid: 'producer', token: claims(producerEmail) };
const projectRef = db.doc('projects/p');
const acl = projectRef.collection('collaborators').doc(producerEmail);
const row = (area, subcategory, providerId) => ({
  area, subcategory, providerId, providerName: providerId, description: providerId, order: 1, unitPrice: 100, quantity: 1,
  total: 100, paymentHistory: [], paymentLocked: false, paymentAuthorIds: [], createdBy: 'owner', createdByEmail: adminEmail,
});
const filePath = 'projects/p/areaExpenses/hidden/comprobantes/native.pdf';
const finance = createProviderFinanceHandler({ db, timestamp, readFile: async () => 'JVBERg==',
  readMetadata: async () => ({ projectId: 'p', family: 'seguros', uploadedBy: producerEmail }) });
const call = (action, input = {}) => finance({ auth, data: { action, projectId: 'p', ...input } });
const signing = createProviderPortalAdminHandler({ db, timestamp, sign: {
  projectDocuments: async () => ({ connected: true, url: 'https://example.test/private', documents: [
    { id: 'signed-visible', source: 'sign_project', sourceDocumentId: 'doc-visible', title: 'Autorizado', signatures: [{ email: 'private@example.test' }] },
    { id: 'signed-hidden', source: 'sign_project', sourceDocumentId: 'doc-hidden', title: 'FUERA DE ALCANCE' },
    { id: 'unbound', source: 'sign_project', title: 'Sin categoría' },
  ] }),
  projectFile: async () => ({ base64: 'JVBERg==' }),
} });
const portal = createProviderPortalHandler({ db, timestamp, sign: {} });
try {
  await Promise.all([
    db.doc('users/owner').set({ role: 'admin', email: adminEmail }),
    db.doc('users/producer').set({ role: 'jefe_produccion', email: producerEmail }),
    db.doc('users/outsider').set({ role: 'colaborador', email: 'outsider@example.test' }),
    db.doc('users/candidate').set({ role: 'colaborador', email: 'candidate@example.test', displayName: 'Cuenta ficticia' }),
    projectRef.set({ name: 'Prueba', createdBy: 'owner', collaboratorEmails: [producerEmail], categories: ['Arte', 'Post'],
      activeAreas: ['Arte'], categoryBudgets: { Arte: 500, Post: 991199 }, budgetTotal: 911123,
      budgetRevision: 1, areaExpenseSubcategories: { Arte: ['Utilería', 'Vestuario'], Post: ['Render'] } }),
    acl.set({ role: 'jefe_produccion', allowedTabs: ['areas', 'documentos', 'cajas', 'proveedores'], allowedCategories: ['Arte'], excludedSubcategories: ['Arte||Vestuario'], canEditBudgetAreas: true }),
    projectRef.collection('areaExpenses').doc('visible').set(row('Arte', 'Utilería', 'supplier')),
    projectRef.collection('areaExpenses').doc('hidden').set(row('Arte', 'Vestuario', 'elsewhere')),
    projectRef.collection('areaExpenses').doc('bare').set(row('', '', 'unbound-provider')),
    projectRef.collection('budgetItems').doc('hidden-budget').set(row('Post', '', 'outside-budget')),
    projectRef.collection('projectDocuments').doc('doc-visible').set({ area: 'Arte', subcategory: 'Utilería', title: 'Visible' }),
    projectRef.collection('projectDocuments').doc('doc-hidden').set({ area: 'Arte', subcategory: 'Vestuario', title: 'Fuera de alcance' }),
    projectRef.collection('cashMovements').doc('owned-visible').set({ type: 'pago', cashAccount: 'personal', fromUserEmail: producerEmail, collectionName: 'areaExpenses', itemId: 'visible', amount: 15, description: 'Visible' }),
    projectRef.collection('cashMovements').doc('owned-hidden').set({ type: 'pago', cashAccount: 'personal', fromUserEmail: producerEmail, collectionName: 'areaExpenses', itemId: 'hidden', amount: 30, description: 'Fuera de alcance', notes: 'Privadas' }),
    projectRef.collection('cashMovements').doc('general-hidden').set({ type: 'pago', cashAccount: 'general', fromUserEmail: producerEmail, collectionName: 'areaExpenses', itemId: 'hidden', amount: 3000 }),
    db.doc('providers/supplier').set({ name: 'Prestador autorizado' }), db.doc('providers/elsewhere').set({ name: 'Prestador privado' }),
    db.doc('providerInvites/invite').set({ status: 'pending', used: false, projectId: 'p', expenseId: 'hidden', collectionName: 'areaExpenses' }),
  ]);
  const bucket = `gs://${projectId}.appspot.com`;
  await env.withSecurityRulesDisabled(ctx => uploadBytes(ref(ctx.storage(bucket), filePath), new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf' }));
  const dbProducer = producer.firestore();
  for (const location of ['projects/p', 'projects/p/areaExpenses/hidden', 'projects/p/areaExpenses/bare', 'projects/p/projectDocuments/doc-visible', 'providers/elsewhere']) {
    await assertFails(getDoc(doc(dbProducer, location)));
  }
  for (const location of ['projects', 'projects/p/areaExpenses', 'projects/p/budgetItems', 'projects/p/collaborators', 'projects/p/cashMovements', 'providers']) {
    await assertFails(getDocs(collection(dbProducer, location)));
  }
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'projects/p/areaExpenses/hidden')));
  assert.deepEqual(await portal({ data: { action: 'linkedInviteTargetStatus', inviteToken: 'invite' } }), { issue: 'TARGET_EXPENSE_ALREADY_ASSIGNED' });
  await assertSucceeds(getDoc(doc(owner.firestore(), 'projects/p/areaExpenses/hidden')));
  await assertSucceeds(getBytes(ref(owner.storage(bucket), filePath)));
  await assertFails(getBytes(ref(producer.storage(bucket), filePath)));
  await assertFails(getBytes(ref(outsider.storage(bucket), filePath)));
  await assertSucceeds(runTransaction(dbProducer, async transaction => {
    const reference = doc(dbProducer, 'projects/p/areaExpenses/visible');
    const item = (await transaction.get(reference)).data();
    assert.equal(item.total, 100);
    transaction.update(reference, { description: 'Editado', updatedAt: serverTimestamp() });
  }));
  await assertFails(updateDoc(doc(dbProducer, 'projects/p/areaExpenses/hidden'), { description: 'Sin permiso' }));
  const overview = await call('projectScopedSnapshot');
  assert.deepEqual(overview.areaExpenses.map(expense => expense.id), ['visible']);
  assert.deepEqual(overview.documents.map(document => document.id), ['doc-visible']);
  assert.deepEqual(overview.project.areaExpenseSubcategories, { Arte: ['Utilería'] });
  assert.deepEqual(overview.project.categoryBudgets, {});
  assert.equal(overview.project.budgetTotal, undefined);
  assert.deepEqual(overview.providers.map(provider => provider.id), ['supplier']);
  assert.deepEqual((await call('scopedProviderCatalog')).providers.map(provider => provider.id), ['supplier']);
  const { movements } = await call('personalCashMovements');
  assert.equal(movements.length, 2);
  const ownHidden = movements.find(movement => movement.id === 'owned-hidden');
  assert.equal(ownHidden.itemId, undefined);
  assert.equal(ownHidden.notes, undefined);
  assert.equal(ownHidden.amount, 30);
  const callSign = (action, input = {}) => signing({ auth, data: { action, projectId: 'p', ...input } });
  const { documents, url } = await callSign('projectDocuments');
  assert.equal(url, undefined);
  assert.deepEqual(documents.map(document => document.id), ['signed-visible']);
  assert.equal(documents[0].signatures, undefined);
  assert.equal((await callSign('projectFile', { documentId: 'signed-visible', artifact: 'original' })).base64, 'JVBERg==');
  await assert.rejects(callSign('projectFile', { documentId: 'signed-hidden', artifact: 'original' }), { code: 'permission-denied' });
  await assert.rejects(call('projectTeamCandidate', { email: 'candidate@example.test' }), { code: 'permission-denied' });
  await acl.update({ allowedTabs: ['areas', 'documentos', 'permisos'] });
  assert.equal((await call('projectTeamCandidate', { email: 'candidate@example.test' })).candidate.uid, 'candidate');
  await assert.rejects(call('projectAssignCollaborator', { email: 'candidate@example.test', uid: 'candidate', role: 'jefe_area', categories: ['Post'] }), { code: 'permission-denied' });
  const assigned = await call('projectAssignCollaborator', { email: 'candidate@example.test', uid: 'candidate', role: 'jefe_area', categories: ['Arte'] });
  assert.deepEqual(assigned.collaborator.excludedSubcategories, ['Arte||Vestuario']);
  const newDoc = { family: 'seguros', area: 'Arte', subcategory: 'Utilería', fileName: 'ficticio.pdf', path: 'projects/p/documents/new-doc/ficticio.pdf' };
  await assert.rejects(call('projectCreateDocument', { itemId: 'new-doc', document: { ...newDoc, subcategory: 'Vestuario' } }), { code: 'permission-denied' });
  assert.deepEqual(await call('projectCreateDocument', { itemId: 'new-doc', document: newDoc }), { id: 'new-doc' });
  const groupRow = projectRef.collection('areaExpenses').doc('delete-group');
  await groupRow.set({ ...row('Arte', 'Temporal', 'supplier'), paid: true });
  const removeGroup = () => call('reclassifyAreaExpenses', { kind: 'deleteSubcategory', operationId: randomUUID(), expectedRevision: 1,
    fromArea: 'Arte', targetArea: 'Arte', fromSubcategory: 'Temporal', targetSubcategory: '' });
  await assert.rejects(removeGroup(), { code: 'permission-denied' });
  await acl.update({ excludedSubcategories: [] });
  await assert.rejects(removeGroup(), /pagos registrados/);
  await groupRow.update({ paid: false });
  assert.equal((await removeGroup()).view.expenses[0].after.subcategory, '');
  assert.equal((await groupRow.get()).data().subcategory, '');
  await acl.update({ allowedTabs: ['documentos'], excludedSubcategories: ['Arte||Vestuario'] });
  await assertFails(getDoc(doc(dbProducer, 'projects/p/areaExpenses/visible')));
  const documentOnly = await call('projectScopedSnapshot');
  assert.deepEqual(documentOnly.areaExpenses, []);
  assert.deepEqual(documentOnly.documents.map(document => document.id), ['doc-visible', 'new-doc']);
  assert.deepEqual((await call('personalCashMovements')).movements, []);
  await acl.update({ allowedTabs: [] });
  assert.deepEqual((await call('projectScopedSnapshot')).documents, []);
  await assert.rejects(callSign('projectDocuments'), { code: 'permission-denied' });
  console.log('PASS project scope: rules, tabs, inherited and excluded categories, projected totals and files, personal cash, supplier intake and live revocation.');
} finally {
  await env.cleanup();
  await app.delete();
}
