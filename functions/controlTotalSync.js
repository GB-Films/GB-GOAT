const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { BOOK_ID, buildPlan, parseSheetData, sheetRequests, appliedState, hash } = require('./controlTotalPlan');

const RANGE_NAMES = ['Servicios_Recibidos', 'Proveedores', 'Proyectos', 'Pagos_Proveedores', 'Gastos_Adelantados'];
const RANGES = ["'Servicios_Recibidos'!A4:AB", "'Proveedores'!A4:Q", "'Proyectos'!A4:O", "'Pagos_Proveedores'!A4:R", "'Gastos_Adelantados'!A4:Q"];

function validateRequest(request) {
  const email = String(request.auth?.token?.email || '').toLowerCase();
  if (!request.auth || request.auth.token.email_verified !== true || !email) throw new HttpsError('permission-denied', 'Ingresá con una cuenta verificada de GOAT para usar esta conexión.');
  const data = request.data || {};
  if (!['status', 'preview', 'apply'].includes(data.action) || !/^[\w-]{1,120}$/.test(data.projectId || '')) throw new HttpsError('invalid-argument', 'Pedido de actualización inválido.');
  if (JSON.stringify(data).length > 160000) throw new HttpsError('invalid-argument', 'El pedido es demasiado grande.');
  if (data.action !== 'status' && (typeof data.accessToken !== 'string' || data.accessToken.length < 20 || data.accessToken.length > 5000)) throw new HttpsError('unauthenticated', 'Volvé a autorizar Google para acceder a CT.');
  if (data.action === 'apply' && !/^[a-f0-9-]{36}$/.test(data.runId || '')) throw new HttpsError('invalid-argument', 'Falta la vista previa del lote.');
  if (data.action === 'preview') {
    data.config = { projectId: String(data.config?.projectId || '').slice(0, 250), serviceDate: String(data.config?.serviceDate || '').slice(0, 10), ...(data.config?.serviceDateMode ? { serviceDateMode: data.config.serviceDateMode === 'manual' ? 'manual' : 'project' } : {}) };
    const resolutions = {};
    for (const [key, choice] of Object.entries(data.resolutions || {})) {
      if (!/^(budgetItems|areaExpenses)\/[\w-]{1,150}$/.test(key) || !choice || !['new', 'direct', 'included', 'exclude', 'void'].includes(choice.mode)) throw new HttpsError('invalid-argument', 'Vínculo de gasto inválido.');
      if (!Array.isArray(choice.serviceIds || []) || (choice.serviceIds || []).length > 20) throw new HttpsError('invalid-argument', 'Reparto de servicio inválido.');
      resolutions[key] = { mode: choice.mode, serviceIds: (choice.serviceIds || []).map(x => String(x).slice(0, 200)), reason: String(choice.reason || '').slice(0, 1500), projectId: String(choice.projectId || '').slice(0, 250), providerId: String(choice.providerId || '').slice(0, 100), serviceDate: String(choice.serviceDate || '').slice(0, 10) };
    }
    if (Object.keys(resolutions).length > 500) throw new HttpsError('invalid-argument', 'Demasiados vínculos en un lote.');
    data.resolutions = resolutions;
  }
  return { email, data };
}

async function googleJson(fetchImpl, token, url, options = {}) {
  const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(25000), headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new HttpsError('permission-denied', 'Google no autorizó CT. Revisá el permiso de Google Sheets y el acceso de tu cuenta al libro.');
    throw new HttpsError('unavailable', `No se pudo completar la consulta a Google (${response.status}). Revisá el resultado antes de reintentar.`);
  }
  return response.json();
}

async function validateGoogleIdentity(fetchImpl, token, email) {
  const identity = await googleJson(fetchImpl, token, 'https://www.googleapis.com/oauth2/v3/userinfo');
  if (String(identity.email || '').toLowerCase() !== email || identity.email_verified !== true) throw new HttpsError('permission-denied', 'Usá en Google la misma cuenta administrativa con la que ingresaste a GOAT.');
}

async function readCt(fetchImpl, token) {
  const root = `https://sheets.googleapis.com/v4/spreadsheets/${BOOK_ID}`;
  const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE' });
  RANGES.forEach(r => params.append('ranges', r));
  const [meta, data] = await Promise.all([
    googleJson(fetchImpl, token, `${root}?fields=sheets(properties(sheetId,title,gridProperties(rowCount)))`),
    googleJson(fetchImpl, token, `${root}/values:batchGet?${params}`),
  ]);
  if (data.valueRanges?.length !== RANGES.length) throw new HttpsError('failed-precondition', 'CT no devolvió todas las pestañas. No se escribió nada.');
  return parseSheetData(Object.fromEntries(RANGE_NAMES.map((name, i) => [name, data.valueRanges[i].values || []])), meta.sheets.map(s => s.properties));
}

async function readSource(db, projectId) {
  const ref = db.collection('projects').doc(projectId);
  const [projectDoc, commercialDoc, budget, area] = await Promise.all([
    ref.get(), db.collection('projectCommercial').doc(projectId).get(), ref.collection('budgetItems').get(), ref.collection('areaExpenses').get(),
  ]);
  if (!projectDoc.exists) throw new HttpsError('not-found', 'El proyecto ya no existe.');
  const documents = [...budget.docs.map(d => ({ ...d.data(), id: d.id, collection: 'budgetItems' })), ...area.docs.map(d => ({ ...d.data(), id: d.id, collection: 'areaExpenses' }))];
  const ids = [...new Set(documents.map(d => d.providerId).filter(x => typeof x === 'string' && /^[\w-]{1,150}$/.test(x)))];
  const providerDocs = ids.length ? await db.getAll(...ids.map(id => db.collection('providers').doc(id))) : [];
  return { project: { ...projectDoc.data(), ...(commercialDoc.exists ? commercialDoc.data() : {}) }, documents, sourceProviders: Object.fromEntries(providerDocs.filter(d => d.exists).map(d => [d.id, d.data()])) };
}

function publicPlan(plan, runId, ct, lastRun, resolutions = {}) {
  const savedChoices = Object.fromEntries(Object.entries(plan.bindings).filter(([, b]) => ['direct', 'included', 'exclude', 'void'].includes(b.mode)).map(([key, b]) => [key, { mode: b.mode, serviceIds: b.serviceIds || [], projectId: b.projectId || '', providerId: b.providerId || '', reason: b.reason || '' }]));
  return { runId, summary: plan.summary, items: plan.items, config: plan.config, lastRun: lastRun || null,
    resolutions: { ...savedChoices, ...resolutions },
    projects: ct.projects, providers: ct.providers.map(p => ({ id: p.id, name: p.name })),
    // Restricted to global app administrators. Cross-project links are needed for
    // a shared campaign, monthly salary or aggregate; no bank or payroll notes are returned.
    services: ct.rows.map(r => ({ id: String(r.values[0]), projectId: String(r.values[5]), name: String(r.values[7] || ''), provider: String(r.values[2] || ''), amount: Number(r.values[10]) || 0 })),
  };
}

function verifyDerived(actions, ct) {
  for (const action of actions) {
    const values = ct.ids.get(action.id)?.values;
    const unit = ct.projects.find(p => p.id === values?.[5])?.unit;
    if (!values || !unit || values[6] !== unit) throw new HttpsError('failed-precondition', 'El costo se registró, pero su unidad no se calculó correctamente. Revisá las fórmulas antes de confirmar el lote.');
    if (Number(values[10]) > 0 && (!(Number(values[16]) > 0) || !(Number(values[23]) > 0) || !(Number(values[20]) > 0))) throw new HttpsError('failed-precondition', 'El costo se registró, pero falta su conversión o reconocimiento mensual. Revisá TC y fórmulas antes de confirmar el lote.');
  }
}

async function withBookLock(db, owner, fn) {
  const lock = db.collection('ctSyncLocks').doc('control-total');
  await db.runTransaction(async tx => {
    const snap = await tx.get(lock), current = snap.data();
    if (current?.pendingOwner && current.pendingOwner !== owner) throw new HttpsError('aborted', 'Hay un lote anterior pendiente de verificación. Retomalo antes de escribir otro proyecto.');
    if (current?.expiresAt > Date.now()) throw new HttpsError('aborted', 'Hay otra actualización de CT en curso. Esperá a que termine y reintentá.');
    tx.set(lock, { owner, expiresAt: Date.now() + 300000, ...(current?.pendingOwner ? { pendingOwner: current.pendingOwner } : {}) });
  });
  let uncertain = false, succeeded = false;
  try { const result = await fn(); succeeded = true; return result; }
  catch (error) { uncertain = error.ctSyncUncertain === true; throw error; }
  finally {
    await db.runTransaction(async tx => {
      const s = await tx.get(lock);
      if (s.data()?.owner !== owner) return;
      if (uncertain || (!succeeded && s.data()?.pendingOwner)) tx.set(lock, { owner, pendingOwner: owner, expiresAt: 0 });
      else tx.delete(lock);
    });
  }
}

function createControlTotalHandler({ db, fetchImpl = fetch, now = () => new Date().toISOString() }) {
  return async request => {
    const { email, data } = validateRequest(request);
    const user = await db.collection('users').doc(request.auth.uid).get();
    if (user.data()?.role !== 'admin') throw new HttpsError('permission-denied', 'Sólo los administradores globales de GOAT pueden actualizar CT.');
    const stateRef = db.collection('ctSyncProjects').doc(data.projectId);
    const state = (await stateRef.get()).data() || {};
    if (data.action === 'status') return { lastRun: state.lastRun || null, config: state.config || null };
    await validateGoogleIdentity(fetchImpl, data.accessToken, email);
    if (data.action === 'preview') {
      if (state.pendingRunId) {
        const pending = (await stateRef.collection('runs').doc(state.pendingRunId).get()).data();
        if (pending && ['applying', 'uncertain'].includes(pending.status)) {
          if (pending.createdBy !== request.auth.uid) throw new HttpsError('aborted', 'La cuenta que inició el lote anterior debe verificarlo antes de continuar.');
          const ct = await readCt(fetchImpl, data.accessToken);
          return { ...publicPlan(pending.plan, state.pendingRunId, ct, state.lastRun, pending.resolutions), recover: true };
        }
      }
      const [source, ct] = await Promise.all([readSource(db, data.projectId), readCt(fetchImpl, data.accessToken)]);
      const config = data.config || state.config || {}, resolutions = data.resolutions || {};
      const plan = buildPlan({ projectId: data.projectId, ...source, ct, state, config, resolutions });
      const runId = crypto.randomUUID();
      if (JSON.stringify(plan).length > 650000) throw new HttpsError('resource-exhausted', 'El lote es muy grande. Revisalo por partes.');
      await stateRef.collection('runs').doc(runId).create({ status: 'preview', createdBy: request.auth.uid, createdAt: now(), expiresAt: Date.now() + 900000, stateBaselineHash: state.baselineHash || '', plan, config, resolutions });
      return publicPlan(plan, runId, ct, state.lastRun, resolutions);
    }
    return withBookLock(db, `${data.projectId}/${data.runId}`, async () => {
      const runRef = stateRef.collection('runs').doc(data.runId), run = (await runRef.get()).data();
      if (!run || run.createdBy !== request.auth.uid) throw new HttpsError('permission-denied', 'La vista previa pertenece a otra sesión.');
      if (run.status === 'verified') return run.result;
      const latestState = (await stateRef.get()).data() || {};
      if (latestState.pendingRunId && latestState.pendingRunId !== data.runId) throw new HttpsError('aborted', 'Retomá primero el lote pendiente de este proyecto.');
      let ct = await readCt(fetchImpl, data.accessToken);
      let plan = run.plan;
      if (!['applying', 'uncertain'].includes(run.status)) {
        if (run.expiresAt < Date.now()) throw new HttpsError('failed-precondition', 'La vista previa venció. Compará otra vez antes de aplicar.');
        const source = await readSource(db, data.projectId);
        const fresh = buildPlan({ projectId: data.projectId, ...source, ct, state: latestState, config: run.config, resolutions: run.resolutions });
        if (fresh.fingerprint !== plan.fingerprint) throw new HttpsError('aborted', 'GOAT o CT cambiaron desde la vista previa. Volvé a comparar; no se reemplazó ningún registro.');
      } else {
        const recovered = appliedState(plan.actions, ct);
        if (recovered === 'conflict') throw new HttpsError('aborted', 'El lote anterior quedó con diferencias. Revisá sus registros antes de reintentar.');
        // A previously verified newer run cannot be overwritten by recovery of an old request.
        if ((latestState.baselineHash || '') !== (run.stateBaselineHash || '')) throw new HttpsError('aborted', 'Existe una actualización posterior. Revisá este lote desde su historial.');
        if (recovered === 'before') {
          const source = await readSource(db, data.projectId);
          if (hash({ project: source.project, documents: source.documents }) !== plan.sourceHash) throw new HttpsError('aborted', 'GOAT cambió después del intento anterior. Revisá este lote antes de aplicar.');
        }
      }
      const start = db.batch();
      start.update(runRef, { status: 'applying', applyingAt: now() });
      start.set(stateRef, { ...latestState, pendingRunId: data.runId });
      start.set(db.collection('ctSyncLocks').doc('control-total'), { owner: `${data.projectId}/${data.runId}`, pendingOwner: `${data.projectId}/${data.runId}`, expiresAt: Date.now() + 300000 });
      await start.commit();
      try {
        if (appliedState(plan.actions, ct) !== 'after' && plan.actions.length) {
          const requests = sheetRequests(plan.actions, ct.sheet.sheetId, ct.sheet.gridProperties.rowCount);
          await googleJson(fetchImpl, data.accessToken, `https://sheets.googleapis.com/v4/spreadsheets/${BOOK_ID}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
          ct = await readCt(fetchImpl, data.accessToken);
        }
        if (appliedState(plan.actions, ct) !== 'after') throw new HttpsError('aborted', 'La lectura posterior no confirmó todo el lote. No se marcó como actualizado.');
        verifyDerived(plan.actions, ct);
        const sourceAfter = await readSource(db, data.projectId);
        const sourceChanged = hash({ project: sourceAfter.project, documents: sourceAfter.documents }) !== plan.sourceHash;
        const result = { runId: data.runId, at: now(), status: plan.summary.pending || sourceChanged ? 'partial' : 'verified', sourceChanged, summary: plan.summary };
        // Record the applied source/target baseline only after the Sheet readback. Retrying this run is a no-op.
        const batch = db.batch();
        batch.set(stateRef, { bindings: plan.bindings, config: plan.config, lastRun: result, baselineHash: hash(plan.bindings) });
        batch.update(runRef, { status: 'verified', result, verifiedAt: result.at });
        await batch.commit();
        return result;
      } catch (error) {
        await runRef.update({ status: 'uncertain', failedAt: now() });
        const failure = error instanceof HttpsError ? error : new HttpsError('unavailable', 'No se pudo confirmar la actualización. Conservá esta ventana y usá Verificar/reintentar; no generes un lote nuevo.');
        failure.details = { ctSyncRecovery: true };
        failure.ctSyncUncertain = true;
        throw failure;
      }
    });
  };
}

module.exports = { validateRequest, validateGoogleIdentity, readCt, readSource, verifyDerived, withBookLock, createControlTotalHandler };
