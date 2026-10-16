import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

const env = await initializeTestEnvironment({ projectId: 'demo-gb-goat-commercial', firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const database = uid => env.authenticatedContext(uid, { email: `${uid}@example.test` }).firestore();
const admin = database('admin'), owner = database('owner'), manager = database('manager');
const lead = database('lead'), outsider = database('outsider'), anonymous = env.unauthenticatedContext().firestore();
const path = 'projectCommercial/private-project';
const valid = extra => ({ schemaVersion: 1, budgetTotal: 100, clientName: 'Synthetic client', updatedAt: serverTimestamp(), ...extra });
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const uid of ['admin', 'owner', 'manager', 'lead', 'outsider']) await setDoc(doc(db, `users/${uid}`), { role: uid === 'admin' ? 'admin' : 'colaborador', email: `${uid}@example.test` });
    await setDoc(doc(db, 'projects/private-project'), { name: 'Synthetic', createdBy: 'owner', collaboratorEmails: ['manager@example.test', 'lead@example.test'], commercialDataVersion: 1 });
    for (const [uid, role] of [['manager', 'admin'], ['lead', 'jefe_produccion']]) await setDoc(doc(db, `projects/private-project/collaborators/${uid}@example.test`), { uid, email: `${uid}@example.test`, role, canViewBudgetTotals: true, allowedTabs: ['summary'], allowedCategories: [] });
    await setDoc(doc(db, path), { schemaVersion: 1, budgetTotal: 100 });
  });
  for (const db of [admin, owner, manager]) {
    assert.equal((await assertSucceeds(getDoc(doc(db, path)))).data().budgetTotal, 100);
    await assertSucceeds(setDoc(doc(db, path), valid()));
  }
  for (const db of [lead, outsider, anonymous]) {
    await assertFails(getDoc(doc(db, path)));
    await assertFails(setDoc(doc(db, path), valid()));
    await assertFails(deleteDoc(doc(db, path)));
  }
  assert.equal((await assertSucceeds(getDoc(doc(lead, 'projects/private-project')))).data().budgetTotal, undefined);
  await assertSucceeds(getDocs(collection(admin, 'projectCommercial')));
  for (const db of [owner, manager, lead, outsider, anonymous]) await assertFails(getDocs(collection(db, 'projectCommercial')));
  for (const extra of [{ budgetTotal: -1 }, { budgetTotal: NaN }, { budgetTotal: Infinity }, { budgetTotal: 1e16 }, { budgetTotal: '100' }, { role: 'admin' }, { clientName: 'x'.repeat(501) }, { controlTotalUrl: 'javascript:alert(1)' }, { controlTotalContractCurrency: 'EUR' }, { controlTotalSourceRowAtImport: 1.5 }, { controlTotalImportedAt: 'now' }, { updatedAt: null }, { schemaVersion: 2 }]) await assertFails(setDoc(doc(admin, path), valid(extra)));
  await assertFails(setDoc(doc(admin, path), { budgetTotal: 100 }));
  await assertFails(setDoc(doc(admin, 'projectCommercial/orphan'), valid()));
  await assertFails(deleteDoc(doc(owner, path)));
  await assertFails(deleteDoc(doc(manager, path)));
  await assertFails(updateDoc(doc(admin, 'projects/private-project'), { budgetTotal: 10 }));
  await assertFails(updateDoc(doc(manager, 'projects/private-project'), { clientName: 'Leaked' }));
  await assertSucceeds(updateDoc(doc(manager, 'projects/private-project'), { name: 'Updated synthetic' }));
  await assertFails(setDoc(doc(admin, 'projects/unsafe-new'), { createdBy: 'admin', budgetTotal: 10 }));
  const batch = writeBatch(admin);
  batch.set(doc(admin, 'projects/safe-new'), { createdBy: 'admin', name: 'Synthetic new', collaboratorEmails: [], commercialDataVersion: 1 });
  batch.set(doc(admin, 'projectCommercial/safe-new'), valid());
  await assertSucceeds(batch.commit());
  await assertSucceeds(deleteDoc(doc(admin, path)));
  console.log('Commercial privacy: authorized reads/writes, forbidden role/list access, schema limits, root reinsertion and atomic creation verified.');
} finally { await env.cleanup(); }
