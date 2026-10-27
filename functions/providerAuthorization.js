const { fail, dateKey } = require("./providerPortalModel");
function authorizedParty(record, declaration, now = new Date()) {
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
    declaration.content.expiresOn < dateKey(now)
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
  return {
    declarationId: record.thirdPartyAuthorizationId,
    role,
    party: declaration.content.party,
    contentHash: declaration.contentHash,
    signedPdfSha256: declaration.proof.signedPdfSha256,
    expiresOn: declaration.content.expiresOn,
  };
}
module.exports = { authorizedParty };
