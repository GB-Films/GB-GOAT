import { downloadPortalFile, portalRequest } from "./providerPortal";
export function handlePortalInvoiceLink(
  event: { preventDefault: () => void },
  file: any,
) {
  if (file.url || !file.portalUploadId) return;
  event.preventDefault();
  void portalRequest({
    action: "internalInvoice",
    uploadId: file.portalUploadId,
  })
    .then(downloadPortalFile)
    .catch((e) => window.alert(e.message));
}
