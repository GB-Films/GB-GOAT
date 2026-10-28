import assert from 'node:assert/strict';

export async function testProviderAccountChoice({ db, admin, deps, request, signActual, env, doc, getDoc, setDoc, assertFails, createProviderPortalHandler, createProviderPortalAdminHandler }) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host || '')) throw Error('Local Auth emulator is required. Never verify test tokens against a live account.');
  const auth = admin.auth();
  const imported = await auth.importUsers([
    { uid: 'own', email: 'own@example.test', emailVerified: true, providerData: [{ uid: 'google-own', email: 'own@example.test', providerId: 'google.com' }] },
    { uid: 'next-account', email: 'nueva@example.test', emailVerified: true, providerData: [{ uid: 'google-next', email: 'nueva@example.test', providerId: 'google.com' }] },
  ]);
  assert.equal(imported.failureCount, 0);
  async function signInTarget() {
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestUri: 'http://localhost',
      postBody: new URLSearchParams({ providerId: 'google.com', id_token: JSON.stringify({ sub: 'google-next', email: 'nueva@example.test', email_verified: true, name: 'Persona de prueba' }) }).toString(), returnSecureToken: true }),
  });
  assert(response.ok, 'Google sign-in simulation must succeed in the Auth emulator');
  return response.json();
  }
  let target = await signInTarget();
  assert.equal(target.localId, 'next-account');
  const services = { ...deps, clock: () => new Date(), verifyGoogleToken: token => auth.verifyIdToken(token, true), findAccountByUid: uid => auth.getUser(uid) };
  const portal = createProviderPortalHandler(services), manage = createProviderPortalAdminHandler(services);
  const own = data => portal(request('own', 'own@example.test', data));
  const next = data => portal(request('next-account', 'nueva@example.test', data));
  const review = (d, decision = 'approved') => manage(request('admin', 'admin@example.test', { action: 'review', declarationId: d.id, decision, reason: 'Prueba local de cuenta Google verificada' }));
  const providerId = 'account-choice-flow', providerRef = db.doc(`providers/${providerId}`);
  const provider = { type: 'persona', name: 'Persona', lastName: 'Prueba', dni: '12345678', bankAccount_alias: 'cuenta.propia', bankAccount_holder: 'Persona Prueba', email: 'anterior@example.test', portalAccessEmail: 'own@example.test',
    source: 'provider_invite', personalGoogleAccount: { uid: 'own', email: 'own@example.test', version: 'personal-google-v1', personalUse: true } };
  await providerRef.set(provider);
  await db.doc(`providerPortalUsers/own/memberships/${providerId}`).set({ providerId, email: 'own@example.test', status: 'active' });
  const prepare = { action: 'prepareProfile', providerId, confirmProfile: true, dataConfirmed: true, accessEmailConfirmed: true, ownAccountConfirmed: true, changes: {} };
  const complete = d => own({ action: 'completeDeclaration', providerId: d.providerId, declarationId: d.id });
  const align = await own({ ...prepare, attemptId: 'choose-current-google', selectedAccountEmail: 'own@example.test' });
  assert.equal(align.content.confirmation.profile.email, 'own@example.test');
  assert.equal(align.content.changes.email.critical, true);
  await signActual(align); await complete(align);
  assert.equal((await providerRef.get()).data().email, 'anterior@example.test', 'a signature does not silently replace the registered email');
  await review(align);
  assert.equal((await providerRef.get()).data().email, 'own@example.test');
  assert.equal((await own({ action: 'overview', providerId })).profileConfirmation.status, 'confirmed');
  await assert.rejects(own({ ...prepare, attemptId: 'unverified-email', selectedAccountEmail: 'nueva@example.test' }), /verificá/);
  await assert.rejects(own({ action: 'verifyAccount', providerId, expectedEmail: 'nueva@example.test', idToken: 'forged-token' }), /No pudimos verificar/);
  await assert.rejects(own({ action: 'verifyAccount', providerId, expectedEmail: 'different@example.test', idToken: target.idToken }), /no coincide/);
  const verified = await own({ action: 'verifyAccount', providerId, expectedEmail: 'nueva@example.test', idToken: target.idToken });
  assert.equal(verified.email, 'nueva@example.test');
  const proof = (await db.doc(`providerPortalAccountVerifications/${verified.verificationId}`).get()).data();
  assert(!JSON.stringify(proof).includes(target.idToken), 'tokens must never be persisted in the verification receipt');
  const external = env.authenticatedContext('own', { email: 'own@example.test', email_verified: true }).firestore();
  await assertFails(getDoc(doc(external, `providerPortalAccountVerifications/${verified.verificationId}`)));
  await assertFails(setDoc(doc(external, 'providerPortalAccountVerifications/forged'), { ...proof, verifiedAt: 'forged-client-value' }));
  const change = await own({ ...prepare, attemptId: 'choose-verified-google', selectedAccountEmail: verified.email, accountVerificationId: verified.verificationId });
  assert.equal(change.content.accountChoice.selected.uid, 'next-account');
  assert.equal(change.actor.email, 'own@example.test', 'the existing Google session signs the explicit change request');
  await signActual(change); await complete(change);
  assert.equal((await own({ action: 'overview', providerId })).profileConfirmation.status, 'pending_review');
  await assert.rejects(next({ action: 'overview', providerId }));
  await auth.updateUser('next-account', { disabled: true });
  await assert.rejects(review(change), /cuenta elegida/);
  assert.equal((await providerRef.get()).data().email, 'own@example.test');
  await auth.updateUser('next-account', { disabled: false });
  target = await signInTarget();
  await review(change);
  const changed = (await providerRef.get()).data();
  assert.equal(changed.email, verified.email); assert.equal(changed.portalAccessEmail, verified.email);
  assert.equal(changed.bankAccount_alias, provider.bankAccount_alias);
  assert.equal(changed.personalGoogleAccount.uid, 'next-account');
  assert.equal((await db.doc(`providerPortalUsers/own/memberships/${providerId}`).get()).data().status, 'revoked');
  assert.equal((await next({ action: 'overview', providerId })).profileConfirmation.status, 'confirmed');
  await assert.rejects(own({ action: 'overview', providerId }));
  assert.equal((await db.doc('users/next-account').get()).exists, false, 'no internal role is created or transferred');
  await assert.rejects(review(change), /no revisable/);
  const companyId = 'company-account-choice';
  await db.doc(`providers/${companyId}`).set({ type: 'empresa', name: 'Empresa de prueba', businessName: 'Empresa de prueba', email: 'own@example.test', portalAccessEmail: 'own@example.test', bankAccount_alias: 'empresa.propia', bankAccount_holder: 'Empresa de prueba' });
  await db.doc(`providerPortalUsers/own/memberships/${companyId}`).set({ providerId: companyId, email: 'own@example.test', status: 'active', representation: 'authorized_representative' });
  await db.doc(`providerPortalCompanyApprovals/${companyId}`).set({ uid: 'own', declarationId: 'company-history' });
  await assert.rejects(own({ ...prepare, providerId: companyId, attemptId: 'proof-for-wrong-provider', selectedAccountEmail: verified.email, accountVerificationId: verified.verificationId }), /verificación/);
  const companyProof = await own({ action: 'verifyAccount', providerId: companyId, expectedEmail: verified.email, idToken: target.idToken });
  const company = await own({ ...prepare, providerId: companyId, attemptId: 'company-account-change', selectedAccountEmail: verified.email, accountVerificationId: companyProof.verificationId });
  await signActual(company); await complete(company); await review(company);
  assert.equal((await db.doc(`providerPortalUsers/next-account/memberships/${companyId}`).get()).data().status, 'needs_confirmation');
  assert.equal((await db.doc(`providerPortalCompanyApprovals/${companyId}`).get()).data().declarationId, 'company-history', 'the old authority evidence is preserved and never transferred to a new signer');
  await assert.rejects(next({ action: 'overview', providerId: companyId }));
  console.log('PASS: actual Auth SDK verification in local Auth emulator → signed account choice in GB Sign → atomic administrative review; mismatch, forged token, private proof, scope, disabled account, access revocation, unchanged banking and company authority guards.');
}
