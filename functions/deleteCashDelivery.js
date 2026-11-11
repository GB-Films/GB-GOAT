const { HttpsError } = require('firebase-functions/v2/https');
const { canAccessGeneralCash } = require('./generalCashAccess');
const { hasTeamWorkAccess } = require('./teamWorkAccess');
const email = value => String(value || '').trim().toLowerCase();
const fail = (code, message) => { throw new HttpsError(code, message); };

async function deleteCashDelivery({ db, timestamp, availablePersonalCents }, request) {
  const input = request.data;
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['action', 'projectId', 'movementId'].includes(key))
    || typeof input.projectId !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/.test(input.projectId)
    || typeof input.movementId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(input.movementId)) fail('invalid-argument', 'Elegí una entrega válida para borrar.');
  const actorEmail = email(request.auth.token.email);
  if (!canAccessGeneralCash(actorEmail)) fail('permission-denied', 'No tenés permiso para borrar entregas de Caja General.');
  const root = db.collection('projects').doc(input.projectId);
  const movement = root.collection('cashMovements').doc(input.movementId);
  const audit = root.collection('activityLog').doc(`cash-delivery-deleted-${input.movementId}`);
  return db.runTransaction(async tx => {
    const [project, actor, access, saved, previousAudit] = await tx.getAll(
      root, db.collection('users').doc(request.auth.uid), root.collection('collaborators').doc(actorEmail), movement, audit,
    );
    if (!project.exists || !actor.exists || !hasTeamWorkAccess(actor.data()) || email(actor.data().email) !== actorEmail
      || !(actor.data().role === 'admin' || project.data().createdBy === request.auth.uid || access.data()?.role === 'admin')
      || (project.data().generalCashDeliveryBlockedEmails || []).includes(actorEmail)) fail('permission-denied', 'No tenés permiso para borrar entregas en este proyecto.');
    if (!saved.exists) {
      if (previousAudit.exists && previousAudit.data().action === 'cash_delivery_deleted' && previousAudit.data().movementId === movement.id) return { id: movement.id, repeated: true };
      fail('not-found', 'La entrega ya no existe. Actualizá la página.');
    }
    if (previousAudit.exists) fail('failed-precondition', 'Esta entrega tiene un borrado anterior. Pedí a administración que revise el historial.');
    const data = saved.data(), recipient = email(data.toUserEmail);
    if (data.type !== 'entrega' || data.subdelivery === true || data.sharedRecordId
      || !/^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(recipient)
      || typeof data.amount !== 'number' || !Number.isFinite(data.amount) || data.amount <= 0 || data.amount > 1e12
      || Math.abs(data.amount * 100 - Math.round(data.amount * 100)) > 0.0001
      || ![undefined, 'pending', 'confirmed', 'cancelled'].includes(data.status)) fail('failed-precondition', 'Esta entrega necesita una revisión antes de poder borrarla.');
    const ledger = await tx.get(root.collection('cashMovements').limit(2001));
    if (ledger.size > 2000) fail('failed-precondition', 'La caja tiene demasiados movimientos para este borrado. Pedí a administración que la revise.');
    const rows = ledger.docs.map(doc => ({ id: doc.id, data: doc.data() }));
    const balanceBeforeCents = availablePersonalCents(rows.map(row => row.data), recipient);
    const balanceAfterCents = availablePersonalCents(rows.filter(row => row.id !== movement.id).map(row => row.data), recipient);
    if (balanceAfterCents < 0) fail('failed-precondition', 'No podés borrar esta entrega: el saldo restante no alcanza para cubrir los pagos y las entregas o devoluciones pendientes.');
    const revision = project.data().cashSubdeliveryRevision || 0;
    if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) fail('failed-precondition', 'Pedí a administración que revise el historial de la caja.');
    const now = timestamp();
    tx.delete(movement);
    tx.create(audit, {
      action: 'cash_delivery_deleted', movementId: movement.id, before: data, amount: data.amount,
      recipientEmail: recipient, recipientName: data.toUserName || '', status: data.status || 'legacy',
      balanceBeforeCents, balanceAfterCents, deletedBy: request.auth.uid, deletedByEmail: actorEmail,
      deletedByName: String(actor.data().displayName || actorEmail).slice(0, 200), deletedByRole: 'admin', createdAt: now,
    });
    // Same serialization point as new personal deliveries and their receipts.
    tx.update(root, { cashSubdeliveryRevision: revision + 1 });
    return { id: movement.id, repeated: false };
  });
}
module.exports = { deleteCashDelivery };
