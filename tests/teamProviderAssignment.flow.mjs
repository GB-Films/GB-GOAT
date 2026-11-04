import assert from 'node:assert/strict';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

export async function testTeamProviderAssignment({ db, admin, env, assertFails, assertSucceeds, createRequire }) {
  const { createProviderPortalAdminHandler } = createRequire('../functions/providerPortalAdmin');
  const { createTeamOnboarding } = createRequire('../functions/teamOnboarding');
  const accounts = new Map(), timestamp = () => admin.firestore.FieldValue.serverTimestamp();
  const findAccount = async email => {
    if (!accounts.has(email)) throw Object.assign(Error('not-found'), { code: 'auth/user-not-found' });
    return accounts.get(email);
  };
  const handler = createProviderPortalAdminHandler({ db, timestamp, findAccount, sign: {} });
  const actor = (uid, email = `${uid}@example.test`) => ({ uid, email, name: uid });
  const request = (a, data, provider = 'google.com') => ({ auth: { uid: a.uid, token: { email: a.email, email_verified: true, firebase: { sign_in_provider: provider } } }, data });
  const manager = actor('direct-admin'), owner = actor('direct-owner', 'info@granbertafilms.com');
  for (const a of [manager, owner]) await db.doc(`users/${a.uid}`).set({ uid: a.uid, email: a.email, role: 'admin' });
  const call = data => handler(request(manager, data));
  const own = data => handler(request(owner, data));
  const sdk = a => env.authenticatedContext(a.uid, { email: a.email, email_verified: true }).firestore();
  async function seed(uid, extra = {}) {
    const a = actor(uid), providerId = `registered_${uid}`;
    accounts.set(a.email, { uid, email: a.email, emailVerified: true, disabled: false, displayName: `Persona ${uid}`, providerData: [{ providerId: 'google.com' }] });
    await db.doc(`providers/${providerId}`).set({ type: 'persona', name: 'Julia', lastName: `Ójeda ${uid}`, fullName: `Julia Ójeda ${uid}`, email: a.email,
      source: 'provider_invite', registration: { status: 'complete' }, personalGoogleAccount: { uid, email: a.email, version: 'personal-google-v1', personalUse: true },
      bankAccount_cbu: 'PRIVATE_BANK', cuit: 'PRIVATE_CUIT', ...extra });
    await db.doc(`providerPortalUsers/${uid}/memberships/${providerId}`).set({ providerId, email: a.email, status: 'active', representation: 'own' });
    return { a, providerId };
  }
  const preview = p => call({ action: 'teamProviderPreview', providerId: p.providerId });
  const assignment = (p, view, role = 'colaborador', requestId = `assign_${p.a.uid}`) => ({ action: 'teamAssignProvider', providerId: p.providerId, fingerprint: view.fingerprint, role, requestId });
  const person = await seed('direct-new');
  await db.doc('providers/direct_provisional').set({ type: 'persona', name: 'Julia', lastName: 'Provisoria', email: 'provisional@example.test', bankAccount_alias: 'private' });
  await db.doc('providers/direct_company').set({ type: 'empresa', name: 'Julia Sociedad', source: 'provider_invite', email: 'company@example.test' });
  const candidates = (await call({ action: 'teamProviderCandidates', search: 'ojeda julia' })).candidates;
  assert(candidates.some(p => p.providerId === person.providerId && p.available));
  assert(!JSON.stringify(candidates).includes('PRIVATE'));
  assert.equal((await call({ action: 'teamProviderCandidates', search: 'julia' })).candidates.find(p => p.providerId === 'direct_provisional').available, false);
  assert(!(await call({ action: 'teamProviderCandidates', search: 'julia' })).candidates.some(p => p.providerId === 'direct_company'));
  for (const action of ['teamProviderCandidates', 'teamProviderPreview', 'teamAssignProvider']) {
    await assert.rejects(handler(request(person.a, { action, providerId: person.providerId, search: 'Julia' })), e => e.code === 'permission-denied');
    await assert.rejects(handler(request(manager, { action, providerId: person.providerId, search: 'Julia' }, 'password')), e => e.code === 'permission-denied');
  }
  const beforeProvider = (await db.doc(`providers/${person.providerId}`).get()).data();
  const beforeMember = (await db.doc(`providerPortalUsers/${person.a.uid}/memberships/${person.providerId}`).get()).data();
  const view = await preview(person);
  assert.equal(view.projects.length, 0); assert.equal(view.alreadyMember, false);
  await assert.rejects(call(assignment(person, view, 'admin')), /cuenta dueña/);
  const input = { ...assignment(person, view), uid: 'forged-target', email: 'forged@example.test' };
  const results = await Promise.all([call(input), call(input), call(input)]);
  assert(results.every(r => r.assigned)); assert(results.some(r => r.resumed));
  const profile = (await db.doc(`users/${person.a.uid}`).get()).data();
  assert.equal(profile.role, 'colaborador'); assert.equal(profile.teamOnboarding.status, 'ready'); assert.equal(profile.teamOnboarding.providerId, person.providerId);
  assert.equal((await db.doc(`teamAccessEmails/${person.a.email}`).get()).data().status, 'ready');
  assert.deepEqual((await db.doc(`providers/${person.providerId}`).get()).data(), beforeProvider);
  assert.deepEqual((await db.doc(`providerPortalUsers/${person.a.uid}/memberships/${person.providerId}`).get()).data(), beforeMember);
  assert.equal((await db.collection('providerTeamAssignments').where('targetUid', '==', person.a.uid).get()).size, 1);
  await assertSucceeds(getDoc(doc(sdk(person.a), `users/${person.a.uid}`)));
  await assertFails(getDoc(doc(sdk(person.a), 'projects/project_legacy')));
  const bootstrap = await createTeamOnboarding({ db, timestamp, findAccount }).bootstrap(person.a, {});
  assert.equal(bootstrap.status, 'ready', 'directly assigned user needs no invitation token or repeated signup');
  await db.doc(`users/${person.a.uid}`).update({ role: 'jefe_produccion' });
  assert.equal((await call(input)).role, 'jefe_produccion', 'lost-response retry cannot undo a later role change');
  const existing = await preview(person);
  assert.equal(existing.alreadyMember, true);
  assert.equal((await call(assignment(person, existing, 'colaborador', 'do-not-downgrade'))).alreadyMember, true);
  assert.equal((await db.doc(`users/${person.a.uid}`).get()).data().role, 'jefe_produccion');
  await assertFails(setDoc(doc(sdk(person.a), 'users/forged-direct'), { uid: 'forged-direct', email: person.a.email, role: 'admin' }));
  await assertFails(updateDoc(doc(sdk(person.a), `users/${person.a.uid}`), { role: 'admin' }));
  const receipt = (await db.collection('providerTeamAssignments').where('targetUid', '==', person.a.uid).get()).docs[0];
  await assertFails(getDoc(doc(sdk(person.a), receipt.ref.path)));

  const pending = await seed('direct-pending');
  const invite = 'direct_pending_invite';
  await db.doc(`userInvites/${invite}`).set({ email: pending.a.email, status: 'accepted', used: false, acceptedBy: pending.a.uid });
  await db.doc(`teamAccessEmails/${pending.a.email}`).set({ uid: pending.a.uid, email: pending.a.email, status: 'pending', inviteToken: invite });
  await db.doc(`users/${pending.a.uid}`).set({ uid: pending.a.uid, email: pending.a.email, role: 'colaborador', pinnedProjectIds: ['direct_project'], teamOnboarding: { version: 1, status: 'needs_profile', inviteToken: invite } });
  await db.doc('projects/direct_project').set({ name: 'Proyecto previo', createdBy: 'other', collaboratorEmails: [pending.a.email], teamOnboardingBlockedEmails: [pending.a.email, 'keep-blocked@example.test'] });
  const acl = db.doc(`projects/direct_project/collaborators/${pending.a.email}`);
  await acl.set({ email: pending.a.email, role: 'jefe_area', allowedCategories: ['Campo'], allowedTabs: ['areas'], teamOnboardingBlockedEmail: pending.a.email });
  await assertFails(getDoc(doc(sdk(pending.a), 'projects/direct_project')));
  const pv = await preview(pending);
  assert.equal(pv.projects[0].name, 'Proyecto previo');
  await assert.rejects(call(assignment(pending, pv, 'jefe_produccion')), /Confirmá las asignaciones/);
  await call({ ...assignment(pending, pv, 'jefe_produccion'), confirmExistingProjects: true });
  assert.equal((await acl.get()).data().role, 'jefe_area'); assert.deepEqual((await acl.get()).data().allowedCategories, ['Campo']);
  assert.equal((await acl.get()).data().teamOnboardingBlockedEmail, '');
  assert.deepEqual((await db.doc('projects/direct_project').get()).data().teamOnboardingBlockedEmails, ['keep-blocked@example.test']);
  assert.deepEqual((await db.doc(`users/${pending.a.uid}`).get()).data().pinnedProjectIds, ['direct_project']);
  assert.equal((await db.doc(`userInvites/${invite}`).get()).data().used, true);
  await assertSucceeds(getDoc(doc(sdk(pending.a), 'projects/direct_project')));

  const stale = await seed('direct-stale'); const sv = await preview(stale);
  await db.doc('projects/direct_new_acl').set({ createdBy: 'other', collaboratorEmails: [stale.a.email] });
  await assert.rejects(call(assignment(stale, sv)), /permisos cambiaron/);
  assert.equal((await db.doc(`users/${stale.a.uid}`).get()).exists, false);
  const revoked = await seed('direct-revoked'); const rv = await preview(revoked);
  await db.doc(`providerPortalUsers/${revoked.a.uid}/memberships/${revoked.providerId}`).update({ status: 'revoked' });
  await assert.rejects(call(assignment(revoked, rv)), /acceso personal activo/);
  const unavailable = await seed('direct-unavailable'); const uv = await preview(unavailable);
  accounts.get(unavailable.a.email).disabled = true;
  await assert.rejects(call(assignment(unavailable, uv)), /no está disponible/);
  const dupe = await seed('direct-duplicate');
  await db.doc('providers/direct_duplicate_second').set((await db.doc(`providers/${dupe.providerId}`).get()).data());
  await assert.rejects(preview(dupe), /más de una ficha/);
  const staleUid = await seed('direct-old-uid');
  await db.doc('users/stale_different_uid').set({ uid: 'stale_different_uid', email: staleUid.a.email.toUpperCase(), role: 'colaborador' });
  await assert.rejects(preview(staleUid), /otro usuario del equipo/);
  const callerRevoked = await seed('direct-caller-revoked'); const cv = await preview(callerRevoked);
  await db.doc(`users/${manager.uid}`).update({ role: 'colaborador' });
  await assert.rejects(call(assignment(callerRevoked, cv)), e => e.code === 'permission-denied');
  await db.doc(`users/${manager.uid}`).update({ role: 'admin' });

  const wrongAcl = await seed('direct-wrong-acl');
  await db.doc('projects/direct_wrong_acl').set({ createdBy: 'other', collaboratorEmails: [wrongAcl.a.email] });
  await db.doc(`projects/direct_wrong_acl/collaborators/${wrongAcl.a.email}`).set({ uid: 'different-identity', email: wrongAcl.a.email, role: 'admin' });
  await assert.rejects(preview(wrongAcl), /permiso de proyecto.*otra cuenta/);
  assert.equal((await db.doc(`users/${wrongAcl.a.uid}`).get()).exists, false);

  const raceCaller = await seed('direct-race-caller'); const raceView = await preview(raceCaller);
  const racing = createProviderPortalAdminHandler({ db, timestamp, sign: {}, findAccount: async email => {
    const result = await findAccount(email); await db.doc(`users/${manager.uid}`).update({ role: 'colaborador' }); return result;
  } });
  await assert.rejects(racing(request(manager, assignment(raceCaller, raceView))), e => e.code === 'permission-denied');
  assert.equal((await db.doc(`users/${raceCaller.a.uid}`).get()).exists, false, 'caller revocation after Auth lookup must still reject the transaction');
  await db.doc(`users/${manager.uid}`).update({ role: 'admin' });
  const legacy = await seed('direct-signed-history', { source: 'manual', personalGoogleAccount: null, registration: null });
  await db.doc('providerPortalDeclarations/direct_history_confirmation').set({ providerId: legacy.providerId, kind: 'profile', status: 'applied',
    actor: legacy.a, proof: { complete: true }, content: { confirmation: { version: 'profile-confirmation-v1', accessEmail: legacy.a.email } } });
  await call(assignment(legacy, await preview(legacy)));
  assert.equal((await db.doc(`users/${legacy.a.uid}`).get()).data().teamOnboarding.providerId, legacy.providerId);
  const newAdmin = await seed('direct-new-admin');
  await own(assignment(newAdmin, await preview(newAdmin), 'admin'));
  assert.equal((await db.doc(`users/${newAdmin.a.uid}`).get()).data().role, 'admin');
  accounts.set(owner.email, { uid: owner.uid, email: owner.email, emailVerified: true, providerData: [{ providerId: 'google.com' }] });
  await db.doc('providers/direct_owner').set({ type: 'persona', source: 'provider_invite', email: owner.email, personalGoogleAccount: { uid: owner.uid, email: owner.email } });
  await db.doc(`providerPortalUsers/${owner.uid}/memberships/direct_owner`).set({ providerId: 'direct_owner', email: owner.email, status: 'active', representation: 'own' });
  await assert.rejects(own({ action: 'teamAssignProvider', providerId: 'direct_owner', role: 'colaborador', requestId: 'protect-owner', fingerprint: 'unused' }), /cuenta dueña/);
  console.log('PASS registered provider → team role without invitation: Google identity, admin/owner bounds, immutable supplier data, transactional ACL review, ready SDK access, no project grant, concurrent retries, stale preview, revoked/duplicate/disabled identities and protected owner.');
}
