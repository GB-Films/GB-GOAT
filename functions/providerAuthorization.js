const { fail } = require("./providerPortalModel");
const { THIRD_PARTY_VERSIONS, thirdPartyIsCurrent } = require('./providerThirdPartyDeclaration');
function authorizedParty(record, declaration, now = new Date()) {
  if (!THIRD_PARTY_VERSIONS.includes(declaration?.content?.termsVersion)) fail('Actualizá la autorización con el emisor, CUIT y cuenta del titular de la factura antes de registrar operaciones nuevas.');
  const role =
    record.kind === "invoice"
      ? "invoice"
      : record.kind === "payment"
        ? "payment"
        : null;
  if (
    !role ||
    !declaration ||
    declaration.kind !== "third_party" ||
    declaration.providerId !== record.providerId ||
    declaration.status !== "active" ||
    !declaration.proof?.complete ||
    !declaration.effectiveRoles?.includes(role) ||
    !thirdPartyIsCurrent(declaration.content, now)
  )
    fail("La autorización del tercero no está vigente para esta operación.");
  if (
    record.allocations.some(
      (a) =>
        !declaration.content.workKeys.includes(
          `${a.projectId}/${a.collectionName}/${a.itemId}`,
        ),
    )
  )
    fail("La autorización no incluye todos los trabajos seleccionados.");
  if (
    role === "invoice" &&
    record.issuerCuit !== declaration.content.party.cuit
  )
    fail("El emisor no coincide con la autorización revisada.");
  if (role === "payment" && record.payeeName !== declaration.content.party.name)
    fail("El beneficiario no coincide con la autorización revisada.");
  if (declaration.content.party.holderCuit !== declaration.content.party.cuit) fail('El emisor y el titular de la cuenta deben corresponder al mismo CUIT.');
  if (role === 'payment' && (record.method !== 'transfer' || record.account !== (declaration.content.party.cbu || declaration.content.party.alias)
    || record.payeeCuit !== declaration.content.party.cuit || !declaration.effectiveRoles.includes('invoice')
    || record.allocations.some(a => !a.invoiceId))) fail('El pago debe vincular la factura del emisor aprobado y utilizar su cuenta y CUIT autorizados.');
  return {
    declarationId: record.thirdPartyAuthorizationId,
    role,
    party: declaration.content.party,
    contentHash: declaration.contentHash,
    signedPdfSha256: declaration.proof.signedPdfSha256,
    ...(declaration.content.expiresOn ? { expiresOn: declaration.content.expiresOn } : { validity: 'until_revoked' }),
  };
}
module.exports = { authorizedParty };
