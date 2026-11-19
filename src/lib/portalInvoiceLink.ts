import { downloadPortalFile, portalRequest } from "./providerPortal";
import { providerFinanceRequest } from './providerFinance';
import firebaseConfig from '../../firebase-applet-config.json';
import { legacyProjectAttachment } from './legacyProjectAttachment';

export function projectAttachmentHref(value: string | undefined) {
  return !value || value.startsWith('goat-file:') || legacyProjectAttachment(value, firebaseConfig.storageBucket) ? '#' : value;
}

export function handleProjectAttachmentLink(event: { preventDefault: () => void }, url: unknown) {
  if (typeof url !== 'string') return false;
  const scoped = url.startsWith('goat-file:');
  const legacy = legacyProjectAttachment(url, firebaseConfig.storageBucket);
  if (!scoped && !legacy) return false;
  event.preventDefault();
  void Promise.resolve().then(async () => {
    const input = legacy ? { ...legacy, action: 'projectAdminAttachment' }
      : { ...JSON.parse(decodeURIComponent(url.slice('goat-file:'.length))), action: 'projectScopedAttachment' };
    const file = await providerFinanceRequest(input);
    downloadPortalFile(file as Parameters<typeof downloadPortalFile>[0]);
  }).catch(error => window.alert(error.message || 'No se pudo abrir este comprobante.'));
  return true;
}
export function handlePortalInvoiceLink(
  event: { preventDefault: () => void },
  file: any,
) {
  if (handleProjectAttachmentLink(event, file.url) || file.url || !file.portalUploadId) return;
  event.preventDefault();
  void portalRequest({
    action: "internalInvoice",
    uploadId: file.portalUploadId,
  })
    .then(downloadPortalFile)
    .catch((e) => window.alert(e.message));
}
