const assert = require('node:assert/strict');
const test = require('node:test');
const { activatePersonalMembership, attachVerifiedIntakeMembership, verifyPortalAccount } = require('./providerPortalAccess');

function fixture(membership, provider) {
  const records = new Map([['providerPortalUsers/own/memberships/supplier', membership], ['providers/supplier', provider]].filter(([, value]) => value !== undefined));
  const writes = [];
  const db = { doc: path => ({ path }), collection: path => ({ doc: () => ({ path: `${path}/audit` }), where: () => ({ limit: () => ({ query: path }) }) }),
    runTransaction: fn => fn({ get: async ref => ref.query ? { size: 0, docs: [] } : ({ exists: records.has(ref.path), data: () => records.get(ref.path) }),
      update: (ref, value) => { writes.push({ path: ref.path, value }); records.set(ref.path, { ...records.get(ref.path), ...value }); },
      create: (ref, value) => { assert.equal(records.has(ref.path), false); writes.push({ path: ref.path, value }); records.set(ref.path, value); } }) };
  return { writes, records, activate: (email = 'own@example.test') => activatePersonalMembership({ db, actor: { uid: 'own', email }, providerId: 'supplier', timestamp: () => 'now' }),
    attach: () => attachVerifiedIntakeMembership({ db, actor: { uid: 'own', email: 'own@example.test' }, providerId: 'supplier', timestamp: () => 'now' }) };
}
test('persona con asociación pendiente entra sin firma, conserva la ficha y deja una sola auditoría', async () => {
  const provider = { type: 'persona', email: 'contact@example.test', name: 'Persona' };
  const f = fixture({ status: 'needs_confirmation', email: 'own@example.test', source: 'personal_google_intake' }, provider);
  assert.equal((await f.activate()).status, 'active');
  assert.equal(f.records.get('providerPortalUsers/own/memberships/supplier').representation, 'own');
  assert.equal(f.records.get('providerPortalUsers/own/memberships/supplier').declarationId, undefined);
  assert.equal(f.records.get('providers/supplier'), provider);
  assert.equal(f.writes.length, 2);
  await f.activate();
  assert.equal(f.writes.length, 2);
});
test('legacy sin type accede sólo con asociación personal propia, sin empresa ni cambio de ficha/banco/registro', async () => {
  const provider = { name: 'Ficticio', bankAccount_cbu: 'old-invalid', source: 'manual' };
  const member = { status: 'needs_confirmation', email: 'own@example.test', representation: 'own' };
  const f = fixture(member, provider);
  assert.equal((await f.activate()).status, 'active');
  assert.equal(f.records.get('providers/supplier'), provider); assert.equal(Object.hasOwn(provider, 'type'), false);
  assert.equal(f.writes[0].value.activationMethod, 'verified_google_legacy_personal');
  for (const changed of [{ ...provider, businessName: 'Empresa' }, { ...provider, type: 'empresa' }, { ...provider, personalGoogleAccount: { uid: 'foreign', email: 'foreign@example.test' } }]) {
    const blocked = fixture(member, changed); await blocked.activate(); assert.equal(blocked.writes.length, 0);
  }
  const ambiguous = fixture({ ...member, representation: '' }, provider); await ambiguous.activate(); assert.equal(ambiguous.writes.length, 0);
  const company = fixture(member, provider); company.records.set('providerPortalCompanyApprovals/supplier', { declarationId: 'company' });
  await company.activate(); assert.equal(company.writes.length, 0);
});
test('lectura del portal comprueba cuenta viva sin habilitar Google desactivado, otro UID/correo o proveedor no Google', async () => {
  const account = { uid: 'own', email: 'own@example.test', emailVerified: true, providerData: [{ providerId: 'google.com' }] };
  const actor = { uid: 'own', email: account.email };
  await verifyPortalAccount(async () => account, actor);
  for (const patch of [{ disabled: true }, { uid: 'foreign' }, { email: 'foreign@example.test' }, { emailVerified: false }, { providerData: [{ providerId: 'password' }] }])
    await assert.rejects(verifyPortalAccount(async () => ({ ...account, ...patch }), actor), error => error.code === 'permission-denied');
  await assert.rejects(verifyPortalAccount(async () => { throw { code: 'auth/internal-error' }; }, actor), error => error.code === 'unavailable');
  await assert.rejects(verifyPortalAccount(async () => { throw { code: 'auth/user-not-found' }; }, actor), error => error.code === 'permission-denied');
});
test('el alta propia se asocia por UID y correo verificados; la empresa queda pendiente y nunca se reabre una revocación', async () => {
  const provider = { type: 'persona', source: 'provider_invite', personalGoogleAccount: { uid: 'own', email: 'own@example.test', version: 'personal-google-v1', personalUse: true } };
  const personal = fixture(undefined, provider);
  assert.equal((await personal.attach()).status, 'active');
  const company = fixture(undefined, { ...provider, type: 'empresa' });
  assert.equal((await company.attach()).status, 'needs_confirmation');
  for (const changed of [{ ...provider, source: 'internal' }, { ...provider, personalGoogleAccount: { ...provider.personalGoogleAccount, uid: 'other' } }, { ...provider, personalGoogleAccount: { ...provider.personalGoogleAccount, email: 'other@example.test' } }]) {
    const invalid = fixture(undefined, changed); await invalid.attach(); assert.equal(invalid.writes.length, 0);
  }
  const revoked = fixture({ status: 'revoked', email: 'own@example.test' }, provider);
  assert.equal((await revoked.attach()).status, 'revoked'); assert.equal(revoked.writes.length, 0);
});
test('no crea asociaciones ni reactiva revocadas, correos ajenos, empresas o tipos desconocidos', async () => {
  for (const [membership, provider] of [
    [undefined, { type: 'persona' }],
    [{ status: 'revoked', email: 'own@example.test' }, { type: 'persona' }],
    [{ status: 'active', email: 'own@example.test' }, { type: 'persona' }],
    [{ status: 'needs_confirmation', email: 'other@example.test' }, { type: 'persona' }],
    [{ status: 'needs_confirmation', email: 'own@example.test' }, { type: 'empresa' }],
    [{ status: 'needs_confirmation', email: 'own@example.test' }, { type: 'unknown' }],
    [{ status: 'needs_confirmation', email: 'own@example.test' }, undefined],
  ]) {
    const f = fixture(membership, provider);
    await f.activate();
    assert.equal(f.writes.length, 0);
  }
});
