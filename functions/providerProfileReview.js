const { text } = require('./providerPortalModel');
const { signedProfileRegistration } = require('./providerRegistrationEvidence');
// Review is informational. It never grants access, writes a registration marker,
// changes bank data, or replaces the signed validation of critical fields.
function profileReview(provider, confirmation, declarations = []) {
  const fields = [];
  if (provider.type === 'empresa') return { required: false, fields };
  const add = (field, label, message) => fields.push({ field, label, message });
  if (!text(provider.name)) add('name', 'Nombre', 'Completá tu nombre.');
  if (!/^\d{7,9}$/.test(text(provider.dni).replace(/\D/g, ''))) add('dni', 'DNI', 'Revisá tu DNI.');
  if (!/^\d{11}$/.test(text(provider.cuit).replace(/\D/g, ''))) add('cuit', 'CUIT/CUIL', 'Revisá tu CUIT/CUIL.');
  if (!text(provider.phone)) add('phone', 'Teléfono', 'Completá tu teléfono.');
  if (!text(provider.address)) add('address', 'Domicilio', 'Completá tu domicilio.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(provider.email))) add('email', 'Correo de contacto', 'Revisá tu correo de contacto.');
  const cbu = text(provider.bankAccount_cbu);
  if (cbu && !/^\d{22}$/.test(cbu)) add('bankAccount_cbu', 'CBU/CVU', 'Debe tener 22 números.');
  else if (!cbu && !text(provider.bankAccount_alias)) add('bankAccount_alias', 'Cuenta propia', 'Completá tu CBU/CVU o alias propio.');
  const registrationPending = !(provider.personalGoogleAccount?.uid || provider.registration?.status === 'complete' || ['provider_invite', 'team_onboarding'].includes(provider.source)
    || declarations.some(row => signedProfileRegistration(row)));
  const classificationPending = provider.type !== 'persona';
  return { required: fields.length > 0 || registrationPending || classificationPending || ['required', 'pending_review'].includes(confirmation?.status),
    fields, registrationPending, classificationPending };
}
module.exports = { profileReview };
