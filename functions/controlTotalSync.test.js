const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createControlTotalHandler, validateRequest } = require('./controlTotalSync');

const token = 'unit-test-oauth-token-not-a-real-credential';
const projectId = 'local-project';
const clone = value => value === undefined ? undefined : structuredClone(value);
function noUndefined(value) {
  if (value === undefined) throw Error('Undefined Firestore field');
  if (value && typeof value === 'object') for (const child of Object.values(value)) noUndefined(child);
}
function database(seed) {
  const records = new Map(Object.entries(seed).map(([k, v]) => [k, clone(v)]));
  let txQueue = Promise.resolve();
  const snapshot = (path) => ({ id: path.split('/').at(-1), exists: records.has(path), data: () => clone(records.get(path)) });
  const write = (path, value, merge = false) => { noUndefined(value); records.set(path, clone(merge ? { ...records.get(path), ...value } : value)); };
  const reference = path => ({ path, id: path.split('/').at(-1), collection: name => collection(`${path}/${name}`), get: async () => snapshot(path), create: async value => { if (records.has(path)) throw Error('Already exists'); write(path, value); }, update: async value => write(path, value, true) });
  const collection = path => ({ doc: id => reference(`${path}/${id}`), get: async () => ({ docs: [...records.keys()].filter(k => k.startsWith(`${path}/`) && k.split('/').length === path.split('/').length + 1).sort().map(snapshot) }) });
  return {
    records, collection, getAll: async (...refs) => refs.map(r => snapshot(r.path)),
    async runTransaction(callback) {
      let release;
      const previous = txQueue; txQueue = new Promise(r => { release = r; }); await previous;
      const writes = [];
      try {
        const result = await callback({ get: async ref => snapshot(ref.path), set: (ref, value) => writes.push(() => write(ref.path, value)), delete: ref => writes.push(() => records.delete(ref.path)) });
        writes.forEach(fn => fn()); return result;
      } finally { release(); }
    },
    batch() {
      const writes = [];
      return { set: (ref, value) => writes.push(() => write(ref.path, value)), update: (ref, value) => writes.push(() => write(ref.path, value, true)), commit: async () => { writes.forEach(fn => fn()); } };
    },
  };
}

function environment() {
  const services = Array(28).fill('');
  Object.assign(services, { 0: 'ServicioID (auto)', 1: 'Fecha', 2: 'Proveedor selector', 5: 'ProyectoID', 9: 'Moneda', 10: 'Monto', 24: 'Notas' });
  const tables = {
    Servicios_Recibidos: [services], Proveedores: [['ProveedorID', 'Nombre', '', '', 'CUIT/Tax ID'], ['PROV-local', 'Proveedor local', 'PROV-local | Proveedor local', '', '']],
    Proyectos: [['ProyectoID', '', '', '', '', 'Unidad dueña'], ['G ZZ 0001 Local', '', '', '', '', 'GB']], Pagos_Proveedores: [[]], Gastos_Adelantados: [[]],
  };
  const db = database({
    'users/admin-local': { role: 'admin' },
    [`projects/${projectId}`]: { name: 'Local', activeAreas: [], shootingDate: '2026-09-23' },
    [`projectCommercial/${projectId}`]: { controlTotalProjectId: 'G ZZ 0001 Local' },
    [`projects/${projectId}/budgetItems/expense-local`]: { providerName: 'Proveedor local', area: 'Ejecutiva', description: 'Servicio local', total: 100 },
  });
  let writes = 0, failAfterWrite = false, holdWrite = null, identity = 'tomas@granberta.com', missingFormula = false;
  const json = data => ({ ok: true, status: 200, json: async () => clone(data) });
  const fetchImpl = async (url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    if (url.includes('/userinfo')) return json({ email: identity, email_verified: true });
    if (url.includes('/values:batchGet')) return json({ valueRanges: Object.values(tables).map(values => ({ values })) });
    if (url.endsWith(':batchUpdate')) {
      if (holdWrite) await holdWrite;
      writes++;
      for (const r of JSON.parse(options.body).requests) {
        if (!r.updateCells) continue;
        const { start, rows } = r.updateCells;
        assert.equal(start.sheetId, 55);
        for (let y = 0; y < rows.length; y++) {
          const i = start.rowIndex - 3 + y;
          tables.Servicios_Recibidos[i] ||= [];
          rows[y].values.forEach((cell, x) => {
            const v = cell.userEnteredValue;
            const col = start.columnIndex + x;
            const data = tables.Servicios_Recibidos[i];
            const formulaResult = { 6: 'GB', 15: 1550, 16: Number(data[10]) / 1550, 20: 46266, 21: 1, 22: 46296, 23: missingFormula ? 0 : Number(data[10]) / 1550 };
            data[col] = v.numberValue ?? v.stringValue ?? formulaResult[col] ?? '';
          });
        }
      }
      if (failAfterWrite) { failAfterWrite = false; throw Error('Response lost after committed write'); }
      return json({ replies: [] });
    }
    return json({ sheets: [{ properties: { sheetId: 55, title: 'Servicios_Recibidos', gridProperties: { rowCount: 999 } } }] });
  };
  const call = createControlTotalHandler({ db, fetchImpl });
  const request = (action, extra = {}) => ({ auth: { uid: 'admin-local', token: { email: 'tomas@granberta.com', email_verified: true } }, data: { action, projectId, accessToken: token, ...extra } });
  return { db, tables, call, request, writes: () => writes, loseResponse: () => { failAfterWrite = true; }, hold: promise => { holdWrite = promise; }, setIdentity: value => { identity = value; }, breakFormula: () => { missingFormula = true; } };
}

test('anonymous/unverified/other-account requests are rejected before any financial access', () => {
  assert.throws(() => validateRequest({ data: {} }), /administrativas/);
  assert.throws(() => validateRequest({ auth: { uid: 'x', token: { email: 'tomas@granberta.com' } }, data: {} }), /administrativas/);
  assert.throws(() => validateRequest({ auth: { uid: 'x', token: { email: 'other@example.invalid', email_verified: true } }, data: {} }), /administrativas/);
});
test('preview writes only private run state; apply and repeat produce one Sheet write', async () => {
  const env = environment();
  const preview = await env.call(env.request('preview'));
  assert.equal(preview.summary.create, 1); assert.equal(env.writes(), 0);
  const applied = await env.call(env.request('apply', { runId: preview.runId }));
  assert.equal(applied.status, 'verified'); assert.equal(env.writes(), 1);
  const again = await env.call(env.request('apply', { runId: preview.runId }));
  assert.deepEqual(again, applied); assert.equal(env.writes(), 1);
  assert.ok(!JSON.stringify([...env.db.records.values()]).includes(token));
  const next = await env.call(env.request('preview'));
  assert.equal(next.summary.create, 0); assert.equal(next.summary.update, 0);
});
test('source changes between preview and apply stop all writes', async () => {
  const env = environment(); const preview = await env.call(env.request('preview'));
  env.db.records.get(`projects/${projectId}/budgetItems/expense-local`).total = 120;
  await assert.rejects(env.call(env.request('apply', { runId: preview.runId })), /cambiaron/);
  assert.equal(env.writes(), 0);
});
test('OAuth account must match the verified Firebase account', async () => {
  const env = environment(); env.setIdentity('different@example.invalid');
  await assert.rejects(env.call(env.request('preview')), /misma cuenta/);
  assert.equal(env.writes(), 0);
});
test('missing monthly formulas never produce a verified result', async () => {
  const env = environment(); const p = await env.call(env.request('preview')); env.breakFormula();
  await assert.rejects(env.call(env.request('apply', { runId: p.runId })), /reconocimiento mensual/);
  assert.equal(env.writes(), 1);
  assert.equal(env.db.records.get(`ctSyncProjects/${projectId}`).lastRun, undefined);
  assert.ok(env.db.records.get('ctSyncLocks/control-total').pendingOwner);
});
test('manual CT change after preview stops all writes', async () => {
  const env = environment(); const preview = await env.call(env.request('preview'));
  env.tables.Servicios_Recibidos.push(['MANUAL-local', 46288, 'PROV-local | Proveedor local', '', '', 'G ZZ 0001 Local', '', '', '', 'ARS', 5]);
  await assert.rejects(env.call(env.request('apply', { runId: preview.runId })), /cambiaron/);
  assert.equal(env.writes(), 0);
});
test('lost response recovers from readback without a second bank/cost write', async () => {
  const env = environment(); const preview = await env.call(env.request('preview')); env.loseResponse();
  await assert.rejects(env.call(env.request('apply', { runId: preview.runId })), /confirmar/);
  assert.equal(env.writes(), 1);
  const resumed = await env.call(env.request('preview'));
  assert.equal(resumed.runId, preview.runId); assert.equal(resumed.recover, true);
  assert.ok(env.db.records.get('ctSyncLocks/control-total').pendingOwner);
  const result = await env.call(env.request('apply', { runId: preview.runId }));
  assert.equal(result.status, 'verified'); assert.equal(env.writes(), 1);
  assert.equal(env.db.records.has('ctSyncLocks/control-total'), false);
});
test('simultaneous applies are serialized across the workbook', async () => {
  const env = environment(); const preview = await env.call(env.request('preview'));
  let release; env.hold(new Promise(r => { release = r; }));
  const first = env.call(env.request('apply', { runId: preview.runId }));
  while (!env.db.records.has('ctSyncLocks/control-total')) await new Promise(r => setTimeout(r, 1));
  await assert.rejects(env.call(env.request('apply', { runId: preview.runId })), /otra actualización/);
  release(); await first; assert.equal(env.writes(), 1);
});
test('malformed resolution and expired preview fail closed', async () => {
  const env = environment();
  await assert.rejects(env.call(env.request('preview', { resolutions: { 'unknown/doc': { mode: 'new' } } })), /inválido/);
  const preview = await env.call(env.request('preview'));
  env.db.records.get(`ctSyncProjects/${projectId}/runs/${preview.runId}`).expiresAt = 0;
  await assert.rejects(env.call(env.request('apply', { runId: preview.runId })), /venció/);
  assert.equal(env.writes(), 0);
});
