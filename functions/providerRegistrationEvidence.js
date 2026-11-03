const { VERSION } = require('./providerProfileConfirmation');
function signedProfileRegistration(declaration, actor) {
  if (declaration?.kind !== 'profile' || declaration.status !== 'applied' || declaration.proof?.complete !== true
    || declaration.content?.confirmation?.version !== VERSION) return false;
  if (!actor) return true;
  return declaration.actor?.uid === actor.uid && declaration.actor?.email === actor.email
    || declaration.accountChoiceApplied?.authority === 'signed_verified_accounts'
      && declaration.accountChoiceApplied.selected?.uid === actor.uid && declaration.accountChoiceApplied.selected?.email === actor.email;
}
// An already signed legacy confirmation is an intake, never a provisional record
// that can be overwritten through an unsigned signup. Only add its lifecycle marker.
async function rememberSignedRegistration({db,timestamp,actor,providerId,declarations}) {
  const candidate = declarations.find(row => signedProfileRegistration(row,actor));
  if (!candidate) return;
  const ref=db.doc(`providers/${providerId}`);
  await db.runTransaction(async tx => {
    const provider=(await tx.get(ref)).data();
    if (!provider || provider.registration?.status === 'complete') return;
    const membership=(await tx.get(db.doc(`providerPortalUsers/${actor.uid}/memberships/${providerId}`))).data();
    const declaration=(await tx.get(db.doc(`providerPortalDeclarations/${candidate.id}`))).data();
    if (membership?.status !== 'active' || membership.email !== actor.email || declaration?.providerId !== providerId || !signedProfileRegistration(declaration,actor)) return;
    tx.update(ref,{registration:{status:'complete',method:'signed_profile_confirmation',declarationId:candidate.id,completedByUid:actor.uid,recordedAt:timestamp()}});
    tx.create(db.collection('providerPortalAudit').doc(),{action:'legacy_signed_registration_recognized',providerId,declarationId:candidate.id,actor,at:timestamp()});
  });
}
module.exports={signedProfileRegistration,rememberSignedRegistration};
