const { HttpsError } = require('firebase-functions/v2/https');
const { projectFinanceAccess } = require('./projectFinanceAccess');
const { canReadTab } = require('./projectReadScope');
const { listCashRecipients, resolveCashRecipient, canReceiveTransfer } = require('./projectCashRecipients');
const email = value => String(value || '').trim().toLowerCase();
const fail = (code, message) => { throw new HttpsError(code, message); };
const cents = value => Math.round(Number(value || 0) * 100);
const validProjectId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,150}$/.test(value);
const displayName = (user, actorEmail) => String(user.displayName || actorEmail).slice(0, 200);

async function actorCashAccess(db, transaction, request, projectId, requireCashTab) {
  const actor = { uid: request.auth.uid, email: email(request.auth.token.email) };
  const access = await projectFinanceAccess({ db, transaction, actor, projectId });
  if (!access.user || email(access.user.email) !== actor.email || requireCashTab && !canReadTab(access, 'cajas'))
    fail('permission-denied', 'Necesitás acceso vigente a Cajas en este proyecto.');
  return access;
}

function availablePersonalCents(movements, actorEmail) {
  let balance = 0;
  for (const m of movements) {
    if (m.status === 'cancelled') continue;
    const from = email(m.fromUserEmail), to = email(m.toUserEmail);
    if (from !== actorEmail && to !== actorEmail) continue;
    if (typeof m.amount !== 'number' || !Number.isFinite(m.amount) || m.amount <= 0 || m.amount > 1e12) fail('failed-precondition', 'Revisá los importes registrados en tu caja antes de hacer un movimiento.');
    const amount = cents(m.amount);
    if (m.type === 'devolucion') {
      if (from === actorEmail && ['pending', 'confirmed'].includes(m.status)) balance -= amount;
      continue;
    }
    if (m.type === 'entrega' && m.status === 'pending') continue;
    // Pending personal deliveries reserve the sender's funds, but are not
    // spendable by the recipient until that recipient confirms reception.
    if (to === actorEmail && !(m.type === 'transferencia' && m.status === 'pending')) balance += amount;
    if (from === actorEmail && m.cashAccount !== 'general' && m.type !== 'entrega') balance -= amount;
  }
  if (!Number.isSafeInteger(balance)) fail('failed-precondition', 'Revisá el saldo de tu caja.');
  return balance;
}

function createCashSubdeliveryHandler({ db, timestamp }) {
  return async request => {
    if (!request.auth?.uid || !request.auth.token?.email) fail('unauthenticated', 'Iniciá sesión.');
    const input = request.data;
    if (input?.action === 'deleteDelivery') return require('./deleteCashDelivery').deleteCashDelivery({ db, timestamp, availablePersonalCents }, request);
    if (request.auth.token.email_verified !== true) fail('permission-denied', 'Verificá tu correo para operar en Cajas.');
    if (input?.action === 'confirm') return confirmCashSubdelivery({ db, timestamp }, request);
    if (input?.action === 'recipients') {
      if (!validProjectId(input.projectId) || Object.keys(input).some(key => !['action', 'projectId'].includes(key)))
        fail('invalid-argument', 'Elegí un proyecto válido.');
      const access = await actorCashAccess(db, null, request, input.projectId, true);
      return listCashRecipients(db, db.collection('projects').doc(input.projectId), access, email(request.auth.token.email));
    }
    const isReturn = input?.action === 'createReturn';
    const keys = ['projectId', 'requestId', 'toUserEmail', 'amount', 'notes', 'receiptVersion', ...(isReturn ? ['action', 'date'] : [])];
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !keys.includes(key))) fail('invalid-argument', 'Datos del movimiento de caja inválidos.');
    if (input.receiptVersion !== 1) fail('failed-precondition', 'Actualizá la página para registrar una entrega con confirmación de recepción.');
    const { projectId, requestId, amount } = input;
    if (!validProjectId(projectId)
      || typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId)
      || typeof input.toUserEmail !== 'string' || input.toUserEmail.length > 254 || !/^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(input.toUserEmail)
      || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0.01 || amount > 1e12
      || Math.abs(amount * 100 - cents(amount)) > 0.0001
      || (input.notes !== undefined && (typeof input.notes !== 'string' || input.notes.length > 1000))) fail('invalid-argument', 'Revisá destino, importe y nota.');
    const actorEmail = email(request.auth.token.email), toEmail = email(input.toUserEmail);
    if (actorEmail === toEmail) fail('invalid-argument', 'Elegí otra persona como destinataria.');
    const notes = (input.notes || '').trim();
    const returnDate = isReturn && typeof input.date === 'string' ? new Date(input.date) : null;
    if (isReturn && (!returnDate || !Number.isFinite(returnDate.getTime()) || returnDate.toISOString() !== input.date))
      fail('invalid-argument', 'Elegí una fecha de devolución válida.');
    const root = db.collection('projects').doc(projectId);
    const movement = root.collection('cashMovements').doc(`${isReturn ? 'cash-return' : 'subdelivery'}-${requestId}`);
    const type = isReturn ? 'devolucion' : 'transferencia';
    return db.runTransaction(async transaction => {
      const [access, existing] = await Promise.all([
        actorCashAccess(db, transaction, request, projectId, true), transaction.get(movement),
      ]);
      const target = await resolveCashRecipient(db, transaction, root, access.project, toEmail);
      if (!target || (isReturn ? !target.canReceiveReturn : !canReceiveTransfer(target, access.admin))) fail('permission-denied',
        isReturn ? 'Elegí a un responsable de Caja General con acceso administrativo al proyecto.' : 'La persona destinataria debe tener acceso vigente al proyecto.');
      if (existing.exists) {
        const previous = existing.data();
        if (previous.type !== type || (!isReturn && previous.subdelivery !== true) || previous.createdBy !== request.auth.uid ||
          previous.toUserEmail !== toEmail || cents(previous.amount) !== cents(amount) || previous.notes !== notes ||
          (isReturn && previous.date?.toDate?.().toISOString() !== input.date)) fail('already-exists', 'La solicitud ya fue usada con otros datos.');
        return { id: movement.id, repeated: true };
      }
      const ledger = await transaction.get(root.collection('cashMovements'));
      if (availablePersonalCents(ledger.docs.map(doc => doc.data()), actorEmail) < cents(amount)) fail('failed-precondition', 'El monto supera el saldo disponible de tu caja asignada.');
      const now = timestamp();
      transaction.create(movement, {
        type, ...(isReturn ? { cashAccount: 'general', date: returnDate } : { cashAccount: 'personal', date: now, subdelivery: true, receiptVersion: 1 }),
        status: 'pending', amount: cents(amount) / 100, fromUserEmail: actorEmail, fromUserName: displayName(access.user, actorEmail),
        toUserId: target.uid, toUserEmail: toEmail, toUserName: target.person.displayName, notes,
        createdBy: request.auth.uid, createdByEmail: actorEmail, createdByName: displayName(access.user, actorEmail), createdAt: now, updatedAt: now,
      });
      // Serializes simultaneous subdeliveries, in addition to live ledger reads.
      transaction.update(root, { cashSubdeliveryRevision: (Number(access.project.cashSubdeliveryRevision) || 0) + 1 });
      return { id: movement.id, repeated: false };
    });
  };
}

async function confirmCashSubdelivery({ db, timestamp }, request) {
  const input = request.data;
  if (Object.keys(input).some(key => !['action', 'projectId', 'movementId'].includes(key))
    || !validProjectId(input.projectId)
    || typeof input.movementId !== 'string' || !/^subdelivery-[a-f0-9-]{36}$/i.test(input.movementId)) fail('invalid-argument', 'Elegí una entrega válida para confirmar.');
  const actorEmail = email(request.auth.token.email);
  const root = db.collection('projects').doc(input.projectId);
  const movement = root.collection('cashMovements').doc(input.movementId);
  return db.runTransaction(async transaction => {
    const [access, saved] = await Promise.all([
      actorCashAccess(db, transaction, request, input.projectId, false), transaction.get(movement),
    ]);
    const previous = saved.data();
    if (!previous || previous.type !== 'transferencia' || previous.cashAccount !== 'personal' || previous.subdelivery !== true
      || previous.receiptVersion !== 1 || email(previous.toUserEmail) !== actorEmail || email(previous.fromUserEmail) === actorEmail
      || previous.toUserId && previous.toUserId !== request.auth.uid) fail('permission-denied', 'Sólo la persona destinataria puede confirmar esta entrega.');
    if (typeof previous.amount !== 'number' || !Number.isFinite(previous.amount) || previous.amount <= 0 || previous.amount > 1e12) fail('failed-precondition', 'Esta entrega requiere revisar su importe antes de confirmar.');
    if (previous.status === 'confirmed' && previous.confirmedBy === request.auth.uid && previous.confirmedByEmail === actorEmail) return { id: movement.id, repeated: true };
    if (previous.status !== 'pending') fail('failed-precondition', 'Esta entrega ya no está pendiente de recepción. Actualizá la página.');
    const now = timestamp();
    transaction.update(movement, { status: 'confirmed', confirmedBy: request.auth.uid, confirmedByEmail: actorEmail,
      confirmedByName: displayName(access.user, actorEmail), confirmedAt: now, updatedAt: now });
    transaction.update(root, { cashSubdeliveryRevision: (Number(access.project.cashSubdeliveryRevision) || 0) + 1 });
    return { id: movement.id, repeated: false };
  });
}
module.exports = { createCashSubdeliveryHandler, availablePersonalCents };
