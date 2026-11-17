import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, updateDoc } from 'firebase/firestore';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const { createProviderPortalHandler } = require('../functions/providerPortal');
const { createProviderPortalAdminHandler } = require('../functions/providerPortalAdmin');
const { hash } = require('../functions/providerPortalModel');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Local Firestore emulator required; production forbidden.');
const projectId = 'demo-goat-person-access';
const env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
const app = admin.initializeApp({ projectId }, 'personal-access-test'), db = app.firestore();
const timestamp = () => admin.firestore.FieldValue.serverTimestamp();
const accounts = new Map(['own', 'second', 'admin', 'other', 'producer'].map(uid => [uid, { uid, email: `${uid}@example.test`, emailVerified: true, disabled: false, providerData: [{ providerId: 'google.com' }] }]));
const deps = { db, timestamp, findAccount: async email => [...accounts.values()].find(account => account.email === email), findAccountByUid: async uid => accounts.get(uid), sign: { list: async () => [] } };
const portal = createProviderPortalHandler(deps), manage = createProviderPortalAdminHandler(deps);
const request = (uid, data, token = {}) => ({ auth: { uid, token: { email: `${uid}@example.test`, email_verified: true, firebase: { sign_in_provider: 'google.com' }, ...token } }, data });
const own = data => portal(request('own', data));
const asAdmin = data => manage(request('admin', data));
try {
  await db.doc('providerPortalConfig/current').set({ enabled: true });
  await db.doc('users/admin').set({ uid: 'admin', email: 'admin@example.test', role: 'admin' });
  await db.doc('users/producer').set({ uid: 'producer', email: 'producer@example.test', role: 'colaborador' });
  await db.doc('projects/film').set({ name: 'Ficticio', activeAreas: ['Arte'] });
  const legacy = { name: 'Persona antigua ficticia', email: 'contact@example.test', source: 'manual', bankAccount_cbu: 'invalid-bank', bankAccount_alias: '' };
  const expense = { providerId: 'ambiguous', area: 'Arte', total: 100, paid: false, paymentHistory: [{ id: 'paid', amount: 25, createdBy: 'producer' }] };
  await db.doc('providers/ambiguous').set(legacy);
  const memberRef = db.doc('providerPortalUsers/own/memberships/ambiguous');
  const membership = { providerId: 'ambiguous', email: 'own@example.test', status: 'needs_confirmation', assignedBy: { uid: 'admin' } };
  await memberRef.set(membership);
  await db.doc('projects/film/areaExpenses/work').set(expense);
  await db.doc('projects/film/areaExpenses/foreign').set({ ...expense, providerId: 'foreign' });
  let boot = await own({ action: 'bootstrap', includeDocuments: false });
  assert.equal(boot.memberships[0].needsClassification, true); assert.equal(boot.memberships[0].status, 'needs_confirmation');
  await assert.rejects(own({ action: 'overview', providerId: 'ambiguous' }), error => error.code === 'permission-denied');
  assert.deepEqual((await db.doc('providers/ambiguous').get()).data(), legacy);
  const command = { operationKey: 'fictitious-admin-classification', providerId: 'ambiguous', email: 'own@example.test', confirmPersonal: true };
  const preview = await asAdmin({ action: 'personalClassificationPreview', ...command });
  assert.equal(preview.outcome, 'preview'); assert.deepEqual((await memberRef.get()).data(), membership);
  await assert.rejects(manage(request('producer', { action: 'personalClassificationPreview', ...command })), error => error.code === 'permission-denied');
  const result = await asAdmin({ action: 'classifyPersonalProvider', ...command, expectedVersion: preview.expectedVersion, expectedPreservationHash: preview.expectedPreservationHash });
  assert.equal(result.verification, 'passed');
  assert.deepEqual((await memberRef.get()).data(), membership, 'admin classification never forces active');
  boot = await own({ action: 'bootstrap', includeDocuments: false });
  assert.equal(boot.memberships[0].status, 'active');
  let overview = await own({ action: 'overview', providerId: 'ambiguous' });
  assert.equal(overview.works.length, 1); assert.equal(overview.works[0].payments[0].amount, 25);
  assert.equal(overview.profileReview.required, true); assert.equal(overview.profileReview.registrationPending, true);
  assert(overview.profileReview.fields.some(field => field.field === 'bankAccount_cbu'));
  assert.equal(overview.provider.bankAccount_cbu, legacy.bankAccount_cbu);
  assert.equal((await db.doc('providers/ambiguous').get()).data().registration, undefined);
  assert.deepEqual((await db.doc('projects/film/areaExpenses/work').get()).data(), expense);
  assert.equal((await db.doc('users/own').get()).exists, false);
  // A different legacy with a trusted explicit personal association can already
  // consult its own work; missing type remains a review state, never an intake.
  await db.doc('providers/second-legacy').set(legacy);
  await db.doc('providerPortalUsers/second/memberships/second-legacy').set({ providerId: 'second-legacy', email: 'second@example.test', status: 'needs_confirmation', representation: 'own' });
  await db.doc('projects/film/areaExpenses/second-work').set({ ...expense, providerId: 'second-legacy' });
  const second = data => portal(request('second', data));
  assert.equal((await second({ action: 'bootstrap', includeDocuments: false })).memberships[0].status, 'active');
  overview = await second({ action: 'overview', providerId: 'second-legacy' });
  assert.equal(overview.works.length, 1); assert.equal(overview.profileReview.required, true); assert.equal(overview.profileReview.classificationPending, true);
  assert.deepEqual((await db.doc('providers/second-legacy').get()).data(), legacy);
  // No provider account becomes a collaborator or gains direct expense writes.
  const ownSdk = env.authenticatedContext('second', { email: 'second@example.test', email_verified: true }).firestore();
  await assertFails(updateDoc(doc(ownSdk, 'projects/film/areaExpenses/second-work'), { total: 1 }));
  await assertFails(updateDoc(doc(ownSdk, 'providers/second-legacy'), { registration: { status: 'complete' } }));
  for (const [suffix, providerPatch, memberPatch, company] of [
    ['company', { type: 'empresa', businessName: 'Empresa ficticia' }, {}, false],
    ['business', { businessName: 'Empresa ficticia' }, {}, false],
    ['approval', {}, {}, true],
    ['revoked', {}, { status: 'revoked' }, false],
    ['suspended', {}, { status: 'suspended' }, false],
    ['email', {}, { email: 'foreign@example.test' }, false],
  ]) {
    const providerId = `blocked-${suffix}`;
    await db.doc(`providers/${providerId}`).set({ ...legacy, ...providerPatch });
    const ref = db.doc(`providerPortalUsers/own/memberships/${providerId}`), member = { providerId, email: 'own@example.test', status: 'needs_confirmation', representation: 'own', ...memberPatch };
    await ref.set(member);
    if (company) await db.doc(`providerPortalCompanyApprovals/${providerId}`).set({ declarationId: 'company-proof' });
    await own({ action: 'bootstrap', includeDocuments: false });
    await assert.rejects(own({ action: 'overview', providerId }), error => error.code === 'permission-denied');
    assert.deepEqual((await ref.get()).data(), member);
  }
  for (const patch of [{ disabled: true }, { emailVerified: false }, { email: 'foreign@example.test' }, { uid: 'foreign' }, { providerData: [{ providerId: 'password' }] }]) {
    const account = accounts.get('own'); accounts.set('own', { ...account, ...patch });
    await assert.rejects(own({ action: 'bootstrap', includeDocuments: false }), error => error.code === 'permission-denied');
    await assert.rejects(own({ action: 'overview', providerId: 'ambiguous' }), error => error.code === 'permission-denied');
    accounts.set('own', account);
  }
  await assert.rejects(portal(request('own', { action: 'bootstrap' }, { firebase: { sign_in_provider: 'password' } })), error => error.code === 'permission-denied');
  await db.doc('providers/contact-only').set({ ...legacy, email: 'other@example.test' });
  assert.deepEqual((await portal(request('other', { action: 'bootstrap', includeDocuments: false }))).memberships, []);
  assert.equal((await db.doc('providerPortalUsers/other/memberships/contact-only').get()).exists, false);
  assert.equal(hash((await db.doc('projects/film/areaExpenses/work').get()).data()), hash(expense));
  console.log('PASS personal portal access/review: ambiguous legacy admin preview/classification route, distinct explicit-own legacy access, bad bank and yellow status nonblocking, exact own work/payment reads, no registration/roles/financial writes, Google identity and revoked/company/mismatch negatives.');
} finally { await env.cleanup(); await db.terminate(); await app.delete(); }
