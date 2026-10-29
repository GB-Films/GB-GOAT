const M = require('./providerPortalModel');

const VERSION = 'profile-confirmation-v1';
const FIELDS = ['type', 'name', 'lastName', 'businessName', 'dni', 'cuit', 'birthDate', 'address', 'phone', 'email', 'bankAccount_cbu', 'bankAccount_alias', 'bankAccount_holder'];
const snapshot = provider => ({ ...Object.fromEntries(FIELDS.map(key => [key, M.text(provider[key])])), birthDate: M.text(M.publicProfile(provider).birthDate), type: provider.type === 'empresa' ? 'empresa' : 'persona',
  ...(provider.type === 'empresa' ? { name: M.text(provider.businessName || provider.name) } : {}) });
function confirmationContent(provider, actor, changes, input, accountChoice) {
  if (input.dataConfirmed !== true || input.accessEmailConfirmed !== true)
    M.fail('Confirmá tus datos y la cuenta Google con la que ingresaste.');
  const before = snapshot(provider);
  const profile = snapshot({ ...before, ...Object.fromEntries(Object.entries(changes).map(([key, change]) => [key, change.after])) });
  const name = profile.type === 'empresa' ? profile.businessName || profile.name : [profile.name, profile.lastName].filter(Boolean).join(' ');
  if (!name) M.fail('Completá el nombre del proveedor.');
  if (profile.type !== 'empresa' && !/^\d{7,9}$/.test(profile.dni.replace(/\D/g, '')))
    M.fail('Completá tu DNI antes de confirmar los datos.');
  if (!profile.bankAccount_cbu && !profile.bankAccount_alias) M.fail('Completá tu CBU/CVU o alias propio.');
  if (profile.bankAccount_cbu && !/^\d{22}$/.test(profile.bankAccount_cbu)) M.fail('Revisá tu CBU/CVU: debe tener 22 dígitos.');
  if (profile.cuit && !/^\d{11}$/.test(profile.cuit.replace(/\D/g, ''))) M.fail('Revisá tu CUIT: debe tener 11 dígitos.');
  if (input.ownAccountConfirmed !== true) M.fail('Confirmá la titularidad de la cuenta provista.');
  const selectedEmail = accountChoice?.selected.email || actor.email;
  return {
    version: VERSION, before, profile, accessEmail: actor.email,
    terms: `Declaro que revisé los datos detallados en este documento y que son correctos. Confirmo que controlo personalmente la cuenta Google ${selectedEmail} y la elijo para gestionar esta ficha.${selectedEmail !== actor.email ? ` También verifiqué esa cuenta mediante un inicio de sesión con Google. Firmo esta solicitud con mi cuenta aprobada ${actor.email} y autorizo el cambio de acceso.` : ''} ${profile.type === 'empresa' ? 'La cuenta bancaria informada pertenece a la empresa identificada. Esta confirmación de datos no otorga facultades de representación; esas facultades se declaran y revisan por separado.' : 'La cuenta bancaria informada me pertenece. Si otra persona factura y cobra por mis trabajos, debo identificarla y autorizarla por separado para los trabajos correspondientes.'} Los cambios declarados se aplican al completar mi firma, sin aprobación administrativa posterior. Esta declaración no es una autorización de cobro por un tercero ni un recibo de pago.`,
  };
}
function assertConfirmationUnchanged(provider, confirmation) {
  if (M.hash(snapshot(provider)) !== M.hash(confirmation.before))
    M.fail('Los datos cambiaron mientras firmabas. Revisalos y prepará una nueva confirmación.');
}
function confirmationState(provider, membership, actor, declarations) {
  const current = M.hash(snapshot(provider));
  let confirmed;
  for (const declaration of declarations) {
    const c = declaration.content?.confirmation;
    const signedByActor = declaration.actor?.uid === actor.uid && declaration.actor?.email === actor.email && c?.accessEmail === actor.email;
    const transferred = declaration.accountChoiceApplied?.selected?.uid === actor.uid && declaration.accountChoiceApplied?.selected?.email === actor.email
      && (declaration.review?.decision === 'approved' || declaration.accountChoiceApplied.authority === 'signed_verified_accounts') && declaration.content?.accountChoice?.selected.uid === actor.uid && declaration.content.accountChoice.selected.email === actor.email;
    if (declaration.kind !== 'profile' || c?.version !== VERSION || (!signedByActor && !transferred) || !declaration.proof?.complete) continue;
    if (declaration.status === 'applied' && current === M.hash(c.profile)) confirmed = { status: 'confirmed', declarationId: declaration.id };
    if (declaration.status === 'pending_review') {
      const expected = { ...c.before };
      for (const [key, change] of Object.entries(declaration.content.changes || {})) if (!change.critical) expected[key] = change.after;
      if (current === M.hash(snapshot(expected))) return { status: 'pending_review', declarationId: declaration.id };
    }
  }
  // People who completed the new Google-linked signup do not sign merely to register.
  return confirmed || { status: ['verified_intake_uid', 'personal_google_intake'].includes(membership.source) ? 'not_required' : 'required' };
}
module.exports = { VERSION, snapshot, confirmationContent, assertConfirmationUnchanged, confirmationState };
