// Cross-repository contract test. Local demo emulator only; never calls live GOAT.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { importProject, validatePayload } = require('../functions/crmProjectImport');
const { SOURCE, argentinaDate } = require('../functions/bnaQuote');
const Bani = require('../functions/crmBaniPost');

async function main() {
  assert(process.env.GCLOUD_PROJECT?.startsWith('demo-'), 'Requires a demo project');
  assert(/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''), 'Requires the local Firestore emulator');
  assert(process.env.CRM_REPO_ROOT && process.env.CRM_TEST_PYTHON, 'Set CRM_REPO_ROOT and CRM_TEST_PYTHON');
  const source = String.raw`
import sys,json
sys.path.insert(0,sys.argv[1])
import goat_destino as goat,goat_historicos as history
from verificar_goat_historicos import fila,crudo
from unittest.mock import patch
payloads=[]
for i,(currency,amount) in enumerate([('ARS','500000'),('USD','900'),('','')]):
    name=f'Prueba local {i}';base=f'E2E {9000+i} {name}'
    f=fila(proyecto=name,codigo_empresa=f'G {base}',codigo=base,codigo_n=f'operation-{i}',codigo_discord=f'channel-{i}',moneda=currency,precio_final=amount)
    b={**f,'codigo_empresa':f'B {base}','empresa':'Bani VFX','tipo_cliente':'Interno','precio_final':['1500000','2100','0'][i],'moneda':['ARS','USD','ARS'][i]}
    raw=crudo([f,b])
    class LocalRegistry:
        def leer_bytes(self,path):return raw
    with patch.object(goat,'enviar_payload',side_effect=lambda p:p):
        payloads.append(goat.enviar_proyecto([f],{'budget_usd':99999999},almacen=LocalRegistry()))
f=fila(proyecto='Histórico local',codigo_empresa='G E2E 9003 Histórico local',origen='import-v2',venta_id='',moneda='',precio_final='',fecha_entrega='')
payloads+=history.planear(crudo([f]),[f])['candidates']
legacy=fila(proyecto='Compatible local',codigo_empresa='G E2E 9004 Compatible local')
payloads.append(goat.payload_del_proyecto([legacy],None))
print(json.dumps(payloads,allow_nan=False))
`;
  const generated = spawnSync(process.env.CRM_TEST_PYTHON, ['-c', source, path.join(process.env.CRM_REPO_ROOT, 'code_generator')], { encoding: 'utf8', timeout: 30000 });
  assert.equal(generated.status, 0, generated.stderr);
  const payloads = JSON.parse(generated.stdout);
  assert.equal(payloads.length, 5);
  const req = createRequire(path.resolve(__dirname, '../functions/package.json'));
  const { initializeApp, deleteApp } = req('firebase-admin/app');
  const { getFirestore, FieldValue } = req('firebase-admin/firestore');
  const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT }, 'cross-repo-import');
  try {
    const db = getFirestore(app), now = new Date();
    const master = { name: 'BANI VFX LLC', businessName: 'BANI VFX LLC', type: 'empresa', category: 'Postproducción' };
    await db.collection('providers').doc(Bani.BANI_PROVIDER_ID).set(master);
    const quote = { source: SOURCE, kind: 'billetes', date: argentinaDate(now), buy: 100, sell: 102, rate: 101, sha256: 'e'.repeat(64), retrievedAt: now.toISOString() };
    let transientRetries = 0;
    for (const payload of payloads) {
      console.log(`Checking ${payload.projectCode}: schema ${payload.schemaVersion}, ${payload.importMode || 'legacy'}`);
      validatePayload(payload);
      const options = { db, payload, timestamp: () => FieldValue.serverTimestamp(), clock: () => now, getQuote: async () => quote };
      const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => importProject(options)));
      // A failed/uncertain HTTP attempt stays pending in the caller. Replay the
      // same identity, rather than treating a transport failure as a second job.
      const results = [];
      for (const attempt of attempts) {
        if (attempt.status === 'fulfilled') results.push(attempt.value);
        else { transientRetries++; results.push(await importProject(options)); }
      }
      assert.equal(results.filter(r => r.outcome === 'created').length, 1);
      assert.equal(results.filter(r => r.outcome === 'already_processed').length, 4);
      const projects = await db.collection('projects').where('projectCode', '==', payload.projectCode).get();
      assert.equal(projects.size, 1);
      const id = projects.docs[0].id;
      const commercialRef = db.collection('projectCommercial').doc(id);
      const commercial = (await commercialRef.get()).data();
      assert.equal(commercial.budgetTotal, payload.contractCurrency === 'USD' ? 90900 : payload.contractAmount || 0);
      const estimates = await db.collection(`projects/${id}/budgetItems`).get();
      if (payload.importMode === 'new') {
        assert.equal(estimates.size, 1);
        const row = estimates.docs[0].data();
        assert.equal(row.providerId, Bani.BANI_PROVIDER_ID); assert.equal(row.description, 'Toda la Post');
        assert.equal(row.economicNature, 'internal_estimate');
        const bAmount = Number(payload.baniPost.bRow.precio_final);
        assert.equal(row.total, payload.baniPost.bRow.moneda === 'USD' ? bAmount * 101 : bAmount);
        assert.equal(row.paymentHistory, undefined); assert.equal(row.paid, undefined);
        await estimates.docs[0].ref.update({ total: 1777777, unitPrice: 1777777 });
      } else assert.equal(estimates.size, 0, 'unknown B produces no invented zero line');
      assert.equal((await db.collection(`projects/${id}/areaExpenses`).get()).size, 0);
      if (payload.importMode === 'historical') {
        assert.equal(projects.docs[0].data().status, 'Histórico');
        assert.equal(commercial.crmSaleId, '');
        assert.equal(commercial.controlTotalConfirmationDate, '');
      }
      await commercialRef.update({ budgetTotal: 7654321 });
      assert.equal((await importProject({ ...options, getQuote: async () => { throw Error('offline'); } })).outcome, 'already_processed');
      assert.equal((await commercialRef.get()).data().budgetTotal, 7654321);
      if (estimates.size) assert.equal((await estimates.docs[0].ref.get()).data().total, 1777777);
    }
    // Abort after every create has been queued: Firestore must commit none of
    // project/commercial/main-budget/receipt, rather than compensating by deletion.
    const abortPayload = JSON.parse(JSON.stringify(payloads[0]));
    abortPayload.projectCode = 'G E2E 9099'; abortPayload.name = 'Atomic rollback local'; abortPayload.sourceProjectId = 'G E2E 9099 Atomic rollback local';
    for (const [side, prefix] of [['gRow', 'G'], ['bRow', 'B']]) Object.assign(abortPayload.baniPost[side], {
      codigo: 'E2E 9099 Atomic rollback local', codigo_empresa: prefix + ' E2E 9099 Atomic rollback local', proyecto: abortPayload.name,
      codigo_n: 'operation-abort', codigo_discord: 'channel-abort',
    });
    abortPayload.sourceEvidence.rowSha256 = Bani.rowHash(abortPayload.baniPost.gRow);
    const abortingDb = { collection: db.collection.bind(db), runTransaction: callback => db.runTransaction(tx => callback({
      get: tx.get.bind(tx), create(ref, value) { tx.create(ref, value); if (ref.path.startsWith('crmProjectImports/')) throw Error('forced group rollback'); },
    })) };
    await assert.rejects(importProject({ db: abortingDb, payload: abortPayload, timestamp: () => FieldValue.serverTimestamp(), clock: () => now }), /forced group rollback/);
    for (const target of ['projects/ct-G-E2E-9099', 'projectCommercial/ct-G-E2E-9099', 'crmProjectImports/ct-G-E2E-9099', `projects/ct-G-E2E-9099/budgetItems/${Bani.BUDGET_ITEM_ID}`])
      assert.equal((await db.doc(target).get()).exists, false, target + ' must not survive an aborted transaction');
    assert.deepEqual((await db.collection('providers').doc(Bani.BANI_PROVIDER_ID).get()).data(), master);
    console.log(`PASS: 5 actual Python caller payloads → Node → local Firestore; 25 concurrent attempts, ${transientRetries} transient attempts replayed, 5 projects, 3 internal estimates including confirmed zero; edited G/B budgets preserved; atomic rollback left all 4 documents absent; provider unchanged.`);
  } finally { await deleteApp(app); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
