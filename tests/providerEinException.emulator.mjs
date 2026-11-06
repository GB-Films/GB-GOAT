import assert from 'node:assert/strict';

export async function testProviderEinException({ db, own, other, signActual, evidencePdf, env, assertFails, doc, getDoc, setDoc }) {
  const providerId = 'manual-ein-example';
  const providerRef = db.doc(`providers/${providerId}`);
  const exceptionRef = db.doc(`providerFiscalIdentifierExceptions/${providerId}`);
  const membershipRef = db.doc(`providerPortalUsers/own/memberships/${providerId}`);
  const provider = { type: 'empresa', name: 'Example LLC', businessName: 'Example LLC', cuit: 'EIN: 12-3456789', cuitNormalized: '123456789', portalAccessEmail: 'own@example.test', bankAccount_alias: 'existing.account', registration: { status: 'complete', method: 'manual_fiscal_identifier_exception' } };
  const exception = { version: 'provider-ein-exception-v1', status: 'active', providerId, type: 'EIN', country: 'US', value: '123456789', accountEmail: 'own@example.test' };
  await providerRef.set(provider);
  await membershipRef.set({ providerId, email: 'own@example.test', status: 'needs_confirmation', source: 'manual_administrative_registration' });
  const identity = await own({ action: 'uploadEvidence', providerId, kind: 'identity_document', attemptId: 'ein-identity', file: { base64: evidencePdf.base64, contentType: 'application/pdf', fileName: 'identity.pdf' } });
  const input = { action: 'prepareRepresentation', providerId, capacity: 'authorized_representative', attemptId: 'ein-representation', representative: { name: 'Persona prueba', dni: '12345678', role: 'Representante' }, accountConfirmed: true, identityConfirmed: true, authorityConfirmed: true, responsibilityConfirmed: true, evidenceIds: [identity.id] };
  await assert.rejects(own({ ...input, fiscalIdentifier: { type: 'EIN', value: '123456789' } }), /EIN/);
  await exceptionRef.set(exception);
  for (const uid of ['own', 'admin']) {
    const client = env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
    await assertFails(getDoc(doc(client, exceptionRef.path)));
    await assertFails(setDoc(doc(client, exceptionRef.path), { ...exception, value: '987654321' }));
  }
  await assert.rejects(other(input));
  const declaration = await own(input);
  const saved = (await db.doc(`providerPortalDeclarations/${declaration.id}`).get()).data();
  assert.equal(saved.content.provider.cuit, '123456789', 'normalized identifier must not be overwritten by the formatted provider value');
  assert.equal(saved.content.fiscalIdentifier.type, 'EIN');
  assert.match(saved.content.terms, /EIN 123456789/);
  await assert.rejects(own({ action: 'completeDeclaration', providerId, declarationId: declaration.id }), /Falta completar/);
  assert.equal((await membershipRef.get()).data().status, 'needs_confirmation');
  await signActual(declaration);
  await exceptionRef.update({ status: 'revoked' });
  await assert.rejects(own({ action: 'completeDeclaration', providerId, declarationId: declaration.id }), /excepción del EIN/);
  await exceptionRef.update({ status: 'active' });
  assert.equal((await own({ action: 'completeDeclaration', providerId, declarationId: declaration.id })).status, 'applied');
  assert.equal((await membershipRef.get()).data().status, 'active');
  assert.equal((await own({ action: 'overview', providerId })).provider.cuit, provider.cuit);
  const profile = await own({ action: 'prepareProfile', providerId, attemptId: 'ein-profile', confirmProfile: true, dataConfirmed: true, accessEmailConfirmed: true, ownAccountConfirmed: true, changes: { address: 'New address', cuit: '12-3456789' } });
  await signActual(profile);
  assert.equal((await own({ action: 'completeDeclaration', providerId, declarationId: profile.id })).status, 'applied');
  const after = (await providerRef.get()).data();
  assert.equal(after.cuit, '12-3456789');
  assert.equal(after.cuitNormalized, '123456789');
  assert.equal(after.bankAccount_alias, provider.bankAccount_alias);
  assert.equal(after.personalGoogleAccount, undefined, 'manual registration must not fabricate personal Google consent');
}
