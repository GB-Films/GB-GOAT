import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';

const env = await initializeTestEnvironment({ projectId: 'demo-gb-goat-administration', firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const database = uid => env.authenticatedContext(uid, { email: `${uid}@example.test` }).firestore();
const admin = database('admin');
const owner = database('owner');
const manager = database('manager');
const outsider = database('outsider');
const path = 'projectAdministration/private-project';
const valid = (revision, extra = {}) => ({
  schemaVersion: 1, projectId: 'private-project', clientLegalName: 'Cliente SA', issuerEntity: 'Gran Berta SRL',
  agreementStatus: 'pending', agreementRef: '', orderStatus: 'pending', orderNumber: '', orderRef: '',
  agreedAmount: null, agreedCurrency: '',
  billingStatus: 'pending', billingRequirement: '', billingChannel: '', portalRef: '',
  paymentTermDays: null, paymentTermBasis: '', paymentTermSource: '', notes: '',
  invoices: [], collections: [], updatedBy: 'admin@example.test', updatedAt: serverTimestamp(), revision, ...extra,
});

try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const uid of ['admin', 'owner', 'manager', 'outsider']) await setDoc(doc(db, `users/${uid}`), { role: uid === 'admin' ? 'admin' : 'colaborador', email: `${uid}@example.test` });
    await setDoc(doc(db, 'projects/private-project'), { name: 'Synthetic', createdBy: 'owner', collaboratorEmails: ['manager@example.test'] });
    await setDoc(doc(db, 'projects/private-project/collaborators/manager@example.test'), { uid: 'manager', email: 'manager@example.test', role: 'admin' });
  });
  await assertSucceeds(setDoc(doc(admin, path), valid(1)));
  await assertSucceeds(getDoc(doc(admin, path)));
  await assertSucceeds(getDocs(collection(admin, 'projectAdministration')));
  for (const db of [owner, manager, outsider]) {
    await assertFails(getDoc(doc(db, path)));
    await assertFails(getDocs(collection(db, 'projectAdministration')));
    await assertFails(setDoc(doc(db, path), valid(2)));
    await assertFails(deleteDoc(doc(db, path)));
  }
  await assertFails(setDoc(doc(admin, path), valid(1)));
  await assertFails(setDoc(doc(admin, path), valid(2, { projectId: 'other-project' })));
  await assertFails(setDoc(doc(admin, path), valid(2, { updatedBy: 'owner@example.test' })));
  await assertFails(setDoc(doc(admin, path), valid(2, { paymentTermDays: -1 })));
  await assertFails(setDoc(doc(admin, path), valid(2, { agreedAmount: 100, agreedCurrency: '' })));
  await assertFails(setDoc(doc(admin, path), valid(2, { invoices: Array(101).fill({}) })));
  await assertSucceeds(setDoc(doc(admin, path), valid(2)));
  assert.equal((await assertSucceeds(getDoc(doc(admin, path)))).data().revision, 2);
  await assertFails(setDoc(doc(admin, 'projectAdministration/missing-project'), valid(1, { projectId: 'missing-project' })));
  console.log('Project administration stays private to app admins, validates schema and rejects stale revisions.');
} finally { await env.cleanup(); }
