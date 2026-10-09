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
const invalid = message => { throw new ImportError(400, message); };

function validatePayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Se requiere un objeto JSON.');
  if (Object.keys(input).some(key => !FIELDS.includes(key))) invalid('El mensaje contiene campos no admitidos.');
  if (input.schemaVersion !== 1) invalid('Versión de integración no admitida.');
  const data = { schemaVersion: 1 };
  for (const key of FIELDS.filter(key => !['schemaVersion', 'contractAmount'].includes(key))) {
    if (typeof input[key] !== 'string' || input[key].length > 1000 || /[\u0000-\u001f]/.test(input[key])) {
      invalid(`Campo ${key} inválido.`);
    }
    data[key] = input[key].trim();
  }
  if (!/^G [A-Z0-9_-]{1,20} \d{4,8}$/.test(data.projectCode)
      || Number(data.projectCode.split(' ')[2]) < 1) invalid('Sólo se admiten códigos oficiales G.');
  if (!data.name || data.sourceProjectId !== `${data.projectCode} ${data.name}`) invalid('El nombre y el código completo no coinciden.');
  if (!data.saleId || data.saleId.length > 128 || /[\s/]/.test(data.saleId)) invalid('Falta la venta de origen o el marcador interno.');
  if (!data.clientName) invalid('Falta el cliente del código.');
  if (data.ownerUnit !== 'GB' || data.internalProviderUnit !== '' || data.condition !== 'Externo' || data.status !== 'Activo') {
    invalid('Sólo se admite el alta externa de Gran Berta.');
  }
  for (const key of ['confirmationDate', 'deliveryDate']) {
    const date = data[key];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))
        || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) invalid(`Fecha ${key} inválida.`);
  }
  if (!['ARS', 'USD', ''].includes(data.contractCurrency)) invalid('Moneda no admitida.');
  const amount = input.contractAmount;
  if (amount !== null && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0)) invalid('Monto contractual inválido.');
  if ((data.contractCurrency === '') !== (amount === null)) invalid('La moneda y el monto deben estar definidos juntos, o ambos pendientes.');
  data.contractAmount = amount;
  return data;
}

const projectIdFor = code => `ct-${code.replace(/\s+/g, '-')}`;
const response = (data, projectId, outcome) => ({ schemaVersion: 1, projectCode: data.projectCode, projectId, outcome });

function projectFromPayload(data, timestamp) {
  return {
    name: data.name,
    description: '',
    projectCode: data.projectCode,
    clientName: data.clientName,
    brandName: data.brandName,
    companyName: data.companyName,
    serviceName: data.serviceName,
    // GOAT's operational budget is ARS. USD is preserved, never converted.
    budgetTotal: data.contractCurrency === 'ARS' ? data.contractAmount : 0,
    status: 'Presupuesto',
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
    controlTotalImportedAt: timestamp,
    crmSaleId: data.saleId,
    crmSaleUrl: data.saleId === 'interno' ? '' : `https://gran-crm.granberta.workers.dev/?ir=venta/${encodeURIComponent(data.saleId)}`,
    crmProjectImportVersion: 1,
    crmProjectImportedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function importProject({ db, payload, timestamp }) {
  const data = validatePayload(payload);
  const projectId = projectIdFor(data.projectCode);
  const markerRef = db.collection('crmProjectImports').doc(projectId);
  const projectRef = db.collection('projects').doc(projectId);
  return db.runTransaction(async transaction => {
    const marker = await transaction.get(markerRef);
    if (marker.exists) {
      const previous = marker.data();
      if (previous.projectCode !== data.projectCode || previous.saleId !== data.saleId || !previous.projectId) {
        throw new ImportError(409, 'Este código tiene otra procedencia registrada. Requiere revisión.');
      }
      // Keep this receipt even when an administrator deletes the project.
      return response(data, previous.projectId, 'already_processed');
    }

    const canonical = await transaction.get(projectRef);
    const matches = await transaction.get(db.collection('projects').where('projectCode', '==', data.projectCode).limit(2));
    if (matches.size > 1 || (canonical.exists && canonical.data().projectCode !== data.projectCode)
        || (canonical.exists && matches.size === 1 && matches.docs[0].id !== projectId)) {
      throw new ImportError(409, 'El código coincide con proyectos incompatibles. Requiere revisión.');
    }
    const existing = matches.docs[0] || (canonical.exists ? canonical : null);
    if (existing?.data().crmSaleId && existing.data().crmSaleId !== data.saleId) {
      throw new ImportError(409, 'El proyecto existente está vinculado a otra venta.');
    }
    if (!existing) {
      const names = await transaction.get(db.collection('projects').where('name', '==', data.name).limit(2));
      if (names.size === 2 || names.docs.some(item => !item.data().projectCode)) {
        throw new ImportError(409, 'Hay un proyecto con el mismo nombre que requiere vinculación manual.');
      }
    }
    const targetId = existing ? existing.id : projectId;
    const outcome = existing ? 'existing' : 'created';
    // Reads precede writes; create() also protects against concurrent creation.
    if (!existing) transaction.create(projectRef, projectFromPayload(data, timestamp()));
    transaction.create(markerRef, {
      schemaVersion: 1, projectCode: data.projectCode, saleId: data.saleId,
      projectId: targetId, outcome, receivedAt: timestamp(), source: data,
    });
    return response(data, targetId, outcome);
  });
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
