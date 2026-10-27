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
  // A missing owner never grants ownership; an actual legacy owner keeps existing rights.
  await assertFails(getDoc(doc(ownerDb, 'projectCommercial/imported')));
  await assertFails(updateDoc(doc(ownerDb, expensePath('imported', 'new')), { total: 2000 }));
  await assertSucceeds(getDoc(doc(ownerDb, 'projectCommercial/legacy')));
  await assertSucceeds(updateDoc(doc(ownerDb, expensePath('legacy', 'new')), {
    quantity: 1, unitPrice: 3000, total: 3000, updatedAt: serverTimestamp(),
  }));
  console.log('Area expense access: imported/legacy edits allowed; scope, payments and privilege boundaries denied');
} finally {
  await env.cleanup();
}
