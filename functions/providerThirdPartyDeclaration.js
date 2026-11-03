const M = require('./providerPortalModel');
const THIRD_PARTY_VERSIONS = ['third-party-v3', 'third-party-v4', 'third-party-v5'];
function thirdPartyDetails(input) {
  if (typeof input.cuit !== 'string' || !/^[\d\s.-]+$/.test(input.cuit)) M.fail('Ingresá el CUIT de quien emitirá la factura.');
  const party = M.thirdPartyIdentity({ ...input, holder: input.name }, true, false);
  const holderCuit = party.cuit;
  if (input.holderCuit && M.text(input.holderCuit, 30).replace(/\D/g, '') !== holderCuit) M.fail('El titular de la cuenta debe corresponder al CUIT de quien emitirá la factura.');
  return { name: party.name, cuit: party.cuit, holder: party.name, holderCuit, cbu: party.cbu, alias: party.alias };
}
function thirdPartyIsCurrent(content, now = new Date()) {
  if (['third-party-v4', 'third-party-v5'].includes(content?.termsVersion)) return content.validity === 'until_revoked' && !content.expiresOn;
  if (content?.termsVersion !== 'third-party-v3') return false;
  const end = content.expiresOn;
  return typeof end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(end) && !Number.isNaN(Date.parse(end))
    && new Date(end).toISOString().slice(0, 10) === end && end >= M.dateKey(now);
}
function thirdPartyDeclaration(provider, actor, input, workKeys) {
  const party = thirdPartyDetails(input);
  const result = M.thirdParty({ ...input, holder: input.name }, workKeys, false, false);
  if (result.roles.join(',') !== 'invoice,payment') M.fail('La solicitud debe identificar a la misma persona como emisor de factura y beneficiario del pago.');
  if (input.responsibilityConfirmed !== true) M.fail('Confirmá que solicitás la facturación y el cobro mediante la persona y cuenta indicadas, bajo tu responsabilidad.');
  result.party = party;
  result.signerDni = M.text(provider.dni || provider.dniNormalized).replace(/\D/g, '');
  if (!/^\d{7,9}$/.test(result.signerDni)) M.fail('Administración debe completar el DNI propio del prestador antes de esta autorización.');
  result.ownAccount = { cbu: M.text(provider.bankAccount_cbu || provider.bankAccount, 22), alias: M.text(provider.bankAccount_alias, 100) };
  if (!result.ownAccount.cbu && !result.ownAccount.alias) M.fail('Completá tu CBU o alias propio desde Mis datos antes de solicitar esta autorización.');
  result.termsVersion = 'third-party-v5';
  const name = M.text([provider.name, provider.lastName].filter(Boolean).join(' ') || provider.fullName);
  result.terms = `Yo, ${name}, DNI ${result.signerDni}, con cuenta de acceso ${actor.email}, declaro ser quien presta los servicios seleccionados. Solicito y autorizo, bajo mi responsabilidad, que ${party.name}, CUIT ${party.cuit}, emita la factura que corresponda y reciba los pagos de esos trabajos en la cuenta ${party.cbu || party.alias}. Declaro que la cuenta indicada corresponde al titular de la factura, ${party.name}, CUIT ${party.holderCuit}. Mi cuenta propia queda registrada por separado y no se utilizará para estos pagos autorizados. Asumo la responsabilidad por la exactitud de la información y por los acuerdos y distribución posterior de fondos con la persona designada. La autorización no tiene fecha de vencimiento y sólo alcanza a los trabajos seleccionados, hasta su revocación. Guardar estos datos no autoriza otros trabajos ni modifica autorizaciones ya firmadas. Al completar mi firma desde mi cuenta registrada, esta declaración se aplica automáticamente a la facturación y al cobro de los trabajos seleccionados, sin aprobación administrativa posterior. Los datos de la cuenta son declarados por mí; esta autorización no constituye una verificación bancaria automática ni acredita un pago realizado.`;
  return result;
}
module.exports = { thirdPartyDeclaration, thirdPartyDetails, thirdPartyIsCurrent, THIRD_PARTY_VERSIONS };
