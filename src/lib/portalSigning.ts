export type PortalSignatureField = {
  id: string;
  signerEmail: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PortalSignatureInput = {
  fieldId: string;
  dni: string;
  typedName: string;
  signatureType: "typed" | "drawn";
  signatureImage: string;
};

// Do not move or resize a stored field: its coordinates are also used by GB Sign.
export function personalSignatureFields(fields: unknown, email: string): PortalSignatureField[] {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !Array.isArray(fields)) return [];
  return fields.filter((field): field is PortalSignatureField =>
    field && typeof field.id === "string" && field.id.length > 0 &&
    typeof field.signerEmail === "string" && field.signerEmail.trim().toLowerCase() === normalized &&
    Number.isInteger(field.page) && field.page > 0 &&
    [field.x, field.y, field.w, field.h].every(Number.isFinite) &&
    field.x >= 0 && field.y >= 0 && field.w > 0 && field.h > 0 &&
    field.x + field.w <= 1.000001 && field.y + field.h <= 1.000001,
  );
}

export function normalizeSigningDni(value: string): string {
  return value.replace(/[.\s-]/g, "");
}

export type SigningStep = 'preparing' | 'loading' | 'load_error' | 'unassigned' | 'field' | 'dni' | 'dni_confirmation' | 'signature' | 'consent' | 'ready';
export function signingNextStep(input: {
  preparing: boolean; hasUrl: boolean; loadError: string; ready: boolean;
  fieldCount: number; selectedPage?: number; targetPage?: number;
  validDni: boolean; dniConfirmed: boolean; hasSignature: boolean; accepted: boolean;
}): { step: SigningStep; message: string } {
  if (input.preparing) return { step: 'preparing', message: 'Estamos preparando tu documento.' };
  if (input.loadError) return { step: 'load_error', message: 'No pudimos cargar el documento. Volvé a cargarlo para continuar.' };
  if (!input.hasUrl || !input.ready) return { step: 'loading', message: 'Estamos cargando el documento. Esperá un momento.' };
  if (!input.fieldCount) return { step: 'unassigned', message: 'No hay un recuadro válido para tu cuenta. Pedí que revisen la solicitud.' };
  if (!input.selectedPage) return { step: 'field', message: `Falta elegir dónde firmar. Tocá el recuadro resaltado en la página ${input.targetPage}.` };
  if (!input.validDni) return { step: 'dni', message: 'Ingresá un DNI válido para continuar.' };
  if (!input.dniConfirmed) return { step: 'dni_confirmation', message: 'Marcá la confirmación de que el DNI te corresponde.' };
  if (!input.hasSignature) return { step: 'signature', message: 'Falta tu firma. Dibujala o elegí «Usar mi nombre» y completalo.' };
  if (!input.accepted) return { step: 'consent', message: 'Marcá que leíste el documento y aceptás firmarlo.' };
  return { step: 'ready', message: 'Todo listo. Ya podés firmar y confirmar.' };
}

export function signingFailure(error: { code?: string; message?: string }) {
  if (error.code === 'portal/signature-saved') return { checkDocuments: true, message: 'Tu firma quedó guardada. Volvé a Documentos para consultar el estado.' };
  if (/deadline-exceeded|unavailable|network-request-failed|functions\/internal/.test(error.code || '') || /failed to fetch|network request failed/i.test(error.message || ''))
    return { checkDocuments: true, message: 'No pudimos confirmar el resultado. Volvé a Documentos y actualizá el estado antes de intentar otra vez.' };
  if (/unauthenticated|auth\//.test(error.code || ''))
    return { checkDocuments: true, message: 'No pudimos verificar tu sesión. Volvé a ingresar con tu cuenta registrada.' };
  if (/permission-denied/.test(error.code || ''))
    return { checkDocuments: true, message: 'No pudimos autorizar esta firma. Volvé a Documentos; si sigue igual, pedí que revisen la solicitud.' };
  return { checkDocuments: false, message: (error.message || 'No pudimos completar la firma. Intentá nuevamente.').replace(/^Firebase:\s*/i, '').replace(/\s*\(functions\/[^)]+\)\.?$/, '') };
}
