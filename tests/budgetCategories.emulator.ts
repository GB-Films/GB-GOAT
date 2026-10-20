import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDocFromServer, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
import { categoryDeletionPlan, resolveBudgetCategories, DEFAULT_BUDGET_CATEGORIES } from '../src/lib/budgetCategories';

const env = await initializeTestEnvironment({ projectId: 'demo-goat-category-deletion', firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const admin = env.authenticatedContext('admin', { email: 'admin@example.test' }).firestore();
const lead = env.authenticatedContext('lead', { email: 'lead@example.test' }).firestore();
const projectPath = 'projects/raid-fixture';
const collaboratorPath = `${projectPath}/collaborators/lead@example.test`;
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/admin'), { role: 'admin' });
    await setDoc(doc(db, 'users/lead'), { role: 'colaborador' });
    await setDoc(doc(db, projectPath), { createdBy: 'admin', categories: [], activeAreas: ['Producción'], collaboratorEmails: ['lead@example.test'] });
    await setDoc(doc(db, collaboratorPath), { uid: 'lead', email: 'lead@example.test', role: 'jefe_area', allowedCategories: ['Arte', 'Producción'], allowedSubcategories: ['Arte||Pintura'], allowedTabs: ['areas'] });
    await setDoc(doc(db, `${projectPath}/budgetItems/production`), { area: 'Producción', total: 100, paymentHistory: [{ id: 'keep', amount: 100 }], paid: true });
  });
  const originalRow = (await getDocFromServer(doc(admin, `${projectPath}/budgetItems/production`))).data();
  await assertSucceeds(runTransaction(admin, async transaction => {
    const root = await transaction.get(doc(admin, projectPath));
    const collaborator = await transaction.get(doc(admin, collaboratorPath));
    const plan = categoryDeletionPlan(root.data()!, 'Arte');
    transaction.update(root.ref, { ...plan, updatedAt: serverTimestamp() });
    transaction.update(collaborator.ref, { allowedCategories: collaborator.data()!.allowedCategories.filter((area: string) => area !== 'Arte'), allowedSubcategories: [], updatedAt: serverTimestamp() });
  }));
  const reloaded = (await getDocFromServer(doc(admin, projectPath))).data()!;
  assert.deepEqual(resolveBudgetCategories(reloaded), DEFAULT_BUDGET_CATEGORIES.filter(area => area !== 'Arte'));
  assert.deepEqual((await getDocFromServer(doc(admin, collaboratorPath))).data()!.allowedCategories, ['Producción']);
  assert.deepEqual((await getDocFromServer(doc(admin, `${projectPath}/budgetItems/production`))).data(), originalRow);
  await assertFails(runTransaction(lead, async transaction => {
    const snapshot = await transaction.get(doc(lead, projectPath));
    transaction.update(snapshot.ref, categoryDeletionPlan(snapshot.data()!, 'Dirección'));
  }));
  assert.deepEqual((await getDocFromServer(doc(admin, projectPath))).data(), reloaded);
  console.log('Category deletion: Raid legacy shape, reload persistence, atomic collaborator cleanup, unchanged paid row and rejected edit rollback passed.');
} finally { await env.cleanup(); }
