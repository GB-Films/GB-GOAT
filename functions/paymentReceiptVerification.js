const { HttpsError } = require('firebase-functions/v2/https');
function createPaymentReceiptVerifier(bucket) {
  return async (scope, input) => {
    const prefix = `projects/${scope.projectId}/${scope.collectionName}/${scope.itemId}/comprobantes/`;
    if (typeof input.path !== 'string' || !input.path.startsWith(prefix) || input.path.slice(prefix.length).includes('/')
      || input.path.slice(prefix.length).includes('..')) throw new HttpsError('invalid-argument', 'Comprobante fuera del gasto.');
    const [metadata] = await bucket.file(input.path).getMetadata();
    const fields = metadata.metadata || {};
    if (fields.projectId !== scope.projectId || fields.collectionName !== scope.collectionName || fields.itemId !== scope.itemId || fields.paymentId !== scope.paymentId
      || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(metadata.contentType) || Number(metadata.size) <= 0 || Number(metadata.size) > 2 * 1024 * 1024)
      throw new HttpsError('invalid-argument', 'El comprobante no corresponde al pago o excede el tamaño permitido.');
    let url;
    try { url = new URL(input.url); } catch { throw new HttpsError('invalid-argument', 'Enlace de comprobante inválido.'); }
    if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || url.pathname !== `/v0/b/${bucket.name}/o/${encodeURIComponent(input.path)}`)
      throw new HttpsError('invalid-argument', 'Enlace de comprobante ajeno.');
    return { path: input.path, url: url.toString(), fileName: input.path.slice(prefix.length), originalFileName: String(fields.originalFileName || 'Comprobante').slice(0, 200),
      contentType: metadata.contentType, size: Number(metadata.size) };
  };
}
module.exports = { createPaymentReceiptVerifier };
