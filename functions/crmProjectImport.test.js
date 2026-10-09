const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validatePayload, projectFromPayload, importProject, createImportHandler } = require('./crmProjectImport');

const fixture = overrides => ({
  schemaVersion: 1, projectCode: 'G ZZZ 0001', sourceProjectId: 'G ZZZ 0001 Prueba local',
  name: 'Prueba local', saleId: 'VE-TESTLOCAL', clientName: 'Cliente local',
  brandName: 'Marca local', companyName: 'Empresa local', serviceName: 'Comercial / Publicidad',
  confirmationDate: '2026-10-09', deliveryDate: '2026-11-01',
  contractCurrency: 'ARS', contractAmount: 500000, ownerUnit: 'GB',
  internalProviderUnit: '', condition: 'Externo', status: 'Activo', ...overrides,
});

// Transaction double: rejects reads after writes and records only create calls.
function database(seed = {}) {
  const records = new Map(Object.entries(seed));
  const writes = [];
  const snapshot = (path, value) => ({ id: path.split('/')[1], exists: value !== undefined, data: () => value });
  const collection = name => ({
    doc: id => ({ path: `${name}/${id}` }),
    where: (key, operator, value) => ({ name, key, value, limit: count => ({ name, key, value, count }) }),
  });
  return {
    records, writes, collection,
    async runTransaction(callback) {
      const pending = [];
      const result = await callback({
        async get(ref) {
          assert.equal(pending.length, 0, 'all reads must precede writes');
          if (ref.path) return snapshot(ref.path, records.get(ref.path));
          const docs = [...records].filter(([path, data]) => path.startsWith(`${ref.name}/`) && data[ref.key] === ref.value)
            .slice(0, ref.count).map(([path, data]) => snapshot(path, data));
          return { size: docs.length, docs };
        },
        create(ref, value) {
          assert.equal(records.has(ref.path), false, 'create must not overwrite');
          pending.push([ref.path, value]);
        },
      });
      pending.forEach(([path, value]) => { records.set(path, value); writes.push(path); });
      return result;
    },
  };
}

test('validates canonical code, date and currency; preserves unknowns', () => {
  assert.equal(validatePayload(fixture()).contractAmount, 500000);
  assert.equal(validatePayload(fixture({ saleId: 'interno', contractCurrency: '', contractAmount: null })).contractAmount, null);
});

for (const [title, override] of [
  ['B code', { projectCode: 'B ZZZ 0001' }],
  ['zero code', { projectCode: 'G ZZZ 0000' }],
  ['extra field', { createdBy: 'an-admin' }],
  ['schema version', { schemaVersion: 2 }],
  ['inconsistent name', { name: 'Otro' }],
  ['invalid date', { deliveryDate: '2026-02-30' }],
  ['missing date', { confirmationDate: '' }],
  ['missing sale', { saleId: '' }],
  ['internal condition', { condition: 'Interno' }],
  ['wrong owner', { ownerUnit: 'BANI' }],
  ['missing client', { clientName: '' }],
  ['negative amount', { contractAmount: -1 }],
  ['infinite amount', { contractAmount: Infinity }],
  ['string amount', { contractAmount: '500000' }],
  ['missing amount', { contractAmount: undefined }],
  ['unknown currency', { contractCurrency: 'EUR' }],
  ['undefined price with currency', { contractAmount: null }],
  ['price without currency', { contractCurrency: '' }],
]) {
  test(`rejects ${title}`, () => assert.throws(() => validatePayload(fixture(override)), { status: 400 }));
}

test('GOAT budgets remain ARS, USD is retained without inventing exchange rates', () => {
  const result = projectFromPayload(validatePayload(fixture({ contractCurrency: 'USD', contractAmount: 12345 })), 123);
  assert.equal(result.budgetTotal, 0);
  assert.equal(result.controlTotalContractAmount, 12345);
  assert.equal(result.controlTotalContractCurrency, 'USD');
  assert.equal(result.createdBy, 'crm-code-generator');
  assert.deepEqual(result.collaboratorEmails, []);
});

test('creates a project and receipt; repeated delivery creates nothing', async () => {
  const db = database();
  const options = { db, payload: fixture(), timestamp: () => 123 };
  assert.deepEqual(await importProject(options), { schemaVersion: 1, projectCode: 'G ZZZ 0001', projectId: 'ct-G-ZZZ-0001', outcome: 'created' });
  assert.equal((await importProject(options)).outcome, 'already_processed');
  assert.equal(db.writes.length, 2);
  assert.equal(db.records.get('projects/ct-G-ZZZ-0001').budgetTotal, 500000);
});

test('preserves existing projects, including random legacy IDs and financial edits', async () => {
  const original = { projectCode: 'G ZZZ 0001', name: 'Renombrado', budgetTotal: 111, status: 'Rodaje' };
  const db = database({ 'projects/manual-legacy': original });
  const result = await importProject({ db, payload: fixture(), timestamp: () => 123 });
  assert.equal(result.projectId, 'manual-legacy');
  assert.equal(result.outcome, 'existing');
  assert.equal(db.records.get('projects/manual-legacy'), original);
  assert.deepEqual(db.writes, ['crmProjectImports/ct-G-ZZZ-0001']);
});

test('receipt prevents retries from resurrecting a project deleted by an administrator', async () => {
  const db = database();
  const options = { db, payload: fixture(), timestamp: () => 123 };
  await importProject(options);
  db.records.delete('projects/ct-G-ZZZ-0001');
  assert.equal((await importProject(options)).outcome, 'already_processed');
  assert.equal(db.records.has('projects/ct-G-ZZZ-0001'), false);
  assert.equal(db.writes.length, 2);
});

test('a receipt cannot be reused by another sale', async () => {
  const db = database();
  await importProject({ db, payload: fixture(), timestamp: () => 123 });
  await assert.rejects(importProject({ db, payload: fixture({ saleId: 'VE-OTHER' }), timestamp: () => 123 }), { status: 409 });
});

for (const [title, seed] of [
  ['duplicate code', { 'projects/a': { projectCode: 'G ZZZ 0001' }, 'projects/b': { projectCode: 'G ZZZ 0001' } }],
  ['canonical ID conflict', { 'projects/ct-G-ZZZ-0001': { projectCode: 'G OTHER 0001' } }],
  ['uncoded legacy project', { 'projects/a': { name: 'Prueba local', budgetTotal: 222 } }],
  ['existing sale conflict', { 'projects/a': { projectCode: 'G ZZZ 0001', crmSaleId: 'VE-OTHER' } }],
]) {
  test(`conflict ${title} creates nothing`, async () => {
    const db = database(seed);
    await assert.rejects(importProject({ db, payload: fixture(), timestamp: () => 123 }), { status: 409 });
    assert.equal(db.writes.length, 0);
  });
}

function httpResponse() {
  return { headers: {}, statusCode: 200, set(key, value) { this.headers[key] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('HTTP enforces method, content type, body size and does not leak internal errors', async () => {
  const handler = createImportHandler({ db: { runTransaction: async () => { throw new Error('PRIVATE'); } }, timestamp: () => 123, logError: () => {} });
  for (const [request, code] of [
    [{ method: 'GET' }, 405],
    [{ method: 'POST', is: () => false }, 415],
    [{ method: 'POST', is: () => true, rawBody: Buffer.alloc(32769) }, 413],
    [{ method: 'POST', is: () => true, rawBody: Buffer.from('{}'), body: {} }, 400],
    [{ method: 'POST', is: () => true, rawBody: Buffer.from('{}'), body: fixture() }, 503],
  ]) {
    const res = httpResponse();
    await handler(request, res);
    assert.equal(res.statusCode, code);
    assert.equal(JSON.stringify(res.body).includes('PRIVATE'), false);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
});

// This test never connects to production. Run with the Firestore emulator.
test('Firestore transaction deduplicates concurrent deliveries', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  assert.ok(process.env.GCLOUD_PROJECT?.startsWith('demo-'), 'emulator test requires a demo project');
  const { initializeApp, deleteApp } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT }, 'crm-import-test');
  try {
    const db = getFirestore(app);
    const payload = fixture({ projectCode: 'G ZZZ 9999', sourceProjectId: 'G ZZZ 9999 Concurrencia local', name: 'Concurrencia local' });
    const results = await Promise.all(Array.from({ length: 5 }, () => importProject({ db, payload, timestamp: () => FieldValue.serverTimestamp() })));
    assert.equal(results.filter(result => result.outcome === 'created').length, 1);
    assert.equal(results.filter(result => result.outcome === 'already_processed').length, 4);
    assert.equal((await db.collection('projects').where('projectCode', '==', payload.projectCode).get()).size, 1);
  } finally { await deleteApp(app); }
});
