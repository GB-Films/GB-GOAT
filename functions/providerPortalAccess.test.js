const assert = require('node:assert/strict');
const test = require('node:test');
const { activatePersonalMembership } = require('./providerPortalAccess');

function fixture(membership, provider) {
  const records = new Map([['providerPortalUsers/own/memberships/supplier', membership], ['providers/supplier', provider]]);
  const writes = [];
  const db = { doc: path => ({ path }), collection: path => ({ doc: () => ({ path: `${path}/audit` }) }),
    runTransaction: fn => fn({ get: async ref => ({ data: () => records.get(ref.path) }),
      update: (ref, value) => { writes.push({ path: ref.path, value }); records.set(ref.path, { ...records.get(ref.path), ...value }); },
      create: (ref, value) => { assert.equal(records.has(ref.path), false); writes.push({ path: ref.path, value }); records.set(ref.path, value); } }) };
  return { writes, records, activate: (email = 'own@example.test') => activatePersonalMembership({ db, actor: { uid: 'own', email }, providerId: 'supplier', timestamp: () => 'now' }) };
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
