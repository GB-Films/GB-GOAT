import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const projectId = 'demo-goat-area-access';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const firebase = require('firebase-admin');
const app = firebase.initializeApp({ projectId });
const { createProviderFinanceHandler } = require('../functions/providerFinance');
const finance = createProviderFinanceHandler({ db: app.firestore(), timestamp: firebase.firestore.FieldValue.serverTimestamp });
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
});
const leadUid = 'area-lead', leadEmail = 'lead@example.test';
const callAs = (uid, email, data) => finance({ auth: { uid, token: { email, email_verified: true } }, data });
const callAsLead = data => callAs(leadUid, leadEmail, data);
const ownerUid = 'legacy-owner', ownerEmail = 'owner@example.test';
const adminUid = 'global-admin', adminEmail = 'admin@example.test';
const leadDb = env.authenticatedContext(leadUid, { email_verified: true, email: leadEmail }).firestore();
const ownerDb = env.authenticatedContext(ownerUid, { email_verified: true, email: ownerEmail }).firestore();
const outsiderDb = env.authenticatedContext('outsider', { email_verified: true, email: 'outsider@example.test' }).firestore();
const date = Timestamp.fromDate(new Date('2026-10-01T12:00:00Z'));
const versionOf = date => [date.seconds, date.nanoseconds];
const projectPath = id => `projects/${id}`;
const expensePath = (projectId, id) => `${projectPath(projectId)}/areaExpenses/${id}`;
const ownPayment = { id: 'own', amount: 100, createdBy: leadUid, createdByEmail: leadEmail };
const otherPayment = { id: 'admin', amount: 25, createdBy: adminUid, createdByEmail: adminEmail };
const expense = (projectId, overrides = {}) => ({
  projectId, area: 'Producción', subcategory: '', providerId: '', providerName: '',
  description: '', quantity: 1, unitPrice: 0, total: 0, unit: 'Unidad', order: 3,
  paymentAuthorIds: [], paymentHistory: [], paymentLocked: false,
  createdBy: leadUid, createdByEmail: leadEmail, createdAt: date, updatedAt: date,
  ...overrides,
});

try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, `users/${leadUid}`), { email: leadEmail, role: 'ayudante_admin' });
    await setDoc(doc(db, `users/${ownerUid}`), { email: ownerEmail, role: 'colaborador' });
    await setDoc(doc(db, `users/${adminUid}`), { email: adminEmail, role: 'admin' });
    await setDoc(doc(db, 'users/outsider'), { email: 'outsider@example.test', role: 'colaborador' });
    for (const [id, owner] of [['imported', {}], ['legacy', { createdBy: ownerUid }]]) {
      await setDoc(doc(db, projectPath(id)), {
        ...owner, name: 'Proyecto de prueba', activeAreas: ['Producción'],
        collaboratorEmails: [leadEmail],
      });
      await setDoc(doc(db, `${projectPath(id)}/collaborators/${leadEmail}`), {
        uid: leadUid, email: leadEmail, role: 'jefe_produccion',
        canEditBudgetAreas: true, canViewBudgetTotals: false,
        allowedCategories: ['Producción'], allowedTabs: ['areas', 'permisos'],
      });
      await setDoc(doc(db, expensePath(id, 'new')), expense(id, { createdBy: adminUid, createdByEmail: adminEmail }));
      await setDoc(doc(db, expensePath(id, 'outside')), expense(id, { area: 'Arte' }));
      await setDoc(doc(db, expensePath(id, 'paid')), expense(id, {
        paid: true, paymentLocked: true, paymentAuthorIds: [leadUid], total: 100, unitPrice: 100,
        paymentHistory: [ownPayment],
      }));
      await setDoc(doc(db, `${projectPath(id)}/budgetItems/budget`), expense(id, { area: 'Ejecutiva' }));
      await setDoc(doc(db, `projectCommercial/${id}`), { budgetTotal: 1000 });
    }
  });

  for (const id of ['imported', 'legacy']) {
    await assertFails(getDoc(doc(leadDb, projectPath(id))));
    // A collaborator can edit an unpaid row from the restricted projection.
    await assertSucceeds(setDoc(doc(leadDb, expensePath(id, 'created')), expense(id, {
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })));
    await assertFails(getDoc(doc(leadDb, expensePath(id, 'new'))));
    const edit = (itemId, updates, expectedUpdatedAt = versionOf(date), confirmedPaidEdit = false) =>
      callAsLead({ action: 'editScopedAreaExpense', projectId: id, itemId, expectedUpdatedAt, updates, confirmedPaidEdit });
    const edited = await edit('new', { description: 'Gasto cargado por administración', quantity: 1, unitPrice: 2000 });
    assert.equal(edited.expense.total, 2000);
    assert.equal(edited.expense.description, 'Gasto cargado por administración');
    const saved = (await app.firestore().doc(expensePath(id, 'new')).get()).data();
    assert.equal(saved.total, 2000);
    assert.equal(saved.createdBy, adminUid);
    await assertSucceeds(updateDoc(doc(leadDb, expensePath(id, 'new')), {
      description: 'Detalle actualizado', updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(leadDb, expensePath(id, 'outside')), { total: 2000 }));
    await assertFails(updateDoc(doc(leadDb, expensePath(id, 'new')), { area: 'Arte' }));
    await assertFails(updateDoc(doc(leadDb, expensePath(id, 'new')), { createdBy: 'another-user' }));
    await assertFails(updateDoc(doc(leadDb, expensePath(id, 'paid')), { total: 2000, unitPrice: 2000 }));
    await assertFails(updateDoc(doc(leadDb, expensePath(id, 'paid')), { paymentHistory: [] }));
    await assert.rejects(edit('paid', { description: 'Sin confirmar' }), /Confirmá el cambio/);
    const revised = await edit('paid', { description: 'Actualizado con pago propio', unitPrice: 150 }, versionOf(date), true);
    assert.equal(revised.expense.description, 'Actualizado con pago propio');
    assert.equal(revised.expense.total, 150);
    assert.equal(revised.expense.paid, false);
    const revisedVersion = versionOf(revised.expense.updatedAt);
    await assert.rejects(edit('paid', { description: 'Edición anterior' }), /El gasto cambió/);
    await assert.rejects(edit('paid', { unitPrice: 99.99 }, revisedVersion), /por debajo de lo ya pagado/);
    await assert.rejects(edit('paid', { total: 200 }, revisedVersion), /precio unitario o la cantidad/);
    const fullyPaid = await edit('paid', { unitPrice: 100 }, revisedVersion);
    assert.equal(fullyPaid.expense.paid, true);
    assert.deepEqual((await app.firestore().doc(expensePath(id, 'paid')).get()).data().paymentHistory, [ownPayment]);
    const audits = await app.firestore().collection(`${projectPath(id)}/activityLog`).get();
    assert.equal(audits.size, 2);
    assert(audits.docs.every(entry => entry.data().editedBy === leadUid));
    await assert.rejects(edit('outside', { description: 'Fuera de área' }), { code: 'permission-denied' });
    await assertFails(updateDoc(doc(leadDb, `${projectPath(id)}/budgetItems/budget`), { total: 2000 }));
    await assertFails(getDoc(doc(leadDb, `projectCommercial/${id}`)));
    await assertFails(updateDoc(doc(leadDb, projectPath(id)), { createdBy: leadUid }));
    await assertFails(updateDoc(doc(leadDb, `${projectPath(id)}/collaborators/${leadEmail}`), { role: 'admin' }));
    await assertFails(getDoc(doc(outsiderDb, projectPath(id))));
    await assertFails(updateDoc(doc(outsiderDb, expensePath(id, 'new')), { total: 2000 }));
  }

  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [id, data] of Object.entries({
      'paid-by-admin': { paymentHistory: [otherPayment] },
      'paid-by-both': { paymentHistory: [ownPayment, otherPayment] },
      'legacy-without-author': { paymentHistory: [{ id: 'legacy', amount: 10 }] },
      'legacy-paid-flag': { paid: true },
      'historically-cleared': { paymentHistory: [], paid: false },
      'shared': { paymentHistory: [{ ...ownPayment, sharedRecordId: 'shared-payment' }], sharedPaymentIds: ['shared-payment'] },
    })) {
      await setDoc(doc(db, expensePath('imported', id)), expense('imported', { total: 150, unitPrice: 150, paymentLocked: true, ...data }));
    }
  });
  const editImported = (itemId, updates) => callAsLead({ action: 'editScopedAreaExpense', projectId: 'imported', itemId, expectedUpdatedAt: versionOf(date), updates });
  for (const id of ['paid-by-admin', 'paid-by-both', 'legacy-without-author', 'legacy-paid-flag', 'shared']) {
    await assert.rejects(editImported(id, { description: 'Cambio bloqueado' }), /pagos que no podés modificar/);
    await assert.rejects(editImported(id, { unitPrice: 200 }), /pagos que no podés modificar/);
  }
  assert.equal((await editImported('historically-cleared', { description: 'Sin pagos vigentes', unitPrice: 220 })).expense.total, 220);
  // A missing owner never grants ownership; an actual legacy owner keeps existing rights.
  await assertFails(getDoc(doc(ownerDb, 'projectCommercial/imported')));
  await assertFails(updateDoc(doc(ownerDb, expensePath('imported', 'new')), { total: 2000 }));
  await assertSucceeds(getDoc(doc(ownerDb, 'projectCommercial/legacy')));
  await assertSucceeds(updateDoc(doc(ownerDb, expensePath('legacy', 'new')), {
    quantity: 1, unitPrice: 3000, total: 3000, updatedAt: serverTimestamp(),
  }));
  // A whole area inherits existing/future children, with explicit exclusions.
  const scopeRef = `projects/imported/collaborators/${leadEmail}`;
  const targetRef = 'projects/imported/collaborators/target@example.test';
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await updateDoc(doc(db, scopeRef), { excludedSubcategories: ['Producción||Seguros'] });
    await setDoc(doc(db, 'users/target'), { email: 'target@example.test', role: 'colaborador' });
    await setDoc(doc(db, expensePath('imported', 'excluded')), expense('imported', { subcategory: 'Seguros' }));
  });
  await assertSucceeds(setDoc(doc(leadDb, expensePath('imported', 'inherited')), expense('imported', { subcategory: 'Nueva' })));
  await assertFails(setDoc(doc(leadDb, expensePath('imported', 'blocked')), expense('imported', { subcategory: 'Seguros' })));
  await assertFails(updateDoc(doc(leadDb, expensePath('imported', 'excluded')), { description: 'Fuera de alcance' }));
  await assertFails(updateDoc(doc(leadDb, expensePath('imported', 'excluded')), { subcategory: 'Nueva' }));
  await assertFails(updateDoc(doc(leadDb, expensePath('imported', 'inherited')), { subcategory: 'Seguros' }));
  await assertFails(updateDoc(doc(leadDb, scopeRef), { excludedSubcategories: [] }));
  const target = { uid: 'target', email: 'target@example.test', role: 'jefe_area', allowedTabs: ['areas'], canEditBudgetAreas: true, allowedCategories: ['Producción'], allowedSubcategories: [] };
  await assertFails(setDoc(doc(leadDb, targetRef), target));
  await assertFails(setDoc(doc(leadDb, targetRef), { ...target, excludedSubcategories: ['Producción||Seguros'] }));
  const assigned = await finance({ auth: { uid: leadUid, token: { email: leadEmail, email_verified: true } }, data: {
    action: 'projectAssignCollaborator', projectId: 'imported', email: target.email, uid: target.uid, role: target.role, categories: target.allowedCategories } });
  assert.deepEqual(assigned.collaborator.excludedSubcategories, ['Producción||Seguros']);
  await assertFails(updateDoc(doc(leadDb, targetRef), { excludedSubcategories: [] }));
  await assertSucceeds(updateDoc(doc(leadDb, targetRef), { allowedCategories: [], allowedSubcategories: ['Producción||Nueva'] }));
  await assertFails(updateDoc(doc(leadDb, targetRef), { allowedSubcategories: ['Producción||Seguros'] }));
  await assertFails(updateDoc(doc(leadDb, targetRef), { allowedSubcategories: ['Arte||Utilería'] }));
  await assertFails(updateDoc(doc(leadDb, targetRef), { excludedSubcategories: 'invalid' }));
  const targetDb = env.authenticatedContext('target', { email_verified: true, email: 'target@example.test' }).firestore();
  await assertSucceeds(setDoc(doc(targetDb, expensePath('imported', 'target-included')), expense('imported', { subcategory: 'Nueva', createdBy: 'target', createdByEmail: 'target@example.test' })));
  await assertFails(setDoc(doc(targetDb, expensePath('imported', 'target-excluded')), expense('imported', { subcategory: 'Seguros', createdBy: 'target', createdByEmail: 'target@example.test' })));
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), expensePath('imported', 'target-edit')), expense('imported', {
    subcategory: 'Nueva', createdBy: adminUid, createdByEmail: adminEmail,
  })));
  const editedByAreaLead = await callAs('target', 'target@example.test', { action: 'editScopedAreaExpense', projectId: 'imported', itemId: 'target-edit',
    expectedUpdatedAt: versionOf(date), updates: { description: 'Detalle actualizado por jefa de área', unitPrice: 500 } });
  assert.equal(editedByAreaLead.expense.total, 500);
  assert.equal(editedByAreaLead.expense.description, 'Detalle actualizado por jefa de área');
  console.log('Area expense access: legacy/inherited scopes, explicit exclusions, delegation and privilege boundaries verified');
} finally {
  await env.cleanup();
  await app.delete();
}
