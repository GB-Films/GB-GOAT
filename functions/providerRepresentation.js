const { fail, text } = require('./providerPortalModel');
const { validateEvidenceGroups } = require('./providerEvidence');
const COMPANY_VERSIONS = ['company-representation-v2', 'company-representation-v3'];
function companyRepresentation(provider, actor, input, evidence) {
  for (const [key, max] of Object.entries({ name: 160, dni: 20, role: 160 })) if (typeof input.representative?.[key] !== 'string' || input.representative[key].length > max) fail('Revisá el nombre, DNI y carácter del representante.');
  if (!/^[\d\s.-]+$/.test(input.representative.dni)) fail('El DNI debe contener números y separadores válidos.');
  const representative = { name: text(input.representative?.name, 160), dni: text(input.representative?.dni, 20).replace(/\D/g, ''), role: text(input.representative?.role, 160), email: actor.email };
  const company = { name: text(provider.businessName || provider.name, 160), cuit: text(provider.cuit || provider.cuitNormalized).replace(/\D/g, '') };
  if (provider.type !== 'empresa' || !company.name || !/^\d{11}$/.test(company.cuit)) fail('Administración debe completar la razón social y el CUIT de la empresa.');
  if (!representative.name || !/^\d{7,9}$/.test(representative.dni) || !representative.role) fail('Completá nombre, DNI y cargo o carácter del representante.');
  if (input.accountConfirmed !== true || input.identityConfirmed !== true || input.authorityConfirmed !== true) fail('Confirmá tu identidad, el uso del correo y las facultades que declarás.');
  validateEvidenceGroups(evidence);
  return { version: 'company-representation-v3', capacity: 'authorized_representative', representative, provider: company, signerDni: representative.dni, evidence,
    profile: { name: representative.name, dni: representative.dni, role: representative.role, company: company.name, companyCuit: company.cuit, email: actor.email },
    terms: `Yo, ${representative.name}, DNI ${representative.dni}, declaro actuar por ${company.name}, CUIT ${company.cuit}, en carácter de ${representative.role}. Declaro que la cuenta Google ${actor.email} me pertenece, está bajo mi control y la utilizo para gestionar y representar a esta empresa en GOAT. Declaro contar con facultades vigentes y suficientes para acceder a sus datos y firmar en su nombre los documentos comprendidos en la documentación de representación que adjunto. Confirmo que los respaldos corresponden a esta empresa y a mi identidad. Me comprometo a informar cambios, límites o revocaciones. La habilitación queda pendiente de revisión de identidad, documentación y alcance por administración; esta declaración no amplía las facultades que surgen de los documentos ni prueba por sí sola su vigencia.`,
  };
}
function checkCompanyReview(declaration, provider, membership, input) {
  if (input.decision !== 'approved') return;
  if (!COMPANY_VERSIONS.includes(declaration.content.version)) fail('Esta declaración anterior necesita una nueva presentación con documentación.');
  if (provider?.type !== 'empresa' || String(provider.cuit || provider.cuitNormalized || '').replace(/\D/g, '') !== declaration.content.provider.cuit
    || String(provider.businessName || provider.name || '').trim() !== declaration.content.provider.name) fail('Los datos de la empresa cambiaron; prepará una nueva declaración.');
  if (!membership || membership.status === 'revoked' || membership.email !== declaration.actor.email) fail('La asociación de esta cuenta cambió o fue revocada.');
  if (input.decision === 'approved' && ['companyVerified', 'identityVerified', 'authorityVerified', 'scopeVerified'].some(key => input.checks?.[key] !== true)) fail('Revisá y confirmá empresa, DNI, facultades vigentes y alcance antes de aprobar.');
  if (input.decision === 'approved' && !text(input.approvedScope, 500)) fail('Dejá indicado el alcance de la representación revisada.');
}
module.exports = { companyRepresentation, checkCompanyReview, COMPANY_VERSIONS };
