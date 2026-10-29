const { fail, hash } = require('./providerPortalModel');
const { assertDeclaredCompany } = require('./providerRepresentation');

async function applySignedCompanyRepresentation({ db, tx, ref, declaration, providerRef, provider, membershipRef, membership, actor, proof, timestamp }) {
  assertDeclaredCompany(provider, actor, membership, declaration.content);
  if (!proof.complete || !Number.isFinite(Date.parse(proof.signedAt))) fail('Falta la fecha y la evidencia completa de tu firma.');
  if (hash({ kind: declaration.kind, providerId: declaration.providerId, actor: declaration.actor, content: declaration.content }) !== declaration.contentHash) fail('La declaración no coincide con el contenido firmado.');
  const authorityRef = db.doc(`providerPortalCompanyApprovals/${declaration.providerId}`);
  const previous = (await tx.get(authorityRef)).data();
  if (previous?.declarationId !== ref.id && previous?.signedAt && Date.parse(previous.signedAt) >= Date.parse(proof.signedAt)) fail('Ya hay una declaración posterior aplicada. Revisá tu representación actual.');
  tx.update(membershipRef, { status: 'active', representation: 'authorized_representative', declarationId: ref.id, companyReviewVersion: declaration.content.version, companyAuthorityMethod: 'signed_declaration', confirmedAt: timestamp() });
  tx.set(authorityRef, { providerId: declaration.providerId, uid: actor.uid, email: actor.email, declarationId: ref.id, company: declaration.content.provider,
    scope: 'Gestión de la ficha y firma de contratos en GOAT bajo responsabilidad declarada.', version: declaration.content.version, contentHash: declaration.contentHash, method: 'signed_declaration', signedAt: proof.signedAt, appliedAt: timestamp() });
  tx.update(providerRef, { portalAccessEmail: actor.email, updatedAt: timestamp() });
  tx.create(db.collection('providerPortalAudit').doc(), { action: 'company_representation_declared', providerId: declaration.providerId, declarationId: ref.id, actor,
    method: 'signed_declaration', evidence: declaration.content.evidence, previousDeclarationId: previous?.declarationId || null, at: timestamp() });
}
module.exports = { applySignedCompanyRepresentation };
