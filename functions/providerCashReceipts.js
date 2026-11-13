const { HttpsError } = require('firebase-functions/v2/https');
const { projectFinanceAccess } = require('./projectFinanceAccess');
const { hasTeamWorkAccess } = require('./teamWorkAccess');
const { assertProviderPortalAllowed } = require('./providerAdministrativeRecords');
const { companySigningAuthority } = require('./providerRepresentation');
const { id, email, text, hash, list, dateKey } = require('./providerPortalModel');
const fail = (message, code = 'failed-precondition') => { throw new HttpsError(code, message); };
const cents = value => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e10 || Math.abs(value * 100 - Math.round(value * 100)) > .0001) fail('Revisá los importes: usá hasta dos decimales.');
  return Math.round(value * 100);
};
const date = value => {
  if (value?.toDate) value = value.toDate();
  if (value instanceof Date) value = Number.isNaN(value.getTime()) ? '' : dateKey(value);
  else if (typeof value === 'string' && value.length > 10 && !Number.isNaN(Date.parse(value))) value = dateKey(new Date(value));
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10)) || Number.isNaN(Date.parse(value)) || new Date(value.slice(0, 10) + 'T12:00:00Z').toISOString().slice(0, 10) !== value.slice(0, 10)) fail('El pago necesita una fecha válida.');
  return value.slice(0, 10);
};
const name = provider => text(provider.businessName || [provider.name, provider.lastName].filter(Boolean).join(' ') || provider.fullName, 200);
function cashParts(input, amountCents) {
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['ars', 'usd', 'rate'].includes(key))) fail('Indicá el efectivo entregado.');
  const arsCents = cents(input.ars), usdCents = cents(input.usd), rate = input.rate;
  if (!arsCents && !usdCents) fail('Indicá cuánto efectivo recibió el proveedor.');
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1e6 || Math.abs(rate * 1e6 - Math.round(rate * 1e6)) > .0001 || (usdCents ? rate <= 0 : rate !== 0)) fail('Indicá la cotización en pesos por dólar, con hasta seis decimales; no se obtiene automáticamente.');
  if (arsCents + Math.round(usdCents * rate) !== amountCents) fail('El efectivo y su cotización deben coincidir con el importe en pesos ya registrado. El pago no se modifica.');
  return { arsCents, usdCents, rate };
}
function cashPayment(item, paymentId, movement) {
  const payments = list(item?.paymentHistory).filter(p => p.id === paymentId);
  if (payments.length !== 1) fail('El pago cambió o ya no existe. Actualizá el historial.');
  const p = payments[0];
  if (p.method !== 'caja_efectivo' || p.sharedRecordId || !['general', 'personal'].includes(p.cashAccount) || !p.cashMovementId || !(p.amount > 0)) fail('Sólo se puede pedir recibo de un pago con caja en efectivo.');
  const amountCents = cents(p.amount);
  if (movement && (movement.type !== 'pago' || movement.paymentId !== p.id || movement.cashAccount !== p.cashAccount || cents(movement.amount) !== amountCents)) fail('El movimiento de caja no coincide con el pago. Pedí a administración que lo revise.');
  return { paymentId: p.id, amountCents, date: date(p.date), cashAccount: p.cashAccount, cashMovementId: p.cashMovementId,
    detail: text(p.detail, 2000), providerId: id(item.providerId), concept: text(item.description, 1200),
    deliveredBy: text(p.paidByName || p.createdByName || p.paidByEmail || p.createdByEmail, 200),
    deliveredByEmail: email(p.paidByEmail || p.createdByEmail), cashBoxLabel: text(p.cashBoxLabel || (p.cashAccount === 'general' ? 'Caja General' : 'Caja personal del proyecto'), 200),
    createdBy: text(p.createdBy), createdByEmail: email(p.createdByEmail), paymentType: p.type === 'total' ? 'total' : 'partial' };
}
function createCashReceiptService({ db, sign, timestamp, clock = () => new Date() }) {
  const tuple = input => {
    if (!['areaExpenses', 'budgetItems'].includes(input.collectionName)) fail('Trabajo inválido.');
    return { projectId: id(input.projectId), collectionName: input.collectionName, itemId: id(input.itemId), paymentId: id(input.paymentId) };
  };
  async function source(actor, input, tx) {
    const scope = tuple(input), read = ref => tx ? tx.get(ref) : ref.get();
    const access = await projectFinanceAccess({ db, transaction: tx, actor, projectId: scope.projectId });
    if (actor.email !== 'info@granbertafilms.com' && (!hasTeamWorkAccess(access.user) || email(access.user.email) !== actor.email)) fail('Necesitás una cuenta del equipo habilitada.', 'permission-denied');
    const row = (await read(db.doc(`projects/${scope.projectId}/${scope.collectionName}/${scope.itemId}`))).data();
    if (!row || (scope.collectionName === 'areaExpenses') !== list(access.project.activeAreas).includes(row.area)) fail('El trabajo cambió de gestión. Actualizá la página.');
    const fact = cashPayment(row, scope.paymentId);
    const cash = (await read(db.doc(`projects/${scope.projectId}/cashMovements/${id(fact.cashMovementId)}`))).data();
    if (!cash || cash.collectionName !== scope.collectionName || cash.itemId !== scope.itemId) fail('No se encontró el movimiento de caja vinculado.');
    cashPayment(row, scope.paymentId, cash);
    const c = access.collaborator || {}, key = `${row.area}||${row.subcategory || ''}`;
    const editable = c.canEditBudgetAreas === true && list(c.allowedTabs).includes('areas') && !list(c.excludedSubcategories).includes(key)
      && (list(c.allowedCategories).includes(row.area) || list(c.allowedSubcategories).includes(key));
    const canRequest = access.admin || editable && fact.createdBy === actor.uid && fact.createdByEmail === actor.email;
    const provider = (await read(db.doc(`providers/${fact.providerId}`))).data();
    if (!provider) fail('El proveedor ya no está disponible.');
    const signerEmail = email(provider.portalAccessEmail || provider.personalGoogleAccount?.email);
    return { scope, row, fact, provider, access, canRequest, signerEmail, fingerprint: hash({ ...scope, ...fact }),
      projectName: text(access.project.name, 200), providerName: name(provider) };
  }
  async function current(record, tx) {
    try {
      const read = path => tx ? tx.get(db.doc(path)) : db.doc(path).get();
      const item = (await read(`projects/${record.scope.projectId}/${record.scope.collectionName}/${record.scope.itemId}`)).data();
      const provider = (await read(`providers/${record.providerId}`)).data();
      const fact = cashPayment(item, record.scope.paymentId);
      const movement = (await read(`projects/${record.scope.projectId}/cashMovements/${id(fact.cashMovementId)}`)).data();
      if (!movement || movement.collectionName !== record.scope.collectionName || movement.itemId !== record.scope.itemId) return false;
      cashPayment(item, record.scope.paymentId, movement);
      return hash({ ...record.scope, ...fact }) === record.paymentFingerprint
        && email(provider?.portalAccessEmail || provider?.personalGoogleAccount?.email) === record.actor.email;
    } catch (error) {
      if (error instanceof HttpsError && error.code === 'failed-precondition') return false;
      throw error;
    }
  }
  async function summary(record) {
    return { id: record.id, status: record.status === 'cancelled' ? 'cancelled' : await current(record) ? record.status : 'replaced',
      signed: !!record.proof?.complete, title: record.title, signerEmail: record.actor.email, content: record.content,
      signing: record.signing || null, proof: record.proof ? { complete: record.proof.complete, signedAt: record.proof.signedAt } : null };
  }
  return {
    source, current, summary,
    async admin(actor, input) {
      if (input.action === 'cashReceiptSource') {
        const s = await source(actor, input), key = hash(s.scope);
        const rows = await db.collection('providerCashReceipts').where('paymentKey', '==', key).limit(31).get();
        if (rows.size > 30) fail('Hay demasiadas versiones del recibo. Pedí a administración que revise el historial.');
        return { source: { ...s.scope, fingerprint: s.fingerprint, amountCents: s.fact.amountCents, date: s.fact.date,
          concept: s.fact.concept, projectName: s.projectName, providerName: s.providerName, signerEmail: s.signerEmail,
          cashBoxLabel: s.fact.cashBoxLabel, deliveredBy: s.fact.deliveredBy }, canRequest: s.canRequest,
          receipts: await Promise.all(rows.docs.map(r => summary({ ...r.data(), id: r.id }))) };
      }
      if (input.action === 'requestCashReceipt') {
        if (!/^[a-f0-9-]{36}$/i.test(input.attemptId || '')) fail('Volvé a abrir la solicitud de recibo.');
        const preparedAt = clock().toISOString();
        const receipt = await db.runTransaction(async tx => {
          const s = await source(actor, input, tx);
          await assertProviderPortalAllowed(db, s.fact.providerId, tx);
          if (!s.canRequest) fail('Sólo administración o quien registró el pago con permiso de edición puede pedir este recibo.', 'permission-denied');
          if (input.expectedFingerprint !== s.fingerprint) fail('El pago cambió. Actualizá el historial antes de solicitar el recibo.');
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.signerEmail)) fail('El proveedor debe completar su alta y vincular su cuenta Google antes de recibir el pedido de firma.');
          if (!s.providerName) fail('Falta el nombre del proveedor. Debe completar sus datos antes de solicitar el recibo.');
          const parts = cashParts(input.parts, s.fact.amountCents), paymentKey = hash(s.scope);
          const receiptId = `cash_receipt_${hash({ paymentKey, fingerprint: s.fingerprint, signerEmail: s.signerEmail, parts, attempt: input.attemptId })}`;
          const ref = db.doc(`providerCashReceipts/${receiptId}`), keyRef = db.doc(`providerCashReceiptKeys/${paymentKey}`);
          const [existing, priorKey] = await Promise.all([tx.get(ref), tx.get(keyRef)]);
          const prior = priorKey.data()?.receiptId ? await tx.get(db.doc(`providerCashReceipts/${id(priorKey.data().receiptId)}`)) : null;
          if (existing.exists) {
            if (['cancelled', 'replaced'].includes(existing.data().status)) fail('Esta solicitud fue anulada o reemplazada. Abrí una nueva.');
            return { ...existing.data(), id: receiptId };
          }
          if (prior?.exists && !['cancelled', 'replaced'].includes(prior.data().status) && prior.data().paymentFingerprint === s.fingerprint && prior.data().actor.email === s.signerEmail) {
            if (hash(prior.data().content.parts) !== hash(parts)) fail('Ya hay un recibo para este pago. Anulá esa solicitud antes de cambiar el desglose.');
            return { ...prior.data(), id: prior.id };
          }
          let signerDni = text(s.provider.dni).replace(/\D/g, ''), signerName = s.providerName;
          if (s.provider.type === 'empresa') {
            const approval = (await tx.get(db.doc(`providerPortalCompanyApprovals/${s.fact.providerId}`))).data();
            const membership = approval?.uid ? (await tx.get(db.doc(`providerPortalUsers/${id(approval.uid)}/memberships/${s.fact.providerId}`))).data() : null;
            const declaration = approval?.declarationId ? (await tx.get(db.doc(`providerPortalDeclarations/${id(approval.declarationId)}`))).data() : null;
            companySigningAuthority(s.provider, approval, membership, declaration);
            signerDni = text(declaration?.content.signerDni).replace(/\D/g, '');
            signerName = text(declaration?.content.profile?.name || declaration?.content.profile?.fullName || s.providerName);
          }
          if (!/^\d{7,8}$/.test(signerDni)) fail('Falta el DNI de quien firma. El proveedor debe completar sus datos antes de solicitar el recibo.');
          const content = { version: 'cash-receipt-v1', ...s.scope, projectName: s.projectName, provider: { name: s.providerName, cuit: text(s.provider.cuit), type: s.provider.type || 'persona' },
            signerName, signerDni, payment: s.fact, parts, preparedAt };
          const record = { id: receiptId, kind: 'cash_receipt', providerId: s.fact.providerId, scope: s.scope, paymentKey, paymentFingerprint: s.fingerprint,
            title: `Recibo de efectivo · ${s.projectName} · ${s.fact.date}`, actor: { email: s.signerEmail }, requestedBy: actor,
            status: 'preparing', content, contentHash: hash(content), createdAt: timestamp(), preparedAt };
          tx.create(ref, record); tx.set(keyRef, { receiptId });
          tx.create(db.doc(`projects/${s.scope.projectId}/activityLog/${receiptId}`), { action: 'cash_receipt_requested', actor, receiptId, paymentId: s.scope.paymentId, contentHash: record.contentHash, createdAt: timestamp() });
          return record;
        });
        await assertProviderPortalAllowed(db, receipt.providerId);
        if (receipt.signing && receipt.status !== 'preparing') return summary(receipt);
        const signing = await sign.prepare(receipt);
        const saved = await db.runTransaction(async tx => {
          const ref = db.doc(`providerCashReceipts/${receipt.id}`), savedRecord = (await tx.get(ref)).data();
          const matches = await current(receipt, tx);
          const status = savedRecord.status === 'cancelled' ? 'cancelled' : !matches ? 'replaced' : savedRecord.proof?.complete ? 'signed' : 'requested';
          tx.update(ref, { signing, status });
          return { ...savedRecord, signing, status };
        });
        if (['cancelled', 'replaced'].includes(saved.status)) await sign.cancelCashReceipt(signing);
        return summary(saved);
      }
      if (['cashReceiptFile', 'cancelCashReceipt'].includes(input.action)) {
        const ref = db.doc(`providerCashReceipts/${id(input.receiptId)}`), record = (await ref.get()).data();
        if (!record) fail('Recibo inexistente.');
        const access = await projectFinanceAccess({ db, actor, projectId: record.scope.projectId });
        if (input.action === 'cashReceiptFile') return sign.declarationFile(record.signing, input.artifact || 'original');
        const reason = text(input.reason, 300);
        if (!reason) fail('Indicá el motivo de anulación.');
        await db.runTransaction(async tx => {
          const current = (await tx.get(ref)).data();
          const liveAccess = await projectFinanceAccess({ db, transaction: tx, actor, projectId: record.scope.projectId });
          if (!liveAccess.admin && (record.requestedBy.uid !== actor.uid || record.requestedBy.email !== actor.email || !(await source(actor, record.scope, tx)).canRequest)) fail('Sólo administración o quien solicitó el recibo con permiso de edición vigente puede anularlo.', 'permission-denied');
          if (current.status === 'cancelled') return;
          tx.update(ref, { status: 'cancelled', cancellation: { actor, reason, at: timestamp() } });
          tx.create(db.doc(`projects/${record.scope.projectId}/activityLog/${record.id}_cancelled`), { action: 'cash_receipt_cancelled', receiptId: record.id, actor, reason, createdAt: timestamp() });
        });
        await sign.cancelCashReceipt(record.signing || { receiptId: record.id, contentHash: record.contentHash });
        return { status: 'cancelled' };
      }
      fail('Acción de recibo inválida.');
    },
    async complete(actor, input) {
      const ref = db.doc(`providerCashReceipts/${id(input.receiptId)}`), record = (await ref.get()).data();
      if (!record || record.providerId !== input.providerId || record.actor.email !== actor.email) fail('Este recibo no fue asignado a tu cuenta.', 'permission-denied');
      if (['cancelled', 'replaced'].includes(record.status) || !await current(record)) fail('El pago o la solicitud cambió. Este recibo se conserva como antecedente; pedí uno nuevo.');
      const proof = await sign.verify(record.signing, actor, record.contentHash);
      if (!proof.complete) return { status: 'pending_signature' };
      if (proof.signerDni !== record.content.signerDni) fail('El DNI de la firma no coincide con el recibo.');
      await db.runTransaction(async tx => {
        const saved = (await tx.get(ref)).data();
        if (['cancelled', 'replaced'].includes(saved.status) || saved.contentHash !== record.contentHash) fail('La solicitud cambió. Actualizá tus documentos.');
        const membership = (await tx.get(db.doc(`providerPortalUsers/${id(actor.uid)}/memberships/${record.providerId}`))).data();
        await assertProviderPortalAllowed(db, record.providerId, tx);
        if (membership?.status !== 'active' || membership.email !== actor.email) fail('Tu acceso a este proveedor cambió. Ingresá con la cuenta registrada.', 'permission-denied');
        if (!await current(record, tx)) fail('El pago o su destinatario cambió mientras firmabas. Pedí un recibo actualizado.');
        const provider = (await tx.get(db.doc(`providers/${record.providerId}`))).data();
        if (provider.type === 'empresa') {
          const approval = (await tx.get(db.doc(`providerPortalCompanyApprovals/${record.providerId}`))).data();
          const declaration = approval?.declarationId ? (await tx.get(db.doc(`providerPortalDeclarations/${id(approval.declarationId)}`))).data() : null;
          companySigningAuthority(provider, approval, membership, declaration);
          if (approval.uid !== actor.uid) fail('La representación de la empresa cambió.', 'permission-denied');
        }
        if (saved.proof?.complete) return;
        tx.update(ref, { status: 'signed', proof, signedAt: timestamp() });
        tx.create(db.doc(`projects/${record.scope.projectId}/activityLog/${record.id}_signed`), { action: 'cash_receipt_signed', receiptId: record.id, signerEmail: actor.email, contentHash: record.contentHash, createdAt: timestamp() });
      });
      return { status: 'signed' };
    },
  };
}
module.exports = { createCashReceiptService, cashParts, cashPayment };
