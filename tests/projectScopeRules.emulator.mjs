import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore';
import { getBytes, getMetadata, ref, uploadBytes } from 'firebase/storage';

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
const bucket = `gs://${projectId}.appspot.com`;
const sharedInvoice = { id: 'shared-invoice', amountCents: 10000, issuerCuit: '20999999999', payeeAccount: 'private-account' };
const sharedPayment = { id: 'shared-payment', sharedRecordId: 'shared-paid', amount: 10, detail: 'private-beneficiary', receipt: { url: 'https://example.test/secret' } };
const writableRef = projectRef.collection('areaExpenses').doc('visible');
const inspectUpload = async path => {
  const value = await getMetadata(ref(owner.storage(bucket), path));
  return { ...value, metadata: value.customMetadata };
};
const finance = createProviderFinanceHandler({ db, timestamp, readFile: async file =>
  file.projectAttachment ? { base64: 'JVBERg==', contentType: 'application/pdf', fileName: file.path.split('/').pop() } : 'JVBERg==',
  readMetadata: async path => path.includes('/documents/') ? { projectId: 'p', family: 'seguros', uploadedBy: producerEmail }
    : (await inspectUpload(path)).metadata, inspectUpload });
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
    writableRef.set({ ...row('Arte', 'Utilería', 'supplier'), sharedInvoices: [sharedInvoice] }),
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
  await env.withSecurityRulesDisabled(ctx => uploadBytes(ref(ctx.storage(bucket), filePath), new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf' }));
  const dbProducer = producer.firestore();
  for (const location of ['projects/p', 'projects/p/areaExpenses/visible', 'projects/p/areaExpenses/hidden', 'projects/p/areaExpenses/bare', 'projects/p/projectDocuments/doc-visible', 'providers/elsewhere']) {
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
  const readHistorical = (path, projectId = 'p') => finance({
    auth: { uid: 'owner', token: claims(adminEmail) },
    data: { action: 'projectAdminAttachment', projectId, path },
  });
  assert.equal((await readHistorical(filePath)).base64, 'JVBERg==');
  await assert.rejects(call('projectAdminAttachment', { path: filePath }), { code: 'permission-denied' });
  await assert.rejects(readHistorical('providerFinance/supplier/record/native.pdf'), { code: 'permission-denied' });
  await assert.rejects(readHistorical('projects/other/areaExpenses/work/comprobantes/native.pdf'), { code: 'permission-denied' });
  const edit = (itemId, updates, expectedUpdatedAt = null) => call('editScopedAreaExpense', { itemId, updates, expectedUpdatedAt });
  await assert.rejects(edit('hidden', { description: 'Fuera de alcance' }), { code: 'permission-denied' });
  await assert.rejects(edit('visible', { unitPrice: 150 }), /compartidos/);
  const edited = (await edit('visible', { description: 'Editado' })).expense;
  assert.equal(edited.description, 'Editado');
  assert.deepEqual(edited.sharedInvoices, [{ id: 'shared-invoice', amountCents: 10000 }]);
  await assert.rejects(edit('visible', { description: 'Versión anterior' }), /El gasto cambió/);
  const fileId = 'invoice-added', invoicePath = 'projects/p/areas/arte/facturas/new.pdf';
  const details = { projectId: 'p', collectionName: 'areaExpenses', expenseId: 'visible', area: 'Arte', areaFolder: 'arte', uploadAccessScope: 'area_editor' };
  await assertFails(uploadBytes(ref(producer.storage(bucket), invoicePath), new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf', customMetadata: { ...details, uploaderUid: 'outsider' } }));
  await assertSucceeds(uploadBytes(ref(producer.storage(bucket), invoicePath), new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf', customMetadata: { ...details, uploaderUid: 'producer' } }));
  const attach = () => call('attachScopedAreaExpenseFile', { itemId: 'visible', kind: 'invoice', path: invoicePath, fileId });
  assert.match((await attach()).expense.invoices[0].url, /^goat-file:/);
  assert.equal((await attach()).expense.invoices.length, 1);
  assert.equal((await attach()).expense.invoices[0].path, undefined);
  assert.equal((await call('projectScopedAttachment', { itemId: 'visible', collectionName: 'areaExpenses', kind: 'invoices', fileId })).base64, 'JVBERg==');
  const legacyShared = { ...sharedPayment, createdBy: 'owner', createdByEmail: adminEmail };
  await writableRef.update({ paymentHistory: [legacyShared], sharedPaymentRecords: [legacyShared], sharedPaymentIds: ['shared-paid'], paymentLocked: true, paymentAuthorIds: ['owner'] });
  const payment = { itemId: 'visible', paymentId: 'new-payment', amount: 15, date: '2026-10-25T15:00:00.000Z', detail: 'Pago del colaborador', method: 'otro',
    expected: { ...row('Arte', 'Utilería', 'supplier'), description: 'Editado', id: 'visible' } };
  const register = args => call('registerScopedAreaExpensePayment', { ...payment, ...args });
  const next = (await register()).expense;
  assert.equal(next.paymentHistory[0].detail, undefined);
  assert.equal(next.paymentHistory[0].receipt, undefined);
  assert.equal(next.sharedPaymentRecords, undefined);
  assert.equal(next.paymentHistory[1].createdBy, 'producer');
  assert.equal((await register()).expense.paymentHistory.length, 2);
  await assert.rejects(register({ amount: 16 }), /identificador/);
  await assert.rejects(register({ paymentId: 'overpayment', amount: 76 }), /PAYMENT_EXCEEDS_TOTAL/);
  await assert.rejects(register({ paymentId: 'general', method: 'caja_efectivo', cashAccount: 'general' }), { code: 'permission-denied' });
  assert.deepEqual((await writableRef.get()).data().sharedPaymentRecords, [legacyShared]);
  assert.deepEqual((await getDoc(doc(owner.firestore(), 'projects/p/areaExpenses/visible'))).data().sharedInvoices, [sharedInvoice]);
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
  await assert.rejects(register({ paymentId: 'cash-payment', method: 'caja_efectivo', cashAccount: 'personal' }), /saldo disponible/);
  await projectRef.collection('cashMovements').doc('cash-received').set({ type: 'entrega', cashAccount: 'general', toUserEmail: producerEmail, status: 'confirmed', amount: 90 });
  const receiptPath = 'projects/p/areaExpenses/visible/comprobantes/payment.pdf';
  await assertSucceeds(uploadBytes(ref(producer.storage(bucket), receiptPath), new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf', customMetadata: {
    projectId: 'p', collectionName: 'areaExpenses', itemId: 'visible', paymentId: 'cash-payment', uploadAccessScope: 'area_editor', uploaderUid: 'producer',
  } }));
  const cashArgs = { paymentId: 'cash-payment', method: 'caja_efectivo', cashAccount: 'personal', path: receiptPath };
  const cashRegistered = await register(cashArgs);
  assert.equal(cashRegistered.expense.paymentHistory[2].cashMovementId, 'payment-cash-payment');
  assert.equal(cashRegistered.expense.paymentHistory[2].receipt.path, undefined);
  assert.equal((await register(cashArgs)).expense.paymentHistory.length, 3);
  assert.equal((await projectRef.collection('cashMovements').doc('payment-cash-payment').get()).data().fromUserEmail, producerEmail);
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
  await assert.rejects(edit('visible', { description: 'Sin permiso' }), { code: 'permission-denied' });
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
