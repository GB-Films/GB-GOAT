import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, updateDoc, writeBatch, serverTimestamp, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export async function testExpenseInvoiceControls({ db, env, call }) {
  const projectId = 'invoice-controls', otherProjectId = 'invoice-controls-other';
  const root = db.doc(`projects/${projectId}`);
  await root.set({ activeAreas: ['Post'] });
  await db.doc(`projects/${otherProjectId}`).set({ activeAreas: ['Post'] });
  for (const [uid, role, email] of [['file-admin', 'colaborador', 'file-admin@example.test'], ['file-editor', 'colaborador', 'file-editor@example.test']]) {
    await db.doc(`users/${uid}`).set({ role, email });
    await root.collection('collaborators').doc(email).set({ role: uid === 'file-admin' ? 'admin' : 'jefe_area', canEditBudgetAreas: true, allowedTabs: ['areas'], allowedCategories: ['Post'] });
  }
  const auth = uid => ({ uid, token: { email: `${uid}@example.test`, email_verified: true } });
  const adminDb = env.authenticatedContext('file-admin', auth('file-admin').token).firestore();
  const editorDb = env.authenticatedContext('file-editor', auth('file-editor').token).firestore();
  const anonymous = env.unauthenticatedContext();
  const recordId = 'invoice-controls-record';
  const native = { providerId: 'supplier', kind: 'invoice', status: 'active', issuerCuit: '27333333334', file: { fileName: 'original.pdf', path: 'private-original' },
    allocations: [{ projectId, collectionName: 'areaExpenses', itemId: 'row', amountCents: 10000 }, { projectId: otherProjectId, collectionName: 'areaExpenses', itemId: 'row', amountCents: 10000 }],
    settlements: { paid: [{ projectId, collectionName: 'areaExpenses', itemId: 'row', amountCents: 10000 }] } };
  const reference = { id: recordId, amountCents: 10000, issuerCuit: native.issuerCuit };
  const payment = { id: 'paid', amount: 100, sharedRecordId: 'payment-original', createdBy: 'file-admin', createdByEmail: 'file-admin@example.test' };
  const expense = { providerId: 'supplier', providerName: 'Prestador ficticio', total: 100, unitPrice: 100, quantity: 1, area: 'Post', subcategory: '',
    thirdPartyPayoutRequired: true, sharedInvoices: [reference], sharedPaymentIds: ['payment-original'], sharedPaymentRecords: [payment],
    paymentHistory: [payment], paymentLocked: true, paymentAuthorIds: ['file-admin'], paid: true, invoice: null, invoices: [] };
  const target = root.collection('areaExpenses').doc('row');
  await target.set(expense);
  await db.doc(`projects/${otherProjectId}/areaExpenses/row`).set(expense);
  await db.doc(`providerFinancialRecords/${recordId}`).set(native);
  const attachment = name => ({ id: name, fileName: name + '.pdf', originalFileName: name + '.pdf', url: 'https://example.test/' + name + '.pdf',
    path: `projects/${projectId}/areas/Post/facturas/${name}.pdf`, contentType: 'application/pdf', size: 100, uploadedBy: 'file-editor@example.test' });
  const first = attachment('first'), second = attachment('second');
  const sdkTarget = store => doc(store, target.path);
  await assertSucceeds(updateDoc(sdkTarget(editorDb), { invoice: first, invoices: [first], invoiceStatus: 'pendiente' }));
  await assertSucceeds(updateDoc(sdkTarget(editorDb), { invoices: [first, second], invoiceStatus: 'pendiente' }));
  await assertFails(updateDoc(sdkTarget(editorDb), { invoice: second, invoices: [second] }));
  await assertFails(updateDoc(sdkTarget(editorDb), { sharedInvoices: [{ ...reference, fileHidden: true }] }));
  await assertFails(updateDoc(sdkTarget(adminDb), { sharedInvoices: [] }));
  await assertFails(updateDoc(sdkTarget(adminDb), { thirdPartyPayoutRequired: false }));
  await assertFails(updateDoc(sdkTarget(adminDb), { total: 1, unitPrice: 1 }));
  await assertFails(updateDoc(sdkTarget(adminDb), { paymentHistory: [], paid: false }));
  await assertSucceeds(updateDoc(sdkTarget(adminDb), { invoice: second, invoices: [second] }));
  await assertSucceeds(updateDoc(sdkTarget(adminDb), { invoice: null, invoices: [], invoiceStatus: null }));

  // The public single-use link also works after a previous primary was removed.
  const token = 'invoice-controls-single-use-token';
  await assertSucceeds(setDoc(doc(editorDb, `invoiceUploadInvites/${token}`), { token, projectId, expenseId: 'row', collectionName: 'areaExpenses', area: 'Post', subcategory: '', providerId: 'supplier', status: 'pending', used: false }));
  const publicFile = { ...attachment('public'), uploadedBy: 'provider_public_link' };
  await assertSucceeds(uploadBytes(ref(anonymous.storage(), publicFile.path), new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf', customMetadata: { token, projectId, expenseId: 'row', collectionName: 'areaExpenses', area: 'Post', areaFolder: 'Post', providerId: 'supplier' } }));
  publicFile.url = await getDownloadURL(ref(anonymous.storage(), publicFile.path));
  const publicAppend = (overrides = {}) => {
    const batch = writeBatch(anonymous.firestore());
    batch.update(doc(anonymous.firestore(), target.path), { invoices: [publicFile], invoiceStatus: 'pendiente', publicInvoiceUpload: { token }, updatedAt: serverTimestamp(), ...overrides });
    batch.update(doc(anonymous.firestore(), `invoiceUploadInvites/${token}`), { used: true, status: 'used', usedAt: serverTimestamp(), invoiceFileName: publicFile.fileName, invoicePath: publicFile.path, invoiceUrl: publicFile.url, originalFileName: publicFile.originalFileName });
    return batch.commit();
  };
  await assertFails(publicAppend({ total: 1 }));
  await assertFails(publicAppend({ sharedInvoices: [] }));
  await assertSucceeds(publicAppend());
  await assertFails(publicAppend({ invoices: [publicFile, { ...publicFile, id: 'reused' }] }));

  // Removing the native original affects this row's file controls only, even
  // when that financial invoice already has payments and spans other projects.
  const input = { action: 'removeExpenseInvoiceFile', projectId, collectionName: 'areaExpenses', itemId: 'row', recordId };
  const invoke = (data = input, uid = 'file-admin') => call({ auth: auth(uid), data });
  await assert.rejects(call({ data: input }), { code: 'unauthenticated' });
  await assert.rejects(invoke(input, 'file-editor'), /administrador/);
  await assert.rejects(invoke({ ...input, projectId: otherProjectId }), /acceso/);
  await assert.rejects(invoke({ ...input, recordId: 'foreign' }), /vinculada/);
  await assert.rejects(invoke({ ...input, amount: 1 }), /Elegí/);
  await assert.rejects(call({ auth: { ...auth('file-admin'), token: { ...auth('file-admin').token, email_verified: false } }, data: input }), /Verificá/);
  const recordBefore = (await db.doc(`providerFinancialRecords/${recordId}`).get()).data();
  const otherBefore = (await db.doc(`projects/${otherProjectId}/areaExpenses/row`).get()).data();
  const before = (await target.get()).data();
  const results = await Promise.all([invoke(), invoke()]);
  assert.equal(results.filter(result => result.repeated).length, 1);
  const result = results.find(result => !result.repeated);
  assert.equal(result.sharedInvoices[0].fileHidden, true);
  assert.equal((await invoke()).repeated, true);
  const after = (await target.get()).data();
  const stable = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['sharedInvoices', 'updatedAt'].includes(key)));
  assert.deepEqual(stable(after), stable(before));
  assert.deepEqual(after.sharedInvoices, [{ ...reference, fileHidden: true }]);
  assert.deepEqual((await db.doc(`providerFinancialRecords/${recordId}`).get()).data(), recordBefore);
  assert.deepEqual((await db.doc(`projects/${otherProjectId}/areaExpenses/row`).get()).data(), otherBefore);
  const audits = await root.collection('activityLog').where('action', '==', 'expense_invoice_file_removed').get();
  assert.equal(audits.size, 1);
  assert.deepEqual(audits.docs[0].data().before.sharedInvoices, [reference]);
  assert.equal(audits.docs[0].data().after.sharedInvoices[0].fileHidden, true);
  assert.equal(audits.docs[0].data().createdBy, 'file-admin');
  assert.equal((await root.collection('cashMovements').get()).size, 0);
  // Main-budget file controls retain the same permissions and fiscal guards.
  const budget = root.collection('budgetItems').doc('budget-row');
  await budget.set({ ...expense, area: 'Executive' });
  await assertSucceeds(updateDoc(doc(adminDb, budget.path), { invoice: first, invoices: [first], invoiceStatus: 'pendiente' }));
  await assertSucceeds(updateDoc(doc(adminDb, budget.path), { invoice: null, invoices: [], invoiceStatus: null }));
  await assertFails(updateDoc(doc(editorDb, budget.path), { invoices: [second] }));
  await db.doc('providerFinancialRecords/budget-native').set({ ...native, allocations: [{ projectId, collectionName: 'budgetItems', itemId: 'budget-row', amountCents: 10000 }] });
  await budget.update({ sharedInvoices: [{ ...reference, id: 'budget-native' }] });
  const budgetResult = await invoke({ ...input, collectionName: 'budgetItems', itemId: 'budget-row', recordId: 'budget-native' });
  assert.equal(budgetResult.sharedInvoices[0].fileHidden, true);
  console.log('PASS: third-party file controls support append, scoped removal, replacement and single-use public upload without changing native fiscal records, other projects, payments or cash.');
}
