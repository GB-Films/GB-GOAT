const { fail, text, email, hash } = require('./providerPortalModel');
const { validateEvidenceGroups, DECLARED_COMPANY_EVIDENCE } = require('./providerEvidence');
const COMPANY_VERSIONS = ['company-representation-v2', 'company-representation-v3'];
const DECLARED_COMPANY_VERSION = 'company-representation-v4';
function assertCompanyAccount(provider, actor, membership) {
  if (provider?.type !== 'empresa' || !membership || !['needs_confirmation', 'active'].includes(membership.status) || membership.email !== actor.email) fail('El acceso a esta empresa cambió o fue revocado.');
  const account = provider.personalGoogleAccount;
  if (account ? account.uid !== actor.uid || email(account.email) !== actor.email : !provider.portalAccessEmail || email(provider.portalAccessEmail) !== actor.email) fail('Ingresá con la cuenta Google registrada para esta empresa.');
  if (provider.portalAccessEmail && email(provider.portalAccessEmail) !== actor.email) fail('Cambió la cuenta de acceso. Ingresá con la cuenta registrada vigente.');
}
function assertDeclaredCompany(provider, actor, membership, content) {
  assertCompanyAccount(provider, actor, membership);
  if (content.version !== DECLARED_COMPANY_VERSION || content.responsibilityConfirmed !== true || content.registeredAccount?.uid !== actor.uid || content.registeredAccount?.email !== actor.email) fail('La declaración no corresponde a la cuenta registrada o falta la responsabilidad expresa.');
  if (text(provider.businessName || provider.name) !== content.provider.name || String(provider.cuit || provider.cuitNormalized || '').replace(/\D/g, '') !== content.provider.cuit) fail('Los datos de la empresa cambiaron; revisalos y prepará una nueva declaración.');
}
function companyRepresentation(provider, actor, input, evidence) {
  for (const [key, max] of Object.entries({ name: 160, dni: 20, role: 160 })) if (typeof input.representative?.[key] !== 'string' || input.representative[key].length > max) fail('Revisá el nombre, DNI y carácter del representante.');
  if (!/^[\d\s.-]+$/.test(input.representative.dni)) fail('El DNI debe contener números y separadores válidos.');
  const representative = { name: text(input.representative?.name, 160), dni: text(input.representative?.dni, 20).replace(/\D/g, ''), role: text(input.representative?.role, 160), email: actor.email };
  const company = { name: text(provider.businessName || provider.name, 160), cuit: text(provider.cuit || provider.cuitNormalized).replace(/\D/g, '') };
  if (provider.type !== 'empresa' || !company.name || !/^\d{11}$/.test(company.cuit)) fail('Administración debe completar la razón social y el CUIT de la empresa.');
  if (!representative.name || !/^\d{7,9}$/.test(representative.dni) || !representative.role) fail('Completá nombre, DNI y cargo o carácter del representante.');
  if (input.accountConfirmed !== true || input.identityConfirmed !== true || input.authorityConfirmed !== true) fail('Confirmá tu identidad, el uso del correo y las facultades que declarás.');
  if (input.responsibilityConfirmed !== true) fail('Aceptá la responsabilidad por tu identidad y las facultades que declarás para representar a la empresa.');
  validateEvidenceGroups(evidence, DECLARED_COMPANY_EVIDENCE);
  return { version: DECLARED_COMPANY_VERSION, application: 'signed_declaration', responsibilityConfirmed: true, registeredAccount: { uid: actor.uid, email: actor.email }, capacity: 'authorized_representative', representative, provider: company, signerDni: representative.dni, evidence,
    profile: { name: representative.name, dni: representative.dni, role: representative.role, company: company.name, companyCuit: company.cuit, email: actor.email },
    terms: `Yo, ${representative.name}, DNI ${representative.dni}, declaro actuar por ${company.name}, CUIT ${company.cuit}, en carácter de ${representative.role}. Declaro que controlo personalmente la cuenta Google registrada ${actor.email} y la utilizo para gestionar y representar a esta empresa en GOAT. Declaro bajo mi responsabilidad que mi identidad es verídica y que cuento con facultades vigentes y suficientes para acceder a sus datos y firmar contratos y otros documentos en su nombre. Asumo la responsabilidad por la veracidad de esta declaración y por actuar dentro de mis facultades. Me comprometo a informar sus cambios, límites o revocaciones. Adjunto mi DNI; la presentación de un poder u otro respaldo de representación es opcional. Si adjunto respaldos, declaro que son auténticos y corresponden a mi identidad y a esta empresa. Al completar esta firma se habilita mi representación en GOAT sin revisión administrativa posterior ni exigencia de adjuntar un poder. La habilitación registra mi declaración y no certifica por sí sola la existencia, suficiencia o vigencia de mis facultades.`,
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
function companySigningAuthority(provider, approval, membership, declaration) {
  const signerEmail = email(provider.portalAccessEmail || provider.email);
  const version = approval?.version || 'company-representation-v2';
  if (!approval || approval.email !== signerEmail || membership?.status !== 'active' || membership.email !== signerEmail
    || membership.companyReviewVersion !== version || membership.declarationId !== approval.declarationId
    || approval.company?.cuit !== String(provider.cuit || provider.cuitNormalized || '').replace(/\D/g, '') || approval.company?.name !== text(provider.businessName || provider.name)) fail('La empresa necesita completar su declaración de representación con la cuenta registrada antes de solicitar esta firma.');
  if (approval.version === DECLARED_COMPANY_VERSION) {
    if (approval.method !== 'signed_declaration' || declaration?.status !== 'applied' || !declaration.proof?.complete || declaration.kind !== 'representation'
      || declaration.actor?.uid !== approval.uid || declaration.actor?.email !== signerEmail || declaration.contentHash !== approval.contentHash
      || hash({ kind: declaration.kind, providerId: declaration.providerId, actor: declaration.actor, content: declaration.content }) !== approval.contentHash) fail('Falta la declaración firmada y aplicada de la empresa.');
    assertDeclaredCompany(provider, declaration.actor, membership, declaration.content);
  } else if (!COMPANY_VERSIONS.includes(approval.version || 'company-representation-v2')) fail('La representación necesita una nueva declaración.');
  return { declarationId: approval.declarationId, contentHash: approval.contentHash, scope: approval.scope, email: approval.email,
    ...(approval.version === DECLARED_COMPANY_VERSION ? { method: 'signed_declaration' } : {}) };
}
module.exports = { companyRepresentation, checkCompanyReview, COMPANY_VERSIONS, DECLARED_COMPANY_VERSION, assertCompanyAccount, assertDeclaredCompany, companySigningAuthority };
