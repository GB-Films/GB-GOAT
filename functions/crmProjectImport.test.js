const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validatePayload, projectFromPayload, importProject, createImportHandler } = require('./crmProjectImport');
const Bani = require('./crmBaniPost');

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
    limit: count => ({ name, count }),
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
          const docs = [...records].filter(([path, data]) => path.startsWith(`${ref.name}/`) && (!ref.key || data[ref.key] === ref.value))
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

test('USD cannot become a zero budget without explicit confirmation and a verified quote', () => {
  assert.throws(() => projectFromPayload(validatePayload(fixture({ contractCurrency: 'USD', contractAmount: 12345 })), 123), { status: 409 });
});

const clock = () => new Date('2026-10-28T20:00:00Z');
const evidence = { registryPath: 'codigos/codigos.csv', registrySha256: 'a'.repeat(64), rowSha256: 'b'.repeat(64), verifiedAt: '2026-10-28T19:00:00Z', note: 'Clasificación revisada del registro oficial; precio no confirmado.' };
const historical = overrides => fixture({ schemaVersion: 2, importMode: 'historical', projectStatus: 'Archivado', status: 'Archivo', saleId: '', confirmationDate: null, deliveryDate: null,
  contractAmount: null, contractCurrency: '', contractConfirmed: false, sourceEvidence: evidence, ...overrides });
const quote = { source: 'https://www.bna.com.ar/Personas/', kind: 'billetes', date: '2026-10-28', buy: 100, sell: 102, rate: 101, sha256: 'c'.repeat(64), retrievedAt: '2026-10-28T20:00:00Z' };

function withBani(overrides = {}, bChanges = {}) {
  const data = historical({ importMode: 'new', projectStatus: 'Presupuesto', status: 'Activo', saleId: 'VE-TESTLOCAL', confirmationDate: '2026-10-09', deliveryDate: '2026-11-01', contractCurrency: 'ARS', contractAmount: 500000, contractConfirmed: true, ...overrides });
  const code = data.projectCode.slice(2) + ' ' + data.name;
  const g = { codigo: code, codigo_empresa: data.sourceProjectId, codigo_n: '26-10-09_ZZZ-0001_Prueba-local', codigo_discord: 'ZZZ-0001',
    proyecto: data.name, cliente: data.clientName, fecha_carga: '2026-10-09 12:00:00', fecha_entrega: '2026-11-01', venta_id: data.saleId,
    empresa: 'Gran Berta', tipo_cliente: 'Externo', origen: 'v3-form', precio_final: String(data.contractAmount ?? ''), moneda: data.contractCurrency };
  data.sourceEvidence = { ...evidence, rowSha256: Bani.rowHash(g) };
  data.baniPost = { gRow: g, bRow: { ...g, codigo_empresa: `B ${code}`, empresa: 'Bani VFX', tipo_cliente: 'Interno', precio_final: '1500000', moneda: 'ARS', ...bChanges }, candidateCount: 1 };
  return data;
}
const baniMaster = { name: 'BANI VFX LLC', businessName: 'BANI VFX LLC', type: 'empresa', category: 'Postproducción' };
const baniSeed = () => ({ [`providers/${Bani.BANI_PROVIDER_ID}`]: baniMaster });

function standaloneB(overrides = {}, rowChanges = {}) {
  const data = historical({ schemaVersion: 3, importMode: 'new', projectStatus: 'Presupuesto', status: 'Activo', saleId: 'VE-TESTLOCAL',
    projectCode: 'B ZZZ 0001', sourceProjectId: 'B ZZZ 0001 Prueba local', confirmationDate: '2026-10-09', deliveryDate: '2026-11-01',
    ownerUnit: 'BANI', condition: 'Externo', contractCurrency: 'USD', contractAmount: 5200, contractConfirmed: true, ...overrides });
  const b = { codigo: data.sourceProjectId.slice(2), codigo_empresa: data.sourceProjectId, codigo_n: 'b-independent-operation', codigo_discord: 'b-independent-channel',
    proyecto: data.name, cliente: data.clientName, fecha_carga: '2026-10-09 12:00:00', fecha_entrega: data.deliveryDate || '', venta_id: data.saleId || '',
    empresa: 'Bani VFX', tipo_cliente: data.condition, origen: 'v3-form', precio_final: String(data.contractAmount ?? ''), moneda: data.contractCurrency, ...rowChanges };
  data.sourceEvidence = { ...evidence, rowSha256: Bani.rowHash(b) };
  data.bIndependent = { bRow: b, gRows: [], gCandidateCount: 0, bCodeCount: 1 };
  return data;
}

test('independent B preserves BANI identity, converts confirmed per-code USD once and never allocates Toda la Post to itself', async () => {
  const db = database(baniSeed()), payload = standaloneB(); let calls = 0;
  const result = await importProject({ db, payload, timestamp: () => 123, clock, getQuote: async () => { calls++; return quote; } });
  assert.equal(result.projectId, 'ct-B-ZZZ-0001'); assert.equal(calls, 1);
  const commercial = db.records.get('projectCommercial/ct-B-ZZZ-0001');
  assert.equal(commercial.controlTotalOwnerUnit, 'BANI'); assert.equal(commercial.controlTotalContractUsd, 5200);
  assert.equal(commercial.budgetTotal, 525200); assert.equal(db.writes.length, 3);
  assert(!db.writes.some(path => path.includes('budgetItems') || path.includes('areaExpenses')));
  assert.equal(db.records.get('crmProjectImports/ct-B-ZZZ-0001').baniPost.state, 'not_applicable_independent_b');
  assert.equal(db.records.get('projects/ct-B-ZZZ-0001').projectCode, payload.projectCode);
});

test('paired B, ambiguous operation, duplicate B and unverified evidence cannot create another project', async () => {
  for (const mode of ['paired', 'ambiguous', 'duplicate', 'forged', 'own-post', 'sale-budget', 'missing-key']) {
    const payload = standaloneB();
    const g = { ...payload.bIndependent.bRow, codigo_empresa: 'G ZZZ 0001 Prueba local', empresa: 'Gran Berta', tipo_cliente: 'Externo' };
    if (mode === 'paired' || mode === 'ambiguous') { payload.bIndependent.gRows = [g]; payload.bIndependent.gCandidateCount = 1; if (mode === 'ambiguous') g.cliente = 'Different'; }
    if (mode === 'duplicate') payload.bIndependent.bCodeCount = 2;
    if (mode === 'forged') payload.sourceEvidence.rowSha256 = 'e'.repeat(64);
    if (mode === 'own-post') payload.baniPost = {};
    if (mode === 'sale-budget') payload.contractAmount = 999999;
    if (mode === 'missing-key') { payload.bIndependent.bRow.codigo_n = ''; payload.sourceEvidence.rowSha256 = Bani.rowHash(payload.bIndependent.bRow); }
    const db = database();
    await assert.rejects(importProject({ db, payload, timestamp: () => 123, clock }), error => [400, 409].includes(error.status), mode);
    assert.equal(db.writes.length, 0);
  }
});

test('same number/name in a G with a different operation is not a relationship, while existing ARS and deleted B remain intact', async () => {
  const payload = standaloneB({ contractCurrency: 'ARS', contractAmount: 12500 });
  const unrelated = { ...payload.bIndependent.bRow, codigo_empresa: 'G ZZZ 0001 Prueba local', codigo_n: 'unrelated', codigo_discord: 'unrelated', empresa: 'Gran Berta', tipo_cliente: 'Externo' };
  payload.bIndependent.gRows = [unrelated]; payload.bIndependent.gCandidateCount = 1;
  const db = database({ 'projects/g-existing': { projectCode: 'G ZZZ 0001', name: payload.name }, 'projectCommercial/g-existing': { budgetTotal: 777 } });
  const options = { db, payload, timestamp: () => 123, clock };
  assert.equal((await importProject(options)).outcome, 'created');
  db.records.get('projectCommercial/ct-B-ZZZ-0001').budgetTotal = 888;
  assert.equal((await importProject({ ...options, payload: standaloneB() })).outcome, 'already_processed');
  assert.equal(db.records.get('projectCommercial/ct-B-ZZZ-0001').budgetTotal, 888);
  db.records.delete('projects/ct-B-ZZZ-0001');
  assert.equal((await importProject(options)).outcome, 'already_processed'); assert(!db.records.has('projects/ct-B-ZZZ-0001'));
  assert.equal(db.records.get('projectCommercial/g-existing').budgetTotal, 777);
  const existing = database({ 'projects/b-existing': { projectCode: payload.projectCode, name: payload.name }, 'projectCommercial/b-existing': { budgetTotal: 99000 } });
  assert.equal((await importProject({ ...options, db: existing })).outcome, 'existing');
  assert.equal(existing.records.get('projectCommercial/b-existing').budgetTotal, 99000);
});

test('B unknown/zero/historical prices and quote failure preserve their meaning without creating own BANI allocation', async () => {
  for (const amount of [null, 0]) {
    const payload = standaloneB({ contractAmount: amount, contractCurrency: amount === null ? '' : 'ARS', contractConfirmed: amount !== null });
    const db = database(); await importProject({ db, payload, timestamp: () => 123, clock });
    assert.equal(db.records.get('projectCommercial/ct-B-ZZZ-0001').controlTotalContractAmount, amount);
    assert.equal(db.writes.length, 3);
  }
  const payload = standaloneB({ importMode: 'historical', projectStatus: 'Histórico', contractAmount: null, contractCurrency: '', contractConfirmed: false, saleId: '', confirmationDate: null, deliveryDate: null }, { origen: 'import-v2', fecha_carga: '' });
  const db = database(); await importProject({ db, payload, timestamp: () => 123, clock }); assert.equal(db.records.get('projects/ct-B-ZZZ-0001').status, 'Histórico');
  const failure = database(); await assert.rejects(importProject({ db: failure, payload: standaloneB(), timestamp: () => 123, clock, getQuote: async () => { throw Error('offline'); } }), { status: 503 }); assert.equal(failure.writes.length, 0);
});

test('human confirmation5200 overrides original CSV4800 only with a matching server-side authorization and preserves both sources', async () => {
  const payload = standaloneB({ contractAmount: 4800 }); payload.contractOverride = { approvalId: 'app-human-confirmation-5200' };
  const authorization = { schemaVersion: 1, decision: 'approved', approvalId: payload.contractOverride.approvalId, projectCode: payload.projectCode, saleId: payload.saleId,
    rowSha256: payload.sourceEvidence.rowSha256, originalAmount: 4800, originalCurrency: 'USD', amount: 5200, currency: 'USD',
    source: 'Human confirmation, immutable administrative report TEST ONLY', sourceSha256: 'f'.repeat(64), confirmedAt: '2026-10-28T19:00:00Z' };
  const seed = { 'crmProjectImportAuthorizations/ct-B-ZZZ-0001': authorization };
  const day = () => new Date('2026-10-30T12:55:00Z');
  payload.sourceEvidence.verifiedAt = day().toISOString();
  const bna = { ...quote, date: '2026-10-30', buy: 1510, sell: 1560, rate: 1535, retrievedAt: day().toISOString() };
  const db = database(seed); await importProject({ db, payload, timestamp: () => 123, clock: day, getQuote: async () => bna });
  assert.equal(db.records.get('projectCommercial/ct-B-ZZZ-0001').budgetTotal, 7982000);
  assert.equal(db.records.get('projectCommercial/ct-B-ZZZ-0001').controlTotalContractUsd, 5200);
  const receipt = db.records.get('crmProjectImports/ct-B-ZZZ-0001');
  assert.equal(receipt.source.contractAmount, 4800); assert.equal(receipt.source.bIndependent.bRow.precio_final, '4800');
  assert.equal(receipt.contractOverride.amount, 5200); assert.equal(receipt.contractOverride.originalAmount, 4800);
  assert.deepEqual(db.records.get('crmProjectImportAuthorizations/ct-B-ZZZ-0001'), authorization);
  for (const broken of [null, { ...authorization, approvalId: 'another-approval' }, { ...authorization, decision: 'revoked' }, { ...authorization, rowSha256: 'a'.repeat(64) }, { ...authorization, saleId: 'another-sale' }]) {
    const attempt = database(broken ? { 'crmProjectImportAuthorizations/ct-B-ZZZ-0001': broken } : {});
    await assert.rejects(importProject({ db: attempt, payload, timestamp: () => 123, clock: day, getQuote: async () => bna }), { status: 409 }); assert.equal(attempt.writes.length, 0);
  }
  const omitted = database(seed); const noRef = { ...payload }; delete noRef.contractOverride;
  await assert.rejects(importProject({ db: omitted, payload: noRef, timestamp: () => 123, clock: day }), { status: 409 }); assert.equal(omitted.writes.length, 0, 'never silently uses4800 when an approval is recorded');
  const existing = database({ ...seed, 'projects/existing-b': { projectCode: payload.projectCode }, 'projectCommercial/existing-b': { budgetTotal: 123456 } });
  assert.equal((await importProject({ db: existing, payload, timestamp: () => 123, clock: day })).outcome, 'existing');
  assert.equal(existing.records.get('projectCommercial/existing-b').budgetTotal, 123456);
});

test('BANI creates only an internal main-budget estimate with its own ARS assignment, atomically and once', async () => {
  const db = database(baniSeed()), payload = withBani();
  const options = { db, payload, timestamp: () => 123, clock, getQuote: async () => { throw Error('must not query BNA for ARS'); } };
  const result = await importProject(options);
  assert.equal(result.baniPost.state, 'created');
  const path = `projects/ct-G-ZZZ-0001/budgetItems/${Bani.BUDGET_ITEM_ID}`;
  const row = db.records.get(path);
  assert.equal(row.description, 'Toda la Post'); assert.equal(row.providerId, Bani.BANI_PROVIDER_ID);
  assert.equal(row.economicNature, 'internal_estimate'); assert.equal(row.area, 'Post Producción');
  assert.equal(row.quantity, 1); assert.equal(row.unitPrice, 1500000); assert.equal(row.total, 1500000);
  for (const key of ['paid', 'paymentHistory', 'invoice', 'cashMovementId']) assert.equal(row[key], undefined);
  assert.equal(db.records.get('projectCommercial/ct-G-ZZZ-0001').budgetTotal, 500000, 'G sale budget stays independent');
  assert.equal(db.writes.length, 4); assert.equal(db.records.get(`providers/${Bani.BANI_PROVIDER_ID}`), baniMaster);
  row.total = 1777777;
  assert.equal((await importProject(options)).outcome, 'already_processed');
  assert.equal(row.total, 1777777); assert.equal(db.writes.length, 4);
  assert.ok(db.writes.every(path => !path.includes('areaExpenses') && !path.includes('payments')));
});

test('BANI USD uses the same dated quote and preserves original B amount, independently of G price', async () => {
  const db = database(baniSeed()); let calls = 0;
  const payload = withBani({ contractCurrency: 'USD', contractAmount: 900 }, { moneda: 'USD', precio_final: '2100' });
  await importProject({ db, payload, timestamp: () => 123, clock, getQuote: async () => { calls++; return quote; } });
  assert.equal(calls, 1);
  assert.equal(db.records.get('projectCommercial/ct-G-ZZZ-0001').budgetTotal, 90900);
  const row = db.records.get(`projects/ct-G-ZZZ-0001/budgetItems/${Bani.BUDGET_ITEM_ID}`);
  assert.equal(row.total, 212100); assert.equal(row.crmBaniPost.originalAmount, 2100);
  assert.deepEqual(row.crmBaniPost.conversion, quote);
});

test('BANI zero confirmed is a real zero estimate; unknown, mismatched or ambiguous B stays pending without blocking G', async () => {
  const zero = database(baniSeed());
  await importProject({ db: zero, payload: withBani({}, { precio_final: '0' }), timestamp: () => 123, clock });
  assert.equal(zero.records.get(`projects/ct-G-ZZZ-0001/budgetItems/${Bani.BUDGET_ITEM_ID}`).total, 0);
  for (const alter of [
    p => { p.baniPost.bRow.precio_final = ''; p.baniPost.bRow.moneda = ''; },
    p => { p.baniPost.bRow.codigo_n = 'other-operation'; },
    p => { p.baniPost.bRow.tipo_cliente = 'Externo'; },
    p => { p.baniPost.bRow.venta_id = 'OTHER'; },
    p => { p.baniPost.bRow = null; p.baniPost.candidateCount = 0; },
    p => { p.baniPost.bRow = null; p.baniPost.candidateCount = 2; },
  ]) {
    const db = database(baniSeed()), payload = withBani(); alter(payload);
    const result = await importProject({ db, payload, timestamp: () => 123, clock });
    assert.equal(result.outcome, 'created'); assert.equal(result.baniPost.state, 'pending');
    assert.equal(db.writes.length, 3);
    assert.match(db.records.get('projectCommercial/ct-G-ZZZ-0001').controlTotalSourceWarning, /BANI pendiente/);
  }
});

test('missing BANI master or B-only quote failure leaves a visible pending allocation and no fake zero line', async () => {
  for (const seed of [baniSeed(), {}]) {
    const db = database(seed);
    const payload = withBani({}, { moneda: 'USD', precio_final: '2100' });
    const result = await importProject({ db, payload, timestamp: () => 123, clock, getQuote: async () => { throw Error('offline'); } });
    assert.equal(result.outcome, 'created'); assert.equal(result.baniPost.state, 'pending');
    assert.equal(db.writes.length, 3);
  }
});

test('existing G budgets and detailed post are never extended or overwritten by a B delivery', async () => {
  const original = { projectCode: 'G ZZZ 0001', name: 'Prueba local', status: 'Rodaje' };
  const commercial = { budgetTotal: 6600000 };
  const detail = { providerId: 'external', total: 7777 };
  const db = database({ ...baniSeed(), 'projects/existing': original, 'projectCommercial/existing': commercial, 'projects/existing/areaExpenses/detail': detail });
  const result = await importProject({ db, payload: withBani(), timestamp: () => 123, clock });
  assert.equal(result.outcome, 'existing'); assert.equal(result.baniPost.state, 'not_applied_existing');
  assert.deepEqual(db.writes, ['crmProjectImports/ct-G-ZZZ-0001']);
  assert.equal(db.records.get('projectCommercial/existing'), commercial); assert.equal(db.records.get('projects/existing/areaExpenses/detail'), detail);
});

test('orphaned main budget or detailed post prevents recreating a parent with a second global estimate', async () => {
  for (const path of ['budgetItems/old', 'areaExpenses/detail']) {
    const db = database({ ...baniSeed(), [`projects/ct-G-ZZZ-0001/${path}`]: { total: 123456 } });
    await assert.rejects(importProject({ db, payload: withBani(), timestamp: () => 123, clock }), { status: 409 });
    assert.equal(db.writes.length, 0);
  }
});
test('historical creation preserves archive classification and unknown sale, dates and contract', async () => {
  const db = database();
  await importProject({ db, payload: historical(), timestamp: () => 123, clock, getQuote: async () => { throw Error('must not fetch'); } });
  const project = db.records.get('projects/ct-G-ZZZ-0001'), commercial = db.records.get('projectCommercial/ct-G-ZZZ-0001');
  assert.equal(project.status, 'Archivado');
  assert.equal(commercial.crmSaleId, ''); assert.equal(commercial.crmSaleUrl, '');
  assert.equal(commercial.controlTotalConfirmationDate, ''); assert.equal(commercial.controlTotalDeliveryDate, '');
  assert.equal(commercial.controlTotalContractAmount, null); assert.equal(commercial.budgetTotal, 0);
  assert.match(commercial.controlTotalSourceWarning, /marcador pendiente/);
  assert.equal(project.controlTotalSourceWarning, undefined, 'commercial provenance remains private');
  assert.equal(db.records.get('crmProjectImports/ct-G-ZZZ-0001').source.sourceEvidence.registrySha256, evidence.registrySha256);
});
test('confirmed USD converts only on creation using a current verified official quote', async () => {
  const db = database(); let calls = 0;
  const payload = historical({ contractCurrency: 'USD', contractAmount: 900, contractConfirmed: true });
  const options = { db, payload, timestamp: () => 123, clock, getQuote: async () => { calls++; return quote; } };
  assert.equal((await importProject(options)).outcome, 'created');
  assert.equal(db.records.get('projectCommercial/ct-G-ZZZ-0001').budgetTotal, 90900);
  assert.equal(db.records.get('projectCommercial/ct-G-ZZZ-0001').controlTotalContractUsd, 900);
  assert.deepEqual(db.records.get('crmProjectImports/ct-G-ZZZ-0001').conversion, quote);
  assert.equal((await importProject({ ...options, getQuote: async () => { throw Error('unavailable'); } })).outcome, 'already_processed');
  assert.equal(calls, 1);
});

test('the deployed V1 caller remains compatible and USD uses the same verified creation quote', async () => {
  const db = database();
  const result = await importProject({ db, payload: fixture({ contractCurrency: 'USD', contractAmount: 900 }), timestamp: () => 123, clock, getQuote: async () => quote });
  assert.equal(result.outcome, 'created');
  assert.equal(db.records.get('projectCommercial/ct-G-ZZZ-0001').budgetTotal, 90900);
  assert.equal(db.records.get('crmProjectImports/ct-G-ZZZ-0001').source.schemaVersion, 1);
});
test('existing ARS financials are preserved even when USD quote is unavailable', async () => {
  const commercial = { budgetTotal: 444, crmSaleId: 'sale-existing', controlTotalProjectId: 'G ZZZ 0001 Prueba local' };
  const db = database({ 'projects/legacy': { projectCode: 'G ZZZ 0001', name: 'Prueba local', status: 'Rodaje' }, 'projectCommercial/legacy': commercial });
  const result = await importProject({ db, payload: historical({ contractCurrency: 'USD', contractAmount: 900, contractConfirmed: true }), timestamp: () => 123, clock, getQuote: async () => { throw Error('unavailable'); } });
  assert.equal(result.outcome, 'existing'); assert.equal(commercial.budgetTotal, 444);
  assert.deepEqual(db.writes, ['crmProjectImports/ct-G-ZZZ-0001']);
});
test('unavailable or stale quote never creates a project with a made-up zero budget', async () => {
  for (const getQuote of [async () => { throw Error('offline'); }, async () => null, async () => ({ ...quote, date: '2026-10-27' }), async () => ({ ...quote, rate: 0 })]) {
    const db = database();
    await assert.rejects(importProject({ db, payload: historical({ contractCurrency: 'USD', contractAmount: 900, contractConfirmed: true }), timestamp: () => 123, clock, getQuote }), { status: 503 });
    assert.equal(db.writes.length, 0);
  }
});
test('historical mode rejects missing evidence, guessed active classification, malformed known dates and unconfirmed amounts', () => {
  for (const changes of [{ sourceEvidence: null }, { projectStatus: 'Presupuesto' }, { contractAmount: 900, contractCurrency: 'USD' }, { deliveryDate: '2026-02-30' }])
    assert.throws(() => validatePayload(historical(changes)), { status: 400 });
});
test('code collisions between different historical identities never merge silently', async () => {
  const db = database(); const options = { db, payload: historical(), timestamp: () => 123, clock };
  await importProject(options);
  await assert.rejects(importProject({ ...options, payload: historical({ name: 'Otro proyecto', sourceProjectId: 'G ZZZ 0001 Otro proyecto' }) }), { status: 409 });
  assert.equal(db.records.get('projects/ct-G-ZZZ-0001').name, 'Prueba local');
});

test('creates a project and receipt; repeated delivery creates nothing', async () => {
  const db = database();
  const options = { db, payload: fixture(), timestamp: () => 123 };
  assert.deepEqual(await importProject(options), { schemaVersion: 1, projectCode: 'G ZZZ 0001', projectId: 'ct-G-ZZZ-0001', outcome: 'created' });
  assert.equal((await importProject(options)).outcome, 'already_processed');
  assert.equal(db.writes.length, 3);
  assert.equal(db.records.get('projects/ct-G-ZZZ-0001').budgetTotal, undefined);
  assert.equal(db.records.get('projectCommercial/ct-G-ZZZ-0001').budgetTotal, 500000);
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
  assert.equal(db.writes.length, 3);
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
  ['migrated sale conflict', { 'projects/a': { projectCode: 'G ZZZ 0001', commercialDataVersion: 1 }, 'projectCommercial/a': { crmSaleId: 'VE-OTHER' } }],
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
    // A transport/transaction timeout is an uncertain delivery, as it is for
    // the CRM caller. Replay the same identity, never create a replacement job.
    const concurrentDeliveries = async options => {
      const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => importProject(options)));
      const results = [];
      for (const attempt of attempts) {
        if (attempt.status === 'fulfilled') results.push(attempt.value);
        else {
          assert.ok([3, 4, 10, 14].includes(attempt.reason.code), attempt.reason.message);
          results.push(await importProject(options));
        }
      }
      return results;
    };
    const payload = fixture({ projectCode: 'G ZZZ 9999', sourceProjectId: 'G ZZZ 9999 Concurrencia local', name: 'Concurrencia local' });
    const results = await concurrentDeliveries({ db, payload, timestamp: () => FieldValue.serverTimestamp() });
    assert.equal(results.filter(result => result.outcome === 'created').length, 1);
    assert.equal(results.filter(result => result.outcome === 'already_processed').length, 4);
    assert.equal((await db.collection('projects').where('projectCode', '==', payload.projectCode).get()).size, 1);
    const b = standaloneB({ projectCode: 'B ZZZ 9996', name: 'B concurrente local', sourceProjectId: 'B ZZZ 9996 B concurrente local' });
    const bOptions = { db, payload: b, timestamp: () => FieldValue.serverTimestamp(), clock, getQuote: async () => quote };
    const bResults = await concurrentDeliveries(bOptions);
    assert.equal(bResults.filter(r => r.outcome === 'created').length, 1); assert.equal(bResults.filter(r => r.outcome === 'already_processed').length, 4);
    assert.equal((await db.collection('projects/ct-B-ZZZ-9996/budgetItems').get()).size, 0);
    assert.equal((await db.collection('projectCommercial').doc('ct-B-ZZZ-9996').get()).data().budgetTotal, 525200);

    for (const currency of ['', 'USD']) {
      const code = currency ? 'G ZZZ 9997' : 'G ZZZ 9998';
      const name = `Histórico concurrente ${currency || 'pendiente'}`;
      const historicalPayload = historical({ projectCode: code, sourceProjectId: `${code} ${name}`, name,
        ...(currency ? { contractCurrency: 'USD', contractAmount: 900, contractConfirmed: true } : {}) });
      const options = { db, payload: historicalPayload, timestamp: () => FieldValue.serverTimestamp(), clock, getQuote: async () => quote };
      const deliveries = await concurrentDeliveries(options);
      assert.equal(deliveries.filter(result => result.outcome === 'created').length, 1);
      assert.equal(deliveries.filter(result => result.outcome === 'already_processed').length, 4);
      const projects = await db.collection('projects').where('projectCode', '==', code).get();
      assert.equal(projects.size, 1);
      assert.equal(projects.docs[0].data().status, 'Archivado');
      const id = projects.docs[0].id;
      const commercial = (await db.collection('projectCommercial').doc(id).get()).data();
      assert.equal(commercial.budgetTotal, currency ? 90900 : 0);
      assert.equal(commercial.controlTotalContractAmount, currency ? 900 : null);
      const receipt = (await db.collection('crmProjectImports').doc(id).get()).data();
      assert.equal(receipt.source.schemaVersion, 2);
      assert.equal(receipt.source.sourceEvidence.rowSha256, historicalPayload.sourceEvidence.rowSha256);
      assert.equal(Boolean(receipt.conversion), currency === 'USD');
      await db.collection('projectCommercial').doc(id).update({ budgetTotal: 777777 });
      const retry = await importProject({ ...options, getQuote: async () => { throw Error('offline'); } });
      assert.equal(retry.outcome, 'already_processed');
      assert.equal((await db.collection('projectCommercial').doc(id).get()).data().budgetTotal, 777777);
    }
  } finally { await deleteApp(app); }
});
