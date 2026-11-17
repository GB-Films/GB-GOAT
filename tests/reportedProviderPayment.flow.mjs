import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { assertFails } from '@firebase/rules-unit-testing';
const require = createRequire(import.meta.url);
const { createProviderFinanceHandler } = require('../functions/providerFinance');
const { ownAdvances } = require('../functions/providerPortalReimbursements');
const { createHash } = require('node:crypto');

export async function testReportedProviderPayments({ db, admin, env }) {
  const auth = (uid = 'admin', email = 'agustin@granberta.com') => ({ uid, token: { email, email_verified: true } });
  const fixed = new Date('2026-11-17T15:00:00Z');
  const verifiedFiles = new Map();
  const call = createProviderFinanceHandler({ db, timestamp: () => admin.firestore.FieldValue.serverTimestamp(), clock: () => fixed,
    verifyFile: async (provider, id, input, options) => {
      assert.equal(options.hash, true);
      assert.ok(input.path.startsWith(`providerFinance/${provider}/${id}/`));
      const file = verifiedFiles.get(input.path); if (!file) throw Error('Original no verificado'); return file;
    }, readFile: async file => file.fileName,
  });
  const invoke = (data, actor = auth()) => call({ auth: actor, data });
  await db.doc('providers/report-worker').set({ type: 'persona', name: 'Proveedor', lastName: 'Ficticio', cuit: '20111111112' });
  await db.doc('providers/report-payer').set({ type: 'persona', name: 'Pagador', lastName: 'Ficticio', cuit: '20222222223' });
  const priorDeclaration = { kind: 'third_party', providerId: 'report-worker', status: 'active', content: { workKeys: ['reported-test/areaExpenses/honoraria'] } };
  await db.doc('providerPortalDeclarations/unrelated-signed').set(priorDeclaration);
  const root = db.doc('projects/reported-test');
  await root.set({ name: 'Proyecto ficticio', activeAreas: ['Campo'], collaboratorEmails: ['report-viewer@example.test'] });
  await db.doc('users/report-viewer').set({ email: 'report-viewer@example.test', role: 'colaborador' });
  await root.collection('collaborators').doc('report-viewer@example.test').set({ role: 'jefe_produccion', allowedTabs: ['areas'], allowedCategories: ['Campo'], canEditBudgetAreas: false });
  const row = { providerId: 'report-worker', area: 'Campo', subcategory: 'Gastos', total: 125.25, unitPrice: 125.25, quantity: 1,
    description: 'Rendición ficticia', thirdPartyPayoutRequired: true, paymentHistory: [], paymentLocked: false, paymentAuthorIds: ['historical-author'],
    createdBy: 'original-admin', createdByEmail: 'original@example.test', invoices: [{ fileName: 'factura-preexistente.pdf' }] };
  const expense = root.collection('areaExpenses').doc('rendition');
  await expense.set(row);
  const honoraria = { ...row, total: 500, description: 'Honorarios distintos', paid: true, paymentHistory: [{ id: 'older', amount: 500 }] };
  await root.collection('areaExpenses').doc('honoraria').set(honoraria);
  function request(id, itemId = 'rendition', seed = id) {
    return { id, projectId: 'reported-test', collectionName: 'areaExpenses', itemId, date: '2026-11-16', alreadyPaid: true,
      reason: 'Pago confirmado que requiere aceptación posterior del proveedor', source: 'Confirmación humana documentada en expediente ficticio',
      beneficiary: { name: 'Tercero Ficticio', cuit: '20333333334', account: '0000000000000000000001' },
      parts: [10000, 2525].map((amountCents, index) => {
        const path = `providerFinance/report-worker/${id}/proof-${index}.pdf`, sha256 = createHash('sha256').update(`${seed}-${index}`).digest('hex');
        verifiedFiles.set(path, { path, fileName: `proof-${index}.pdf`, contentType: 'application/pdf', size: 500, sha256 });
        return { amountCents, source: index ? 'personal_advance' : 'general_cash', method: index ? 'transfer' : 'deposit',
          reference: `${seed}-op-${index}`, ctReference: `${seed}-ct-${index}`, cashSourceEvidence: index ? '' : 'Origen GB confirmado expresamente en expediente',
          ...(index ? { payerProviderId: 'report-payer' } : {}), originalFileName: `original-${index}.pdf`, proofSha256: sha256, file: { path } };
      }) };
  }
  const input = request('report-one');
  const preview = await invoke({ ...input, action: 'previewReportedPayment' });
  assert.equal(preview.amountCents, 12525);
  assert.equal(preview.parts[1].payerName, 'Pagador Ficticio');
  assert.equal(preview.parts[0].reference, input.parts[0].reference);
  assert.equal(preview.parts[1].sha256, input.parts[1].proofSha256);
  assert.deepEqual((await expense.get()).data(), row, 'preview has no financial effects');
  assert.equal((await root.collection('cashMovements').get()).size, 0);
  for (const invalid of [
    { ...input, alreadyPaid: false }, { ...input, date: '2026-11-18' }, { ...input, date: '2026-99-99' },
    { ...input, beneficiary: { ...input.beneficiary, cuit: 'bad' } },
    { ...input, parts: [{ ...input.parts[0], amountCents: 10000.5 }] },
    { ...input, parts: [{ ...input.parts[0], amountCents: 12524 }] },
    { ...input, parts: [input.parts[0], input.parts[0]] },
    { ...input, parts: [{ ...input.parts[0], cashSourceEvidence: '' }] },
    { ...input, parts: [{ ...input.parts[0], proofSha256: '0'.repeat(64) }] },
  ]) await assert.rejects(invoke({ ...invalid, action: 'previewReportedPayment' }));
  await assert.rejects(invoke({ ...input, action: 'recordReportedPayment', previewHash: 'wrong' }), /cambiaron/);
  await assert.rejects(invoke({ ...input, action: 'previewReportedPayment' }, auth('report-viewer', 'report-viewer@example.test')), /Sólo administración/);
  await db.doc('users/report-admin').set({ email: 'other-admin@example.test', role: 'admin' });
  await assert.rejects(invoke({ ...input, action: 'previewReportedPayment' }, auth('report-admin', 'other-admin@example.test')), /Caja General/);
  await assert.rejects(invoke({ ...input, action: 'previewReportedPayment' }, { ...auth(), token: { ...auth().token, email_verified: false } }), /Verificá/);
  // Stale expense/provider/payer metadata invalidates the reviewed operation.
  await expense.update({ description: 'Detalle cambiado por otra sesión' });
  await assert.rejects(invoke({ ...input, action: 'recordReportedPayment', previewHash: preview.previewHash }), /cambiaron/);
  await expense.set(row);
  const payerPreview = await invoke({ ...input, action: 'previewReportedPayment' });
  await db.doc('providers/report-payer').update({ name: 'Nombre cambiado' });
  await assert.rejects(invoke({ ...input, action: 'recordReportedPayment', previewHash: payerPreview.previewHash }), /cambiaron/);
  await db.doc('providers/report-payer').update({ name: 'Pagador' });
  const nextPreview = await invoke({ ...input, action: 'previewReportedPayment' });
  const result = await invoke({ ...input, action: 'recordReportedPayment', previewHash: nextPreview.previewHash });
  assert.equal(result.documentaryStatus, 'pending_acceptance');
  const saved = (await expense.get()).data();
  assert.equal(saved.paid, true); assert.equal(saved.thirdPartyPayoutRequired, true);
  assert.equal(saved.paymentHistory.length, 2); assert.equal(saved.paymentHistory.reduce((sum, p) => sum + Math.round(p.amount * 100), 0), 12525);
  assert.equal(saved.paymentHistory[1].method, 'tercero'); assert.equal(saved.paymentHistory[1].thirdPartyPayerId, 'report-payer');
  assert.equal(saved.total, row.total); assert.deepEqual(saved.invoices, row.invoices); assert.equal(saved.createdBy, row.createdBy);
  assert.deepEqual(saved.paymentAuthorIds, ['historical-author', 'admin']);
  assert.deepEqual((await root.collection('areaExpenses').doc('honoraria').get()).data(), honoraria);
  assert.deepEqual((await db.doc('providerPortalDeclarations/unrelated-signed').get()).data(), priorDeclaration);
  const cash = await root.collection('cashMovements').get(); assert.equal(cash.size, 1); assert.equal(cash.docs[0].data().amount, 100);
  assert.equal((await root.collection('activityLog').where('action', '==', 'already_performed_payment_recorded').get()).size, 1);
  assert.equal((await db.doc('providerFinancialRecords/report-one').get()).data().reportedPayment.parts[1].ctReference, 'report-one-ct-1');
  assert.equal(ownAdvances(saved, { activeAreas: ['Campo'] }, 'projects/reported-test/areaExpenses/rendition', 'report-payer')[0].balance, 25.25);
  assert.equal((await invoke({ ...input, action: 'recordReportedPayment', previewHash: nextPreview.previewHash })).repeated, true);
  await assert.rejects(invoke({ ...input, source: 'Otra confirmación diferente', action: 'recordReportedPayment', previewHash: nextPreview.previewHash }), /otro registro/);
  assert.equal((await root.collection('cashMovements').get()).size, 1);
  // Receipt download uses the selected immutable original, never another row or proof index.
  assert.equal((await invoke({ action: 'download', id: input.id, fileIndex: 1 })).base64, 'proof-1.pdf');
  await assert.rejects(invoke({ action: 'download', id: input.id, fileIndex: 4 }), /Comprobante inválido/);
  const viewer = auth('report-viewer', 'report-viewer@example.test');
  const state = await invoke({ action: 'reportedPaymentState', id: input.id, projectId: input.projectId, itemId: input.itemId }, viewer);
  assert.equal(state.proofs.length, 2); assert.equal(state.documentaryStatus, 'pending_acceptance');
  await assert.rejects(invoke({ action: 'cancel', id: input.id, reason: 'No debe borrar un hecho histórico' }), /conserva como antecedente/);
  const actorDb = env.authenticatedContext('admin', { email_verified: true, email: 'agustin@granberta.com' }).firestore();
  await assertFails(updateDoc(doc(actorDb, expense.path), { paymentHistory: [] }));
  await assertFails(getDoc(doc(actorDb, 'providerReportedProofKeys/private')));
  // A duplicate original or bank operation cannot be applied to another expense.
  await root.collection('areaExpenses').doc('another').set(row);
  const duplicate = request('report-duplicate', 'another', 'report-one');
  const duplicatePreview = await invoke({ ...duplicate, action: 'previewReportedPayment' });
  await assert.rejects(invoke({ ...duplicate, action: 'recordReportedPayment', previewHash: duplicatePreview.previewHash }), /ya fue registrado/);
  assert.deepEqual((await root.collection('areaExpenses').doc('another').get()).data(), row);
  const duplicateCt = request('duplicate-ct', 'another'); duplicateCt.parts[0].ctReference = 'report-one-ct-0';
  const duplicateCtPreview = await invoke({ ...duplicateCt, action: 'previewReportedPayment' });
  await assert.rejects(invoke({ ...duplicateCt, action: 'recordReportedPayment', previewHash: duplicateCtPreview.previewHash }), /ya fue registrado/);
  await assert.rejects(invoke({ action: 'create', id: 'ordinary-still-blocked', providerId: 'report-worker', kind: 'payment', date: '2026-11-17',
    method: 'transfer', account: input.beneficiary.account, reference: 'new-ordinary', payeeName: input.beneficiary.name,
    net: 125.25, total: 125.25, allocations: [{ projectId: input.projectId, collectionName: 'areaExpenses', itemId: 'another', amount: 125.25 }] }), /requiere la declaración/);
  assert.equal((await db.doc('providerFinancialRecords/ordinary-still-blocked').get()).exists, false);
  // Simultaneous calls preserve a single event/cash movement/debt even with a different attempt ID.
  await root.collection('areaExpenses').doc('concurrent').set(row);
  const racers = ['concurrent-one', 'concurrent-two'].map(id => request(id, 'concurrent'));
  const previews = await Promise.all(racers.map(r => invoke({ ...r, action: 'previewReportedPayment' })));
  const results = await Promise.allSettled(racers.map((r, i) => invoke({ ...r, action: 'recordReportedPayment', previewHash: previews[i].previewHash })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await root.collection('areaExpenses').doc('concurrent').get()).data().paymentHistory.length, 2);
  assert.equal((await root.collection('cashMovements').get()).size, 2);
  await root.collection('areaExpenses').doc('same-attempt').set(row);
  const sameAttempt = request('one-stable-attempt', 'same-attempt');
  const samePreview = await invoke({ ...sameAttempt, action: 'previewReportedPayment' });
  const identical = await Promise.all([0, 1].map(() => invoke({ ...sameAttempt, action: 'recordReportedPayment', previewHash: samePreview.previewHash })));
  assert.equal(identical.filter(r => r.repeated === false).length, 1);
  assert.equal((await root.collection('cashMovements').get()).size, 3);
  await root.collection('collaborators').doc('report-viewer@example.test').update({ allowedCategories: ['Fuera de alcance'] });
  await assert.rejects(invoke({ action: 'reportedPaymentState', id: input.id, projectId: input.projectId, itemId: input.itemId }, viewer), /No tenés acceso/);
  await root.collection('areaExpenses').doc('orphan-cash').set(row);
  await root.collection('cashMovements').doc('orphan-existing').set({ type: 'pago', amount: 100, collectionName: 'areaExpenses', itemId: 'orphan-cash' });
  await assert.rejects(invoke({ ...request('must-not-duplicate-cash', 'orphan-cash'), action: 'previewReportedPayment' }), /Ya hay un movimiento de caja/);
  assert.deepEqual((await root.collection('areaExpenses').doc('orphan-cash').get()).data(), row);
  console.log('PASS reported payments: reviewed historical fact, exact cents and origins, proof/operation/CT/work dedup, idempotency, audit, scoped read, protected native history and preserved unrelated DDJJ/invoices/honoraria; no CT or signature writes.');
}
