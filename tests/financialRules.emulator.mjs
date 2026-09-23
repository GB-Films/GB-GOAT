import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-gb-goat-financial-rules',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
});

const adminId = 'admin-test';
const adminEmail = 'admin@example.test';
const collaboratorId = 'collaborator-test';
const collaboratorEmail = 'collaborator@example.test';
const projectId = 'project-test';
const date = Timestamp.fromDate(new Date('2026-09-23T12:00:00Z'));
const adminDb = testEnv.authenticatedContext(adminId, { email: adminEmail }).firestore();
const collaboratorDb = testEnv.authenticatedContext(collaboratorId, { email: collaboratorEmail }).firestore();
const itemPath = (collectionName, itemId) => `projects/${projectId}/${collectionName}/${itemId}`;
const movementPath = (movementId) => `projects/${projectId}/cashMovements/${movementId}`;

const baseExpense = (overrides = {}) => ({
  projectId,
  area: 'Producción',
  subcategory: '',
  providerId: 'provider-1',
  providerName: 'Proveedor',
  description: 'Gasto original',
  unit: 'Unidad',
  quantity: 1,
  unitPrice: 100,
  total: 100,
  order: 0,
  paymentHistory: [],
  paymentLocked: false,
  paymentAuthorIds: [],
  paid: false,
  createdBy: adminId,
  createdByEmail: adminEmail,
  createdAt: date,
  updatedAt: date,
  ...overrides,
});

const payment = (id, amount, overrides = {}) => ({
  id,
  amount,
  detail: id,
  date,
  type: 'partial',
  createdBy: adminId,
  createdByEmail: adminEmail,
  ...overrides,
});

const audit = (action, itemId, paymentId, paymentIndex, fields = {}) => ({
  action,
  collectionName: 'areaExpenses',
  itemId,
  paymentId,
  paymentIndex,
  deletedBy: adminId,
  deletedByEmail: adminEmail,
  deletedByName: 'Admin',
  deletedByRole: 'admin',
  createdAt: serverTimestamp(),
  ...fields,
});

try {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `users/${adminId}`), { email: adminEmail, role: 'admin' });
    await setDoc(doc(db, `users/${collaboratorId}`), { email: collaboratorEmail, role: 'colaborador' });
    await setDoc(doc(db, `projects/${projectId}`), {
      createdBy: adminId,
      collaboratorEmails: [collaboratorEmail],
      activeAreas: [],
    });
    await setDoc(doc(db, `projects/${projectId}/collaborators/${collaboratorEmail}`), {
      uid: collaboratorId,
      email: collaboratorEmail,
      role: 'jefe_area',
      canEditBudgetAreas: true,
      allowedCategories: ['Producción'],
      allowedSubcategories: [],
      allowedTabs: ['areas'],
    });
    await setDoc(doc(db, itemPath('areaExpenses', 'paid-area')), baseExpense({
      paymentHistory: [payment('paid-1', 50)], paymentLocked: true, paymentAuthorIds: [adminId],
    }));
    await setDoc(doc(db, itemPath('budgetItems', 'paid-budget')), baseExpense({
      paymentHistory: [payment('paid-2', 50)], paymentLocked: true, paymentAuthorIds: [adminId],
    }));
    await setDoc(doc(db, itemPath('budgetItems', 'move-row')), baseExpense({ area: 'Arte' }));
    await setDoc(doc(db, itemPath('budgetItems', 'concurrent-move')), baseExpense({ area: 'Arte' }));
    await setDoc(doc(db, itemPath('budgetItems', 'delete-row')), baseExpense({ area: 'Arte' }));
    await setDoc(doc(db, itemPath('areaExpenses', 'new-payment')), baseExpense());
    await setDoc(doc(db, itemPath('areaExpenses', 'payment-race')), baseExpense());
    const first = payment('correction-1', 50, { cashMovementId: 'cash-correction' });
    const second = payment('correction-2', 20);
    await setDoc(doc(db, itemPath('areaExpenses', 'correction')), baseExpense({
      paymentHistory: [first, second], paymentLocked: true, paymentAuthorIds: [adminId, adminId],
    }));
    await setDoc(doc(db, movementPath('cash-correction')), {
      type: 'pago', collectionName: 'areaExpenses', itemId: 'correction', paymentId: first.id,
      area: 'Producción', subcategory: '', fromUserEmail: adminEmail,
      amount: 50, date, notes: 'correction-1', updatedAt: date,
    });
  });

  await assertFails(updateDoc(doc(adminDb, itemPath('areaExpenses', 'paid-area')), { description: 'Otra cosa' }));
  await assertFails(updateDoc(doc(collaboratorDb, itemPath('areaExpenses', 'paid-area')), { providerId: 'other' }));
  await assertFails(updateDoc(doc(adminDb, itemPath('budgetItems', 'paid-budget')), { total: 20 }));
  await assertFails(updateDoc(doc(adminDb, itemPath('areaExpenses', 'paid-area')), { paymentLocked: false, paymentHistory: [] }));
  await assertFails(updateDoc(doc(adminDb, itemPath('areaExpenses', 'paid-area')), { paid: false, paymentHistory: [] }));
  await assertFails(updateDoc(doc(adminDb, itemPath('areaExpenses', 'paid-area')), { area: 'Arte' }));
  await assertSucceeds(updateDoc(doc(adminDb, itemPath('areaExpenses', 'paid-area')), { paymentDate: '2026-10-01' }));
  await assertSucceeds(updateDoc(doc(collaboratorDb, itemPath('areaExpenses', 'paid-area')), { paymentDate: '2026-10-02' }));

  const collaboratorPayment = payment('collab-payment', 100, {
    createdBy: collaboratorId, createdByEmail: collaboratorEmail, cashMovementId: 'cash-collab',
  });
  const append = writeBatch(collaboratorDb);
  append.update(doc(collaboratorDb, itemPath('areaExpenses', 'new-payment')), {
    paymentHistory: [collaboratorPayment], paymentLocked: true, paymentAuthorIds: [collaboratorId],
    paid: true, updatedAt: serverTimestamp(),
  });
  append.set(doc(collaboratorDb, movementPath('cash-collab')), {
    type: 'pago', collectionName: 'areaExpenses', itemId: 'new-payment', paymentId: collaboratorPayment.id,
    area: 'Producción', subcategory: '', fromUserEmail: collaboratorEmail, cashAccount: 'personal',
    amount: 100, date, notes: 'collab-payment', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  await assertSucceeds(append.commit());
  await assertFails(updateDoc(doc(adminDb, movementPath('cash-collab')), { amount: 80 }));
  await assertFails(updateDoc(doc(adminDb, itemPath('areaExpenses', 'new-payment')), { area: 'Arte' }));

  let injectedConcurrentPayment = false;
  const raceRef = doc(adminDb, itemPath('areaExpenses', 'payment-race'));
  await assert.rejects(runTransaction(adminDb, async (transaction) => {
    const snapshot = await transaction.get(raceRef);
    if (snapshot.data().paymentLocked || snapshot.data().paymentHistory.length > 0) {
      throw new Error('PAID_EXPENSE_LOCKED');
    }
    if (!injectedConcurrentPayment) {
      injectedConcurrentPayment = true;
      await updateDoc(doc(collaboratorDb, itemPath('areaExpenses', 'payment-race')), {
        paymentHistory: [payment('race-payment', 30, { createdBy: collaboratorId, createdByEmail: collaboratorEmail })],
        paymentLocked: true, paymentAuthorIds: [collaboratorId], paid: false,
        updatedAt: serverTimestamp(),
      });
    }
    transaction.delete(raceRef);
  }), (error) => error?.message?.includes('PAID_EXPENSE_LOCKED') || error?.code === 'permission-denied');
  assert.equal((await getDoc(raceRef)).data().paymentHistory.length, 1);

  const oldFirst = payment('correction-1', 50, { cashMovementId: 'cash-correction' });
  const oldSecond = payment('correction-2', 20);
  const correctedFirst = { ...oldFirst, amount: 60 };
  const wrongAuditRef = doc(collection(adminDb, `projects/${projectId}/activityLog`));
  const wrongCorrection = writeBatch(adminDb);
  wrongCorrection.update(doc(adminDb, itemPath('areaExpenses', 'correction')), {
    paymentHistory: [correctedFirst, { ...oldSecond, amount: 25 }],
    lastFinancialAuditId: wrongAuditRef.id, updatedAt: serverTimestamp(),
  });
  wrongCorrection.update(doc(adminDb, movementPath('cash-correction')), { amount: 60 });
  wrongCorrection.set(wrongAuditRef, audit('payment_corrected', 'correction', oldFirst.id, 0, {
    cashMovementId: 'cash-correction', oldAmount: 50, amount: 60,
  }));
  await assertFails(wrongCorrection.commit());

  const reorder = writeBatch(adminDb);
  reorder.update(doc(adminDb, itemPath('areaExpenses', 'correction')), {
    paymentHistory: [oldSecond, oldFirst, payment('new-append', 10)],
    paymentLocked: true, paymentAuthorIds: [adminId, adminId, adminId], updatedAt: serverTimestamp(),
  });
  await assertFails(reorder.commit());

  const auditRef = doc(collection(adminDb, `projects/${projectId}/activityLog`));
  const correction = writeBatch(adminDb);
  correction.update(doc(adminDb, itemPath('areaExpenses', 'correction')), {
    paymentHistory: [correctedFirst, oldSecond], paid: false, paymentLocked: true,
    lastFinancialAuditId: auditRef.id, updatedAt: serverTimestamp(),
  });
  correction.update(doc(adminDb, movementPath('cash-correction')), { amount: 60 });
  correction.set(auditRef, audit('payment_corrected', 'correction', oldFirst.id, 0, {
    cashMovementId: 'cash-correction', oldAmount: 50, amount: 60,
  }));
  await assertSucceeds(correction.commit());
  const saved = await getDoc(doc(adminDb, itemPath('areaExpenses', 'correction')));
  assert.equal(saved.data().paymentHistory[0].amount, 60);
  assert.equal(saved.data().paymentHistory[1].amount, 20);

  const deleteAuditRef = doc(collection(adminDb, `projects/${projectId}/activityLog`));
  const deletion = writeBatch(adminDb);
  deletion.update(doc(adminDb, itemPath('areaExpenses', 'correction')), {
    paymentHistory: [oldSecond], paid: false, paymentLocked: true,
    lastFinancialAuditId: deleteAuditRef.id, updatedAt: serverTimestamp(),
  });
  deletion.delete(doc(adminDb, movementPath('cash-correction')));
  deletion.set(deleteAuditRef, audit('payment_deleted', 'correction', oldFirst.id, 0, {
    cashMovementId: 'cash-correction', amount: 60, deletedCashMovementCount: 1,
  }));
  await assertSucceeds(deletion.commit());
  await assertFails(updateDoc(doc(adminDb, itemPath('areaExpenses', 'correction')), { description: 'Repurposed' }));

  const orderedAppend = writeBatch(adminDb);
  orderedAppend.update(doc(adminDb, itemPath('areaExpenses', 'correction')), {
    paymentHistory: [oldSecond, payment('new-append', 10)],
    paymentLocked: true, paymentAuthorIds: [adminId, adminId, adminId], updatedAt: serverTimestamp(),
  });
  await assertSucceeds(orderedAppend.commit());

  await assertFails(setDoc(doc(adminDb, itemPath('budgetItems', 'unrevisioned-row')), baseExpense()));
  const budgetCreation = writeBatch(adminDb);
  budgetCreation.set(doc(adminDb, itemPath('budgetItems', 'revisioned-row')), baseExpense());
  budgetCreation.set(doc(adminDb, itemPath('budgetItems', 'revisioned-row-2')), baseExpense());
  budgetCreation.update(doc(adminDb, `projects/${projectId}`), { budgetRevision: 1 });
  await assertSucceeds(budgetCreation.commit());
  let injectedConcurrentCreation = false;
  await assert.rejects(runTransaction(adminDb, async (transaction) => {
    const projectRef = doc(adminDb, `projects/${projectId}`);
    const snapshot = await transaction.get(projectRef);
    if ((Number(snapshot.data().budgetRevision) || 0) !== 1) throw new Error('BUDGET_CHANGED');
    if (!injectedConcurrentCreation) {
      injectedConcurrentCreation = true;
      const concurrent = writeBatch(adminDb);
      concurrent.set(doc(adminDb, itemPath('budgetItems', 'concurrent-row')), baseExpense());
      concurrent.update(projectRef, { budgetRevision: 2 });
      await concurrent.commit();
    }
    transaction.update(projectRef, { activeAreas: ['Producción'] });
  }), /BUDGET_CHANGED/);
  assert.equal((await getDoc(doc(adminDb, `projects/${projectId}`))).data().activeAreas.length, 0);

  await assertFails(updateDoc(doc(adminDb, itemPath('budgetItems', 'move-row')), { area: 'Producción' }));
  const authorizedMove = writeBatch(adminDb);
  authorizedMove.update(doc(adminDb, itemPath('budgetItems', 'move-row')), { area: 'Producción' });
  authorizedMove.update(doc(adminDb, `projects/${projectId}`), { budgetRevision: 3 });
  await assertSucceeds(authorizedMove.commit());

  let injectedConcurrentMove = false;
  await assert.rejects(runTransaction(adminDb, async (transaction) => {
    const projectRef = doc(adminDb, `projects/${projectId}`);
    const snapshot = await transaction.get(projectRef);
    if ((Number(snapshot.data().budgetRevision) || 0) !== 3) throw new Error('BUDGET_CHANGED');
    if (!injectedConcurrentMove) {
      injectedConcurrentMove = true;
      const move = writeBatch(adminDb);
      move.update(doc(adminDb, itemPath('budgetItems', 'concurrent-move')), { area: 'Producción' });
      move.update(projectRef, { budgetRevision: 4 });
      await move.commit();
    }
    transaction.update(projectRef, { activeAreas: ['Producción'] });
  }), /BUDGET_CHANGED/);
  assert.equal((await getDoc(doc(adminDb, itemPath('budgetItems', 'concurrent-move')))).data().area, 'Producción');
  assert.equal((await getDoc(doc(adminDb, `projects/${projectId}`))).data().activeAreas.length, 0);

  await assertFails(deleteDoc(doc(adminDb, itemPath('budgetItems', 'delete-row'))));
  const authorizedDeletion = writeBatch(adminDb);
  authorizedDeletion.delete(doc(adminDb, itemPath('budgetItems', 'delete-row')));
  authorizedDeletion.update(doc(adminDb, `projects/${projectId}`), { budgetRevision: 5 });
  await assertSucceeds(authorizedDeletion.commit());

  await assertSucceeds(updateDoc(doc(adminDb, `projects/${projectId}`), { activeAreas: ['Producción'] }));
  const shadowCreation = writeBatch(adminDb);
  shadowCreation.set(doc(adminDb, itemPath('budgetItems', 'shadow-row')), baseExpense());
  shadowCreation.update(doc(adminDb, `projects/${projectId}`), { budgetRevision: 6 });
  await assertFails(shadowCreation.commit());

  console.log('Firestore emulator financial rules: expected allow and deny cases passed');
} finally {
  await testEnv.cleanup();
}
