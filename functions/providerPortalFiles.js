const { fail, hash } = require("./providerPortalModel");

function portalFileGrantRef(db, providerId, file) {
  return db.doc(`providerPortalFileGrants/${hash({ providerId, fingerprint: hash(file) })}`);
}

const approved = (grant, sha256) => grant?.safeForProvider === true && grant.sha256 === sha256;

async function requestFileDownload(db, ref, file, original, { providerId, downloadRequest }) {
  const { actor, source, timestamp } = downloadRequest;
  return db.runTransaction(async tx => {
    const grant = (await tx.get(ref)).data();
    if (approved(grant, original.sha256)) return 'available';
    if (grant?.downloadRequest?.sha256 === original.sha256)
      return grant.downloadRequest.active ? 'pending_review' : 'closed';
    tx.set(ref, { providerId, fingerprint: hash(file), downloadRequest: {
      sha256: original.sha256, actor, source, fileName: original.fileName, requestedAt: timestamp(), active: true,
    } }, { merge: true });
    return 'pending_review';
  });
}

function createPortalFileReader({ db, readLocalFile }) {
  return async (file, context) => {
    if (!context?.providerId) fail("Falta el alcance del archivo.");
    const original = await readLocalFile(file);
    let trustedUpload = false;
    if (file.portalUploadId) {
      const upload = (
        await db
          .doc(`providerPortalInvoiceUploads/${file.portalUploadId}`)
          .get()
      ).data();
      trustedUpload =
        upload?.status !== 'removed' &&
        upload?.providerId === context.providerId &&
        upload.workKey === context.workKey &&
        upload.path === original.path &&
        upload.sha256 === original.sha256;
    }
    const metadata = original.metadata?.metadata || {};
    const parts = String(context.workKey || "").split("/");
    const sameExpense =
      parts.length === 3 &&
      metadata.projectId === parts[0] &&
      metadata.collectionName === parts[1] &&
      (metadata.expenseId === parts[2] || metadata.itemId === parts[2]);
    const ownedInvoice =
      context.kind === "invoice" &&
      sameExpense &&
      original.path.startsWith(`projects/${parts[0]}/`);
    const ownedAdvance = ['advance', 'reimbursement'].includes(context.kind) && sameExpense
      && original.path.startsWith(`projects/${parts[0]}/`) && context.paymentId
      && metadata.paymentId === context.paymentId
      && (context.kind === 'advance' || context.reimbursementId && metadata.reimbursementId === context.reimbursementId);
    if (!trustedUpload && !ownedInvoice && !ownedAdvance) {
      const ref = portalFileGrantRef(db, context.providerId, file);
      const grant = (await ref.get()).data();
      if (!approved(grant, original.sha256)) {
        if (!context.downloadRequest)
          fail('Administración debe habilitar la descarga de este archivo.');
        const status = await requestFileDownload(db, ref, file, original, context);
        if (status !== 'available') return { status };
      }
    }
    const { metadata: _metadata, path: _path, ...result } = original;
    return result;
  };
}
module.exports = { createPortalFileReader, portalFileGrantRef };
