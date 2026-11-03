const test = require('node:test');
const assert = require('node:assert/strict');
const { hash } = require('./providerPortalModel');
const { thirdPartyDeclaration } = require('./providerThirdPartyDeclaration');
const { checkSignedThirdParty, needsThirdPartyApplication } = require('./signedThirdPartyDeclaration');
const actor = { uid: 'supplier-test', email: 'supplier@example.test' };
const provider = { type: 'persona', name: 'Persona de prueba', dni: '12345678', bankAccount_alias: 'cuenta.propia' };
const membership = { status: 'active', email: actor.email };
const content = thirdPartyDeclaration(provider, actor, { name: 'Tercero de prueba', cuit: '20333333334', alias: 'cuenta.tercero', roles: ['invoice', 'payment'], responsibilityConfirmed: true, workKeys: ['project/areaExpenses/work'] }, ['project/areaExpenses/work']);
const declaration = { kind: 'third_party', providerId: 'supplier', actor, status: 'pending_signature', content };
const now = new Date('2026-11-03');
function check(d = declaration, p = provider, m = membership, proofChanges = {}) {
  const contentHash = hash({ kind: d.kind, providerId: d.providerId, actor: d.actor, content: d.content });
  return checkSignedThirdParty({ ...d, contentHash }, p, m, { complete: true, contentHash, signerDni: provider.dni, signedAt: '2026-11-03T10:00:00Z', signedPdfSha256: 'a'.repeat(64), ...proofChanges }, now);
}

test('firma actual y anteriores compatibles habilitan ambos roles sin comprobaciones administrativas', () => {
  for (const termsVersion of ['third-party-v3', 'third-party-v4', 'third-party-v5']) {
    const next = { ...content, termsVersion };
    if (termsVersion === 'third-party-v3') { delete next.validity; next.expiresOn = '2026-12-31'; }
    check({ ...declaration, content: next });
  }
  assert.equal(content.termsVersion, 'third-party-v5');
  assert.match(content.terms, /se aplica automáticamente/);
  assert.equal(declaration.decisions, undefined);
});

test('no permite aplicar una firma ajena, incompleta, con hash alterado o asociación revocada', () => {
  for (const changes of [{ complete: false }, { contentHash: 'changed' }, { signerDni: '99999999' }, { signedPdfSha256: '' }, { signedAt: 'invalid' }])
    assert.throws(() => check(declaration, provider, membership, changes));
  for (const m of [null, { ...membership, status: 'revoked' }, { ...membership, status: 'needs_confirmation' }, { ...membership, email: 'foreign@example.test' }])
    assert.throws(() => check(declaration, provider, m));
  for (const p of [null, { ...provider, type: 'empresa' }, { ...provider, dni: '23456789' }]) assert.throws(() => check(declaration, p));
  for (const p of [{ ...provider, portalAccessEmail: 'other@example.test' }, { ...provider, personalGoogleAccount: { uid: 'other', email: actor.email } }, { ...provider, personalGoogleAccount: { uid: actor.uid, email: 'other@example.test' } }]) assert.throws(() => check(declaration, p));
  assert.throws(() => checkSignedThirdParty({ ...declaration, contentHash: 'forged' }, provider, membership, { complete: true }, now));
});

test('no inventa roles no firmados, alcance ni vigencia y exige cuenta del emisor', () => {
  for (const changes of [
    { roles: ['payment'] }, { roles: ['invoice'] }, { termsVersion: 'third-party-v2' },
    { termsVersion: 'third-party-v3', expiresOn: '2026-01-01' }, { validity: '' },
    { workKeys: [] }, { workKeys: ['project/secrets/work'] }, { workKeys: ['project/areaExpenses/work', 'project/areaExpenses/work'] },
    { party: { ...content.party, holderCuit: '20999999999' } }, { party: { ...content.party, holder: 'Otro titular' } },
    { party: { ...content.party, cbu: 'invalid' } },
  ]) assert.throws(() => check({ ...declaration, content: { ...content, ...changes } }));
});

test('no reaplica vigentes completas ni revive revocaciones o decisiones rechazadas', () => {
  assert.equal(needsThirdPartyApplication(declaration), true);
  assert.equal(needsThirdPartyApplication({ ...declaration, status: 'pending_review' }), true);
  assert.equal(needsThirdPartyApplication({ ...declaration, status: 'active', effectiveRoles: ['payment'] }), true);
  for (const d of [
    { ...declaration, kind: 'profile' }, { ...declaration, status: 'revoked' }, { ...declaration, status: 'rejected' },
    { ...declaration, status: 'active', effectiveRoles: ['invoice', 'payment'] },
    { ...declaration, status: 'pending_review', decisions: { invoice: { decision: 'rejected' } } },
  ]) assert.equal(needsThirdPartyApplication(d), false);
});
