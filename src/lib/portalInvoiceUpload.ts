export type InvoiceWork = { key: string; projectName: string; description: string; invoiceCount: number; hasInvoice?: boolean; invoiceRevision?: number; thirdPartyPayoutRequired?: boolean };
export function invoiceWorkUnavailable(work?: InvoiceWork) {
  if (!work) return 'Elegí el trabajo al que corresponde la factura.';
  if (work.hasInvoice || work.invoiceCount > 0) return 'Este trabajo ya tiene una factura. Podés verla abajo. Si la cargaste vos, eliminala para reemplazarla; las demás las corrige producción.';
  if (work.thirdPartyPayoutRequired) return 'La factura del tercero se carga por administración. Contactá a producción.';
  return '';
}
export function invoiceFileType(file: Pick<File, 'name' | 'type' | 'size'>) {
  if (!file.size || file.size > 2 * 1024 * 1024) throw Error('Elegí un archivo de hasta 2 MB.');
  const type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : /\.png$/i.test(file.name) ? 'image/png' : '');
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(type)) throw Error('Usá una factura en PDF, JPG o PNG.');
  return type;
}
export async function submitPortalInvoice(input: { providerId: string; work: InvoiceWork; file: File; attemptId: string }, deps: {
  verifySession: () => Promise<void>; read: (file: File) => Promise<string>; request: (input: Record<string, unknown>) => Promise<any>;
}) {
  const unavailable = invoiceWorkUnavailable(input.work);
  if (unavailable) throw Error(unavailable);
  const contentType = invoiceFileType(input.file);
  await deps.verifySession();
  const base64 = await deps.read(input.file);
  await deps.verifySession();
  const result = await deps.request({ action: 'uploadInvoice', providerId: input.providerId, workKey: input.work.key, invoiceRevision: input.work.invoiceRevision || 0,
    attemptId: input.attemptId, file: { base64, contentType, fileName: input.file.name } });
  if (result?.uploaded !== true) throw Error('No recibimos la confirmación de carga. Actualizá Facturas antes de reintentar.');
  return result;
}
export function portalInvoiceFailure(error: any): { message: string; verify?: boolean; refresh?: boolean } {
  const code = error?.code || '';
  if (/requires-recent-login|user-token-expired|invalid-user-token|unauthenticated/.test(code))
    return { message: 'Para cargar la factura, verificá tu cuenta con Google y después tocá «Cargar factura». El archivo sigue seleccionado.', verify: true };
  if (code === 'auth/popup-blocked') return { message: 'El navegador bloqueó Google. Permití las ventanas emergentes y tocá «Verificar con Google».', verify: true };
  if (/popup-closed-by-user|cancelled-popup-request/.test(code)) return { message: 'La verificación no terminó. Completá la ventana de Google o volvé a verificar.', verify: true };
  if (/account-changed|unverified-account|user-mismatch/.test(code)) return { message: 'La cuenta no coincide con la registrada. Volvé a ingresar con tu correo de proveedor.' };
  if (/already-exists/.test(code)) return { message: 'Este trabajo ya tiene una factura. Actualizá la lista para verla; si necesita una corrección, contactá a producción.', refresh: true };
  if (/network|unavailable|deadline-exceeded|aborted/.test(code)) return { message: 'Se interrumpió la conexión. Podés reintentar con este mismo archivo: si ya se guardó, no se duplicará.' };
  if (/internal|data-loss/.test(code)) return { message: 'El servidor no pudo confirmar la carga. Actualizá Facturas antes de reintentar; si continúa, avisá a producción.', refresh: true };
  if (code && !/^functions\/(failed-precondition|permission-denied|invalid-argument)$/.test(code)) return { message: 'No pudimos completar la carga. Volvé a ingresar con tu cuenta de proveedor; si continúa, avisá a producción.' };
  return { message: error?.message || 'No pudimos leer el archivo. Volvé a elegirlo e intentá otra vez.' };
}
