const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const M = require('./providerPortalModel');
const { administrativeRecordRef, isAdministrativeRecord } = require('./providerAdministrativeRecords');

function invoiceFile(file) {
  if (!file || typeof file.base64 !== 'string' || file.base64.length > 3e6
    || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.contentType))
    M.fail('Usá una factura en PDF, JPG o PNG de hasta 2 MB.');
  const bytes = Buffer.from(file.base64, 'base64');
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) M.fail('Usá un archivo de hasta 2 MB.');
  const magic = file.contentType === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
    : file.contentType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : bytes[0] === 255 && bytes[1] === 216;
  if (!magic) M.fail('El contenido no coincide con el formato. Exportá la factura como PDF, JPG o PNG y volvé a elegirla.');
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function ownedPortalInvoice(file, upload, providerId, workKey, actor) {
  return Boolean(file?.portalUploadId && upload && upload.status !== 'removed'
    && upload.providerId === providerId && upload.workKey === workKey
    && upload.actor?.uid === actor.uid && upload.actor?.email === actor.email
    && file.path === upload.path && file.sha256 === upload.sha256
    && (!file.uploadedByUid || file.uploadedByUid === actor.uid));
}
async function portalInvoiceRows(db, expense, workKey, providerId, actor) {
  const files = M.expenseInvoices(expense);
  if (files.length > 100) M.fail('El historial de facturas requiere revisión administrativa.');
  return Promise.all(files.map(async (file, index) => {
    const upload = /^[\w-]{1,160}$/.test(file.portalUploadId || '')
      ? (await db.doc(`providerPortalInvoiceUploads/${file.portalUploadId}`).get()).data() : null;
    const copies = [expense.invoice, ...M.list(expense.invoices)].filter(f => f && (f.path === file.path || f.portalUploadId === file.portalUploadId && file.portalUploadId));
    const canRemove = ownedPortalInvoice(file, upload, providerId, workKey, actor)
      && copies.every(f => ownedPortalInvoice(f, upload, providerId, workKey, actor));
    return { index, fileName: M.text(file.fileName || file.originalFileName, 140), canRemove,
      ...(canRemove ? { uploadId: file.portalUploadId, revision: upload.revision || 1 } : {}) };
  }));
}

function createPortalInvoiceRemoval({ db, timestamp }) {
  return async ({ providerId, actor, input }) => {
    const parts = String(input.workKey || '').split('/');
    if (parts.length !== 3 || !['budgetItems', 'areaExpenses'].includes(parts[1])) M.fail('Trabajo inválido.');
    const workKey = `${M.id(parts[0])}/${parts[1]}/${M.id(parts[2])}`, uploadId = M.id(input.uploadId);
    const revision = Number(input.revision);
    if (!Number.isInteger(revision) || revision < 1) M.fail('Actualizá Facturas antes de eliminar.');
    const receiptRef = db.doc(`providerPortalInvoiceRemovals/${M.hash({ providerId, workKey, uid: actor.uid, attemptId: M.id(input.attemptId) })}`);
    const ref = db.doc(`projects/${workKey}`), uploadRef = db.doc(`providerPortalInvoiceUploads/${uploadId}`);
    const fingerprint = M.hash({ providerId, workKey, uploadId, revision, actor: { uid: actor.uid, email: actor.email } });
    return db.runTransaction(async tx => {
      const [snap, uploadSnap, receipt, member, project, config, administrative] = await Promise.all([
        tx.get(ref), tx.get(uploadRef), tx.get(receiptRef),
        tx.get(db.doc(`providerPortalUsers/${actor.uid}/memberships/${providerId}`)),
        tx.get(db.doc(`projects/${parts[0]}`)), tx.get(db.doc('providerPortalConfig/current')), tx.get(administrativeRecordRef(db, providerId)),
      ]);
      if (member.data()?.status !== 'active' || member.data()?.email !== actor.email || config.data()?.enabled !== true
        || isAdministrativeRecord(administrative.data(), providerId)) throw new HttpsError('permission-denied', 'Tu acceso a esta ficha ya no está activo.');
      if (receipt.exists) {
        if (receipt.data().fingerprint !== fingerprint) M.fail('El intento corresponde a otra factura. Actualizá la lista.');
        return { removed: true, resumed: true };
      }
      const expense = snap.data(), upload = uploadSnap.data();
      if (!expense || expense.providerId !== providerId) throw new HttpsError('permission-denied', 'Trabajo ajeno.');
      if (!project.exists || !M.ownExpense(expense, project.data(), ref.path)) M.fail('El trabajo cambió. Actualizá Facturas.');
      const files = M.expenseInvoices(expense), file = files.find(f => f.portalUploadId === uploadId);
      if (!ownedPortalInvoice(file, upload, providerId, workKey, actor)) throw new HttpsError('permission-denied', 'Sólo podés eliminar las facturas que cargaste vos desde Mi proveedor.');
      if ((upload.revision || 1) !== revision) M.fail('La factura cambió. Actualizá la lista antes de eliminarla.');
      const same = f => f && (f.path === file.path || f.portalUploadId === uploadId);
      if (M.list(expense.invoices).some(f => same(f) && !ownedPortalInvoice(f, upload, providerId, workKey, actor)))
        throw new HttpsError('permission-denied', 'La factura también está registrada por producción. Pedí que revisen la carga.');
      const changes = { invoices: M.list(expense.invoices).filter(f => !same(f)), portalInvoiceRevision: (expense.portalInvoiceRevision || 0) + 1, updatedAt: timestamp() };
      // Preserve a producer's legacy invoice, even if it references the same bytes.
      if (same(expense.invoice)) {
        if (!ownedPortalInvoice(expense.invoice, upload, providerId, workKey, actor)) throw new HttpsError('permission-denied', 'La factura también está registrada por producción. Pedí que revisen la carga.');
        changes.invoice = null;
      }
      tx.update(ref, changes);
      tx.update(uploadRef, { status: 'removed', removedBy: actor, removedAt: timestamp() });
      tx.create(receiptRef, { providerId, workKey, uploadId, revision, actor, fingerprint, original: file, createdAt: timestamp() });
      return { removed: true, resumed: false };
    });
  };
}

function createPortalInvoiceUpload({ db, sign, timestamp }) {
  return async ({ providerId, actor, input }) => {
    const parts = String(input.workKey || '').split('/');
    if (parts.length !== 3 || !['budgetItems', 'areaExpenses'].includes(parts[1])) M.fail('Elegí un trabajo válido.');
    const [projectId, collection, itemId] = [M.id(parts[0]), parts[1], M.id(parts[2])];
    const workKey = `${projectId}/${collection}/${itemId}`;
    const ref = db.doc(`projects/${workKey}`);
    const { sha256 } = invoiceFile(input.file);
    const portalUploadId = M.hash({ providerId, workKey, sha256 });
    const uploadRef = db.doc(`providerPortalInvoiceUploads/${portalUploadId}`);
    const path = `providerPortalUploads/${providerId}/${sha256}/invoice`;
    M.id(input.attemptId);
    const invoiceRevision = Number(input.invoiceRevision ?? 0);
    if (!Number.isInteger(invoiceRevision) || invoiceRevision < 0) M.fail('Actualizá Facturas antes de cargar.');

    async function checkAndCommit(result) {
      return db.runTransaction(async tx => {
        const [expenseSnap, projectSnap, membershipSnap, configSnap, administrativeSnap, uploadSnap] = await Promise.all([
          tx.get(ref), tx.get(db.doc(`projects/${projectId}`)),
          tx.get(db.doc(`providerPortalUsers/${actor.uid}/memberships/${providerId}`)),
          tx.get(db.doc('providerPortalConfig/current')), tx.get(administrativeRecordRef(db, providerId)), tx.get(uploadRef),
        ]);
        const e = expenseSnap.data(), project = projectSnap.data(), membership = membershipSnap.data();
        if (configSnap.data()?.enabled !== true) M.fail('El portal no está habilitado. Consultá con Gran Berta.');
        if (membership?.status !== 'active' || membership.email !== actor.email || isAdministrativeRecord(administrativeSnap.data(), providerId))
          throw new HttpsError('permission-denied', 'Tu cuenta ya no está habilitada para esta ficha. Ingresá con el correo registrado o consultá con Gran Berta.');
        if (!e || e.providerId !== providerId) throw new HttpsError('permission-denied', 'Este trabajo no pertenece a tu ficha. Actualizá tus trabajos.');
        if (!project || !M.ownExpense(e, project, ref.path)) M.fail('Este trabajo cambió de área. Actualizá tus trabajos antes de cargar la factura.');
        if ((e.portalInvoiceRevision || 0) !== invoiceRevision) M.fail('La factura cambió. Actualizá Facturas y elegí nuevamente el archivo.');
        if (e.thirdPartyPayoutRequired) M.fail('La factura del tercero se carga por administración con la declaración firmada. Contactá a producción.');
        const invoices = M.expenseInvoices(e);
        const upload = uploadSnap.data();
        const sameUpload = upload?.status !== 'removed' && invoices.length === 1 && invoices[0].portalUploadId === portalUploadId
          && invoices[0].path === path && upload?.workKey === workKey && upload.providerId === providerId
          && upload.actor?.uid === actor.uid && upload.actor?.email === actor.email && upload.sha256 === sha256 && upload.path === path;
        // Shared allocations count even though their original lives outside the expense.
        if (M.list(e.sharedInvoices).length || (invoices.length && !sameUpload))
          throw new HttpsError('already-exists', 'Este trabajo ya tiene una factura cargada. Podés verla en Facturas; si necesita una corrección, contactá a producción.');
        if (sameUpload) return { uploaded: true, resumed: true };
        const reload = upload?.status === 'removed' && upload.workKey === workKey && upload.providerId === providerId
          && upload.actor?.uid === actor.uid && upload.actor?.email === actor.email && upload.path === path && upload.sha256 === sha256;
        if (uploadSnap.exists && !reload) M.fail('Esta carga ya fue registrada y el trabajo cambió. Actualizá Facturas o contactá a producción.');
        if (!result) return null;
        if (result.portalUploadId !== portalUploadId || result.path !== path || result.sha256 !== sha256) M.fail('No pudimos comprobar el archivo. Volvé a elegir la factura.');
        tx.update(ref, { invoices: [...M.list(e.invoices), { ...result, uploadedAt: new Date().toISOString(), uploadedByUid: actor.uid }], updatedAt: timestamp() });
        if (reload) tx.update(uploadRef, { status: 'active', revision: (upload.revision || 1) + 1, restoredAt: timestamp() });
        else tx.create(uploadRef, { workKey, providerId, actor, path, sha256, status: 'active', revision: 1, createdAt: timestamp() });
        return { uploaded: true, resumed: false };
      });
    }
    // Reject occupied work before storing bytes; reread everything at commit to handle races.
    const previous = await checkAndCommit();
    if (previous) return previous;
    const result = await sign.storeInvoice({ providerId, actor, attemptId: input.attemptId, file: input.file, workKey });
    return checkAndCommit(result);
  };
}
module.exports = { invoiceFile, ownedPortalInvoice, portalInvoiceRows, createPortalInvoiceUpload, createPortalInvoiceRemoval };
