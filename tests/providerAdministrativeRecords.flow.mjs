import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { assertFails } from '@firebase/rules-unit-testing';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { createProviderPortalAdminHandler } = require('../functions/providerPortalAdmin');
const { hash } = require('../functions/providerPortalModel');

export async function testProviderAdministrativeRecords({ db, admin, portal, env }) {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Local emulator required; production forbidden.');
  const timestamp = () => admin.firestore.FieldValue.serverTimestamp();
  const manage = createProviderPortalAdminHandler({ db, timestamp, findAccount: async email => ({ uid: 'coordinator', email, emailVerified: true }) });
  const request = (data, uid = 'institution-admin') => ({ auth: { uid, token: { email: `${uid}@example.test`, email_verified: true, firebase: { sign_in_provider: 'google.com' }, auth_time: Date.now() / 1000 } }, data });
  const call = (data, uid) => manage(request(data, uid));
  await db.doc('users/institution-admin').set({ role: 'admin' });
  await db.doc('users/institution-assistant').set({ role: 'ayudante_admin' });
  await db.doc('users/institution-producer').set({ role: 'colaborador' });
  const providerId = 'institutional-company-test', ref = db.doc(`providers/${providerId}`);
  const before = { type: 'empresa', name: 'Institución ficticia', businessName: 'Institución ficticia', cuit: '30999999991',
    email: 'coordinator@example.test', portalAccessEmail: 'coordinator@example.test', accessPreparation: { generation: 'legacy' },
    source: 'manual', bankAccount_alias: 'institution.account', createdBy: 'operator', notes: 'Preservar datos originales' };
  await ref.set(before);
  const expenseRef = db.doc('projects/institution-test/areaExpenses/expense');
  const expense = { providerId, providerName: before.name, area: 'Seguros', total: 90, paid: true, paymentLocked: true,
    invoices: [{ name: 'fictitious-invoice.pdf' }], paymentHistory: [{ id: 'payment', amount: 90, createdBy: 'payer' }] };
  await expenseRef.set(expense);
  const auditCount = async () => (await db.collection('providerPortalAudit').where('providerId', '==', providerId).get()).size;
  const command = { action: 'setAdministrativeProvider', providerId, enabled: true, contactEmail: 'coordinator@example.test' };
  await assert.rejects(call(command, 'institution-producer'), /Sólo administración/);
  await assert.rejects(manage({ data: command }), error => error.code === 'unauthenticated');
  await assert.rejects(call({ ...command, enabled: 'yes' }), /tipo de gestión/);
  await assert.rejects(call({ ...command, contactEmail: 'invalid' }), /correo/);
  const [first, retry] = await Promise.all([call(command), call(command)]);
  assert.equal(first.active, true); assert.equal(retry.active, true); assert.equal(await auditCount(), 1, 'concurrent/repeated classification is idempotent');
  const record = (await db.doc(`providerAdministrativeRecords/${providerId}`).get()).data();
  assert.equal(record.contactEmail, before.email); assert.equal(record.updatedBy.uid, 'institution-admin');
  const after = (await ref.get()).data();
  for (const key of Object.keys(before).filter(key => !['portalAccessEmail', 'accessPreparation'].includes(key))) assert.deepEqual(after[key], before[key], key);
  assert.equal(after.portalAccessEmail, ''); assert.equal(after.accessPreparation, null);
  assert.equal(after.registration, undefined); assert.equal(after.personalGoogleAccount, undefined);
  assert.deepEqual((await expenseRef.get()).data(), expense, 'classification never touches expense identity, money or evidence');
  const lookup = { action: 'registrationStatuses', providerIds: [providerId, 'unclassified-institution'] };
  assert.deepEqual(await portal(request(lookup)), { registeredProviderIds: [], administrativeProviderIds: [providerId] });
  assert.equal((await call({ ...command, contactEmail: '' })).contactEmail, '', 'optional internal contact can be cleared');
  assert.equal((await ref.get()).data().email, '');
  await call(command);
  assert.equal((await call({ action: 'administrativeProviderState', providerId }, 'institution-assistant')).active, true);
  for (const uid of ['institution-admin', 'institution-producer', 'coordinator']) {
    const sdk = env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
    await assertFails(getDoc(doc(sdk, `providerAdministrativeRecords/${providerId}`)));
    await assertFails(setDoc(doc(sdk, 'providerAdministrativeRecords/forged'), { version: record.version, status: 'active', providerId: 'forged', contactEmail: before.email }));
    await assertFails(updateDoc(doc(sdk, `providerAdministrativeRecords/${providerId}`), { status: 'inactive' }));
  }
  await db.doc('providers/unclassified-institution').set({ type: 'empresa', name: 'Otra institución', administrative: true });
  assert.deepEqual(await portal(request(lookup)), { registeredProviderIds: [], administrativeProviderIds: [providerId] }, 'provider fields cannot forge the private classification');
  await assert.rejects(call({ action: 'setMembership', providerId, email: 'coordinator@example.test', status: 'needs_confirmation' }), /ficha es administrativa/);
  // An old candidate must not turn the internal coordinator into the company representative.
  await ref.update({ portalAccessEmail: 'coordinator@example.test' });
  await db.doc('providerPortalConfig/accessPreparation').set({ generation: 'old-candidate-test' });
  await db.doc(`providerPortalCandidates/${hash('coordinator@example.test')}`).set({ status: 'ready', email: 'coordinator@example.test', providerIds: [providerId], generation: 'old-candidate-test' });
  assert.equal((await portal(request({ action: 'bootstrap', includeDocuments: false }, 'coordinator'))).memberships.some(row => row.providerId === providerId), false);
  const membershipRef = db.doc(`providerPortalUsers/coordinator/memberships/${providerId}`);
  assert.equal((await membershipRef.get()).exists, false);
  await membershipRef.set({ providerId, email: 'coordinator@example.test', status: 'active' });
  await assert.rejects(portal(request({ action: 'overview', providerId }, 'coordinator')), /ficha es administrativa/);
  assert.equal((await portal(request({ action: 'bootstrap', includeDocuments: false }, 'coordinator'))).memberships.some(row => row.providerId === providerId), false);
  await membershipRef.delete();
  await ref.update({ portalAccessEmail: '' });
  const token = 'institution-old-link';
  await db.doc(`providerInvites/${token}`).set({ status: 'pending', used: false, projectId: 'institution-test', collectionName: 'areaExpenses', expenseId: 'expense', provisionalProviderId: providerId });
  const signup = { action: 'registerProvider', inviteToken: token, attemptId: token, personalAccountAccepted: true, ownAccountConfirmed: true,
    form: { type: 'empresa', businessName: before.name, cuit: before.cuit, email: 'coordinator@example.test', phone: '111', address: 'Domicilio ficticio', category: 'Otra', categoryOther: 'Seguros', bankAccount_alias: 'institution.account' } };
  await assert.rejects(portal(request(signup, 'coordinator')), /ficha es administrativa/);
  assert.equal((await db.doc(`providerInvites/${token}`).get()).data().used, false);
  assert.deepEqual((await expenseRef.get()).data(), expense);
  await call({ action: 'prepareAccess', apply: true });
  assert.equal((await ref.get()).data().portalAccessEmail, '', 'access preparation excludes administrative records');
  for (const [suffix, patch, extra] of [
    ['person', { type: 'persona' }], ['registered', { registration: { status: 'complete' } }], ['google', { personalGoogleAccount: { uid: 'someone' } }],
    ['membership', {}, 'membership'], ['legacy-membership', {}, 'legacy-membership'], ['authority', {}, 'authority'], ['signed-profile', {}, 'signed-profile'], ['pending-signature', {}, 'pending-signature'],
  ]) {
    const blockedId = `institution-blocked-${suffix}`;
    await db.doc(`providers/${blockedId}`).set({ type: 'empresa', ...patch });
    if (extra?.includes('membership')) await db.doc(`providerPortalUsers/other/memberships/${blockedId}`).set({ ...(extra === 'membership' ? { providerId: blockedId } : {}), email: 'other@example.test', status: 'active' });
    if (extra === 'authority') await db.doc(`providerPortalCompanyApprovals/${blockedId}`).set({ declarationId: 'history' });
    if (extra === 'signed-profile') await db.doc(`providerPortalDeclarations/${blockedId}`).set({ providerId: blockedId, kind: 'profile', status: 'applied', proof: { complete: true }, content: { confirmation: { version: 'profile-confirmation-v1' } } });
    if (extra === 'pending-signature') await db.doc(`providerPortalDeclarations/${blockedId}`).set({ providerId: blockedId, kind: 'representation', status: 'pending_signature' });
    await assert.rejects(call({ ...command, providerId: blockedId }), /alta propia|alta o una representación/);
    assert.equal((await db.doc(`providerAdministrativeRecords/${blockedId}`).get()).exists, false);
  }
  const disabled = await call({ ...command, enabled: false });
  assert.equal(disabled.active, false);
  assert.equal((await membershipRef.get()).exists, false, 'returning to intake never grants portal access');
  assert.equal((await ref.get()).data().portalAccessEmail, '', 'a previous coordinator identity is never restored');
  assert.deepEqual(await portal(request(lookup)), { registeredProviderIds: [], administrativeProviderIds: [] });
  const registered = await portal(request(signup, 'coordinator'));
  assert.equal(registered.providerId, providerId, 'explicit return to intake can complete the same company record');
  assert.equal((await membershipRef.get()).data().status, 'needs_confirmation', 'company still needs its own representation declaration');
  assert.deepEqual((await expenseRef.get()).data(), expense);
  await assert.rejects(call(command), /alta propia/);
  // Changing management cannot race a legitimate company registration into an administrative exemption.
  const raceId = 'institutional-race-test', raceToken = 'institutional-race-link', raceCuit = '30888888881';
  await db.doc(`providers/${raceId}`).set({ ...before, cuit: raceCuit });
  await db.doc('projects/institution-test/areaExpenses/race').set({ ...expense, providerId: raceId });
  await db.doc(`providerInvites/${raceToken}`).set({ status: 'pending', used: false, projectId: 'institution-test', collectionName: 'areaExpenses', expenseId: 'race', provisionalProviderId: raceId });
  const race = await Promise.allSettled([
    call({ ...command, providerId: raceId }),
    portal(request({ ...signup, inviteToken: raceToken, attemptId: raceToken, form: { ...signup.form, cuit: raceCuit } }, 'coordinator')),
  ]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  const raceProvider = (await db.doc(`providers/${raceId}`).get()).data();
  const raceRecord = (await db.doc(`providerAdministrativeRecords/${raceId}`).get()).data();
  assert.notEqual(raceProvider.registration?.status === 'complete', raceRecord?.status === 'active');
  console.log('PASS administrative companies: explicit classification, coordinator separation, legacy link/candidate denial, private SDK boundary, registered identity guards, reversible intake and immutable paid history');
}
