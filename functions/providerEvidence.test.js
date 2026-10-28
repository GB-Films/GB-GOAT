const test = require('node:test');
const assert = require('node:assert/strict');
const { createEvidenceStore, evidenceBytes, COMPANY_EVIDENCE } = require('./providerEvidence');
function fixture() {
  const records = new Map(), files = new Map();
  const db = { doc: path => ({ path, get: async () => ({ data: () => records.get(path) }) }),
    runTransaction: callback => callback({ get: async ref => ({ data: () => records.get(ref.path) }), create: (ref, value) => { assert(!records.has(ref.path)); records.set(ref.path, value); } }) };
  const bucket = () => ({ file: path => ({ save: async bytes => { if (files.has(path)) throw Object.assign(Error('exists'), { code: 412 }); files.set(path, bytes); }, download: async () => { if (!files.has(path)) throw Error('missing'); return [files.get(path)]; } }) });
  return { service: createEvidenceStore({ db, bucket, timestamp: () => 'now' }), records, files };
}
const actor = { uid: 'person', email: 'person@example.test' };
const file = { contentType: 'application/pdf', fileName: 'respaldo.pdf', base64: Buffer.from('%PDF-ejemplo-de-prueba').toString('base64') };
test('los originales privados son inmutables e idempotentes, y el cliente no elige su ruta', async () => {
  const f = fixture();
  const input = { kind: 'dni_front', attemptId: 'attempt', file: { ...file, path: 'other/person/private' } };
  const first = await f.service.upload('company', actor, input, 'empresa');
  const second = await f.service.upload('company', actor, input, 'empresa');
  assert.equal(first.id, second.id); assert.equal(f.files.size, 1); assert.equal(f.records.size, 1);
  assert.equal(first.path, undefined);
  assert([...f.files.keys()][0].startsWith('providerPortalUploads/privateEvidence/company/person/'));
  await assert.rejects(f.service.upload('company', actor, { ...input, file: { ...file, base64: Buffer.from('%PDF-diferente').toString('base64') } }, 'empresa'));
  await assert.rejects(f.service.upload('person', actor, input, 'persona'));
});
test('sólo la cuenta propietaria o administración obtienen bytes; se verifican ficha, UID y hash', async () => {
  const f = fixture(); const uploaded = await f.service.upload('company', actor, { kind: 'dni_front', attemptId: 'attempt', file }, 'empresa');
  assert.equal((await f.service.read('company', uploaded.id, actor)).base64, file.base64);
  await assert.rejects(f.service.read('company', uploaded.id, { uid: 'other' }));
  await assert.rejects(f.service.read('other-company', uploaded.id, actor));
  assert.equal((await f.service.read('company', uploaded.id, { uid: 'admin' }, true)).base64, file.base64);
  f.files.set([...f.files.keys()][0], Buffer.from('%PDF-modificado'));
  await assert.rejects(f.service.read('company', uploaded.id, actor), /hash/);
});
test('el manifiesto admite un respaldo de representación y uno o dos DNI de esta misma cuenta', async () => {
  const f = fixture(); const ids = [];
  for (const kind of Object.keys(COMPANY_EVIDENCE)) ids.push((await f.service.upload('company', actor, { kind, attemptId: kind, file }, 'empresa')).id);
  assert.equal((await f.service.manifest('company', actor, ids, COMPANY_EVIDENCE)).length, 2);
  await assert.rejects(f.service.manifest('company', actor, ids.slice(1), COMPANY_EVIDENCE));
  await assert.rejects(f.service.manifest('company', { uid: 'other' }, ids, COMPANY_EVIDENCE));
  await assert.rejects(f.service.manifest('company', actor, [ids[0], ids[0]], COMPANY_EVIDENCE));
  const second = (await f.service.upload('company', actor, { kind: 'identity_document', attemptId: 'second', file }, 'empresa')).id;
  assert.equal((await f.service.manifest('company', actor, [...ids, second], COMPANY_EVIDENCE)).length, 3);
  const third = (await f.service.upload('company', actor, { kind: 'identity_document', attemptId: 'third', file }, 'empresa')).id;
  await assert.rejects(f.service.manifest('company', actor, [...ids, second, third], COMPANY_EVIDENCE));
});
test('rechaza archivos demasiado grandes o cuyo contenido no coincide con el formato', () => {
  assert.throws(() => evidenceBytes({ ...file, base64: Buffer.from('<html>documento falso</html>').toString('base64') }));
  assert.throws(() => evidenceBytes({ ...file, base64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }));
  assert.throws(() => evidenceBytes({ ...file, contentType: 'text/html' }));
});
