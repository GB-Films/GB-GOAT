'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { classifyPersonalProvider, classificationInput, preserved } = require('./providerPersonalClassification');
const { hash } = require('./providerPortalModel');
const input = { operationKey: 'fictitious-person-classification', providerId: 'supplier', targetUid: 'own', targetEmail: 'own@example.test',
  operatorUid: 'admin', operatorEmail: 'admin@example.test', confirmedPersonal: true, reason: 'Autorización ficticia para clasificación personal.', authorizationSha256: 'a'.repeat(64) };
function fixture() {
  let tick = 1;
  const rows = new Map([
    ['providers/supplier', { name: 'Persona ficticia', bankAccount_cbu: 'invalid-old-bank', bankAccount_alias: '', notes: 'Preservar' }],
    ['users/admin', { role: 'admin', email: 'admin@example.test' }],
    ['projects/film', { name: 'Proyecto ficticio' }],
    ['providerPortalUsers/own/memberships/supplier', { providerId: 'supplier', email: 'own@example.test', status: 'needs_confirmation' }],
    ['projects/film/areaExpenses/work', { providerId: 'supplier', total: 100, paid: true, paymentHistory: [{ amount: 100, createdBy: 'payer' }] }],
  ]);
  const times = new Map([...rows.keys()].map(key => [key, { seconds: 1, nanoseconds: 0 }]));
  const writes = [], accounts = { admin: { uid: 'admin', email: 'admin@example.test', emailVerified: true, providerData: [{ providerId: 'google.com' }] }, own: { uid: 'own', email: 'own@example.test', emailVerified: true, providerData: [{ providerId: 'google.com' }] } };
  const snap = path => ({ exists: rows.has(path), data: () => structuredClone(rows.get(path)), updateTime: times.get(path), ref: { path } });
  const get = async ref => ref.query ? (() => {
    const docs = [...rows].filter(([path, data]) => path.startsWith(ref.name + '/') && path.split('/').length === ref.name.split('/').length + 1 && (!ref.field || data[ref.field] === ref.value)).map(([path]) => snap(path));
    return { size: docs.length, docs };
  })() : snap(ref.path);
  const query = (name, field, value) => ({ where: (field, op, value) => query(name, field, value), select: () => query(name, field, value), limit: () => ({ query: true, name, field, value, get() { return get(this); } }) });
  const db = { projectId: 'demo-classification', doc: path => ({ path, get: () => get({ path }) }), collection: name => query(name), collectionGroup: () => { throw Error('Collection-group queries forbidden in this repair'); },
    async runTransaction(fn) {
      const pending = [];
      const result = await fn({ get, update: (ref, value, precondition) => pending.push({ path: ref.path, value, precondition, kind: 'update' }), create: (ref, value) => pending.push({ path: ref.path, value, kind: 'create' }) });
      for (const write of pending) {
        if (write.kind === 'create') assert(!rows.has(write.path));
        rows.set(write.path, write.kind === 'update' ? { ...rows.get(write.path), ...write.value } : write.value);
        times.set(write.path, { seconds: ++tick, nanoseconds: 0 }); writes.push(write);
      }
      if (pending.length && db.afterCommit) db.afterCommit();
      return result;
    } };
  const call = (extra = {}, apply = false) => classifyPersonalProvider({ db, input: { ...input, ...extra }, apply,
    operatorEmail: 'admin@example.test', timestamp: () => ({ seconds: 100, nanoseconds: 0 }), findAccountByUid: async uid => accounts[uid] });
  return { db, rows, times, writes, accounts, call };
}
test('preview y reparación preservan banco inválido, trabajos, pagos y membresía; sólo type/updatedAt y auditoría', async () => {
  const f = fixture(), before = structuredClone([...f.rows]);
  const preview = await f.call();
  assert.equal(preview.outcome, 'preview'); assert.equal(f.writes.length, 0); assert.deepEqual([...f.rows], before);
  const command = { expectedVersion: preview.expectedVersion, expectedPreservationHash: preview.expectedPreservationHash };
  const applied = await f.call(command, true);
  assert.equal(applied.verification, 'passed');
  assert.deepEqual(Object.keys(f.writes[0].value).sort(), ['type', 'updatedAt']);
  assert.deepEqual(f.writes.map(write => write.path), ['providers/supplier', `providerPortalAudit/${applied.auditId}`]);
  assert.deepEqual(preserved(f.rows.get('providers/supplier')), preserved(before.find(([path]) => path === 'providers/supplier')[1]));
  for (const [path, value] of before.filter(([path]) => path !== 'providers/supplier')) assert.deepEqual(f.rows.get(path), value);
  assert.equal(f.rows.get('providerPortalUsers/own/memberships/supplier').status, 'needs_confirmation');
  const retry = await f.call(command, true);
  assert.equal(retry.outcome, 'already_applied'); assert.equal(f.writes.length, 2);
  assert.equal(f.rows.get(`providerPortalAudit/${applied.auditId}`).authorizationSha256, input.authorizationSha256);
});
test('rechaza campos extra, rutas ajenas, confirmación ausente y apply sin preview', async () => {
  for (const patch of [{ patch: { type: 'empresa' } }, { providerId: '../other' }, { confirmedPersonal: false }, { targetEmail: 'OTHER@example.test' }]) assert.throws(() => classificationInput({ ...input, ...patch }));
  const f = fixture(); await assert.rejects(f.call({}, true), /vista previa/); assert.equal(f.writes.length, 0);
});
test('versión y huella impiden sobrescribir cambios después de revisar el plan', async () => {
  for (const change of ['version', 'bank', 'payment', 'membership']) {
    const f = fixture(), preview = await f.call();
    if (change === 'version') f.times.set('providers/supplier', { seconds: 2, nanoseconds: 0 });
    if (change === 'bank') f.rows.get('providers/supplier').bankAccount_cbu = 'another';
    if (change === 'payment') f.rows.get('projects/film/areaExpenses/work').paymentHistory.push({ amount: 5 });
    if (change === 'membership') f.rows.get('providerPortalUsers/own/memberships/supplier').assignedBy = { uid: 'other' };
    await assert.rejects(f.call({ expectedVersion: preview.expectedVersion, expectedPreservationHash: preview.expectedPreservationHash }, true), /[Cc]ambi/);
    assert.equal(f.writes.length, 0);
  }
});
test('cuentas/roles/revocaciones/tipos incompatibles nunca se reparan ni activan como personas', async () => {
  const cases = [
    f => { f.rows.get('users/admin').role = 'colaborador'; },
    f => { f.rows.get('users/admin').email = 'foreign@example.test'; },
    f => { f.rows.get('users/admin').teamOnboarding = { status: 'needs_review' }; },
    f => { f.accounts.admin.disabled = true; },
    f => { f.accounts.own.disabled = true; },
    f => { f.accounts.own.emailVerified = false; },
    f => { f.accounts.own.uid = 'foreign'; },
    f => { f.accounts.own.providerData = [{ providerId: 'password' }]; },
    f => { f.rows.get('providerPortalUsers/own/memberships/supplier').email = 'foreign@example.test'; },
    f => { f.rows.get('providerPortalUsers/own/memberships/supplier').status = 'revoked'; },
    f => { f.rows.get('providerPortalUsers/own/memberships/supplier').status = 'suspended'; },
    f => { f.rows.get('providerPortalUsers/own/memberships/supplier').representation = 'authorized_representative'; },
    f => { f.rows.delete('providerPortalUsers/own/memberships/supplier'); },
    f => { f.rows.get('providers/supplier').type = 'empresa'; },
    f => { f.rows.get('providers/supplier').type = 'unknown'; },
    f => { f.rows.get('providers/supplier').businessName = 'Empresa'; },
    f => { f.rows.get('providers/supplier').personalGoogleAccount = { uid: 'foreign', email: 'foreign@example.test' }; },
    f => { f.rows.set('providerPortalCompanyApprovals/supplier', { declarationId: 'company-proof' }); },
    f => { f.rows.set('providerPortalDeclarations/company-history', { providerId: 'supplier', kind: 'representation', status: 'pending_signature' }); },
    f => { f.rows.set('providerAdministrativeRecords/supplier', { providerId: 'supplier', version: 'administrative-provider-v1', status: 'active' }); },
  ];
  for (const change of cases) { const f = fixture(); change(f); await assert.rejects(f.call()); assert.equal(f.writes.length, 0); }
  const f = fixture(); await assert.rejects(f.call({ providerId: 'another' }), /no existe/); assert.equal(f.writes.length, 0);
});
test('operación estable rechaza reutilización para otro contenido y falla con checkpoint después de commit', async () => {
  const f = fixture(), preview = await f.call();
  const command = { expectedVersion: preview.expectedVersion, expectedPreservationHash: preview.expectedPreservationHash };
  f.db.afterCommit = () => { f.rows.get('projects/film/areaExpenses/work').total = 200; };
  const result = await f.call(command, true);
  assert.equal(result.verification, 'failed_after_commit'); assert.equal(f.writes.length, 2); assert.equal(f.rows.get('providers/supplier').type, 'persona');
  await assert.rejects(f.call({ ...command, reason: 'Otra autorización ficticia incompatible.' }, true), /otro contenido/);
  assert.equal(f.writes.length, 2);
  assert.equal(hash(f.rows.get(`providerPortalAudit/${result.auditId}`).changedFields), hash(['type', 'updatedAt']));
});
