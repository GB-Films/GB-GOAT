import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { saveCategoryBudget } from '../src/lib/categoryBudgetStore.ts';

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Local Firestore emulator required; never production.');
const projectId = 'demo-goat-category-budgets';
const env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
const ownerEmail = 'owner@example.test', producerEmail = 'producer@example.test', managerEmail = 'manager@example.test';
const owner = env.authenticatedContext('owner', { email: ownerEmail, email_verified: true }).firestore();
const producer = env.authenticatedContext('producer', { email: producerEmail, email_verified: true }).firestore();
const manager = env.authenticatedContext('manager', { email: managerEmail, email_verified: true }).firestore();
const ref = db => doc(db, 'projects', 'synthetic');
const paidExpense = { projectId: 'synthetic', area: 'Arte', providerId: 'fake', total: 70, paid: true,
  paymentHistory: [{ id: 'fake-payment', amount: 70, createdBy: 'owner' }] };
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/owner'), { email: ownerEmail, role: 'admin' });
    await setDoc(doc(db, 'users/producer'), { email: producerEmail, role: 'colaborador' });
    await setDoc(doc(db, 'users/manager'), { email: managerEmail, role: 'colaborador' });
    await setDoc(ref(db), { createdBy: 'owner', categories: ['Arte', 'Vestuario'], executiveCategoryDefaultApplied: true,
      activeAreas: ['Arte'], collaboratorEmails: [producerEmail, managerEmail], budgetRevision: 0 });
    await setDoc(doc(db, 'projects/synthetic/collaborators', producerEmail), { uid: 'producer', email: producerEmail,
      role: 'jefe_produccion', allowedTabs: ['areas'], allowedCategories: ['Arte'], canEditBudgetAreas: true });
    await setDoc(doc(db, 'projects/synthetic/collaborators', managerEmail), { uid: 'manager', email: managerEmail,
      role: 'admin', allowedTabs: ['presupuesto', 'areas'], allowedCategories: [] });
    await setDoc(doc(db, 'projects/synthetic/areaExpenses/paid'), paidExpense);
    await setDoc(doc(db, 'projects/synthetic/budgetItems/legacy'), { area: 'Vestuario', total: 350 });
  });

  await saveCategoryBudget(owner, 'synthetic', { area: 'Arte', create: false, amount: 500, expectedAmount: null }, ownerEmail);
  let state = (await getDoc(ref(owner))).data();
  assert.deepEqual(state.activeAreas, ['Arte']);
  assert.equal(state.categoryBudgets.Arte, 500);
  assert.equal(state.budgetRevision, 1);
  assert.equal((await getDocs(collection(owner, 'projects/synthetic/budgetItems'))).size, 1, 'no fake budget row');
  assert.deepEqual((await getDoc(doc(owner, 'projects/synthetic/areaExpenses/paid'))).data(), paidExpense, 'paid expenses untouched');
  await saveCategoryBudget(owner, 'synthetic', { area: 'Sonido', create: true, amount: 120, expectedAmount: null }, ownerEmail);
  state = (await getDoc(ref(owner))).data();
  assert.equal(state.categoryBudgets.Arte, 500);
  assert.equal(state.categoryBudgets.Sonido, 120);
  assert.ok(state.categories.includes('Sonido'));
  console.log('PASS owner: active empty category and new category accept budgets without expenses or payments');

  await updateDoc(ref(producer), { areaExpenseSubcategoryBudgets: { 'Arte||Utilería': { area: 'Arte', budget: 200, budgetAssigned: true } } });
  await assertFails(updateDoc(ref(producer), { categoryBudgets: { Arte: 9000 } }));
  await assertFails(saveCategoryBudget(producer, 'synthetic', { area: 'Arte', create: false, amount: 9000, expectedAmount: 500 }, producerEmail));
  await assertFails(saveCategoryBudget(env.unauthenticatedContext().firestore(), 'synthetic', { area: 'Arte', create: false, amount: 9000, expectedAmount: 500 }, ''));
  console.log('PASS permissions: delegated subcategory manager and anonymous account cannot assign main-category budgets');

  await assert.rejects(saveCategoryBudget(owner, 'synthetic', { area: 'Arte', create: false, amount: 199.99, expectedAmount: 500 }, ownerEmail), /subcategorías/);
  await assert.rejects(saveCategoryBudget(owner, 'synthetic', { area: 'Arte', create: false, amount: null, expectedAmount: 500 }, ownerEmail), /subcategorías/);
  assert.equal((await getDoc(ref(owner))).data().categoryBudgets.Arte, 500, 'invalid changes are atomic');
  const attempts = await Promise.allSettled([600, 700].map(amount => saveCategoryBudget(owner, 'synthetic', { area: 'Arte', create: false, amount, expectedAmount: 500 }, ownerEmail)));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(result => result.status === 'rejected').length, 1, 'stale modal does not overwrite another allocation');
  assert.match(attempts.find(result => result.status === 'rejected').reason.message, /presupuesto cambió/);
  state = (await getDoc(ref(owner))).data();
  assert.ok([600, 700].includes(state.categoryBudgets.Arte));
  assert.equal(state.categoryBudgets.Sonido, 120);
  console.log('PASS limits and concurrency: allocated subcategories preserved; exactly one stale competing edit succeeds');

  await saveCategoryBudget(owner, 'synthetic', { area: 'Vestuario', create: false, amount: 900, expectedAmount: null }, ownerEmail);
  await saveCategoryBudget(owner, 'synthetic', { area: 'Vestuario', create: false, amount: null, expectedAmount: 900 }, ownerEmail);
  state = (await getDoc(ref(owner))).data();
  assert.equal(Object.hasOwn(state.categoryBudgets, 'Vestuario'), false);
  assert.equal((await getDoc(doc(owner, 'projects/synthetic/budgetItems/legacy'))).data().total, 350);
  await saveCategoryBudget(manager, 'synthetic', { area: 'Sonido', create: false, amount: 0, expectedAmount: 120 }, managerEmail);
  assert.equal((await getDoc(ref(owner))).data().categoryBudgets.Sonido, 0);
  assert.equal((await getDoc(ref(owner))).data().categoryBudgetUpdatedByEmail, managerEmail);
  assert.deepEqual((await getDoc(doc(owner, 'projects/synthetic/areaExpenses/paid'))).data(), paidExpense);
  console.log('PASS project administrator, legacy and zero: delegated admin can assign; removing allocation retains item amounts; explicit zero remains an assignment');
} finally { await env.cleanup(); }
