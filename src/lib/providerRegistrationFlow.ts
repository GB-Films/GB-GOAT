export type RegistrationRecovery = 'verify' | 'choose' | 'retry' | 'contact' | 'portal' | 'reload' | 'fields';
export type RegistrationFailure = { message: string; action: RegistrationRecovery; code: string; reference: string; field?: string };
export const REGISTRATION_FIELD_LIMITS = { name:160, lastName:160, businessName:160, dni:20, cuit:30, email:300, phone:60, address:300, birthDate:10, category:100, categoryOther:300, bankAccount_cbu:22, bankAccount_alias:100, dietaryRestriction:300 };
export const REGISTRATION_FIELD_LABELS: Record<string, string> = { name:'Nombre', lastName:'Apellido', businessName:'Razón social', dni:'DNI', cuit:'CUIT / CUIL', email:'Correo', phone:'Teléfono', address:'Domicilio', birthDate:'Fecha de nacimiento', category:'Categoría', categoryOther:'Comentario de categoría', bankAccount_cbu:'CBU / CVU', bankAccount_alias:'Alias', dietaryRestriction:'Restricción alimentaria' };
export function registrationProblem(code: string) { return Object.assign(new Error(code), { code }); }
export function registrationNeedsVerification(claims: Record<string, unknown>, now = Date.now()) {
  const signedAt = Number(claims.auth_time);
  return !Number.isFinite(signedAt) || signedAt <= 0 || signedAt > now / 1000 + 30 || now / 1000 - signedAt > 540;
}
type RegistrationUser = { uid: string; email: string | null; getIdTokenResult: (refresh?: boolean) => Promise<{ signInProvider: string | null; claims: Record<string, unknown> }> };
export async function verifyRegistrationSession(getUser: () => RegistrationUser | null, expected: { uid: string; email: string }, now = Date.now()) {
  const user = getUser();
  if (!user || user.uid !== expected.uid || user.email?.trim().toLowerCase() !== expected.email.trim().toLowerCase()) throw registrationProblem('registration/account-changed');
  const token = await user.getIdTokenResult(true);
  if (getUser()?.uid !== user.uid || getUser()?.email?.trim().toLowerCase() !== expected.email.trim().toLowerCase()) throw registrationProblem('registration/account-changed');
  if (token.signInProvider !== 'google.com' || token.claims.email_verified !== true || String(token.claims.email || '').toLowerCase() !== expected.email.trim().toLowerCase()) throw registrationProblem('registration/unverified-account');
  if (registrationNeedsVerification(token.claims, now)) throw registrationProblem('auth/requires-recent-login');
}
export function registrationFieldErrors(form: Record<string, string>) {
  const errors: Record<string, string> = {};
  for (const [field, max] of Object.entries(REGISTRATION_FIELD_LIMITS)) {
    const value = field === 'bankAccount_cbu' ? (form[field] || '').replace(/\D/g, '') : form[field] || '';
    if (value.length > max) errors[field] = `${REGISTRATION_FIELD_LABELS[field]} admite hasta ${max} caracteres. Acortá este dato.`;
  }
  return errors;
}
export function providerRegistrationFailure(error: unknown, reference: string, phase: 'load' | 'signin' | 'verify' | 'submit' = 'submit'): RegistrationFailure {
  const err = error as { code?: string; message?: string; details?: { field?: string; supportReference?: string } } | null;
  const code = typeof err?.code === 'string' && /^[\w/-]{1,80}$/.test(err.code) ? err.code : 'registration/unexpected';
  const result = (message: string, action: RegistrationRecovery, field?: string): RegistrationFailure => {
    if (action === 'retry' && phase === 'load') { message = 'No pudimos conectar para comprobar el enlace. Revisá internet y tocá «Volver a comprobar el enlace».'; action = 'reload'; }
    if (action === 'retry' && (phase === 'signin' || phase === 'verify')) { message = 'Se interrumpió la conexión con Google. Revisá internet y volvé a verificar tu cuenta; tus datos siguen en esta ventana.'; action = phase === 'signin' ? 'choose' : 'verify'; }
    return { message, action, code, reference: /^[\w-]{1,160}$/.test(err?.details?.supportReference || '') ? err!.details!.supportReference! : reference, ...(field ? { field } : {}) };
  };
  if (code === 'auth/popup-blocked') return result('El navegador bloqueó la ventana de Google. Permití las ventanas emergentes para GOAT y tocá «Verificar con Google». Tus datos siguen en este formulario.', 'verify');
  if (code === 'auth/popup-closed-by-user') return result('La verificación de Google se cerró antes de terminar. Tocá «Verificar con Google» y completala; tus datos siguen cargados.', 'verify');
  if (code === 'auth/cancelled-popup-request') return result('Ya hay una ventana de Google abierta. Completala o cerrala antes de volver a verificar.', 'verify');
  if (['auth/requires-recent-login', 'auth/user-token-expired', 'auth/invalid-user-token', 'functions/unauthenticated'].includes(code)) return result('Tu sesión necesita una nueva verificación. Tocá «Verificar con Google» y elegí la misma cuenta; después volvé a enviar el alta. Tus datos siguen cargados.', 'verify');
  if (['registration/account-changed', 'registration/unverified-account', 'auth/user-mismatch', 'auth/credential-already-in-use'].includes(code)) return result('La cuenta Google no coincide con la confirmada en el formulario. Elegí la cuenta que vas a usar, confirmá que te pertenece y revisá los datos antes de enviar.', 'choose');
  if (['auth/unauthorized-domain', 'auth/operation-not-allowed', 'auth/invalid-api-key', 'auth/app-not-authorized', 'functions/not-found'].includes(code)) return result('El acceso de Google o el servicio de alta no está configurado correctamente. Compartí la referencia del error con Gran Berta para que lo corrijan.', 'contact');
  if (['auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(code)) return result('Este navegador no permite completar el acceso con Google. Abrí el enlace directamente en Safari o Chrome, permití las cookies y volvé a ingresar.', 'choose');
  if (['auth/user-disabled','auth/invalid-credential'].includes(code)) return result('Google no pudo autorizar esta cuenta. Volvé a elegir tu cuenta; si sigue igual, compartí la referencia con Gran Berta.', 'choose');
  if (['permission-denied','firestore/permission-denied'].includes(code)) return result('El enlace no permite consultar o completar este alta. Pedí a Gran Berta que revise el enlace y compartí la referencia del error.', 'contact');
  if (['not-found','firestore/not-found'].includes(code)) return result('No se encontró el enlace o el gasto al que pertenece. Pedí a Gran Berta un enlace nuevo.', 'contact');
  if (/network-request-failed|unavailable|deadline-exceeded|functions\/cancelled|functions\/aborted|^aborted$|^cancelled$/.test(code) || /failed to fetch|network request failed/i.test(err?.message || '')) return result('Se interrumpió la conexión y no pudimos comprobar el resultado. Revisá internet y tocá «Reintentar envío» en esta misma ventana: si el alta ya se guardó, se recuperará sin duplicarla.', 'retry');
  if (/too-many-requests|resource-exhausted/.test(code)) return result('Se alcanzó el límite de intentos. Esperá unos minutos y volvé a enviar desde esta misma ventana, sin cambiar los datos.', 'retry');
  if (['DNI_EXISTS','CUIT_EXISTS'].includes(err?.message || '')) return result('Ese DNI o CUIT ya corresponde a una ficha. Compartí la referencia con Gran Berta para completar la ficha existente.', 'contact');
  if (['functions/failed-precondition','functions/invalid-argument','functions/permission-denied'].includes(code) && err?.message) {
    const field = err.details?.field && err.details.field in REGISTRATION_FIELD_LABELS ? err.details.field : undefined;
    const message = err.message.replace(/^Firebase:\s*/i, '').replace(/\s*\(functions\/[^)]+\)\.?$/, '').slice(0, 600);
    if (field) return result(message, field === 'email' ? 'choose' : 'fields', field);
    if (/ya tiene un alta|ya se guardó|ya fue utilizado|datos confirmados con firma/.test(message)) return result(message, 'portal');
    return result(message, /link|enlace|ficha|identificador|acceso asociado|Gran Berta|habilitado/.test(message) ? 'contact' : 'fields');
  }
  if (code === 'functions/internal' || code === 'functions/data-loss') return result('El servidor encontró un error al guardar el alta. Conservá esta ventana y compartí la referencia con Gran Berta para revisar el intento antes de repetirlo.', 'contact');
  if (code === 'registration/bank-consent') return result('Falta confirmar que los datos son correctos y que la cuenta bancaria corresponde a este proveedor. Marcá la declaración debajo del formulario.', 'fields');
  if (code.startsWith('auth/')) return result('Google no pudo completar la verificación de tu cuenta. Tus datos siguen cargados. Compartí la referencia con Gran Berta para revisar el acceso.', 'contact');
  return result('El alta se interrumpió y no pudimos identificar la causa. Tus datos siguen en esta ventana. Compartí la referencia del error con Gran Berta para que revisen este intento.', 'contact');
}
