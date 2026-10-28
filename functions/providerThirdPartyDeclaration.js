const M = require('./providerPortalModel');
function thirdPartyDeclaration(provider, actor, input, workKeys) {
  if (typeof input.cuit !== 'string' || !/^[\d\s.-]+$/.test(input.cuit)) M.fail('Ingresá el CUIT de quien emitirá la factura.');
  const result = M.thirdParty({ ...input, holder: input.name }, workKeys, false);
  const holderCuit = result.party.cuit;
  if (result.roles.join(',') !== 'invoice,payment') M.fail('La solicitud debe identificar a la misma persona como emisor de factura y beneficiario del pago.');
  if (input.holderCuit && M.text(input.holderCuit, 30).replace(/\D/g, '') !== holderCuit) M.fail('El titular de la cuenta debe corresponder al CUIT de quien emitirá la factura.');
  if (input.responsibilityConfirmed !== true) M.fail('Confirmá que solicitás la facturación y el cobro mediante la persona y cuenta indicadas, bajo tu responsabilidad.');
  result.party.holderCuit = holderCuit;
  result.party = { name: result.party.name, cuit: result.party.cuit, holder: result.party.name, holderCuit, cbu: result.party.cbu, alias: result.party.alias };
  result.signerDni = M.text(provider.dni || provider.dniNormalized).replace(/\D/g, '');
  if (!/^\d{7,9}$/.test(result.signerDni)) M.fail('Administración debe completar el DNI propio del prestador antes de esta autorización.');
  result.ownAccount = { cbu: M.text(provider.bankAccount_cbu || provider.bankAccount, 22), alias: M.text(provider.bankAccount_alias, 100) };
  if (!result.ownAccount.cbu && !result.ownAccount.alias) M.fail('Completá tu CBU o alias propio desde Mis datos antes de solicitar esta autorización.');
  result.termsVersion = 'third-party-v3';
  const name = M.text([provider.name, provider.lastName].filter(Boolean).join(' ') || provider.fullName);
  result.terms = `Yo, ${name}, DNI ${result.signerDni}, con cuenta de acceso ${actor.email}, declaro ser quien presta los servicios seleccionados. Solicito y autorizo, bajo mi responsabilidad, que ${result.party.name}, CUIT ${result.party.cuit}, emita la factura que corresponda y reciba los pagos de esos trabajos en la cuenta ${result.party.cbu || result.party.alias}. Declaro que la cuenta indicada corresponde al titular de la factura, ${result.party.name}, CUIT ${holderCuit}. Mi cuenta propia queda registrada por separado y no se utilizará para estos pagos autorizados. Asumo la responsabilidad por la exactitud de la información y por los acuerdos y distribución posterior de fondos con la persona designada. La solicitud sólo alcanza a los trabajos y vigencia indicados. La emisión de una factura con otro CUIT queda sujeta a validación contable independiente. Los datos de la cuenta son declarados por mí; esta autorización no constituye una verificación bancaria automática ni acredita un pago realizado.`;
  return result;
}
const THIRD_PARTY_CHECKS = { invoice: ['fiscalFrameVerified'], payment: ['declaredPayeeChecked'] };
function checkThirdPartyReview(declaration, roles, input) {
  if (input.decision !== 'approved') return;
  if (declaration.content.termsVersion !== 'third-party-v3') M.fail('Pedí una autorización actualizada con el emisor, CUIT y cuenta del titular de la factura.');
  if (roles.some(role => THIRD_PARTY_CHECKS[role]?.some(key => input.checks?.[key] !== true))) M.fail('Confirmá el encuadre de facturación y la cuenta declarada para el titular de la factura antes de aprobar.');
}
module.exports = { thirdPartyDeclaration, checkThirdPartyReview };
