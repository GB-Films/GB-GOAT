const { HttpsError } = require('firebase-functions/v2/https');
const { id, list, hash } = require('./providerPortalModel');
const { paymentCorrectionSnapshot } = require('./paymentCorrectionSnapshot');
const { projectFinanceAccess, linkedAllocation } = require('./projectFinanceAccess');
const { activeRecordAllocations } = require('./providerFinanceAllocations');
const { canAccessGeneralCash, canReadPersonalCashMovement } = require('./generalCashAccess');
const { hasTeamWorkAccess } = require('./teamWorkAccess');
const { deny, projectTabs, canReadTab, fullArea, canReadArea, canReadExpenseArea, canReadExpense, canReadDocumentArea, canReadDocument } = require('./projectReadScope');

const fields = (row, keys) => Object.fromEntries(keys.filter(key => row?.[key] !== undefined).map(key => [key, row[key]]));
const header = row => fields(row, ['name', 'projectCode', 'status', 'location', 'shootingDate', 'shootingStartDate', 'shootingEndDate', 'createdAt', 'updatedAt', 'archived', 'archivedAt', 'budgetRevision']);
const wire = value => value?.toDate ? { seconds: value.seconds, nanoseconds: value.nanoseconds } : value instanceof Date ? value.toISOString()
  : Array.isArray(value) ? value.map(wire) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wire(v)])) : value;
const providerFields = ['id', 'type', 'name', 'lastName', 'businessName', 'alias', 'fullName', 'email', 'phone', 'dni', 'cuit', 'cuitNormalized',
  'bankAccount_cbu', 'bankAccount_alias', 'bankAccount_holder', 'source', 'provisional', 'administrativeRegistrationExempt', 'createdAt', 'updatedAt', 'category'];

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
    ...list(scope.allowedSubcategories).filter(key => typeof key === 'string').map(key => key.split('||')[0])])].filter(area => fullArea(access, area)
    || list(scope.allowedCategories).includes(area) || list(scope.allowedSubcategories).some(key => typeof key === 'string' && key.startsWith(area + '||')
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
  const ownCategories = list(access.collaborator?.allowedCategories);
  const categories = list(row.allowedCategories).filter(area => ownCategories.includes(area));
  const canSeeKey = key => typeof key === 'string' && canReadArea(access, ...key.split('||'));
  const subs = list(row.allowedSubcategories).filter(canSeeKey);
  if (!categories.length && !subs.length) return null;
  return { ...fields(row, ['id', 'email', 'uid', 'displayName', 'photoURL', 'role']),
    allowedCategories: categories, allowedSubcategories: subs,
      excludedSubcategories: list(row.excludedSubcategories).filter(key => canSeeKey(key) && typeof key === 'string'),
      scopeEditable: categories.length === list(row.allowedCategories).length
        && list(row.allowedSubcategories).every(key => list(access.collaborator?.allowedSubcategories).includes(key)) };
}

function scopedCashMovement(access, actor, movement, item) {
  const participant = canReadPersonalCashMovement(actor.email, movement);
  if (!participant && !canAccessGeneralCash(actor.email)) return null;
  if (access.admin || canReadExpenseArea(access, movement.collectionName, item)) return movement;
  if (!participant) return null;
  // A personal handover/payment still affects the user's custodial balance.
  return { ...fields(movement, ['id', 'type', 'cashAccount', 'subdelivery', 'receiptVersion', 'date', 'amount', 'fromUserEmail',
    'toUserEmail', 'toUserId', 'status', 'createdBy', 'createdByEmail', 'createdAt', 'confirmedAt', 'updatedAt']),
    ...(movement.itemId ? { description: 'Movimiento de tu caja', scopeLimited: true } : {}) };
}

const token = args => 'goat-file:' + encodeURIComponent(JSON.stringify(args));
const attachmentFields = ['id', 'contentType'];
const expenseFields = ['id', 'projectId', 'area', 'subcategory', 'order', 'areaStructureRevision', 'unit', 'quantity', 'unitPrice', 'total',
  'paid', 'paymentDate', 'paymentLocked', 'paymentAuthorIds', 'createdBy', 'createdByEmail', 'createdAt', 'updatedAt', 'providerId',
  'providerName', 'providerInviteLink', 'description', 'operationalNote', 'invoiceStatus', 'sourceBudgetItemId',
  'sharedPaymentIds', 'economicNature', 'thirdPartyPayoutRequired'];
const paymentFields = ['id', 'amount', 'date', 'method', 'type', 'detail', 'cashAccount', 'cashBoxLabel', 'cashMovementId',
  'createdBy', 'createdByEmail', 'createdByName', 'createdByRole', 'paidByEmail', 'paidByName', 'thirdPartyPayerId',
  'thirdPartyPayerName', 'reimbursedAmount'];
const reimbursementFields = ['id', 'amount', 'date', 'cashMovementId', 'createdBy', 'createdByEmail', 'createdByName', 'detail'];
function paymentDatesVersion(row) {
  return hash(wire({ ...fields(row, ['updatedAt', 'area', 'subcategory', 'providerId', 'providerName', 'description', 'total', 'paymentDate', 'paid', 'paymentLocked']),
    payments: list(row.paymentHistory).map(payment => fields(payment, ['id', 'amount', 'date'])) }));
}
function scopedFiles(projectId, collectionName, item) {
  const marker = (file, kind, index = 0, nestedIndex = 0) => file && (file.path || file.url)
    ? { ...fields(file, attachmentFields), fileName: ['invoice', 'invoices'].includes(kind) ? 'Factura' : 'Comprobante',
      url: token({ projectId, collectionName, itemId: item.id, kind, index, nestedIndex }) } : null;
  const next = fields(item, expenseFields);
  next.paymentDatesVersion = paymentDatesVersion(item);
  for (const field of ['sharedInvoices', 'sharedReceipts']) {
    if (Array.isArray(item[field])) next[field] = item[field].map(reference => fields(reference, ['id', 'amountCents', 'fileHidden']));
  }
  if (item.invoice) next.invoice = marker(item.invoice, 'invoice');
  if (Array.isArray(item.invoices)) next.invoices = item.invoices.map((file, index) => marker(file, 'invoices', index));
  if (Array.isArray(item.otherReceipts)) next.otherReceipts = item.otherReceipts.map((file, index) => marker(file, 'other', index));
  if (Array.isArray(item.paymentHistory)) next.paymentHistory = item.paymentHistory.map((payment, index) => ({
    ...(payment.sharedRecordId
      ? fields(payment, ['id', 'sharedRecordId', 'amount', 'date', 'method', 'type', 'createdBy', 'createdByEmail'])
      : { ...fields(payment, paymentFields), correctionVersion: hash(paymentCorrectionSnapshot(payment)) }), ...(payment.receipt && !payment.sharedRecordId ? { receipt: marker(payment.receipt, 'payment', index) } : {}),
    ...(!payment.sharedRecordId && Array.isArray(payment.reimbursements) ? { reimbursements: payment.reimbursements.map((refund, sub) => ({
      ...fields(refund, reimbursementFields), ...(refund.receipt ? { receipt: marker(refund.receipt, 'reimbursement', index, sub) } : {}),
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

async function boundAttachment({ db, actor, access, projectId, collectionName, row, itemId, kind, index, nestedIndex, file, path, bucket, readMetadata }) {
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
  const invoice = ['invoice', 'invoices'].includes(kind);
  if (parts[2] === collectionName && parts[3] === itemId) {
    if (parts.length === 5) return invoice;
    if (parts.length === 6 && parts[4] === 'otros-comprobantes') return kind === 'other';
    if (parts.length !== 6 || !(parts[4] === 'comprobantes' || invoice && parts[4] === 'facturas')) return false;
    if (!invoice && !['payment', 'reimbursement', 'other'].includes(kind)) return false;
  } else if (parts.length !== 6 || parts[2] !== 'areas' || parts[4] !== 'facturas' || !invoice) {
    return false;
  }
  const metadata = await readMetadata?.(path);
  if (metadata?.projectId !== projectId || (metadata.itemId || metadata.expenseId) !== itemId) return false;
  if (metadata.collectionName !== collectionName) {
    if (metadata.collectionName || !['invoice', 'invoices', 'other'].includes(kind)) return false;
    // Older uploads kept project + row IDs but did not keep a collection.
    // Resolve the row only when its ID is unique across both expense collections.
    const alternative = collectionName === 'areaExpenses' ? 'budgetItems' : 'areaExpenses';
    if ((await db.doc(`projects/${projectId}/${alternative}/${itemId}`).get()).exists) return false;
  }
  if (kind === 'other') return !metadata.paymentId;
  if (kind === 'payment' || kind === 'reimbursement') {
    const payment = list(row.paymentHistory)[index];
    if (kind === 'payment' && !metadata.paymentId) {
      // Some historical receipts predate payment IDs in Storage. A unique live
      // reference on the already verified row identifies that receipt.
      return list(row.paymentHistory).flatMap(entry => [entry.receipt, ...list(entry.reimbursements).map(refund => refund.receipt)])
        .filter(reference => {
          try { return objectPath(reference, bucket) === path; } catch { return false; }
        }).length === 1;
    }
    return Boolean(payment?.id && metadata.paymentId === payment.id
      && (kind !== 'reimbursement' || metadata.reimbursementId && metadata.reimbursementId === list(payment.reimbursements)[nestedIndex]?.id));
  }
  return true;
}

async function historicalAttachmentAlias(context) {
  const { db, access, projectId, collectionName, itemId, kind, path, bucket, readMetadata } = context;
  const [namespace, parent, folder, sourceId, ...rest] = path.split('/');
  if (namespace !== 'projects' || parent !== projectId) return false;
  const sameObject = file => {
    try { return objectPath(file, bucket) === path; } catch { return false; }
  };
  if (folder === 'documents' && rest.length === 1 && ['invoice', 'invoices', 'other'].includes(kind)) {
    const source = (await db.doc(`projects/${projectId}/projectDocuments/${id(sourceId)}`).get()).data();
    return canReadDocumentArea(access, source) && sameObject(source);
  }
  if (!['document', 'invoice', 'invoices', 'other'].includes(kind)) return false;
  const metadata = await readMetadata?.(path);
  const sourceCollection = metadata?.collectionName;
  const sourceExpense = metadata?.itemId || metadata?.expenseId;
  if (metadata?.projectId !== projectId || !['areaExpenses', 'budgetItems'].includes(sourceCollection)
    || !sourceExpense || sourceCollection === collectionName && sourceExpense === itemId) return false;
  const row = (await db.doc(`projects/${projectId}/${sourceCollection}/${id(sourceExpense)}`).get()).data();
  if (!canReadExpenseArea(access, sourceCollection, row)) return false;

  // A second legacy reference can use an original retained by another
  // authorized row. Both associations must exist and remain readable.
  const candidates = [
    { kind: 'invoice', file: row.invoice },
    ...list(row.invoices).map((file, index) => ({ kind: 'invoices', file, index })),
    ...list(row.otherReceipts).map((file, index) => ({ kind: 'other', file, index })),
    ...list(row.paymentHistory).flatMap((payment, index) => [
      ...(!payment.sharedRecordId ? [{ kind: 'payment', file: payment.receipt, index }] : []),
      ...(!payment.sharedRecordId ? list(payment.reimbursements).map((refund, nestedIndex) =>
        ({ kind: 'reimbursement', file: refund.receipt, index, nestedIndex })) : []),
    ]),
  ];
  for (const original of candidates) {
    if (sameObject(original.file) && await boundAttachment({ ...context, ...original,
      collectionName: sourceCollection, itemId: sourceExpense, row, readMetadata: async () => metadata })) return true;
  }
  return false;
}

function createProjectScopedReads({ db, readFile, bucketName, readMetadata, timestamp }) {
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

  async function snapshot(access, projectId, purpose) {
    if (purpose && !canReadTab(access, purpose)) return { project: { ...header(access.project), id: projectId }, budgetItems: [], areaExpenses: [], providers: [], documents: [], collaborators: [] };
    const auxiliary = !purpose;
    const collection = name => db.collection(`projects/${projectId}/${name}`);
    const [budget, areas, docs, peers] = await Promise.all([
      canReadTab(access, 'resumen', 'presupuesto', 'areas', 'saldos', 'proveedores') ? rows(collection('budgetItems')) : [],
      canReadTab(access, 'resumen', 'areas', 'saldos', 'proveedores') ? rows(collection('areaExpenses')) : [],
      auxiliary && canReadTab(access, 'documentos') ? rows(collection('projectDocuments')) : [],
      auxiliary && canReadTab(access, 'permisos') ? rows(collection('collaborators'), 300) : [],
    ]);
    const budgetItems = budget.filter(row => canReadExpense(access, 'budgetItems', row));
    const areaExpenses = areas.filter(row => canReadExpense(access, 'areaExpenses', row));
    const providerIds = [...new Set([...budgetItems, ...areaExpenses].flatMap(row => [row.providerId, ...list(row.paymentHistory).map(p => p.thirdPartyPayerId)])
      .filter(value => typeof value === 'string' && /^[\w-]{1,160}$/.test(value)))];
    const providers = (providerIds.length ? await db.getAll(...providerIds.map(pid => db.doc(`providers/${pid}`))) : [])
      .filter(row => row.exists).map(row => ({ ...fields(row.data(), providerFields),
        ...(row.data().registration?.status === 'complete' ? { registration: { status: 'complete' } } : {}), id: row.id }));
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
        for (const provider of (await snapshot(access, project.id, 'proveedores')).providers) allowed.set(provider.id, provider);
      }
      return wire({ providers: [...allowed.values()] });
    }
    const projectId = id(input.projectId);
    const access = await projectFinanceAccess({ db, actor, projectId });
    if (input.action === 'projectAccess') return { admin: access.admin };
    if (['projectTeamCandidate', 'projectAssignCollaborator'].includes(input.action)) {
      const email = String(input.email || '').trim().toLowerCase();
      if (email.length > 254 || !/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(email)) return { candidate: null };
      const root = db.doc(`projects/${projectId}`);
      const candidateRef = root.collection('collaborators').doc(email);
      const authorize = scope => {
        if (!scope.admin && (scope.collaborator?.role !== 'jefe_produccion' || !canReadTab(scope, 'permisos')
          || !list(scope.collaborator.allowedCategories).length)) deny();
      };
      authorize(access);
      const find = async tx => {
        const read = ref => tx ? tx.get(ref) : ref.get();
        const users = await read(db.collection('users').where('email', '==', email).limit(2));
        const chosen = users.size === 1 ? users.docs[0] : null;
        const gate = (await read(db.doc(`teamAccessEmails/${email}`))).data();
        return chosen && hasTeamWorkAccess(chosen.data()) && gate?.status !== 'pending' ? chosen : null;
      };
      if (input.action === 'projectTeamCandidate') {
        const user = await find();
        if (!user || user.id === access.project.createdBy || (await candidateRef.get()).exists
          || list(access.project.collaboratorEmails).includes(email)) return { candidate: null };
        return { candidate: { ...fields(user.data(), ['displayName', 'photoURL']), email, uid: user.id } };
      }
      return db.runTransaction(async tx => {
        const live = await projectFinanceAccess({ db, transaction: tx, actor, projectId });
        authorize(live);
        const uid = id(input.uid), role = input.role, categories = [...new Set(list(input.categories))];
        if (!['jefe_area', 'jefe_produccion'].includes(role) || !categories.length || categories.length > 80
          || categories.some(area => typeof area !== 'string' || !list(live.collaborator?.allowedCategories).includes(area) && !live.admin)) deny();
        const [user, existing] = await Promise.all([find(tx), tx.get(candidateRef)]);
        if (!user || user.id !== uid || uid === live.project.createdBy || existing.exists || list(live.project.collaboratorEmails).includes(email)
          || list(live.project.teamOnboardingBlockedEmails).includes(email)) deny();
        const now = timestamp();
        const collaborator = { uid, email, ...fields(user.data(), ['displayName', 'photoURL']), role,
          allowedCategories: categories, allowedSubcategories: [], excludedSubcategories: list(live.collaborator?.excludedSubcategories),
          allowedTabs: projectTabs({ collaborator: { role } }), canEditBudgetAreas: true, canViewBudgetTotals: false };
        tx.create(candidateRef, { ...collaborator, createdAt: now, updatedAt: now });
        tx.update(root, { collaboratorEmails: [...list(live.project.collaboratorEmails), email], updatedAt: now });
        return { collaborator };
      });
    }
    if (input.action === 'projectCreateDocument') {
      if (!access.admin && (access.collaborator?.role !== 'jefe_produccion' || !canReadTab(access, 'documentos'))) deny();
      const itemId = id(input.itemId);
      const file = input.document || {};
      if (!canReadDocument(access, file) || !['contratos', 'seguros'].includes(file.family)) deny();
      const path = objectPath(file);
      const parts = path.split('/');
      if (parts.length !== 5 || parts[0] !== 'projects' || parts[1] !== projectId || parts[2] !== 'documents'
        || parts[3] !== itemId || parts[4] !== file.fileName) deny();
      const metadata = await readMetadata?.(path);
      if (metadata?.projectId !== projectId || metadata.family !== file.family || metadata.uploadedBy !== actor.email) deny();
      const data = Object.fromEntries(['family', 'title', 'area', 'subcategory', 'expirationDate', 'notes', 'providerId', 'providerName',
        'type', 'subtype', 'fileName', 'originalFileName', 'contentType'].map(key => [key, String(file[key] || '').slice(0, key === 'notes' ? 2000 : 400)]));
      const now = timestamp(), ref = db.doc(`projects/${projectId}/projectDocuments/${itemId}`);
      await db.runTransaction(async tx => {
        const live = await projectFinanceAccess({ db, actor, transaction: tx, projectId });
        if (!canReadDocument(live, data) || !live.admin && live.collaborator?.role !== 'jefe_produccion') deny();
        if (data.providerId && !live.admin) {
          const name = await tx.get(db.doc(`providers/${id(data.providerId)}`));
          const matching = await tx.get(db.collection(`projects/${projectId}/areaExpenses`).where('providerId', '==', data.providerId).where('area', '==', data.area).limit(100));
          if (!name.exists || !matching.docs.some(row => canReadExpenseArea(live, 'areaExpenses', row.data()))) deny();
          const provider = name.data();
          data.providerName = provider.businessName || [provider.name, provider.lastName].filter(Boolean).join(' ');
        }
        tx.create(ref, { ...data, path, url: token({ projectId, collectionName: 'projectDocuments', itemId, kind: 'document' }),
          source: 'Carga manual', uploadedBy: actor.email, createdAt: now, updatedAt: now });
      });
      return { id: itemId };
    }
    if (input.action === 'projectScopedSnapshot') {
      const purpose = ['resumen', 'proveedores'].includes(input.purpose) ? input.purpose : undefined;
      return wire(await snapshot(access, projectId, purpose));
    }
    if (input.action === 'projectAdminAttachment') {
      if (!access.admin || !readFile) deny();
      const path = objectPath({ path: input.path });
      const [namespace, parent, ...parts] = path.split('/');
      // A project admin already reads project files directly in Storage. The
      // authenticated adapter preserves that access after old links are retired.
      if (namespace !== 'projects' || parent !== projectId || parts.length < 3) deny();
      return readFile({ path, projectAttachment: true });
    }
    if (input.action === 'projectScopedAttachment') {
      const { collectionName, kind } = input, itemId = id(input.itemId);
      if (!['areaExpenses', 'budgetItems', 'projectDocuments'].includes(collectionName)) deny();
      const row = (await db.doc(`projects/${projectId}/${collectionName}/${itemId}`).get()).data();
      let file;
      let index = Number(input.index ?? 0);
      const nestedIndex = Number(input.nestedIndex ?? 0);
      if (collectionName === 'projectDocuments') {
        if (!canReadDocument(access, row) || kind !== 'document') deny();
        file = row;
      } else {
        if (!canReadExpense(access, collectionName, row)) deny();
        if (input.fileId !== undefined) {
          const fileId = id(input.fileId);
          const entries = kind === 'invoices' ? list(row.invoices) : kind === 'other' ? list(row.otherReceipts)
            : kind === 'payment' ? list(row.paymentHistory) : [];
          index = entries.findIndex(entry => entry?.id === fileId);
        }
        if (![index, nestedIndex].every(value => Number.isInteger(value) && value >= 0 && value <= 500)) deny();
        file = attachedFile(row, kind, index, nestedIndex);
        const payment = ['payment', 'reimbursement'].includes(kind) ? list(row.paymentHistory)[index] : null;
        if (payment?.sharedRecordId && !String(file?.path || '').startsWith('providerFinance/')) deny();
      }
      if (!file || !readFile) deny();
      const bucket = bucketName?.(), path = objectPath(file, bucket);
      const binding = { db, actor, access, projectId, collectionName, row, itemId, kind, index, nestedIndex, file, path, bucket, readMetadata };
      if (!await boundAttachment(binding) && !await historicalAttachmentAlias(binding)) deny();
      const original = await readFile({ path, projectAttachment: true });
      return { ...original, fileName: file.originalFileName || file.fileName || original.fileName };
    }
    deny();
  };
}

module.exports = { createProjectScopedReads, projectProjection, scopedCashMovement, canReadRecordOriginal, paymentDatesVersion, scopedFiles, wire };
