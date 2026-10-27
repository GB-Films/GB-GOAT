import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
const env = await initializeTestEnvironment({ projectId: process.env.GCLOUD_PROJECT, firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const db = uid => env.authenticatedContext(uid, { email_verified: true, email: `${uid}@example.test` }).firestore();
const admin = db('admin'), other = db('other'), recipient = db('recipient');
const lead = db('lead');
const base = 'projects/rules-cash';
const delivery = { type: 'entrega', cashAccount: 'general', status: 'pending', amount: 100, date: new Date(), toUserId: 'admin', toUserEmail: 'admin@example.test', toUserName: 'Admin', createdBy: 'other', createdByEmail: 'other@example.test', createdByName: 'Other', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
try {
  await env.withSecurityRulesDisabled(async ctx => {
    const store = ctx.firestore();
    for (const uid of ['admin', 'other', 'recipient', 'lead']) await setDoc(doc(store, `users/${uid}`), { email: `${uid}@example.test`, role: ['recipient', 'lead'].includes(uid) ? 'colaborador' : 'admin' });
    await setDoc(doc(store, base), { createdBy: 'other', collaboratorEmails: ['recipient@example.test'], generalCashDeliveryBlockedEmails: ['admin@example.test'] });
    await setDoc(doc(store, `${base}/collaborators/recipient@example.test`), { uid: 'recipient', email: 'recipient@example.test', role: 'jefe_area', allowedCategories: ['Arte'], allowedTabs: ['cajas'] });
    await setDoc(doc(store, `${base}/collaborators/lead@example.test`), { uid: 'lead', email: 'lead@example.test', role: 'jefe_produccion', allowedCategories: ['Arte'], allowedTabs: ['cajas'] });
    await setDoc(doc(store, 'projects/other-cash-project'), { createdBy: 'other', collaboratorEmails: [] });
    await setDoc(doc(store, `${base}/cashMovements/subdelivery`), { type: 'transferencia', cashAccount: 'personal', subdelivery: true, amount: 30, fromUserEmail: 'admin@example.test', toUserEmail: 'recipient@example.test', date: new Date() });
  });
  await assertSucceeds(setDoc(doc(other, `${base}/cashMovements/general`), delivery));
  await assertSucceeds(setDoc(doc(admin, 'projects/other-cash-project/cashMovements/allowed-general'), { ...delivery, createdBy: 'admin', createdByEmail: 'admin@example.test' }));
  await assertFails(setDoc(doc(lead, `${base}/cashMovements/old-direct-transfer`), { ...delivery, type: 'transferencia', cashAccount: 'personal', fromUserEmail: 'lead@example.test', toUserEmail: 'recipient@example.test', createdBy: 'lead', createdByEmail: 'lead@example.test' }));
  const upperCaseAdmin = env.authenticatedContext('admin', { email_verified: true, email: 'ADMIN@example.test' }).firestore();
  await assertFails(setDoc(doc(upperCaseAdmin, `${base}/cashMovements/uppercase-bypass`), { ...delivery, createdBy: 'admin', createdByEmail: 'ADMIN@example.test' }));
  await assertFails(setDoc(doc(admin, `${base}/cashMovements/forbidden-general`), { ...delivery, createdBy: 'admin', createdByEmail: 'admin@example.test' }));
  await assertFails(setDoc(doc(admin, `${base}/cashMovements/forged-personal`), { ...delivery, cashAccount: 'personal', createdBy: 'admin', createdByEmail: 'admin@example.test' }));
  await assertFails(setDoc(doc(admin, `${base}/cashMovements/forged-transfer`), { ...delivery, type: 'transferencia', cashAccount: 'personal', fromUserEmail: 'admin@example.test', subdelivery: true, createdBy: 'admin', createdByEmail: 'admin@example.test' }));
  for (const store of [admin, other, recipient]) {
    await assertFails(updateDoc(doc(store, base), { generalCashDeliveryBlockedEmails: [] }));
    await assertFails(updateDoc(doc(store, base), { cashSubdeliveryRevision: 50 }));
    await assertFails(updateDoc(doc(store, `${base}/cashMovements/subdelivery`), { amount: 1, updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(store, `${base}/cashMovements/subdelivery`)));
  }
  await assertFails(setDoc(doc(other, 'projects/new-with-policy'), { createdBy: 'other', generalCashDeliveryBlockedEmails: [] }));
  await assertFails(updateDoc(doc(admin, `${base}/cashMovements/general`), { amount: 1, updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(admin, `${base}/cashMovements/general`)));
  await assertSucceeds(updateDoc(doc(admin, `${base}/cashMovements/general`), { status: 'confirmed', confirmedBy: 'admin', confirmedByEmail: 'admin@example.test', confirmedByName: 'Admin', confirmedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  assert.equal((await getDoc(doc(admin, `${base}/cashMovements/general`))).data().status, 'confirmed');
  console.log('Rules: scoped General delivery restriction, policy/counter lockdown, forged-source denial, immutable subdelivery and recipient confirmation passed.');
} finally { await env.cleanup(); }
