const { HttpsError } = require('firebase-functions/v2/https');
const email = value => String(value || '').trim().toLowerCase();
const fail = (code, message) => { throw new HttpsError(code, message); };
const cents = value => Math.round(Number(value || 0) * 100);

function availablePersonalCents(movements, actorEmail) {
  let balance = 0;
  for (const m of movements) {
    if (m.status === 'cancelled') continue;
    const from = email(m.fromUserEmail), to = email(m.toUserEmail);
    if (from !== actorEmail && to !== actorEmail) continue;
    if (typeof m.amount !== 'number' || !Number.isFinite(m.amount) || m.amount <= 0 || m.amount > 1e12) fail('failed-precondition', 'Revisá los importes registrados en tu caja antes de hacer una subentrega.');
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
    if (input?.action === 'confirm') return confirmCashSubdelivery({ db, timestamp }, request);
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['projectId', 'requestId', 'toUserEmail', 'amount', 'notes', 'receiptVersion'].includes(key))) fail('invalid-argument', 'Datos de subentrega inválidos.');
    if (input.receiptVersion !== 1) fail('failed-precondition', 'Actualizá la página para registrar una entrega con confirmación de recepción.');
    const { projectId, requestId, amount } = input;
    if (typeof projectId !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/.test(projectId)
      || typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId)
      || typeof input.toUserEmail !== 'string' || input.toUserEmail.length > 254 || !/^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(input.toUserEmail)
      || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0.01 || amount > 1e12
      || Math.abs(amount * 100 - cents(amount)) > 0.0001
      || (input.notes !== undefined && (typeof input.notes !== 'string' || input.notes.length > 1000))) fail('invalid-argument', 'Revisá destino, importe y nota.');
    const actorEmail = email(request.auth.token.email), toEmail = email(input.toUserEmail);
    if (actorEmail === toEmail) fail('invalid-argument', 'Elegí otra persona como destinataria.');
    const notes = (input.notes || '').trim();
    const root = db.collection('projects').doc(projectId);
    const movement = root.collection('cashMovements').doc(`subdelivery-${requestId}`);
    return db.runTransaction(async transaction => {
      const [project, actor, access, recipient, existing] = await transaction.getAll(
        root, db.collection('users').doc(request.auth.uid), root.collection('collaborators').doc(actorEmail),
        root.collection('collaborators').doc(toEmail), movement,
      );
      if (!project.exists || !actor.exists || !require('./teamWorkAccess').hasTeamWorkAccess(actor.data()) || email(actor.data().email) !== actorEmail
        || !(actor.data().role === 'admin' || project.data().createdBy === request.auth.uid || access.data()?.role === 'admin')) fail('permission-denied', 'Sólo administradores del proyecto o de la app pueden hacer subentregas.');
      const recipientUsers = await transaction.get(db.collection('users').where('email', '==', toEmail).limit(2));
      const recipientAdmin = recipientUsers.docs.find(doc => doc.data().role === 'admin');
      const recipientOwner = recipientUsers.docs.find(doc => doc.id === project.data().createdBy);
      const target = recipient.exists && ['admin', 'jefe_produccion', 'jefe_area'].includes(recipient.data().role) ? recipient.data() : (recipientAdmin || recipientOwner)?.data();
      if (!target) fail('permission-denied', 'La persona debe tener acceso al proyecto.');
      if (existing.exists) {
        const previous = existing.data();
        if (previous.subdelivery !== true || previous.createdBy !== request.auth.uid || previous.toUserEmail !== toEmail || cents(previous.amount) !== cents(amount) || previous.notes !== notes) fail('already-exists', 'La solicitud ya fue usada con otros datos.');
        return { id: movement.id, repeated: true };
      }
      const ledger = await transaction.get(root.collection('cashMovements'));
      if (availablePersonalCents(ledger.docs.map(doc => doc.data()), actorEmail) < cents(amount)) fail('failed-precondition', 'El monto supera el saldo disponible de tu caja asignada.');
      const now = timestamp();
      transaction.create(movement, {
        type: 'transferencia', cashAccount: 'personal', subdelivery: true, receiptVersion: 1, status: 'pending', amount: cents(amount) / 100,
        date: now, fromUserEmail: actorEmail, fromUserName: String(actor.data().displayName || actorEmail).slice(0, 200),
        toUserEmail: toEmail, toUserName: String(target.displayName || toEmail).slice(0, 200), notes,
        createdBy: request.auth.uid, createdByEmail: actorEmail, createdByName: String(actor.data().displayName || actorEmail).slice(0, 200), createdAt: now, updatedAt: now,
      });
      // Serializes simultaneous subdeliveries, in addition to live ledger reads.
      transaction.update(root, { cashSubdeliveryRevision: (Number(project.data().cashSubdeliveryRevision) || 0) + 1 });
      return { id: movement.id, repeated: false };
    });
  };
}

async function confirmCashSubdelivery({ db, timestamp }, request) {
  const input = request.data;
  if (Object.keys(input).some(key => !['action', 'projectId', 'movementId'].includes(key))
    || typeof input.projectId !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/.test(input.projectId)
    || typeof input.movementId !== 'string' || !/^subdelivery-[a-f0-9-]{36}$/i.test(input.movementId)) fail('invalid-argument', 'Elegí una entrega válida para confirmar.');
  const actorEmail = email(request.auth.token.email);
  const root = db.collection('projects').doc(input.projectId);
  const movement = root.collection('cashMovements').doc(input.movementId);
  return db.runTransaction(async transaction => {
    const [project, actor, access, saved] = await transaction.getAll(root, db.collection('users').doc(request.auth.uid), root.collection('collaborators').doc(actorEmail), movement);
    if (!project.exists || !actor.exists || !require('./teamWorkAccess').hasTeamWorkAccess(actor.data()) || email(actor.data().email) !== actorEmail
      || !(actor.data().role === 'admin' || project.data().createdBy === request.auth.uid || ['admin', 'jefe_produccion', 'jefe_area'].includes(access.data()?.role))) fail('permission-denied', 'Necesitás acceso vigente al proyecto para confirmar la recepción.');
    const previous = saved.data();
    if (!previous || previous.type !== 'transferencia' || previous.cashAccount !== 'personal' || previous.subdelivery !== true
      || previous.receiptVersion !== 1 || email(previous.toUserEmail) !== actorEmail || email(previous.fromUserEmail) === actorEmail) fail('permission-denied', 'Sólo la persona destinataria puede confirmar esta entrega.');
    if (typeof previous.amount !== 'number' || !Number.isFinite(previous.amount) || previous.amount <= 0 || previous.amount > 1e12) fail('failed-precondition', 'Esta entrega requiere revisar su importe antes de confirmar.');
    if (previous.status === 'confirmed' && previous.confirmedBy === request.auth.uid && previous.confirmedByEmail === actorEmail) return { id: movement.id, repeated: true };
    if (previous.status !== 'pending') fail('failed-precondition', 'Esta entrega ya no está pendiente de recepción. Actualizá la página.');
    const now = timestamp();
    transaction.update(movement, { status: 'confirmed', confirmedBy: request.auth.uid, confirmedByEmail: actorEmail,
      confirmedByName: String(actor.data().displayName || actorEmail).slice(0, 200), confirmedAt: now, updatedAt: now });
    transaction.update(root, { cashSubdeliveryRevision: (Number(project.data().cashSubdeliveryRevision) || 0) + 1 });
    return { id: movement.id, repeated: false };
  });
}
module.exports = { createCashSubdeliveryHandler, availablePersonalCents };
