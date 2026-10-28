'use strict';

// The HTTP function is private: Cloud Run IAM authenticates the CRM workflow.
// This module only creates projects. A retry never edits an existing project.
class ImportError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const FIELDS = [
  'schemaVersion', 'projectCode', 'sourceProjectId', 'name', 'saleId',
  'clientName', 'brandName', 'companyName', 'serviceName', 'confirmationDate',
  'deliveryDate', 'contractCurrency', 'contractAmount', 'ownerUnit',
  'internalProviderUnit', 'condition', 'status',
];
const V2_FIELDS = [...FIELDS, 'importMode', 'projectStatus', 'sourceEvidence', 'contractConfirmed', 'baniPost'];
const Bani = require('./crmBaniPost');
const HISTORICAL_STATUSES = ['Cerrado', 'Archivado', 'Cancelado', 'Histórico'];
const { fetchBnaQuote, convertUsd, validateQuote } = require('./bnaQuote');
const NEED_QUOTE = Symbol('verified-quote-required');
const invalid = message => { throw new ImportError(400, message); };

function validatePayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Se requiere un objeto JSON.');
  const v2 = input.schemaVersion === 2, historical = v2 && input.importMode === 'historical';
  if (Object.keys(input).some(key => !(v2 ? V2_FIELDS : FIELDS).includes(key))) invalid('El mensaje contiene campos no admitidos.');
  if (![1, 2].includes(input.schemaVersion)) invalid('Versión de integración no admitida.');
  const data = { schemaVersion: input.schemaVersion };
  for (const key of FIELDS.filter(key => !['schemaVersion', 'contractAmount'].includes(key))) {
    const value = historical && ['confirmationDate', 'deliveryDate', 'saleId'].includes(key) && input[key] === null ? '' : input[key];
    if (typeof value !== 'string' || value.length > 1000 || /[\u0000-\u001f]/.test(value)) {
      invalid(`Campo ${key} inválido.`);
    }
    data[key] = value.trim();
  }
  if (!/^G [A-Z0-9_-]{1,20} \d{4,8}$/.test(data.projectCode)
      || Number(data.projectCode.split(' ')[2]) < 1) invalid('Sólo se admiten códigos oficiales G.');
  if (!data.name || data.sourceProjectId !== `${data.projectCode} ${data.name}`) invalid('El nombre y el código completo no coinciden.');
  if ((!data.saleId && !historical) || data.saleId.length > 128 || /[\s/]/.test(data.saleId)) invalid('Falta la venta de origen o el marcador interno.');
  if (!data.clientName) invalid('Falta el cliente del código.');
  if (data.ownerUnit !== 'GB' || (!historical && (data.internalProviderUnit !== '' || data.condition !== 'Externo' || data.status !== 'Activo'))) {
    invalid('Sólo se admite el alta externa de Gran Berta.');
  }
  for (const key of ['confirmationDate', 'deliveryDate']) {
    const date = data[key];
    if (historical && date === '') continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))
        || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) invalid(`Fecha ${key} inválida.`);
  }
  if (!['ARS', 'USD', ''].includes(data.contractCurrency)) invalid('Moneda no admitida.');
  const amount = input.contractAmount;
  if (amount !== null && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0)) invalid('Monto contractual inválido.');
  if ((data.contractCurrency === '') !== (amount === null)) invalid('La moneda y el monto deben estar definidos juntos, o ambos pendientes.');
  data.contractAmount = amount;
  if (v2) {
    if (!['new', 'historical'].includes(input.importMode) || typeof input.contractConfirmed !== 'boolean') invalid('Indicá el modo y la confirmación del contrato.');
    if (historical ? !HISTORICAL_STATUSES.includes(input.projectStatus) : input.projectStatus !== 'Presupuesto') invalid('La clasificación del proyecto no es válida para este modo.');
    if ((amount !== null) !== input.contractConfirmed) invalid('Un precio pendiente conserva monto nulo y moneda vacía. Un importe requiere confirmación explícita.');
    const evidence = input.sourceEvidence;
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)
      || Object.keys(evidence).sort().join(',') !== 'note,registryPath,registrySha256,rowSha256,verifiedAt'
      || evidence.registryPath !== 'codigos/codigos.csv' || !/^[a-f0-9]{64}$/.test(evidence.registrySha256)
      || !/^[a-f0-9]{64}$/.test(evidence.rowSha256) || typeof evidence.note !== 'string' || !evidence.note.trim() || evidence.note.length > 1000
      || typeof evidence.verifiedAt !== 'string' || !Number.isFinite(Date.parse(evidence.verifiedAt))) invalid('Falta la evidencia verificable del registro de códigos.');
    data.importMode = input.importMode; data.projectStatus = input.projectStatus; data.contractConfirmed = input.contractConfirmed;
    data.sourceEvidence = { ...evidence };
    if (input.baniPost !== undefined) {
      if (JSON.stringify(input.baniPost).length > 16000) invalid('La evidencia BANI supera el tamaño admitido.');
      data.baniPost = input.baniPost;
    }
  }
  return data;
}

const { splitProjectCommercial } = require('./projectCommercial');
const projectIdFor = code => `ct-${code.replace(/\s+/g, '-')}`;
const response = (data, projectId, outcome, baniPost) => ({ schemaVersion: 1, projectCode: data.projectCode, projectId, outcome,
  ...(data.baniPost !== undefined && baniPost ? { baniPost: { state: baniPost.state, ...(baniPost.reason ? { reason: baniPost.reason } : {}) } } : {}) });

function projectFromPayload(data, timestamp, quote = null, now = new Date()) {
  let budget = data.contractCurrency === 'ARS' ? data.contractAmount : 0;
  const warnings = [];
  if (data.contractCurrency === 'USD') {
    // V1 already defines this as the confirmed per-code contract amount. Keep
    // that protocol usable while the caller rolls forward to evidenced V2.
    if ((data.schemaVersion === 2 && !data.contractConfirmed) || !quote) throw new ImportError(409, 'USD requiere confirmación explícita y cotización oficial del día.');
    try { budget = convertUsd(data.contractAmount, quote, now); }
    catch { throw new ImportError(503, 'La cotización BNA no se pudo verificar. El alta queda pendiente.'); }
    warnings.push(`USD ${data.contractAmount} confirmado; convertido al crear con BNA billetes ${quote.date}: compra ${quote.buy}, venta ${quote.sell}, promedio ${quote.rate}. Fuente: ${quote.source}`);
  }
  if (data.contractAmount === null) warnings.push('Precio pendiente de confirmar. El presupuesto operativo 0 es un marcador pendiente, no un contrato por cero.');
  if (data.importMode === 'historical') warnings.push(`Clasificación histórica: ${data.projectStatus}. Estado de origen: ${data.status || 'No informado'}. ${data.sourceEvidence.note}`);
  return {
    name: data.name,
    description: data.importMode === 'historical' ? 'Proyecto histórico del registro de códigos; se conservan como pendientes las fechas y el precio no informados.' : '',
    projectCode: data.projectCode,
    clientName: data.clientName,
    brandName: data.brandName,
    companyName: data.companyName,
    serviceName: data.serviceName,
    budgetTotal: budget,
    status: data.projectStatus || 'Presupuesto',
    ...(warnings.length ? { controlTotalSourceWarning: warnings.join(' ').slice(0, 2000) } : {}),
    createdBy: 'crm-code-generator',
    createdByEmail: '',
    collaboratorEmails: [],
    categories: ['Ejecutiva', 'Producción de Campo', 'Post Producción'],
    executiveCategoryDefaultApplied: true,
    controlTotalProjectId: data.sourceProjectId,
    controlTotalUrl: 'https://docs.google.com/spreadsheets/d/1YBEXhP3ZrcjW0DnvSVZyxVPTK4QLxrDVUu3ZMrpCdHY/edit#gid=293971582',
    controlTotalStatusAtImport: data.status,
    controlTotalOwnerUnit: data.ownerUnit,
    controlTotalInternalProviderUnit: data.internalProviderUnit,
    controlTotalCondition: data.condition,
    controlTotalConfirmationDate: data.confirmationDate,
    controlTotalDeliveryDate: data.deliveryDate,
    controlTotalContractCurrency: data.contractCurrency,
    controlTotalContractAmount: data.contractAmount,
    controlTotalContractArs: data.contractCurrency === 'ARS' ? data.contractAmount : null,
    controlTotalContractUsd: data.contractCurrency === 'USD' ? data.contractAmount : null,
    controlTotalImportedAt: timestamp,
    crmSaleId: data.saleId,
    crmSaleUrl: !data.saleId || data.saleId === 'interno' ? '' : `https://gran-crm.granberta.workers.dev/?ir=venta/${encodeURIComponent(data.saleId)}`,
    crmProjectImportVersion: data.schemaVersion,
    crmProjectImportedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function importProject({ db, payload, timestamp, clock = () => new Date(), getQuote = fetchBnaQuote }) {
  const data = validatePayload(payload);
  const projectId = projectIdFor(data.projectCode);
  const markerRef = db.collection('crmProjectImports').doc(projectId);
  const projectRef = db.collection('projects').doc(projectId);
  let quote = null, quoteUnavailable = false;
  const run = () => db.runTransaction(async transaction => {
    const marker = await transaction.get(markerRef);
    if (marker.exists) {
      const previous = marker.data();
      if (previous.projectCode !== data.projectCode || (previous.saleId && data.saleId && previous.saleId !== data.saleId) || !previous.projectId
        || (previous.source?.sourceProjectId && previous.source.sourceProjectId !== data.sourceProjectId)) {
        throw new ImportError(409, 'Este código tiene otra procedencia registrada. Requiere revisión.');
      }
      // Keep this receipt even when an administrator deletes the project.
      return response(data, previous.projectId, 'already_processed', previous.baniPost);
    }

    const canonical = await transaction.get(projectRef);
    const matches = await transaction.get(db.collection('projects').where('projectCode', '==', data.projectCode).limit(2));
    if (matches.size > 1 || (canonical.exists && canonical.data().projectCode !== data.projectCode)
        || (canonical.exists && matches.size === 1 && matches.docs[0].id !== projectId)) {
      throw new ImportError(409, 'El código coincide con proyectos incompatibles. Requiere revisión.');
    }
    const existing = matches.docs[0] || (canonical.exists ? canonical : null);
    const existingCommercial = existing ? await transaction.get(db.collection('projectCommercial').doc(existing.id)) : null;
    const previousSaleId = existingCommercial?.data()?.crmSaleId || existing?.data().crmSaleId;
    if (previousSaleId && data.saleId && previousSaleId !== data.saleId) {
      throw new ImportError(409, 'El proyecto existente está vinculado a otra venta.');
    }
    const previousSourceId = existingCommercial?.data()?.controlTotalProjectId || existing?.data().controlTotalProjectId;
    if (existing && data.importMode === 'historical' && ((previousSourceId && previousSourceId !== data.sourceProjectId)
      || (!previousSourceId && existing.data().name !== data.name))) throw new ImportError(409, 'El código histórico coincide con otra identidad o un renombre no vinculado. Requiere revisión.');
    if (!existing) {
      const names = await transaction.get(db.collection('projects').where('name', '==', data.name).limit(2));
      if (names.size === 2 || names.docs.some(item => !item.data().projectCode)) {
        throw new ImportError(409, 'Hay un proyecto con el mismo nombre que requiere vinculación manual.');
      }
    }
    const targetId = existing ? existing.id : projectId;
    const outcome = existing ? 'existing' : 'created';
    let baniAudit = { state: 'not_applied_existing' };
    // Reads precede writes; create() also protects against concurrent creation.
    if (!existing) {
      const orphanBudget = await transaction.get(db.collection(`projects/${projectId}/budgetItems`).limit(1));
      const orphanExpenses = await transaction.get(db.collection(`projects/${projectId}/areaExpenses`).limit(1));
      if (orphanBudget.size || orphanExpenses.size) throw new ImportError(409, 'Hay partidas sin proyecto o recibo coherente. Requiere revisión.');
      if (data.sourceEvidence) {
        const age = clock().getTime() - Date.parse(data.sourceEvidence.verifiedAt);
        if (age > 36 * 60 * 60 * 1000 || age < -300000) invalid('La verificación del registro está vencida o tiene fecha futura.');
      }
      if (data.contractCurrency === 'USD') {
        if (!quote && !quoteUnavailable) throw NEED_QUOTE;
        if (quoteUnavailable) throw new ImportError(503, 'BNA no está disponible o la cotización no es del día. El alta queda pendiente.');
      }
      let post = Bani.prepareBaniPost(data);
      const budgetRef = db.collection(`projects/${projectId}/budgetItems`).doc(Bani.BUDGET_ITEM_ID);
      if (post.state === 'ready') {
        const provider = await transaction.get(db.collection('providers').doc(Bani.BANI_PROVIDER_ID));
        if (!provider.exists || !Bani.validBaniProvider(provider.data())) post = Bani.pending('provider_unavailable', post.source);
        else {
          if (post.currency === 'USD' && !quote && !quoteUnavailable) throw NEED_QUOTE;
          if (post.currency === 'USD' && quoteUnavailable) post = Bani.pending('quote_unavailable', post.source);
        }
      }
      const now = timestamp();
      let budget = null;
      if (post.state === 'ready') {
        try { budget = Bani.makeBaniBudget(post, projectId, now, quote, clock()); }
        catch { post = Bani.pending('invalid_amount', post.source); }
      }
      baniAudit = budget ? budget.audit : post;
      const project = projectFromPayload(data, now, quote, clock());
      if (!budget) project.controlTotalSourceWarning = [project.controlTotalSourceWarning, post.message].filter(Boolean).join(' ').slice(0, 2000);
      const { publicData, commercial } = splitProjectCommercial(project);
      transaction.create(projectRef, { ...publicData, commercialDataVersion: 1, ...(budget ? { budgetRevision: 1 } : {}) });
      transaction.create(db.collection('projectCommercial').doc(projectId), { ...commercial, schemaVersion: 1, updatedAt: now });
      if (budget) transaction.create(budgetRef, budget.row);
    }
    transaction.create(markerRef, {
      schemaVersion: 1, projectCode: data.projectCode, saleId: data.saleId,
      projectId: targetId, outcome, receivedAt: timestamp(), source: data,
      baniPost: baniAudit,
      ...(outcome === 'created' && quote ? { conversion: quote } : {}),
    });
    return response(data, targetId, outcome, baniAudit);
  });
  try { return await run(); }
  catch (error) {
    if (error !== NEED_QUOTE) throw error;
    // Network reads happen outside the transaction. The second transaction
    // rechecks receipts and existing projects before creating anything.
    try { quote = validateQuote(await getQuote({ now: clock() }), clock()); }
    catch { quoteUnavailable = true; }
    return run();
  }
}

function createImportHandler({ db, timestamp, logError = console.error }) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.set('Allow', 'POST').status(405).json({ error: 'Sólo POST.' });
    if (!req.is('application/json')) return res.status(415).json({ error: 'Se requiere application/json.' });
    if (!req.rawBody || req.rawBody.length > 32768) return res.status(413).json({ error: 'Mensaje demasiado grande o vacío.' });
    try {
      const result = await importProject({ db, payload: req.body, timestamp });
      return res.status(result.outcome === 'created' ? 201 : 200).json(result);
    } catch (error) {
      if (error instanceof ImportError) return res.status(error.status).json({ error: error.message });
      logError('CRM project import failed', { code: error.code || 'internal' });
      return res.status(503).json({ error: 'No se pudo confirmar el alta. El CRM debe reintentar.' });
    }
  };
}

module.exports = { ImportError, validatePayload, projectIdFor, projectFromPayload, importProject, createImportHandler };
