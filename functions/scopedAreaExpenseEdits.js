const { Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { availablePersonalCents } = require('./cashSubdelivery');
const { isInternalBudgetEstimate } = require('./internalBudgetEstimate');
const { projectFinanceAccess } = require('./projectFinanceAccess');
const { canEditAreaExpense, deny } = require('./projectReadScope');
const { paymentDatesVersion, scopedFiles, wire } = require('./projectScopedReads');
const { fail, hash, id, list } = require('./providerPortalModel');

const amountFields = ['unitPrice', 'quantity', 'total'];
const editableFields = ['description', 'unit', 'providerName', 'providerId', ...amountFields];
const targetFields = ['area', 'subcategory', ...editableFields];
const cents = value => Math.round(Number(value) * 100);
const isMap = value => value && typeof value === 'object' && !Array.isArray(value);
const isNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12;
const validId = value => typeof value === 'string' && /^[\w-]{1,160}$/.test(value);
const ownerName = (access, actor) => String(access.user?.displayName || actor.email).slice(0, 200);
const revision = value => value?.seconds == null ? null : [value.seconds, value.nanoseconds || 0];
const fileMarker = (scope, kind, fileId) => 'goat-file:' + encodeURIComponent(JSON.stringify({ ...scope, kind, fileId }));
const documents = ['invoice', 'other'];

function prepareChanges(expense, input) {
  const submitted = input.updates;
  if (!isMap(submitted) || !Object.keys(submitted).length || Object.keys(submitted).some(key => ![...editableFields, 'providerInviteLink'].includes(key))) fail('Dato de gasto no editable.');
  if (JSON.stringify(input.expectedUpdatedAt) !== JSON.stringify(revision(expense.updatedAt))) fail('El gasto cambió. Actualizá la fila antes de editarla.');
  const updates = {};
  for (const key of editableFields.filter(field => Object.hasOwn(submitted, field))) {
    const value = submitted[key];
    if (amountFields.includes(key) ? !isNumber(value) : typeof value !== 'string' || value.length > (key === 'description' ? 2000 : 300)) fail('Dato de gasto inválido.');
    updates[key] = value;
  }
  if (!Object.keys(updates).length) fail('Dato de gasto no editable.');
  const assignsProvider = Object.hasOwn(updates, 'providerId');
  if (assignsProvider !== Object.hasOwn(updates, 'providerName') || assignsProvider && (Boolean(updates.providerId) !== Boolean(updates.providerName)
    || Boolean(updates.providerId) && !validId(updates.providerId))) fail('Proveedor inválido.');
  if (Object.hasOwn(submitted, 'providerInviteLink') && (!updates.providerId || submitted.providerInviteLink !== null)) fail('Invitación inválida.');
  if (expense.paymentLocked === true || expense.paid === true || list(expense.paymentHistory).length) fail('PAID_EXPENSE_LOCKED');
  if ((expense.thirdPartyPayoutRequired || list(expense.sharedInvoices).length || list(expense.sharedReceipts).length || list(expense.sharedPaymentIds).length)
    && ['providerId', 'providerName', ...amountFields].some(key => key in updates && updates[key] !== expense[key])) fail('El gasto tiene comprobantes compartidos. Revisá sus importes o proveedor con administración.');
  if ('quantity' in updates || 'unitPrice' in updates) {
    updates.quantity = updates.quantity ?? Number(expense.quantity);
    updates.unitPrice = updates.unitPrice ?? Number(expense.unitPrice);
    updates.total = updates.quantity * updates.unitPrice;
    if (![updates.quantity, updates.unitPrice, updates.total].every(isNumber)) fail('Importe de gasto inválido.');
  }
  return updates;
}

async function uploadedAttachment(inspectUpload, scope, expense, actor, input, kind, fileId) {
  const path = input.path;
  if (typeof path !== 'string' || path.length > 900 || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) fail('Ruta de archivo inválida.');
  const parts = path.split('/');
  if (parts.length !== 6 || parts[0] !== 'projects' || parts[1] !== scope.projectId
    || (kind === 'invoice' ? parts[2] !== 'areas' || parts[4] !== 'facturas' : parts[2] !== scope.collectionName || parts[3] !== scope.itemId || parts[4] !== 'comprobantes')) deny();
  const metadata = await inspectUpload(path);
  const custom = metadata.metadata || {};
  const contentType = metadata.contentType, size = Number(metadata.size);
  const mimeTypes = ['application/pdf', 'image/jpeg', 'image/png', ...(kind === 'invoice' ? [] : ['image/webp'])];
  if (custom.uploadAccessScope !== 'area_editor' || custom.projectId !== scope.projectId || custom.collectionName !== scope.collectionName
    || (custom.itemId || custom.expenseId) !== scope.itemId || custom.uploaderUid !== actor.uid
    || (kind === 'invoice' && (custom.area !== expense.area || custom.areaFolder !== parts[3]))
    || (kind !== 'invoice' && custom.paymentId !== (kind === 'payment' ? fileId : ''))
    || !mimeTypes.includes(contentType) || !Number.isSafeInteger(size) || size < 1 || size > 2 * 1024 * 1024) deny();
  return { id: fileId, path, url: fileMarker(scope, kind === 'invoice' ? 'invoices' : kind, fileId), fileName: parts[5],
    originalFileName: String(custom.originalFileName || parts[5]).slice(0, 300), contentType, size, uploadedBy: actor.email, uploadedAt: Timestamp.now() };
}

function createScopedAreaExpenseEdits({ db, inspectUpload }) {
  return async (actor, input) => {
    const projectId = id(input.projectId), collectionName = 'areaExpenses';
    const root = db.doc(`projects/${projectId}`);
    return db.runTransaction(async tx => {
      const access = await projectFinanceAccess({ db, transaction: tx, actor, projectId });
      if (input.action === 'scheduleScopedAreaExpenseDates') {
        const targets = input.targets;
        if (!Array.isArray(targets) || !targets.length || targets.length > 200 || targets.some(target => !isMap(target)
          || !validId(target.id) || typeof target.expected !== 'string' || !/^[a-f0-9]{64}$/.test(target.expected)
          || typeof target.date !== 'string' || target.date !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(target.date)
            || !Number.isFinite(Date.parse(target.date)) || new Date(target.date).toISOString().slice(0, 10) !== target.date))
          || new Set(targets.map(target => target.id)).size !== targets.length) fail('Volvé a preparar la programación.');
        const snapshots = await tx.getAll(...targets.map(target => root.collection(collectionName).doc(target.id)));
        const now = Timestamp.now();
        let changed = 0;
        snapshots.forEach((snapshot, index) => {
          const expense = snapshot.data(), target = targets[index];
          if (!canEditAreaExpense(access, expense) || isInternalBudgetEstimate(expense) || !list(access.project.activeAreas).includes(expense.area)) deny();
          if (paymentDatesVersion(expense) !== target.expected) fail('Cambió el gasto. No se aplicó el lote.');
          if ((expense.paymentDate || '') === target.date) return;
          tx.update(snapshot.ref, { paymentDate: target.date, updatedAt: now });
          changed++;
        });
        return { changed };
      }
      const itemId = id(input.itemId), scope = { projectId, collectionName, itemId };
      const ref = root.collection(collectionName).doc(itemId);
      const expense = (await tx.get(ref)).data();
      if (!canEditAreaExpense(access, expense)) deny();
      const view = row => wire(scopedFiles(projectId, collectionName, { ...row, id: itemId }));
      const updatedAt = Timestamp.fromMillis(Math.max(Date.now(), (expense.updatedAt?.toMillis?.() ?? 0) + 1));
      if (input.action === 'editScopedAreaExpense') {
        const updates = prepareChanges(expense, input);
        if (updates.providerId && !(await tx.get(db.doc(`providers/${updates.providerId}`))).exists) fail('El proveedor ya no está disponible.');
        if (updates.providerId && expense.providerInviteLink?.status === 'pending' && validId(expense.providerInviteLink.token)) {
          const inviteRef = db.doc(`providerInvites/${expense.providerInviteLink.token}`);
          const invite = (await tx.get(inviteRef)).data();
          if (invite?.status === 'pending' && invite.used === false && invite.projectId === projectId && invite.collectionName === collectionName && invite.expenseId === itemId) {
            tx.update(inviteRef, { status: 'cancelled', cancelledAt: updatedAt, updatedAt, cancelledBy: actor.uid, cancelledByEmail: actor.email });
          }
          updates.providerInviteLink = null;
        } else if (input.updates.providerInviteLink === null) updates.providerInviteLink = null;
        tx.update(ref, { ...updates, updatedAt });
        return { expense: view({ ...expense, ...updates, updatedAt }) };
      }

      if (isInternalBudgetEstimate(expense)) deny();
      if (input.action === 'attachScopedAreaExpenseFile') {
        const { kind } = input, fileId = id(input.fileId);
        if (!documents.includes(kind)) fail('Tipo de comprobante inválido.');
        const field = kind === 'invoice' ? 'invoices' : 'otherReceipts', previous = list(expense[field]);
        const existing = previous.find(file => file?.id === fileId || file?.path === input.path);
        if (existing) {
          if (existing.id !== fileId || existing.path !== input.path || existing.uploadedBy !== actor.email) fail('El archivo ya fue vinculado.');
          return { expense: view(expense) };
        }
        const file = await uploadedAttachment(inspectUpload, scope, expense, actor, input, kind, fileId);
        const updates = { [field]: [...previous, file], updatedAt };
        if (kind === 'invoice') {
          updates.invoiceStatus = 'pendiente';
          if (!expense.invoice && !previous.length) updates.invoice = file;
        } else Object.assign(file, { uploadedByEmail: actor.email, uploadedByName: ownerName(access, actor), uploadedByRole: access.collaborator?.role || 'admin' });
        tx.update(ref, updates);
        return { expense: view({ ...expense, ...updates }) };
      }

      if (input.action !== 'registerScopedAreaExpensePayment') fail('Acción de gasto desconocida.');
      const { amount, date, detail, method, expected } = input;
      const paymentId = id(input.paymentId);
      const entryDate = new Date(date);
      if (!isNumber(amount) || cents(amount) <= 0 || Math.abs(amount * 100 - cents(amount)) > 0.0001
        || typeof date !== 'string' || !Number.isFinite(entryDate.getTime()) || entryDate.toISOString() !== date
        || typeof detail !== 'string' || detail.length > 2000 || !['otro', 'tercero', 'caja_efectivo'].includes(method)
        || !isMap(expected) || expected.id !== itemId) fail('Revisá los datos del pago.');
      const history = list(expense.paymentHistory), existing = history.find(payment => payment.id === paymentId);
      const fingerprint = hash({ actor, amount, date, detail, method, payer: input.thirdPartyPayerId || '', path: input.path || '', expected });
      if (existing) {
        if (existing.createdBy !== actor.uid || existing.createdByEmail !== actor.email || existing.registrationFingerprint !== fingerprint) fail('El identificador ya corresponde a otro pago.');
        return { expense: view(expense) };
      }
      if (!targetFields.every(key => (expected[key] ?? null) === (expense[key] ?? null))) fail('ITEM_CHANGED');
      if (expense.thirdPartyPayoutRequired) fail('Este gasto requiere el pago a la persona autorizada.');
      const expenseTotal = Number(expense.total);
      if (history.some(payment => !isNumber(Number(payment.amount))) || !isNumber(expenseTotal)) fail('Revisá el historial de pagos.');
      const totalPaid = history.reduce((sum, payment) => sum + cents(payment.amount), cents(amount));
      if (totalPaid > cents(expenseTotal)) fail('PAYMENT_EXCEEDS_TOTAL');
      const paid = totalPaid === cents(expenseTotal), name = ownerName(access, actor);
      const payment = { id: paymentId, amount, date: Timestamp.fromDate(entryDate), detail, method, type: paid ? 'total' : 'partial',
        createdBy: actor.uid, createdByEmail: actor.email, createdByName: name, createdByRole: access.collaborator?.role || 'admin', registrationFingerprint: fingerprint };

      let cashRef;
      if (method === 'tercero') {
        const payerId = id(input.thirdPartyPayerId);
        const payer = (await tx.get(db.doc(`providers/${payerId}`))).data();
        const payerName = [payer?.name, payer?.lastName].filter(Boolean).join(' ').trim() || payer?.fullName || '';
        if (payer?.type !== 'persona' || !payerName) fail('Seleccioná quién hizo el pago.');
        Object.assign(payment, { thirdPartyPayerId: payerId, thirdPartyPayerName: String(payerName).slice(0, 300), reimbursements: [], reimbursedAmount: 0 });
      } else if (method === 'caja_efectivo') {
        if (input.cashAccount !== 'personal') deny();
        cashRef = root.collection('cashMovements').doc(`payment-${paymentId}`);
        const ledger = await tx.get(root.collection('cashMovements').limit(2001));
        if (ledger.size > 2000 || availablePersonalCents(ledger.docs.map(row => row.data()), actor.email) < cents(amount)) fail('El monto supera el saldo disponible de tu caja.');
        Object.assign(payment, { cashAccount: 'personal', paidByEmail: actor.email, paidByName: name, cashBoxLabel: `Caja asignada a ${name}`, cashMovementId: cashRef.id });
      }
      if (input.path) payment.receipt = await uploadedAttachment(inspectUpload, scope, expense, actor, input, 'payment', paymentId);

      if (cashRef) {
        tx.create(cashRef, { type: 'pago', cashAccount: 'personal', amount, date: entryDate, fromUserEmail: actor.email, fromUserName: name,
          area: expense.area || '', subcategory: expense.subcategory || '', collectionName, itemId, paymentId, description: expense.description || '', notes: detail,
          createdBy: actor.uid, createdByEmail: actor.email, createdByName: name, createdAt: updatedAt, updatedAt });
        tx.update(root, { cashSubdeliveryRevision: (Number(access.project.cashSubdeliveryRevision) || 0) + 1 });
      }
      const updates = { paymentHistory: [...history, payment], paid, paymentLocked: true, paymentAuthorIds: [...list(expense.paymentAuthorIds), actor.uid], updatedAt };
      tx.update(ref, updates);
      return { expense: view({ ...expense, ...updates }) };
    });
  };
}

module.exports = { createScopedAreaExpenseEdits };
