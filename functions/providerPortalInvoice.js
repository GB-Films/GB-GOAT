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
        if (e.thirdPartyPayoutRequired) M.fail('La factura del tercero se carga por administración con la declaración firmada. Contactá a producción.');
        const invoices = M.expenseInvoices(e);
        const upload = uploadSnap.data();
        const sameUpload = invoices.length === 1 && invoices[0].portalUploadId === portalUploadId
          && invoices[0].path === path && upload?.workKey === workKey && upload.providerId === providerId
          && upload.actor?.uid === actor.uid && upload.actor?.email === actor.email && upload.sha256 === sha256 && upload.path === path;
        // Shared allocations count even though their original lives outside the expense.
        if (M.list(e.sharedInvoices).length || (invoices.length && !sameUpload))
          throw new HttpsError('already-exists', 'Este trabajo ya tiene una factura cargada. Podés verla en Facturas; si necesita una corrección, contactá a producción.');
        if (sameUpload) return { uploaded: true, resumed: true };
        if (uploadSnap.exists) M.fail('Esta carga ya fue registrada y el trabajo cambió. Actualizá Facturas o contactá a producción.');
        if (!result) return null;
        if (result.portalUploadId !== portalUploadId || result.path !== path || result.sha256 !== sha256) M.fail('No pudimos comprobar el archivo. Volvé a elegir la factura.');
        tx.update(ref, { invoices: [...M.list(e.invoices), { ...result, uploadedAt: new Date().toISOString(), uploadedByUid: actor.uid }], updatedAt: timestamp() });
        tx.create(uploadRef, { workKey, providerId, actor, path, sha256, createdAt: timestamp() });
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
module.exports = { invoiceFile, createPortalInvoiceUpload };
