const { HttpsError } = require('firebase-functions/v2/https');
const { id, list } = require('./providerPortalModel');
const { projectFinanceAccess, linkedAllocation } = require('./projectFinanceAccess');
const { activeRecordAllocations } = require('./providerFinanceAllocations');
const { canAccessGeneralCash, canReadPersonalCashMovement } = require('./generalCashAccess');
const { deny, projectTabs, canReadTab, fullArea, canReadArea, canReadExpense, canReadDocument } = require('./projectReadScope');

const fields = (row, keys) => Object.fromEntries(keys.filter(key => row?.[key] !== undefined).map(key => [key, row[key]]));
const header = row => fields(row, ['name', 'projectCode', 'status', 'location', 'shootingDate', 'shootingStartDate', 'shootingEndDate', 'createdAt', 'updatedAt']);
const wire = value => value?.toDate ? { seconds: value.seconds, nanoseconds: value.nanoseconds } : value instanceof Date ? value.toISOString()
  : Array.isArray(value) ? value.map(wire) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wire(v)])) : value;
const providerFields = ['id', 'type', 'name', 'lastName', 'businessName', 'alias', 'fullName', 'email', 'phone', 'dni', 'cuit', 'cuitNormalized',
  'bankAccount_cbu', 'bankAccount_alias', 'bankAccount_holder', 'bankAccount', 'source', 'provisional', 'administrativeRegistrationExempt'];

async function rows(query, max = 1500) {
  const snap = await query.limit(max + 1).get();
  if (snap.size > max) throw new HttpsError('resource-exhausted', 'La consulta supera el límite de esta vista. Contactá a administración.');
  return snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
}

function projectProjection(access) {
  const project = access.project;
  if (access.admin) return project;
  const scope = access.collaborator || {};
  const areas = [...new Set([...list(project.categories), ...list(project.activeAreas), ...list(scope.allowedCategories),
    ...list(scope.allowedSubcategories).map(key => key.split('||')[0])])].filter(area => fullArea(access, area)
    || list(scope.allowedCategories).includes(area) || list(scope.allowedSubcategories).some(key => key.startsWith(area + '||')
      && canReadArea(access, area, key.split('||')[1])));
  return { ...header(project), categories: areas, executiveCategoryDefaultApplied: true,
    activeAreas: list(project.activeAreas).filter(area => areas.includes(area)),
    categoryBudgets: Object.fromEntries(Object.entries(project.categoryBudgets || {}).filter(([area]) => fullArea(access, area))),
    areaExpenseSubcategories: Object.fromEntries(areas.map(area => [area,
      list(project.areaExpenseSubcategories?.[area]).filter(sub => canReadArea(access, area, sub))])),
    areaExpenseSubcategoryBudgets: Object.fromEntries(Object.entries(project.areaExpenseSubcategoryBudgets || {}).filter(([key, entry]) => {
      const [area, sub] = key.split('||');
      return canReadArea(access, entry?.area || area, entry?.subcategory || sub);
    })),
  };
}

function scopedPeer(access, row) {
  if (access.admin) return row;
  const categories = list(row.allowedCategories).filter(area => fullArea(access, area));
  const canSeeKey = key => canReadArea(access, ...key.split('||'));
  const subs = list(row.allowedSubcategories).filter(canSeeKey);
  if (!categories.length && !subs.length) return null;
  return { ...fields(row, ['id', 'email', 'uid', 'displayName', 'photoURL', 'role']),
    allowedCategories: categories, allowedSubcategories: subs, excludedSubcategories: list(row.excludedSubcategories).filter(canSeeKey) };
}

function scopedCashMovement(access, actor, movement, item) {
  const participant = canReadPersonalCashMovement(actor.email, movement);
  if (!participant && !canAccessGeneralCash(actor.email)) return null;
  if (access.admin || canReadExpense(access, movement.collectionName, item)) return movement;
  if (!participant) return null;
  // A personal handover/payment still affects the user's custodial balance.
  return { ...fields(movement, ['id', 'type', 'cashAccount', 'subdelivery', 'receiptVersion', 'date', 'amount', 'fromUserEmail',
    'toUserEmail', 'toUserId', 'status', 'createdBy', 'createdByEmail', 'createdAt', 'confirmedAt', 'updatedAt']),
    ...(movement.itemId ? { description: 'Movimiento de tu caja', scopeLimited: true } : {}) };
}

const token = args => 'goat-file:' + encodeURIComponent(JSON.stringify(args));
const attachmentFields = ['id', 'contentType', 'uploadedAt', 'uploadedBy', 'uploadedByEmail', 'uploadedByName', 'uploadedByRole'];
function scopedFiles(projectId, collectionName, item) {
  const marker = (file, kind, index = 0, nestedIndex = 0) => file && (file.path || file.url)
    ? { ...fields(file, attachmentFields), fileName: ['invoice', 'invoices'].includes(kind) ? 'Factura' : 'Comprobante',
      url: token({ projectId, collectionName, itemId: item.id, kind, index, nestedIndex }) } : null;
  const { sharedPaymentRecords: _rawHistory, ...next } = item;
  for (const field of ['sharedInvoices', 'sharedReceipts']) {
    if (Array.isArray(item[field])) next[field] = item[field].map(reference => fields(reference, ['id', 'amountCents', 'fileHidden']));
  }
  if (item.invoice) next.invoice = marker(item.invoice, 'invoice');
  if (Array.isArray(item.invoices)) next.invoices = item.invoices.map((file, index) => marker(file, 'invoices', index));
  if (Array.isArray(item.otherReceipts)) next.otherReceipts = item.otherReceipts.map((file, index) => marker(file, 'other', index));
  if (Array.isArray(item.paymentHistory)) next.paymentHistory = item.paymentHistory.map((payment, index) => ({
    ...(payment.sharedRecordId
      ? fields(payment, ['id', 'sharedRecordId', 'amount', 'date', 'method', 'type', 'createdBy', 'createdByEmail'])
      : payment), ...(payment.receipt && !payment.sharedRecordId ? { receipt: marker(payment.receipt, 'payment', index) } : {}),
    ...(!payment.sharedRecordId && Array.isArray(payment.reimbursements) ? { reimbursements: payment.reimbursements.map((refund, sub) => ({
      ...refund, ...(refund.receipt ? { receipt: marker(refund.receipt, 'reimbursement', index, sub) } : {}),
    })) } : {}),
  }));
  return next;
}

function attachedFile(item, kind, index, nestedIndex) {
  if (kind === 'invoice') return item.invoice;
  if (kind === 'invoices') return list(item.invoices)[index];
  if (kind === 'other') return list(item.otherReceipts)[index];
  if (kind === 'payment') return list(item.paymentHistory)[index]?.receipt;
  if (kind === 'reimbursement') return list(list(item.paymentHistory)[index]?.reimbursements)[nestedIndex]?.receipt;
}

function objectPath(file, bucket) {
  let path = file?.path;
  if (!path && file?.url && bucket) {
    try {
      const url = new URL(file.url);
      const parts = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
      if (url.origin === 'https://firebasestorage.googleapis.com' && parts && decodeURIComponent(parts[1]) === bucket) path = decodeURIComponent(parts[2]);
    } catch {}
  }
  if (typeof path !== 'string' || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) deny();
  return path;
}

async function canReadRecordOriginal({ db, actor, access, projectId, record }) {
  const allocations = activeRecordAllocations(record);
  if (record.status !== 'active' || !allocations.length || list(record.detachedExpenseKeys).length) return false;
  const accessByProject = new Map([[projectId, Promise.resolve(access)]]);
  const readable = await Promise.all(allocations.map(async row => {
    if (!['areaExpenses', 'budgetItems'].includes(row.collectionName)) return false;
    if (!accessByProject.has(row.projectId)) accessByProject.set(row.projectId,
      projectFinanceAccess({ db, actor, projectId: id(row.projectId) }).catch(error => {
        if (error.code === 'permission-denied') return null;
        throw error;
      }));
    const rowAccess = await accessByProject.get(row.projectId);
    if (!rowAccess) return false;
    const item = (await db.doc(`projects/${id(row.projectId)}/${row.collectionName}/${id(row.itemId)}`).get()).data();
    return canReadExpense(rowAccess, row.collectionName, item) && linkedAllocation(record, row.projectId, row.itemId, row.collectionName, item);
  }));
  return readable.every(Boolean);
}

async function boundAttachment({ db, actor, access, projectId, collectionName, row, itemId, kind, index, nestedIndex, file, path, readMetadata }) {
  const parts = path.split('/');
  if (parts[0] === 'providerFinance' && parts.length === 4 && parts[1] === row.providerId) {
    const recordId = id(parts[2]);
    const record = { ...(await db.doc(`providerFinancialRecords/${recordId}`).get()).data(), id: recordId };
    const expectedKind = ['invoice', 'invoices'].includes(kind) ? 'invoice' : kind === 'payment' ? 'payment' : 'other';
    return record.kind === expectedKind && record.file?.path === path
      && linkedAllocation(record, projectId, itemId, collectionName, row)
      && canReadRecordOriginal({ db, actor, access, projectId, record });
  }
  if (file.portalUploadId && parts[0] === 'providerPortalUploads') {
    const upload = (await db.doc(`providerPortalInvoiceUploads/${id(file.portalUploadId)}`).get()).data();
    return ['invoice', 'invoices'].includes(kind) && upload?.status !== 'removed' && upload?.providerId === row.providerId
      && upload?.workKey === `${projectId}/${collectionName}/${itemId}` && upload?.path === path;
  }
  if (parts[0] !== 'projects' || parts[1] !== projectId) return false;
  if (kind === 'document') return parts.length === 5 && parts[2] === 'documents' && parts[3] === itemId;
  if (parts[2] === collectionName && parts[3] === itemId) {
    if (parts.length === 5) return ['invoice', 'invoices'].includes(kind);
    if (parts.length === 6 && parts[4] === 'otros-comprobantes') return kind === 'other';
    if (parts.length !== 6 || parts[4] !== 'comprobantes' || !['payment', 'reimbursement'].includes(kind)) return false;
  } else if (parts.length !== 6 || parts[2] !== 'areas' || parts[4] !== 'facturas' || !['invoice', 'invoices'].includes(kind)) {
    return false;
  }
  const metadata = await readMetadata?.(path);
  if (metadata?.projectId !== projectId || metadata.collectionName !== collectionName || (metadata.itemId || metadata.expenseId) !== itemId) return false;
  if (kind === 'payment' || kind === 'reimbursement') {
    const payment = list(row.paymentHistory)[index];
    return Boolean(payment?.id && metadata.paymentId === payment.id
      && (kind !== 'reimbursement' || metadata.reimbursementId && metadata.reimbursementId === list(payment.reimbursements)[nestedIndex]?.id));
  }
  return true;
}

function createProjectScopedReads({ db, readFile, bucketName, readMetadata }) {
  async function projectList(actor) {
    const base = db.collection('projects');
    const visible = await Promise.all([rows(base.where('createdBy', '==', actor.uid), 500), rows(base.where('collaboratorEmails', 'array-contains', actor.email), 500)]);
    const projects = await Promise.all([...new Map(visible.flat().map(row => [row.id, row])).values()].map(async row => {
      try {
        const access = await projectFinanceAccess({ db, actor, projectId: row.id });
        return { ...(access.admin ? access.project : header(access.project)), id: row.id, projectAdmin: access.admin };
      } catch (error) { if (error.code === 'permission-denied') return null; throw error; }
    }));
    return projects.filter(Boolean);
  }

  async function snapshot(access, projectId, providerOnly = false) {
    const collection = name => db.collection(`projects/${projectId}/${name}`);
    const [budget, areas, docs, peers] = await Promise.all([
      canReadTab(access, 'resumen', 'presupuesto', 'areas', 'saldos', 'proveedores') ? rows(collection('budgetItems')) : [],
      canReadTab(access, 'resumen', 'areas', 'saldos', 'proveedores') ? rows(collection('areaExpenses')) : [],
      !providerOnly && canReadTab(access, 'documentos') ? rows(collection('projectDocuments')) : [],
      !providerOnly && canReadTab(access, 'permisos') ? rows(collection('collaborators'), 300) : [],
    ]);
    const budgetItems = budget.filter(row => canReadExpense(access, 'budgetItems', row));
    const areaExpenses = areas.filter(row => canReadExpense(access, 'areaExpenses', row));
    const providerIds = [...new Set([...budgetItems, ...areaExpenses].flatMap(row => [row.providerId, ...list(row.paymentHistory).map(p => p.thirdPartyPayerId)])
      .filter(value => typeof value === 'string' && /^[\w-]{1,160}$/.test(value)))];
    const providers = (providerIds.length ? await db.getAll(...providerIds.map(pid => db.doc(`providers/${pid}`))) : [])
      .filter(row => row.exists).map(row => ({ ...fields(row.data(), providerFields), id: row.id }));
    const projectedRows = (items, name) => access.admin ? items : items.map(row => scopedFiles(projectId, name, row));
    return {
      project: { ...projectProjection(access), id: projectId }, admin: access.admin,
      permissions: access.collaborator ? { ...access.collaborator, allowedTabs: projectTabs(access) } : null,
      budgetItems: projectedRows(budgetItems, 'budgetItems'), areaExpenses: projectedRows(areaExpenses, 'areaExpenses'), providers,
      documents: docs.filter(row => canReadDocument(access, row)).map(row => access.admin ? row : ({
        ...fields(row, ['id', 'family', 'type', 'subtype', 'area', 'subcategory', 'providerName', 'providerId', 'title', 'notes', 'originalFileName', 'fileName',
          'contentType', 'expirationDate', 'createdAt']),
        url: token({ projectId, collectionName: 'projectDocuments', itemId: row.id, kind: 'document' }),
      })),
      collaborators: peers.map(row => scopedPeer(access, row)).filter(Boolean),
    };
  }

  return async (actor, input) => {
    if (input.action === 'projectSummaries') return wire({ projects: await projectList(actor) });
    if (input.action === 'scopedProviderCatalog') {
      const projects = await projectList(actor);
      const allowed = new Map();
      for (const project of projects) {
        const access = await projectFinanceAccess({ db, actor, projectId: project.id });
        for (const provider of (await snapshot(access, project.id, true)).providers) allowed.set(provider.id, provider);
      }
      return wire({ providers: [...allowed.values()] });
    }
    const projectId = id(input.projectId);
    const access = await projectFinanceAccess({ db, actor, projectId });
    if (input.action === 'projectScopedSnapshot') return wire(await snapshot(access, projectId));
    if (input.action === 'projectScopedAttachment') {
      const { collectionName, kind } = input, itemId = id(input.itemId);
      if (!['areaExpenses', 'budgetItems', 'projectDocuments'].includes(collectionName)) deny();
      const row = (await db.doc(`projects/${projectId}/${collectionName}/${itemId}`).get()).data();
      let file;
      const index = Number(input.index ?? 0), nestedIndex = Number(input.nestedIndex ?? 0);
      if (collectionName === 'projectDocuments') {
        if (!canReadDocument(access, row) || kind !== 'document') deny();
        file = row;
      } else {
        if (!canReadExpense(access, collectionName, row)) deny();
        if (![index, nestedIndex].every(value => Number.isInteger(value) && value >= 0 && value <= 500)) deny();
        file = attachedFile(row, kind, index, nestedIndex);
        const payment = ['payment', 'reimbursement'].includes(kind) ? list(row.paymentHistory)[index] : null;
        if (payment?.sharedRecordId && !String(file?.path || '').startsWith('providerFinance/')) deny();
      }
      if (!file || !readFile) deny();
      const path = objectPath(file, bucketName?.());
      if (!await boundAttachment({ db, actor, access, projectId, collectionName, row, itemId, kind, index, nestedIndex, file, path, readMetadata })) deny();
      return { fileName: file.originalFileName || file.fileName || path.split('/').pop(), contentType: file.contentType || 'application/pdf', base64: await readFile({ path }) };
    }
    deny();
  };
}

module.exports = { createProjectScopedReads, projectProjection, scopedCashMovement, canReadRecordOriginal };
