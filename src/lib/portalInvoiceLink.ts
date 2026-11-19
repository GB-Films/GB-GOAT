import { downloadPortalFile, portalRequest } from "./providerPortal";
import { providerFinanceRequest } from './providerFinance';

export function projectAttachmentHref(value: string | undefined) {
  return !value || value.startsWith('goat-file:') ? '#' : value;
}

export function handleProjectAttachmentLink(event: { preventDefault: () => void }, url: unknown) {
  if (typeof url !== 'string' || !url.startsWith('goat-file:')) return false;
  event.preventDefault();
  void Promise.resolve().then(async () => {
    const input = JSON.parse(decodeURIComponent(url.slice('goat-file:'.length)));
    const file = await providerFinanceRequest({ ...input, action: 'projectScopedAttachment' });
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
