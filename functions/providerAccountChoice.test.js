const test = require('node:test');
const assert = require('node:assert/strict');
const { googleIdentity, createAccountChoiceService, checkAccountReview } = require('./providerAccountChoice');
const actor = { uid: 'old', email: 'actual@example.test' };
const now = new Date('2026-10-28T18:00:00Z').getTime();
const claims = { uid: 'next', email: 'nueva@example.test', email_verified: true, auth_time: now / 1000, firebase: { sign_in_provider: 'google.com' } };
function fixture() {
  let instant = now;
  const records = new Map([['providerPortalUsers/old/memberships/p', { status: 'active', email: actor.email }]]);
  const ref = path => ({ path, get: async () => ({ exists: records.has(path), data: () => records.get(path) }) });
  const db = { doc: ref, runTransaction: fn => fn({ get: ref => ref.get(), create: (ref, value) => records.set(ref.path, value) }) };
  const service = createAccountChoiceService({ db, timestamp: () => 'now', clock: () => new Date(instant), verifyGoogleToken: async token => { if (token !== 'opaque-secret') throw Error('signature'); return claims; } });
  return { records, service, expire: () => { instant += 600001; } };
}
test('sólo acepta una cuenta Google verificada y un inicio de sesión reciente', () => {
  assert.equal(googleIdentity(claims, now).email, claims.email);
  for (const change of [{ email_verified: false }, { uid: '' }, { email: '' }, { firebase: { sign_in_provider: 'password' } }, { firebase: { sign_in_provider: 'custom' } }, { auth_time: (now - 601000) / 1000 }, { auth_time: (now + 40000) / 1000 }])
    assert.throws(() => googleIdentity({ ...claims, ...change }, now));
});
test('la prueba queda vinculada a ficha y sesión, vence y nunca almacena el token recibido', async () => {
  const f = fixture();
  await assert.rejects(f.service.verify('p', actor, { expectedEmail: claims.email, idToken: 'false' }), /No pudimos verificar/);
  await assert.rejects(f.service.verify('p', actor, { expectedEmail: 'otra@example.test', idToken: 'opaque-secret' }), /no coincide/);
  const result = await f.service.verify('p', actor, { expectedEmail: claims.email, idToken: 'opaque-secret' });
  assert.equal(result.email, claims.email);
  assert(!JSON.stringify([...f.records.values()]).includes('opaque-secret'));
  const input = { selectedAccountEmail: claims.email, accountVerificationId: result.verificationId };
  const choice = await f.service.resolve('p', actor, { email: actor.email }, input);
  assert.equal(choice.selected.uid, 'next'); assert.equal(choice.changesIdentity, true);
  await assert.rejects(f.service.resolve('foreign', actor, {}, input));
  await assert.rejects(f.service.resolve('p', { ...actor, uid: 'foreign' }, {}, input));
  await assert.rejects(f.service.resolve('p', actor, {}, { selectedAccountEmail: claims.email }), /Primero verificá/);
  const current = await f.service.resolve('p', actor, {}, { selectedAccountEmail: actor.email });
  assert.equal(current.changesIdentity, false);
  f.expire(); await assert.rejects(f.service.resolve('p', actor, {}, input), /venció/);
});
test('una asociación revocada no puede guardar verificaciones', async () => {
  const f = fixture(); f.records.set('providerPortalUsers/old/memberships/p', { status: 'revoked', email: actor.email });
  await assert.rejects(f.service.verify('p', actor, { expectedEmail: claims.email, idToken: 'opaque-secret' }), /acceso/);
  assert.equal(f.records.size, 1);
});
test('la revisión exige que ambas asociaciones y la cuenta Google continúen siendo válidas', async () => {
  const f = fixture(); const choice = await f.service.resolve('p', actor, { email: actor.email }, { selectedAccountEmail: actor.email });
  const declaration = { actor, content: { accountChoice: choice } }, membership = { status: 'active', email: actor.email };
  const account = { uid: actor.uid, email: actor.email, emailVerified: true, providerData: [{ providerId: 'google.com' }] };
  assert.equal(checkAccountReview(declaration, { email: actor.email }, membership, membership, account), choice);
  for (const change of [{ disabled: true }, { emailVerified: false }, { uid: 'foreign' }, { email: claims.email }, { providerData: [{ providerId: 'password' }] }])
    assert.throws(() => checkAccountReview(declaration, { email: actor.email }, membership, membership, { ...account, ...change }));
  assert.throws(() => checkAccountReview(declaration, { email: 'changed@example.test' }, membership, membership, account));
  assert.throws(() => checkAccountReview(declaration, { email: actor.email }, { ...membership, status: 'revoked' }, membership, account));
});
