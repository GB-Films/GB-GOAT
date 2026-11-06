export type PendingEvidence = { file: File; attemptId: string };
export type EvidenceFile = { id: string; kind: string; fileName: string; sha256: string; createdAt?: number };
export type EvidenceUploadProblem = { message: string; verify?: boolean; retry?: boolean };

export function evidenceFileType(file: Pick<File, 'name' | 'type' | 'size'>) {
  if (!file.size || file.size > 2 * 1024 * 1024) throw Error('Elegí un archivo de hasta 2 MB.');
  const type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : /\.png$/i.test(file.name) ? 'image/png' : '');
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(type)) throw Error('Usá un PDF, JPG o PNG para el respaldo.');
  return type;
}

type UploadDependencies = {
  verifySession: () => Promise<void>;
  read: (file: File) => Promise<string>;
  request: (input: Record<string, unknown>) => Promise<any>;
  onUploaded: (item: PendingEvidence, result: EvidenceFile) => void;
};
export async function uploadEvidenceBatch(providerId: string, kind: string, pending: PendingEvidence[], deps: UploadDependencies) {
  for (const item of pending) {
    const contentType = evidenceFileType(item.file);
    await deps.verifySession();
    const base64 = await deps.read(item.file);
    await deps.verifySession();
    const result = await deps.request({ action: 'uploadEvidence', providerId, kind, attemptId: item.attemptId,
      file: { base64, contentType, fileName: item.file.name } });
    if (!result || typeof result.id !== 'string' || result.kind !== kind || typeof result.sha256 !== 'string')
      throw Object.assign(Error('No recibimos la confirmación de carga. Reintentá con el archivo seleccionado.'), { code: 'evidence/invalid-response' });
    deps.onUploaded(item, result);
  }
}

// Called directly by the verification button. Open Google synchronously, before
// reading files or awaiting tokens; otherwise browsers can block the popup.
export function verifyAndUploadEvidence(openGoogle: () => Promise<unknown>, upload: () => Promise<void>) {
  return openGoogle().then(upload);
}

export function evidenceUploadFailure(error: any): EvidenceUploadProblem {
  const code = String(error?.code || '');
  if (/requires-recent-login|user-token-expired|invalid-user-token|unauthenticated/.test(code))
    return { message: 'Para adjuntar el archivo, verificá tu cuenta con Google. El archivo sigue seleccionado.', verify: true };
  if (code === 'auth/popup-blocked')
    return { message: 'El navegador bloqueó Google. Permití las ventanas emergentes para GOAT y tocá «Verificar con Google y cargar». El archivo sigue seleccionado.', verify: true };
  if (/popup-closed-by-user|cancelled-popup-request/.test(code))
    return { message: 'La verificación no terminó. Tocá «Verificar con Google y cargar» para continuar con el mismo archivo.', verify: true };
  if (/account-changed|unverified-account|user-mismatch/.test(code))
    return { message: 'La cuenta no coincide con la registrada. Elegí el mismo correo que usás en esta ficha.', verify: true };
  if (/network|unavailable|deadline-exceeded|aborted|evidence\/invalid-response/.test(code))
    return { message: 'Se interrumpió la carga. Reintentá con el archivo seleccionado; si ya se guardó, no se duplicará.', retry: true };
  if (/internal|data-loss|permission-denied/.test(code))
    return { message: 'No pudimos confirmar la carga. Reintentá; si continúa, avisá a Gran Berta.', retry: true };
  if (/^functions\/(failed-precondition|invalid-argument)$/.test(code))
    return { message: String(error.message || 'Revisá que el archivo sea PDF, JPG o PNG y no supere 2 MB.').replace(/^Firebase:\s*/i, ''), retry: true };
  if (code) return { message: 'No pudimos verificar la cuenta. Volvé a ingresar con el correo de esta ficha. El archivo sigue seleccionado.' };
  return { message: error?.message || 'No pudimos leer el archivo. Volvé a elegirlo.', retry: true };
}
