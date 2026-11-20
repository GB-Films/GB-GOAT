export const EVIDENCE_MAX_MB = 6;
const megabyte = 1024 * 1024;
const maxAttachmentBytes = EVIDENCE_MAX_MB * megabyte;
const maxPhotoMB = 25;
const maxPhotoSide = 2400;
const photoTypes = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'];
const fileTypesByExtension: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', heic: 'image/heic', heif: 'image/heif',
};

type PreparedEvidence = { file: File; contentType: string };
export type PendingEvidence = { file: File; attemptId: string; prepared?: PreparedEvidence };
export type EvidenceFile = { id: string; kind: string; fileName: string; sha256: string; createdAt?: number };
export type EvidenceUploadProblem = { message: string; verify?: boolean; retry?: boolean; reference?: string };

export function evidenceFileType(file: Pick<File, 'name' | 'type' | 'size'>) {
  if (!file.size) throw Error('«' + file.name + '» está vacío. Volvé a guardar el documento o elegí otra foto.');
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const inferred = fileTypesByExtension[extension];
  const type = file.type === 'application/octet-stream' ? inferred : file.type || inferred;
  if (type !== 'application/pdf' && !photoTypes.includes(type)) {
    throw Error('«' + file.name + '» tiene un formato que GOAT no admite. Elegí un PDF o una foto JPG, PNG o HEIC.');
  }
  const maxMB = type === 'application/pdf' ? EVIDENCE_MAX_MB : maxPhotoMB;
  if (file.size > maxMB * megabyte) {
    const size = (Math.ceil(file.size / megabyte * 100) / 100).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
    const solution = type === 'application/pdf' ? 'Guardá el PDF con menor tamaño o elegí las fotos.' : 'Elegí una foto de menor tamaño.';
    throw Error('«' + file.name + '» pesa ' + size + ' MB y el límite es ' + maxMB + ' MB. ' + solution);
  }
  return type;
}

async function resizeEvidencePhoto(file: File) {
  const image = new Image();
  const canvas = document.createElement('canvas');
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = reject;
      image.src = url;
    });
    const scale = Math.min(1, maxPhotoSide / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw Error('Canvas unavailable');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  } finally {
    image.onload = image.onerror = null;
    image.removeAttribute('src');
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}

export async function prepareEvidenceFile(file: File, resize = resizeEvidencePhoto): Promise<PreparedEvidence> {
  const contentType = evidenceFileType(file);
  const isHeic = contentType === 'image/heic' || contentType === 'image/heif';
  if (!isHeic && file.size <= maxAttachmentBytes) return { file, contentType };
  let jpeg: Blob | null;
  try {
    jpeg = await resize(file);
  } catch {
    jpeg = null;
  }
  if (!jpeg?.size || jpeg.type !== 'image/jpeg' || jpeg.size > maxAttachmentBytes) {
    const reason = isHeic ? 'El navegador no pudo convertir la foto HEIC' : 'El navegador no pudo reducir la foto a ' + EVIDENCE_MAX_MB + ' MB';
    throw Error(reason + ' «' + file.name + '». Guardala como JPG o elegí una foto más liviana.');
  }
  return { file: new File([jpeg], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: jpeg.type }), contentType: jpeg.type };
}

type UploadDependencies = {
  verifySession: () => Promise<void>;
  read: (file: File) => Promise<string>;
  request: (input: Record<string, unknown>) => Promise<any>;
  onUploaded: (item: PendingEvidence, result: EvidenceFile) => void;
  prepare?: typeof prepareEvidenceFile;
};
export async function uploadEvidenceBatch(providerId: string, kind: string, pending: PendingEvidence[], deps: UploadDependencies) {
  for (const item of pending) {
    await deps.verifySession();
    item.prepared ??= await (deps.prepare || prepareEvidenceFile)(item.file);
    const { file, contentType } = item.prepared;
    const base64 = await deps.read(file);
    await deps.verifySession();
    const result = await deps.request({ action: 'uploadEvidence', providerId, kind, attemptId: item.attemptId,
      file: { base64, contentType, fileName: file.name } });
    if (!result || typeof result.id !== 'string' || result.kind !== kind || typeof result.sha256 !== 'string')
      throw Object.assign(Error('No recibimos la confirmación de carga. Reintentá con el archivo seleccionado.'), { code: 'evidence/invalid-response' });
    deps.onUploaded(item, result);
  }
}

// Open Google directly from the click before reading files or awaiting tokens.
export function verifyAndUploadEvidence(openGoogle: () => Promise<unknown>, upload: () => Promise<void>) {
  return openGoogle().then(upload);
}

export function evidenceUploadFailure(error: any): EvidenceUploadProblem {
  const code = String(error?.code || '');
  const reference = /^[\da-f-]{36}$/i.test(error?.details?.reference || '') ? error.details.reference as string : undefined;
  if (error?.details?.reason === 'evidence_storage_unavailable')
    return { message: 'GOAT no pudo guardar el archivo en el servicio de adjuntos. Reintentá con el archivo seleccionado.', retry: true, reference };
  if (error?.details?.reason === 'evidence_lookup_unavailable')
    return { message: 'GOAT no pudo consultar si este archivo ya se había adjuntado. Reintentá con el archivo seleccionado.', retry: true, reference };
  if (error?.details?.reason === 'evidence_confirmation_unavailable')
    return { message: 'El archivo llegó a GOAT, pero faltó confirmar que quedó adjunto a tu ficha. Reintentá la carga. El archivo no se duplicará.', retry: true, reference };
  if (/requires-recent-login|user-token-expired|invalid-user-token|unauthenticated/.test(code))
    return { message: 'Para adjuntar el archivo, verificá tu cuenta con Google. El archivo sigue seleccionado.', verify: true };
  if (code === 'auth/popup-blocked')
    return { message: 'El navegador bloqueó Google. Permití las ventanas emergentes para GOAT y tocá «Verificar con Google y cargar». El archivo sigue seleccionado.', verify: true };
  if (/popup-closed-by-user|cancelled-popup-request/.test(code))
    return { message: 'La verificación no terminó. Tocá «Verificar con Google y cargar» para continuar con el mismo archivo.', verify: true };
  if (/account-changed|unverified-account|user-mismatch/.test(code))
    return { message: 'La cuenta no coincide con la registrada. Elegí el mismo correo que usás en esta ficha.', verify: true };
  if (/operation-not-supported-in-this-environment|web-storage-unsupported/.test(code))
    return { message: 'Este navegador no pudo abrir la verificación de Google. Abrí GOAT directamente en Safari o Chrome e ingresá con el correo de la ficha.' };
  if (code === 'functions/permission-denied')
    return { message: 'La sesión actual no tiene permiso para adjuntar a esta ficha. Ingresá con el correo registrado para esta empresa. Si ya es el mismo, avisá a Gran Berta.' };
  if (/deadline-exceeded/.test(code))
    return { message: 'La carga tardó demasiado y GOAT no recibió la confirmación. Reintentá con el mismo archivo.', retry: true };
  if (/resource-exhausted/.test(code))
    return { message: 'El servicio de carga está ocupado. Esperá unos segundos y reintentá.', retry: true };
  if (/network|unavailable|aborted/.test(code))
    return { message: 'Se interrumpió la comunicación con GOAT. Revisá tu conexión y reintentá con el mismo archivo.', retry: true };
  if (/internal|data-loss|evidence\/invalid-response/.test(code))
    return { message: 'GOAT no confirmó si el archivo quedó adjunto. Reintentá la carga. Si vuelve a fallar, avisá a Gran Berta.', retry: true, reference };
  if (/^functions\/(failed-precondition|invalid-argument)$/.test(code))
    return { message: String(error.message || 'Revisá el formato y el tamaño del archivo o elegí otro.').replace(/^Firebase:\s*/i, '') };
  if (code) return { message: 'No pudimos verificar la cuenta. Volvé a ingresar con el correo de esta ficha. El archivo sigue seleccionado.' };
  return { message: error?.message || 'No pudimos leer el archivo. Volvé a elegirlo.', retry: true };
}
