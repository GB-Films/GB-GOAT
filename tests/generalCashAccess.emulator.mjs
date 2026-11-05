import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp, query, where } from 'firebase/firestore';
import { readProjectCashMovements, personalCashRefreshQueries } from '../src/lib/projectCashQueries.ts';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const { createProviderFinanceHandler } = require('../functions/providerFinance');
const { paymentCorrectionSnapshot } = require('../functions/paymentCorrectionSnapshot');
const projectId = 'demo-goat-general-cash';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Local emulator required');
const env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
const app = admin.initializeApp({ projectId }, 'general-cash-access');
const store = app.firestore();
const root = 'projects/scope';
const people = { tomas: 'tomas@granberta.com', agustin: 'agustin@granberta.com', guido: 'guido@bani-vfx.com', admin: 'admin@example.test', owner: 'info@granbertafilms.com', personal: 'personal@example.test' };
const db = uid => env.authenticatedContext(uid, { email_verified: true, email: people[uid] }).firestore();
const ledger = uid => collection(db(uid), root, 'cashMovements');
const movement = (uid, fields = {}) => ({ type: 'entrega', cashAccount: 'general', status: 'pending', amount: 100, date: new Date(),
  createdBy: uid, createdByEmail: people[uid], toUserId: 'personal', toUserEmail: people.personal, toUserName: 'Responsable', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...fields });
const call = createProviderFinanceHandler({ db: store, timestamp: () => admin.firestore.FieldValue.serverTimestamp() });
const request = (uid, data, verified = true) => ({ auth: { uid, token: { email: people[uid], email_verified: verified } }, data });
try {
  for (const [uid, email] of Object.entries(people)) await store.doc(`users/${uid}`).set({ email, role: ['admin', 'owner'].includes(uid) ? 'admin' : 'colaborador' });
  await store.doc(root).set({ createdBy: 'owner', createdByEmail: people.owner, activeAreas: ['Arte'], collaboratorEmails: Object.values(people) });
  for (const [uid, email] of Object.entries(people)) await store.doc(`${root}/collaborators/${email}`).set({ uid, email, role: uid === 'personal' ? 'jefe_area' : 'admin', allowedTabs: ['areas', 'cajas'], allowedCategories: ['Arte'], canEditBudgetAreas: true });
  await store.doc(`${root}/cashMovements/private-general`).set({ type: 'pago', cashAccount: 'general', fromUserEmail: people.tomas, amount: 987, collectionName: 'areaExpenses', itemId: 'linked', date: new Date() });
  await store.doc(`${root}/cashMovements/personal-legacy`).set({ type: 'pago', fromUserEmail: people.admin, amount: 7, date: new Date() });
  await store.doc(`${root}/cashMovements/personal-delivery`).set({ type: 'entrega', toUserEmail: people.admin, fromUserEmail: people.tomas, amount: 50, status: 'confirmed', date: new Date() });
  for (const uid of ['tomas', 'agustin', 'guido']) {
    await assertSucceeds(getDocs(ledger(uid)));
    const ref = doc(db(uid), root, 'cashMovements', `delivery-${uid}`);
    await assertSucceeds(setDoc(ref, movement(uid)));
    await assertSucceeds(updateDoc(ref, { amount: 110, updatedAt: serverTimestamp() }));
    await assertSucceeds(deleteDoc(ref));
  }
  for (const uid of ['admin', 'owner', 'personal']) {
    await assertFails(getDocs(ledger(uid)));
    await assertFails(getDocs(query(ledger(uid), where('cashAccount', '==', 'general'))));
    await assertFails(getDoc(doc(db(uid), root, 'cashMovements', 'private-general')));
    await assertFails(setDoc(doc(db(uid), root, 'cashMovements', `denied-${uid}`), movement(uid)));
  }
  for (const uid of ['admin', 'owner']) {
    const path = `${root}/areaExpenses/sdk-${uid}`;
    await store.doc(path).set({ area: 'Arte', subcategory: '', total: 100, paymentHistory: [], paymentAuthorIds: [], paymentLocked: false });
    const payment = { id: 'sdk-payment', amount: 10, method: 'otro', createdBy: uid, createdByEmail: people[uid] };
    const change = { paymentHistory: [{ ...payment, cashAccount: 'general' }], paymentAuthorIds: [uid], paymentLocked: true };
    await assertFails(updateDoc(doc(db(uid), path), change));
    await assertSucceeds(updateDoc(doc(db(uid), path), { ...change, paymentHistory: [payment] }));
  }
  await store.doc(`${root}/cashMovements/old-own-general`).set({ type: 'pago', cashAccount: 'general', fromUserEmail: people.admin, amount: 777 });
  await store.doc(`${root}/cashMovements/old-sent-general`).set({ type: 'entrega', cashAccount: 'general', fromUserEmail: people.admin, toUserEmail: people.personal, amount: 888 });
  await store.doc(`${root}/cashMovements/old-received-general`).set({ type: 'devolucion', cashAccount: 'general', fromUserEmail: people.personal, toUserEmail: people.admin, amount: 999, status: 'pending', date: new Date() });
  for (const name of ['old-own-general', 'old-sent-general', 'old-received-general']) await assertFails(getDoc(doc(db('admin'), root, 'cashMovements', name)));
  await assertFails(updateDoc(doc(db('admin'), root, 'cashMovements', 'old-received-general'), { status: 'confirmed', confirmedBy: 'admin', confirmedByEmail: people.admin, confirmedByName: 'Admin', confirmedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  const personalReader = async projectId => (await call(request('admin', { action: 'personalCashMovements', projectId, email: people.tomas }))).movements;
  const own = await readProjectCashMovements(db('admin'), 'scope', people.admin, personalReader);
  for (const q of personalCashRefreshQueries(db('admin'), 'scope', people.admin)) await assertSucceeds(getDocs(q));
  await assertSucceeds(getDoc(doc(db('admin'), root, 'cashMovements', 'personal-legacy')));
  await assert.rejects(call(request('admin', { action: 'personalCashMovements', projectId: 'scope' }, false)), /Verificá/);
  assert.deepEqual(own.map(row => row.id).sort(), ['personal-delivery', 'personal-legacy']);
  const deliveryRef = doc(db('admin'), root, 'cashMovements', 'personal-delivery');
  await assertSucceeds(getDoc(deliveryRef));
  const pendingRef = doc(db('admin'), root, 'cashMovements', 'pending-own');
  await store.doc(pendingRef.path).set({ ...movement('tomas'), toUserEmail: people.admin, toUserId: 'admin', createdAt: new Date(), updatedAt: new Date() });
  await assertSucceeds(updateDoc(pendingRef, { status: 'confirmed', confirmedBy: 'admin', confirmedByEmail: people.admin, confirmedByName: 'Admin', confirmedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db('admin'), root, 'cashMovements', 'private-general'), { amount: 1 }));
  await assertFails(deleteDoc(doc(db('admin'), root, 'cashMovements', 'private-general')));
  const returnFields = { type: 'devolucion', amount: 20, fromUserEmail: people.admin, fromUserName: 'Admin', toUserEmail: people.tomas, toUserId: 'tomas', toUserName: 'Tomas', notes: '', createdByName: 'Admin' };
  await assertSucceeds(setDoc(doc(db('admin'), root, 'cashMovements', 'own-return'), movement('admin', returnFields)));
  await assertSucceeds(updateDoc(doc(db('tomas'), root, 'cashMovements', 'own-return'), { status: 'confirmed', confirmedBy: 'tomas', confirmedByEmail: people.tomas, confirmedByName: 'Tomas', confirmedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db('admin'), root, 'cashMovements', 'wrong-return'), movement('admin', { ...returnFields, toUserEmail: people.owner, toUserId: 'owner' })));
  const unverified = env.authenticatedContext('tomas', { email: people.tomas, email_verified: false }).firestore();
  await assertFails(getDocs(collection(unverified, root, 'cashMovements')));
  await store.doc('projects/foreign').set({ createdBy: 'someone', collaboratorEmails: [] });
  await assertFails(getDocs(collection(db('guido'), 'projects/foreign/cashMovements')));
  await assert.rejects(call(request('personal', { action: 'personalCashMovements', projectId: 'foreign' })), /acceso/);
  const check = await call(request('admin', { action: 'checkCashLinks', projectId: 'scope', collectionName: 'areaExpenses', itemIds: ['linked'] }));
  assert.deepEqual(check, { hasLinkedCash: true });
  assert.deepEqual(await call(request('admin', { action: 'checkCashLinks', projectId: 'scope', checkAnyCash: true })), { hasLinkedCash: true });
  await assert.rejects(call(request('personal', { action: 'checkCashLinks', projectId: 'scope', checkAnyCash: true })), /Sólo administración/);
  const input = { action: 'create', id: 'cash-denied', kind: 'payment', providerId: 'supplier', method: 'cash', account: 'CTA003', reference: 'test-cash', date: '2026-11-05', net: 10, total: 10, payeeName: 'Proveedor ficticio', cashProjectId: 'scope', allocations: [{ projectId: 'scope', collectionName: 'areaExpenses', itemId: 'work', amount: 10 }] };
  await assert.rejects(call(request('admin', input)), /Caja General/);
  await assert.rejects(call(request('owner', input)), /Caja General/);
  await store.doc('users/tomas').update({ role: 'admin' });
  await assert.rejects(call(request('tomas', input, false)), /Caja General/);
  await store.doc('providerFinancialRecords/old-cash').set({ kind: 'payment', method: 'cash', status: 'active' });
  await assert.rejects(call(request('admin', { action: 'cancel', id: 'old-cash', reason: 'No autorizado' })), /Caja General/);
  const payment = { id: 'own', amount: 20, date: '2026-11-05', detail: 'Ficticio', method: 'caja_efectivo', cashAccount: 'general', cashMovementId: 'owned-general', paidByEmail: people.admin, createdBy: 'admin', createdByEmail: people.admin };
  await store.doc(`${root}/areaExpenses/work`).set({ providerId: 'supplier', area: 'Arte', subcategory: '', total: 100, paymentHistory: [payment] });
  await assert.rejects(call(request('admin', { action: 'correctOwnPayment', projectId: 'scope', collectionName: 'areaExpenses', itemId: 'work', paymentId: 'own', attemptId: 'denied', expected: paymentCorrectionSnapshot(payment), amount: 25, date: '2026-11-05', detail: '' })), /Caja General/);
  assert.equal((await store.doc('providerFinancialRecords/cash-denied').get()).exists, false);
  console.log('PASS General cash: three accounts only; admin/owner bypasses denied; scoped legacy personal queries, receipts, returns and non-disclosing preflight preserved; callable cash mutations denied.');
} finally { await env.cleanup(); await app.delete(); }
