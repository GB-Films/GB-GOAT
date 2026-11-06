const test = require('node:test');
const assert = require('node:assert/strict');
const { approvedEin } = require('./providerFiscalIdentifierException');
const { companyRepresentation } = require('./providerRepresentation');
const { ownAccountProfileChanges } = require('./providerPortalModel');
const { confirmationContent } = require('./providerProfileConfirmation');
const actor = { uid: 'example', email: 'company@example.test' };
const provider = { type: 'empresa', businessName: 'Example LLC', cuit: 'EIN: 12-3456789', cuitNormalized: '123456789', portalAccessEmail: actor.email, bankAccount_alias: 'existing.account' };
const exception = { version: 'provider-ein-exception-v1', providerId: 'company', status: 'active', type: 'EIN', country: 'US', value: '123456789', accountEmail: actor.email };
const consent = { representative: { name: 'Example Representative', dni: '12345678', role: 'Representative' }, accountConfirmed: true, identityConfirmed: true, authorityConfirmed: true, responsibilityConfirmed: true };
const evidence = [{ id: 'identity', kind: 'identity_document', sha256: 'a'.repeat(64), fileName: 'identity.pdf' }];
test('EIN is limited to an explicit private approval for this company, value and account', () => {
  assert.equal(approvedEin('company', provider, actor, exception).value, '123456789');
  for (const change of [{ status: 'revoked' }, { providerId: 'other' }, { type: 'CUIT' }, { country: 'AR' }, { value: '12345678900' }, { value: '987654321' }, { accountEmail: 'other@example.test' }, { version: 'unknown' }])
    assert.equal(approvedEin('company', provider, actor, { ...exception, ...change }), null);
  assert.equal(approvedEin('company', provider, actor, null), null);
  for (const change of [{ type: 'persona' }, { cuit: '987654321' }, { cuitNormalized: '987654321' }, { portalAccessEmail: 'other@example.test' }])
    assert.equal(approvedEin('company', { ...provider, ...change }, actor, exception), null);
});
test('manual EIN approval preserves representation consent and identity evidence requirements', () => {
  const approved = approvedEin('company', provider, actor, exception);
  assert.throws(() => companyRepresentation(provider, actor, consent, evidence), /EIN/);
  const content = companyRepresentation(provider, actor, consent, evidence, approved);
  assert.equal(content.provider.cuit, '123456789');
  assert.match(content.terms, /EIN 123456789/);
  for (const key of ['accountConfirmed', 'identityConfirmed', 'authorityConfirmed', 'responsibilityConfirmed'])
    assert.throws(() => companyRepresentation(provider, actor, { ...consent, [key]: false }, evidence, approved));
  assert.throws(() => companyRepresentation(provider, actor, consent, [], approved), /DNI/);
});
test('profile confirmation can preserve the approved EIN, but cannot introduce a different nine-digit identifier', () => {
  const approved = approvedEin('company', provider, actor, exception);
  const confirmationConsent = { dataConfirmed: true, accessEmailConfirmed: true, ownAccountConfirmed: true };
  const changes = ownAccountProfileChanges(provider, { cuit: '12-3456789', address: 'New address' }, true, true, approved);
  assert.equal(confirmationContent(provider, actor, changes, confirmationConsent, null, approved).profile.cuit, '12-3456789');
  assert.throws(() => ownAccountProfileChanges(provider, { cuit: '987654321' }, true, true, approved), /11/);
  assert.throws(() => confirmationContent(provider, actor, {}, confirmationConsent), /11/);
});
