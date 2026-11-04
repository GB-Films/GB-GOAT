import assert from 'node:assert/strict';
import { doc, getDoc } from 'firebase/firestore';

export async function testProviderPortalOwnership({ db, portal, request, sign, env, assertFails, admin }) {
  const providerId = 'mobile-payer', projectId = 'mobile-project';
  const own = data => portal(request('mobile-owner', 'mobile@example.test', { providerId, ...data }));
  await db.doc(`providers/${providerId}`).set({ type: 'persona', name: 'Ficticio', email: 'mobile@example.test' });
  await db.doc(`providerPortalUsers/mobile-owner/memberships/${providerId}`).set({ providerId, email: 'mobile@example.test', status: 'active' });
  await db.doc(`providerPortalUsers/mobile-other/memberships/${providerId}`).set({ providerId, email: 'other-mobile@example.test', status: 'active' });
  await db.doc(`projects/${projectId}`).set({ name: 'Proyecto móvil', activeAreas: ['Campo'] });
  const ref = name => db.doc(`projects/${projectId}/areaExpenses/${name}`), key = name => `${projectId}/areaExpenses/${name}`;
  const financial = { providerId, area: 'Campo', total: 100, paymentLocked: true, paid: true, paymentHistory: [{ id: 'paid', amount: 100, receipt: { path: 'private/payment' } }] };
  for (const name of ['own', 'same-bytes', 'producer']) await ref(name).set(financial);
  const upload = (name, contents = 'first', invoiceRevision = 0) => own({ action: 'uploadInvoice', workKey: key(name), invoiceRevision, attemptId: `upload-${name}-${contents}`, file: {
    base64: Buffer.from(`%PDF-fictitious-${contents}`).toString('base64'), contentType: 'application/pdf', fileName: 'factura.pdf',
  } });
  await upload('own'); await upload('same-bytes');
  const original = (await ref('own').get()).data().invoices[0];
  const overview = () => own({ action: 'overview' });
  const ownRow = (await overview()).works.find(w => w.expenseId === 'own').invoices[0];
  assert.equal(ownRow.canRemove, true);
  const removal = { action: 'removeInvoice', workKey: key('own'), uploadId: ownRow.uploadId, revision: ownRow.revision, attemptId: 'delete-original' };
  await assert.rejects(portal(request('mobile-other', 'other-mobile@example.test', { providerId, ...removal })), e => e.code === 'permission-denied');
  await ref('producer').update({ invoices: [{ path: 'producer/file', uploadedBy: 'mobile@example.test', uploadedByUid: 'mobile-owner' }] });
  assert.equal((await overview()).works.find(w => w.expenseId === 'producer').invoices[0].canRemove, false, 'an email or UID flag without a portal manifest never grants removal');
  await assert.rejects(own({ ...removal, workKey: key('producer') }), e => e.code === 'permission-denied');
  const stale = request('mobile-owner', 'mobile@example.test', { providerId, ...removal }); stale.auth.token.auth_time = 1;
  await assert.rejects(portal(stale), e => e.code === 'unauthenticated');
  assert.equal((await own(removal)).removed, true);
  const after = (await ref('own').get()).data();
  assert.equal(after.invoices.length, 0); assert.equal(after.portalInvoiceRevision, 1);
  const { invoices: _, portalInvoiceRevision: __, updatedAt: ___, ...unchanged } = after;
  assert.deepEqual(unchanged, financial);
  assert.equal((await own(removal)).resumed, true);
  const retained = await sign.readLocalFile(original);
  assert.equal(retained.sha256, original.sha256, 'remove association, never delete bytes shared by another work or audit');
  await assert.rejects(upload('own'), /factura cambió/);
  await upload('own', 'first', 1);
  const restored = (await overview()).works.find(w => w.expenseId === 'own').invoices[0];
  assert.equal(restored.revision, 2);
  await own(removal);
  assert.equal((await ref('own').get()).data().invoices.length, 1, 'old removal retry must not remove the newly restored invoice');
  await assert.rejects(own({ ...removal, attemptId: 'stale-version' }), /factura cambió/);
  await own({ ...removal, revision: 2, attemptId: 'remove-restored' });
  await upload('own', 'corrected', 2);
  assert.notEqual((await ref('own').get()).data().invoices[0].sha256, original.sha256);
  const removals = await db.collection('providerPortalInvoiceRemovals').where('providerId', '==', providerId).get();
  assert.equal(removals.size, 2);
  await assertFails(getDoc(doc(env.authenticatedContext('mobile-owner', { email: 'mobile@example.test', email_verified: true }).firestore(), removals.docs[0].ref.path)));

  // The supplier also fronted expenses for somebody else in a project with no own service.
  await db.doc('projects/payer-only-project').set({ name: 'Sólo adelantos', activeAreas: ['Campo'] });
  const expenses = db.doc('projects/payer-only-project/areaExpenses/advance');
  const receiptPath = 'projects/payer-only-project/areaExpenses/advance/comprobantes/advance.pdf';
  const refundPath = 'projects/payer-only-project/areaExpenses/advance/comprobantes/refund.pdf';
  const bytes = Buffer.from('%PDF-advance-receipt');
  for (const [path, extra] of [[receiptPath, {}], [refundPath, { reimbursementId: 'refund' }]]) await admin.storage().bucket().file(path).save(bytes, {
    contentType: 'application/pdf', metadata: { metadata: { projectId: 'payer-only-project', collectionName: 'areaExpenses', expenseId: 'advance', paymentId: 'advance', ...extra } },
  });
  const p = { id: 'advance', method: 'tercero', thirdPartyPayerId: providerId, amount: 120.15, date: '2026-11-04', receipt: { path: receiptPath, contentType: 'application/pdf' },
    reimbursements: [{ id: 'refund', amount: 20.1, date: '2026-11-04', detail: 'Parcial', receipt: { path: refundPath, contentType: 'application/pdf' } }] };
  await expenses.set({ providerId: 'another-service-provider', area: 'Campo', description: 'Gasto adelantado', total: 9000, internalNotes: 'PRIVATE_SECRET', invoice: { url: 'PRIVATE_TOKEN' },
    paymentHistory: [p, { ...p, id: 'foreign', thirdPartyPayerId: 'foreign-payer', amount: 999 }] });
  await db.doc('projects/payer-only-project/budgetItems/mirror').set((await expenses.get()).data());
  const before = (await expenses.get()).data();
  const result = await own({ action: 'reimbursements' });
  const advances = result.advances.filter(a => a.workKey.startsWith('payer-only-project/'));
  assert.equal(advances.length, 1); assert.equal(advances[0].amount, 120.15); assert.equal(advances[0].reimbursed, 20.1); assert.equal(advances[0].balance, 100.05);
  assert(!JSON.stringify(result).includes('PRIVATE')); assert(advances.every(a => a.amount !== 999)); assert(!JSON.stringify(advances).includes(receiptPath));
  assert.deepEqual((await expenses.get()).data(), before, 'reimbursement reads do not register payments, change cash or mutate supplier data');
  const download = { action: 'download', workKey: advances[0].workKey, paymentIndex: 0, paymentVersion: advances[0].paymentVersion, index: 0 };
  assert.equal((await own({ ...download, kind: 'advance' })).base64, bytes.toString('base64'));
  assert.equal((await own({ ...download, kind: 'reimbursement' })).base64, bytes.toString('base64'));
  await assert.rejects(own({ ...download, kind: 'advance', paymentIndex: 1 }), e => e.code === 'permission-denied');
  await assert.rejects(own({ ...download, kind: 'invoice' }), e => e.code === 'permission-denied');
  await expenses.update({ paymentHistory: [{ ...p, reimbursements: [] }] });
  await assert.rejects(own({ ...download, kind: 'reimbursement' }), /cambió/);
  await db.doc(`providerPortalUsers/mobile-owner/memberships/${providerId}`).update({ status: 'revoked' });
  await assert.rejects(own({ action: 'reimbursements' }), e => e.code === 'permission-denied');
  await assert.rejects(own({ ...removal, attemptId: 'revoked-remove' }), e => e.code === 'permission-denied');
  console.log('PASS portal own invoice correction and private payer advances/refunds: exact ownership, immutable audit/originals, versioned restore/retries, no foreign invoice removal, no financial writes, cross-project payer discovery and scoped downloads.');
}
