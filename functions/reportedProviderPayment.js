const { HttpsError } = require('firebase-functions/v2/https');
const { createHash } = require('node:crypto');
const { id, text, email, hash, list, dateKey } = require('./providerPortalModel');
const { projectFinanceAccess, linkedAllocation } = require('./projectFinanceAccess');
const { canAccessGeneralCash } = require('./generalCashAccess');
const { isInternalBudgetEstimate } = require('./internalBudgetEstimate');
const fail = (message, code = 'failed-precondition') => { throw new HttpsError(code, message); };
const providerName = p => text(p.businessName || [p.name, p.lastName].filter(Boolean).join(' ') || p.fullName, 200);
function normalizeReportedPayment(input, now) {
  const projectId = id(input.projectId), itemId = id(input.itemId), recordId = id(input.id);
  if (input.collectionName !== 'areaExpenses') fail('Elegí un gasto de Áreas existente.');
  const date = text(input.date, 10);
  const parsed = new Date(date + 'T12:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date > dateKey(now)) fail('Indicá la fecha real de un pago ya realizado, sin fechas futuras.');
  if (input.alreadyPaid !== true) fail('Confirmá que el pago ya ocurrió. Esta opción no ordena una transferencia.');
  const beneficiary = { name: text(input.beneficiary?.name, 200), cuit: text(input.beneficiary?.cuit, 30), account: text(input.beneficiary?.account, 60) };
  if (!beneficiary.name || !/^\d{11}$/.test(beneficiary.cuit) || !/^\d{22}$/.test(beneficiary.account)) fail('Completá nombre, CUIT y CBU/CVU reales de quien recibió el dinero.');
  const reason = text(input.reason, 1000), source = text(input.source, 500);
  if (reason.length < 10 || source.length < 10) fail('Indicá el motivo de la regularización y la fuente que confirma el pago.');
  if (!Array.isArray(input.parts) || !input.parts.length || input.parts.length > 4) fail('Detallá entre uno y cuatro pagos con sus originales.');
  const parts = input.parts.map(p => {
    if (!Number.isSafeInteger(p.amountCents) || p.amountCents <= 0 || p.amountCents > 1e12) fail('Revisá los importes en centavos, sin redondear.');
    if (!['general_cash', 'personal_advance'].includes(p.source)) fail('Elegí Caja General o un adelanto personal registrado.');
    if (!['deposit', 'transfer'].includes(p.method) || (p.source === 'general_cash' && p.method !== 'deposit') || (p.source === 'personal_advance' && p.method !== 'transfer')) fail('El origen debe coincidir con depósito de efectivo o transferencia personal.');
    const reference = text(p.reference, 160), ctReference = text(p.ctReference, 200), cashSourceEvidence = text(p.cashSourceEvidence, 500);
    if (!reference || !ctReference) fail('Indicá operación bancaria y referencia de conciliación en CT para cada pago ya realizado.');
    if (p.source === 'general_cash' && cashSourceEvidence.length < 10) fail('Dejá constancia de quién confirmó el origen del efectivo. No se deduce del ticket.');
    if (!/^[a-f0-9]{64}$/.test(p.proofSha256 || '')) fail('Falta verificar el original del pago.');
    return { amountCents: p.amountCents, source: p.source, method: p.method, reference, ctReference, cashSourceEvidence,
      payerProviderId: p.source === 'personal_advance' ? id(p.payerProviderId) : '', originalFileName: text(p.originalFileName, 255), proofSha256: p.proofSha256, file: { path: text(p.file?.path, 1000) } };
  });
  if (new Set(parts.map(p => p.reference.toUpperCase())).size !== parts.length || new Set(parts.map(p => p.ctReference)).size !== parts.length
    || new Set(parts.map(p => p.proofSha256)).size !== parts.length) fail('Cada componente debe tener su operación, referencia CT y comprobante propios.');
  return { id: recordId, projectId, collectionName: 'areaExpenses', itemId, date, beneficiary, reason, source, parts };
}
function createReportedPaymentService({ db, timestamp, verifyFile, clock = () => new Date() }) {
  async function context(actor, data, tx) {
    const read = ref => tx ? tx.get(ref) : ref.get();
    const access = await projectFinanceAccess({ db, transaction: tx, actor, projectId: data.projectId });
    if (!(actor.email === 'info@granbertafilms.com' || access.user?.role === 'admin')) fail('Sólo administración puede registrar pagos históricos.', 'permission-denied');
    if (data.parts.some(p => p.source === 'general_cash') && !canAccessGeneralCash(actor.email)) fail('Caja General sólo está habilitada para sus responsables.', 'permission-denied');
    const ref = db.doc(`projects/${data.projectId}/areaExpenses/${data.itemId}`), snap = await read(ref), row = snap.data();
    if (!row || isInternalBudgetEstimate(row) || !list(access.project.activeAreas).includes(row.area)) fail('El gasto cambió o no pertenece a un área activa.');
    const provider = (await read(db.doc(`providers/${id(row.providerId)}`))).data();
    if (!provider || provider.type !== 'persona') fail('Esta regularización requiere un prestador persona física existente.');
    const payers = await Promise.all(data.parts.map(async part => part.payerProviderId ? (await read(db.doc(`providers/${part.payerProviderId}`))).data() : null));
    payers.forEach((payer, index) => { if (data.parts[index].source === 'personal_advance' && (!payer || payer.type !== 'persona' || !providerName(payer))) fail('Elegí la ficha existente de quien adelantó el dinero.'); });
    return { access, ref, row, provider, payers, fingerprint: hash({ row,
      provider: { name: providerName(provider), cuit: text(provider.cuit), type: provider.type },
      payers: payers.map(p => p ? { name: providerName(p), cuit: text(p.cuit), type: p.type } : null) }) };
  }
  function validateUnpaid(c, data) {
    if (c.row.thirdPartyPayoutRequired !== true) fail('Esta opción regulariza exclusivamente un pago a un tercero pendiente de documentación.');
    if (c.row.paid === true || !Array.isArray(c.row.paymentHistory) || c.row.paymentHistory.length || list(c.row.sharedPaymentIds).length || list(c.row.sharedPaymentRecords).length) fail('El gasto ya registra pagos. Revisá el historial antes de continuar.');
    const total = data.parts.reduce((sum, p) => sum + p.amountCents, 0);
    if (!Number.isSafeInteger(total) || total > 1e12 || total !== Math.round(Number(c.row.total) * 100)) fail('Los comprobantes deben cubrir exactamente el saldo completo del gasto. No se crea otro costo.');
  }
  async function verified(data, providerId) {
    if (!verifyFile) fail('La verificación de originales no está disponible.');
    return Promise.all(data.parts.map(async p => {
      const file = await verifyFile(providerId, data.id, p.file, { hash: true });
      if (file.sha256 !== p.proofSha256) fail('El original cambió. Volvé a revisar el comprobante.');
      return file;
    }));
  }
  async function state(actor, input) {
    const scope = { projectId: id(input.projectId), collectionName: 'areaExpenses', itemId: id(input.itemId) };
    const access = await projectFinanceAccess({ db, actor, projectId: scope.projectId });
    const row = (await db.doc(`projects/${scope.projectId}/areaExpenses/${scope.itemId}`).get()).data();
    const record = (await db.doc(`providerFinancialRecords/${id(input.id)}`).get()).data();
    const c = access.collaborator || {}, key = `${row?.area}||${row?.subcategory || ''}`;
    if (!row || !record?.reportedPayment || !linkedAllocation(record, scope.projectId, scope.itemId, scope.collectionName, row)
      || !access.admin && (!list(c.allowedTabs).includes('areas') || list(c.excludedSubcategories).includes(key) || !list(c.allowedCategories).includes(row.area) && !list(c.allowedSubcategories).includes(key))) fail('No tenés acceso a este pago.', 'permission-denied');
    const declaration = record.acknowledgmentId ? (await db.doc(`providerPortalDeclarations/${id(record.acknowledgmentId)}`).get()).data() : null;
    return { record, declaration, canRequest: access.admin };
  }
  return {
    context, state,
    async handle(actor, input) {
      if (input.action === 'reportedPaymentState') {
        const s = await state(actor, input);
        return { id: s.record.id, documentaryStatus: s.record.documentaryStatus, canRequest: s.canRequest,
          acknowledgment: s.declaration ? { id: s.declaration.id, status: s.declaration.status, signed: s.declaration.proof?.complete === true } : null,
          proofCount: s.record.reportedPayment.parts.length,
          proofs: s.record.reportedPayment.parts.map((p, index) => ({ index, fileName: p.originalFileName || p.file.fileName,
            amountCents: p.amountCents, reference: p.reference, sourceLabel: p.source === 'general_cash' ? 'Caja General' : `Adelanto personal · ${p.payerName}` })) };
      }
      const data = normalizeReportedPayment(input, clock()), requestHash = hash({ data, actor });
      const recordRef = db.doc(`providerFinancialRecords/${data.id}`);
      const existing = (await recordRef.get()).data();
      if (existing) {
        // Revalidate access before returning an idempotent retry, even after the row is paid.
        const current = await context(actor, data);
        if (existing.reportedPayment?.requestHash !== requestHash) fail('Este intento ya corresponde a otro registro. No se duplicó el pago.');
        return { id: data.id, documentaryStatus: existing.documentaryStatus, paymentHistory: current.row.paymentHistory, repeated: true };
      }
      const before = await context(actor, data);
      if (before.row.paid === true || list(before.row.paymentHistory).length) {
        const raced = (await recordRef.get()).data();
        if (raced?.reportedPayment?.requestHash === requestHash) return { id: data.id, documentaryStatus: raced.documentaryStatus, paymentHistory: before.row.paymentHistory, repeated: true };
      }
      validateUnpaid(before, data);
      const files = await verified(data, before.row.providerId);
      const previewHash = hash({ requestHash, row: before.fingerprint, files });
      if (input.action === 'previewReportedPayment') return { id: data.id, previewHash, amountCents: data.parts.reduce((sum, p) => sum + p.amountCents, 0), projectName: text(before.access.project.name), providerName: providerName(before.provider), beneficiary: data.beneficiary,
        message: 'Se registrará un pago ya realizado. Su aceptación documental quedará pendiente. No se transfiere dinero ni se modifica CT.' };
      if (input.action !== 'recordReportedPayment' || input.previewHash !== previewHash) fail('La fila o los originales cambiaron. Volvé a revisar el registro antes de confirmar.');
      return db.runTransaction(async tx => {
        const currentRecord = await tx.get(recordRef), c = await context(actor, data, tx);
        if (currentRecord.exists) {
          if (currentRecord.data().reportedPayment?.requestHash !== requestHash) fail('Este intento ya corresponde a otro registro.');
          return { id: data.id, repeated: true, paymentHistory: c.row.paymentHistory, documentaryStatus: currentRecord.data().documentaryStatus };
        }
        validateUnpaid(c, data);
        if (hash({ requestHash, row: c.fingerprint, files }) !== previewHash) fail('El gasto cambió desde la revisión. No se registró ningún pago.');
        const workRef = db.doc(`providerReportedWorkKeys/${hash(c.ref.path)}`);
        const keys = data.parts.flatMap(p => [db.doc(`providerReportedProofKeys/${p.proofSha256}`),
          db.doc(`providerReportedCtKeys/${hash(p.ctReference)}`),
          db.doc(`providerPaymentKeys/${createHash('sha256').update([data.beneficiary.account.toUpperCase(), p.reference.toUpperCase()].join('|')).digest('hex')}`)]);
        const duplicates = await Promise.all([tx.get(workRef), ...keys.map(ref => tx.get(ref))]);
        if (duplicates.some(s => s.exists)) fail('Un gasto, comprobante u operación ya fue registrado. Revisá el historial para evitar duplicados.');
        const cashRefs = data.parts.map((p, index) => p.source === 'general_cash' ? db.doc(`projects/${data.projectId}/cashMovements/reported-${data.id}-${index}`) : null);
        const cashPrior = await Promise.all(cashRefs.filter(Boolean).map(ref => tx.get(ref)));
        if (cashPrior.some(s => s.exists)) fail('Ya existe el movimiento de caja de este intento. Pedí revisar el vínculo.');
        const now = timestamp(), amountCents = data.parts.reduce((sum, p) => sum + p.amountCents, 0);
        const history = data.parts.map((p, index) => ({
          id: `reported-${data.id}-${index}`, sharedRecordId: data.id, reportedPaymentId: data.id, reportedPartIndex: index, amount: p.amountCents / 100, date: data.date,
          type: 'partial', method: p.source === 'general_cash' ? 'caja_efectivo' : 'tercero',
          detail: `Pago ya realizado a ${data.beneficiary.name} · ${p.reference}`,
          createdBy: actor.uid, createdByEmail: actor.email, createdByName: text(c.access.user?.displayName || actor.email),
          ...(cashRefs[index] ? { cashAccount: 'general', cashMovementId: cashRefs[index].id, cashBoxLabel: 'Caja General', paidByEmail: actor.email } : {
            thirdPartyPayerId: p.payerProviderId, thirdPartyPayerName: providerName(c.payers[index]), reimbursements: [], reimbursedAmount: 0,
          }),
        }));
        const allocation = { projectId: data.projectId, collectionName: 'areaExpenses', itemId: data.itemId, amountCents, invoiceId: '', area: text(c.row.area), projectName: text(c.access.project.name), description: text(c.row.description) };
        const indexRef = db.doc(`providerFinanceProjectIndex/${data.projectId}`), index = (await tx.get(indexRef)).data();
        const indexRecords = { ...(index?.records || {}), [data.id]: [{ area: allocation.area, collectionName: 'areaExpenses' }] };
        const report = { requestHash, version: 'reported-payment-v1', scope: { projectId: data.projectId, collectionName: 'areaExpenses', itemId: data.itemId },
          amountCents, date: data.date, beneficiary: data.beneficiary, reason: data.reason, source: data.source,
          parts: data.parts.map((p, index) => ({ ...p, file: files[index], payerName: p.payerProviderId ? providerName(c.payers[index]) : 'Gran Berta S.R.L.' })),
          financialFingerprint: hash(history), providerName: providerName(c.provider), providerCuit: text(c.provider.cuit), projectName: allocation.projectName };
        tx.create(recordRef, { id: data.id, kind: 'payment', method: 'reported', currency: 'ARS', netArsCents: amountCents, totalCents: amountCents, date: data.date,
          providerId: c.row.providerId, payeeName: data.beneficiary.name, payeeCuit: data.beneficiary.cuit, account: data.beneficiary.account,
          allocations: [allocation], file: files[0], status: 'active', documentaryStatus: 'pending_acceptance', reportedPayment: report, createdBy: actor, createdAt: now, updatedAt: now,
          notes: 'Pago ya realizado. La aceptación del proveedor está pendiente y no autoriza pagos futuros.' });
        tx.update(c.ref, { paymentHistory: history, paymentLocked: true, paymentAuthorIds: [...new Set([...list(c.row.paymentAuthorIds), actor.uid])], sharedPaymentIds: [data.id], sharedPaymentRecords: history, paid: true, updatedAt: now });
        tx.create(workRef, { recordId: data.id, createdAt: now }); keys.forEach(ref => tx.create(ref, { recordId: data.id, createdAt: now }));
        cashRefs.forEach((ref, index) => { if (ref) tx.create(ref, { type: 'pago', cashAccount: 'general', amount: data.parts[index].amountCents / 100, date: data.date,
          collectionName: 'areaExpenses', itemId: data.itemId, paymentId: history[index].id, sharedRecordId: data.id, description: c.row.description || '',
          notes: `Registro histórico de depósito ya realizado · ${data.parts[index].reference}`, fromUserEmail: actor.email, createdBy: actor.uid, createdByEmail: actor.email, createdAt: now }); });
        tx.set(indexRef, { records: indexRecords, managedAreas: [...new Set(Object.values(indexRecords).flat().filter(a => a.collectionName === 'areaExpenses').map(a => a.area))], budgetAreas: [...new Set(Object.values(indexRecords).flat().filter(a => a.collectionName === 'budgetItems').map(a => a.area))], updatedAt: now });
        tx.set(db.doc(`providerFinanceProviderIndex/${c.row.providerId}`), { updatedAt: now });
        tx.create(db.doc(`projects/${data.projectId}/activityLog/reported-${data.id}`), { action: 'already_performed_payment_recorded', actor, recordId: data.id,
          scope: report.scope, previousPaymentHistory: c.row.paymentHistory, amountCents, date: data.date, beneficiary: data.beneficiary, parts: report.parts,
          reason: data.reason, source: data.source, documentaryStatus: 'pending_acceptance', createdAt: now });
        return { id: data.id, documentaryStatus: 'pending_acceptance', paymentHistory: history, repeated: false };
      });
    },
  };
}
module.exports = { createReportedPaymentService, normalizeReportedPayment };
