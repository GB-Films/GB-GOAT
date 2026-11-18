import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-goat-area-access',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
});
const leadUid = 'area-lead', leadEmail = 'lead@example.test';
const ownerUid = 'legacy-owner', ownerEmail = 'owner@example.test';
const leadDb = env.authenticatedContext(leadUid, { email_verified: true, email: leadEmail }).firestore();
const ownerDb = env.authenticatedContext(ownerUid, { email_verified: true, email: ownerEmail }).firestore();
const outsiderDb = env.authenticatedContext('outsider', { email_verified: true, email: 'outsider@example.test' }).firestore();
const date = Timestamp.fromDate(new Date('2026-10-01T12:00:00Z'));
const projectPath = id => `projects/${id}`;
const expensePath = (projectId, id) => `${projectPath(projectId)}/areaExpenses/${id}`;
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
      await setDoc(doc(db, expensePath(id, 'new')), expense(id));
      await setDoc(doc(db, expensePath(id, 'outside')), expense(id, { area: 'Arte' }));
      await setDoc(doc(db, expensePath(id, 'paid')), expense(id, {
        paymentLocked: true, paymentAuthorIds: [leadUid], total: 100, unitPrice: 100,
        paymentHistory: [{ id: 'payment', amount: 100, createdBy: leadUid, createdByEmail: leadEmail }],
      }));
      await setDoc(doc(db, `${projectPath(id)}/budgetItems/budget`), expense(id, { area: 'Ejecutiva' }));
      await setDoc(doc(db, `projectCommercial/${id}`), { budgetTotal: 1000 });
    }
  });

  for (const id of ['imported', 'legacy']) {
    await assertSucceeds(getDoc(doc(leadDb, projectPath(id))));
    // The UI creates an empty row without a `paid` field, then edits its amount in a transaction.
    await assertSucceeds(setDoc(doc(leadDb, expensePath(id, 'created')), expense(id, {
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })));
    await assertSucceeds(runTransaction(leadDb, async transaction => {
      const ref = doc(leadDb, expensePath(id, 'new'));
      const snap = await transaction.get(ref);
      assert.equal(snap.data().total, 0);
      transaction.update(ref, { quantity: 1, unitPrice: 2000, total: 2000, updatedAt: serverTimestamp() });
    }));
    assert.equal((await getDoc(doc(leadDb, expensePath(id, 'new')))).data().total, 2000);
    await assertSucceeds(updateDoc(doc(leadDb, expensePath(id, 'new')), {
      description: 'Detalle actualizado', updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(leadDb, expensePath(id, 'outside')), { total: 2000 }));
    await assertFails(updateDoc(doc(leadDb, expensePath(id, 'new')), { area: 'Arte' }));
    await assertFails(updateDoc(doc(leadDb, expensePath(id, 'new')), { createdBy: 'another-user' }));
    await assertFails(updateDoc(doc(leadDb, expensePath(id, 'paid')), { total: 2000, unitPrice: 2000 }));
    await assertFails(updateDoc(doc(leadDb, expensePath(id, 'paid')), { paymentHistory: [] }));
    await assertFails(updateDoc(doc(leadDb, `${projectPath(id)}/budgetItems/budget`), { total: 2000 }));
    await assertFails(getDoc(doc(leadDb, `projectCommercial/${id}`)));
    await assertFails(updateDoc(doc(leadDb, projectPath(id)), { createdBy: leadUid }));
    await assertFails(updateDoc(doc(leadDb, `${projectPath(id)}/collaborators/${leadEmail}`), { role: 'admin' }));
    await assertFails(getDoc(doc(outsiderDb, projectPath(id))));
    await assertFails(updateDoc(doc(outsiderDb, expensePath(id, 'new')), { total: 2000 }));
  }
  // The creator of an unpaid row is independent of the producer's editing grant.
  // Reproduce a producer with assigned areas but read-only access, then enable
  // only that grant, without changing scopes, roles, or the administrator's row.
  const producerEmail = 'producer@example.test';
  const producerDb = env.authenticatedContext('producer', { email_verified: true, email: producerEmail }).firestore();
  const producerProject = 'producer-edit-grant';
  const collaboratorPath = `projects/${producerProject}/collaborators/${producerEmail}`;
  const originalRow = expense(producerProject, {
    subcategory: 'Proveedores', description: 'Servicio ficticio',
    quantity: 2, unitPrice: 500, total: 1000,
    createdBy: 'admin', createdByEmail: 'admin@example.test',
  });
  const adminPayment = { id: 'admin-payment', amount: 100, createdBy: 'admin', createdByEmail: 'admin@example.test' };
  const originalAccess = {
    uid: 'producer', email: producerEmail, role: 'jefe_produccion', canEditBudgetAreas: false,
    allowedCategories: ['Producción'], allowedSubcategories: [],
    excludedSubcategories: ['Producción||Reservada'], allowedTabs: ['areas', 'cajas', 'resumen'],
  };
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/producer'), { email: producerEmail, role: 'colaborador' });
    await setDoc(doc(db, projectPath(producerProject)), { activeAreas: ['Producción', 'Arte'], collaboratorEmails: [producerEmail] });
    await setDoc(doc(db, collaboratorPath), originalAccess);
    await setDoc(doc(db, expensePath(producerProject, 'admin-created')), originalRow);
    await setDoc(doc(db, expensePath(producerProject, 'outside')), { ...originalRow, area: 'Arte' });
    await setDoc(doc(db, expensePath(producerProject, 'excluded')), { ...originalRow, subcategory: 'Reservada' });
    await setDoc(doc(db, expensePath(producerProject, 'admin-paid')), { ...originalRow, paymentLocked: true, paymentHistory: [adminPayment], paymentAuthorIds: ['admin'] });
  });
  const adminCreatedRef = doc(producerDb, expensePath(producerProject, 'admin-created'));
  await assertSucceeds(getDoc(adminCreatedRef));
  const amountUpdate = { quantity: 3, unitPrice: 600, total: 1800, updatedAt: serverTimestamp() };
  await assertFails(updateDoc(adminCreatedRef, amountUpdate));
  await assertFails(updateDoc(doc(producerDb, collaboratorPath), { canEditBudgetAreas: true }));
  await env.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), collaboratorPath), { canEditBudgetAreas: true });
  });
  const { canEditBudgetAreas, ...preservedAccess } = (await getDoc(doc(producerDb, collaboratorPath))).data();
  assert.equal(canEditBudgetAreas, true);
  const { canEditBudgetAreas: priorGrant, ...priorAccess } = originalAccess;
  assert.equal(priorGrant, false);
  assert.deepEqual(preservedAccess, priorAccess);
  await assertSucceeds(runTransaction(producerDb, async transaction => {
    assert.equal((await transaction.get(adminCreatedRef)).data().total, 1000);
    transaction.update(adminCreatedRef, amountUpdate);
  }));
  const { quantity, unitPrice, total, updatedAt, ...preservedRow } = (await getDoc(adminCreatedRef)).data();
  assert.deepEqual({ quantity, unitPrice, total }, { quantity: 3, unitPrice: 600, total: 1800 });
  assert.ok(updatedAt.toMillis() > date.toMillis());
  const { quantity: priorQuantity, unitPrice: priorPrice, total: priorTotal, updatedAt: priorUpdatedAt, ...priorRow } = originalRow;
  assert.deepEqual(preservedRow, priorRow, 'creator, provider and financial history are preserved');
  await assertFails(updateDoc(doc(producerDb, expensePath(producerProject, 'outside')), amountUpdate));
  await assertFails(updateDoc(doc(producerDb, expensePath(producerProject, 'excluded')), amountUpdate));
  const adminPaidRef = doc(producerDb, expensePath(producerProject, 'admin-paid'));
  await assertFails(updateDoc(adminPaidRef, amountUpdate));
  await assertFails(updateDoc(adminPaidRef, { paymentHistory: [] }));
  await assertFails(updateDoc(adminPaidRef, { paymentHistory: [{ ...adminPayment, amount: 50 }] }));
  assert.deepEqual((await getDoc(adminPaidRef)).data().paymentHistory, [adminPayment]);

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
  await assertSucceeds(setDoc(doc(leadDb, targetRef), { ...target, excludedSubcategories: ['Producción||Seguros'] }));
  await assertFails(updateDoc(doc(leadDb, targetRef), { excludedSubcategories: [] }));
  await assertSucceeds(updateDoc(doc(leadDb, targetRef), { allowedCategories: [], allowedSubcategories: ['Producción||Nueva'] }));
  await assertFails(updateDoc(doc(leadDb, targetRef), { allowedSubcategories: ['Producción||Seguros'] }));
  await assertFails(updateDoc(doc(leadDb, targetRef), { allowedSubcategories: ['Arte||Utilería'] }));
  await assertFails(updateDoc(doc(leadDb, targetRef), { excludedSubcategories: 'invalid' }));
  const targetDb = env.authenticatedContext('target', { email_verified: true, email: 'target@example.test' }).firestore();
  await assertSucceeds(setDoc(doc(targetDb, expensePath('imported', 'target-included')), expense('imported', { subcategory: 'Nueva', createdBy: 'target', createdByEmail: 'target@example.test' })));
  await assertFails(setDoc(doc(targetDb, expensePath('imported', 'target-excluded')), expense('imported', { subcategory: 'Seguros', createdBy: 'target', createdByEmail: 'target@example.test' })));
  console.log('Area expense access: legacy/inherited scopes, explicit exclusions, delegation and privilege boundaries verified');
} finally {
  await env.cleanup();
}
