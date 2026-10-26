const { fail, hash } = require("./providerPortalModel");
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
    if (!trustedUpload && !ownedInvoice) {
      const grant = (
        await db
          .doc(
            `providerPortalFileGrants/${hash({ providerId: context.providerId, fingerprint: hash(file) })}`,
          )
          .get()
      ).data();
      if (!grant?.safeForProvider || grant.sha256 !== original.sha256)
        fail(
          "Administración debe revisar el original y publicar una copia sin datos de terceros.",
        );
    }
    const { metadata: _metadata, path: _path, ...result } = original;
    return result;
  };
}
module.exports = { createPortalFileReader };
