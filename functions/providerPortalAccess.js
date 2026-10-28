// Called only after the portal has verified the Google identity. It can activate
// an existing association; it cannot create one or restore a revoked association.
async function activatePersonalMembership({ db, actor, providerId, timestamp }) {
  const membershipRef = db.doc(`providerPortalUsers/${actor.uid}/memberships/${providerId}`);
  const providerRef = db.doc(`providers/${providerId}`);
  const auditRef = db.collection('providerPortalAudit').doc();
  return db.runTransaction(async tx => {
    const membership = (await tx.get(membershipRef)).data();
    const provider = (await tx.get(providerRef)).data();
    if (!membership || membership.status !== 'needs_confirmation'
      || membership.email !== actor.email || provider?.type !== 'persona') return membership;
    const activation = { status: 'active', representation: 'own', activationMethod: 'verified_google_no_signature', activatedAt: timestamp() };
    tx.update(membershipRef, activation);
    tx.create(auditRef, { action: 'personal_access_activated_without_signature', providerId, actor,
      previousStatus: membership.status, source: membership.source || 'assigned_membership', at: timestamp() });
    return { ...membership, ...activation };
  });
}
async function attachVerifiedIntakeMembership({ db, actor, providerId, timestamp }) {
  const membershipRef = db.doc(`providerPortalUsers/${actor.uid}/memberships/${providerId}`);
  const providerRef = db.doc(`providers/${providerId}`);
  const auditRef = db.collection('providerPortalAudit').doc();
  return db.runTransaction(async tx => {
    const prior = (await tx.get(membershipRef)).data();
    const provider = (await tx.get(providerRef)).data();
    const account = provider?.personalGoogleAccount;
    if (prior || provider?.source !== 'provider_invite' || !['persona', 'empresa'].includes(provider.type)
      || account?.uid !== actor.uid || account.email !== actor.email || account.version !== 'personal-google-v1' || account.personalUse !== true) return prior;
    const membership = { providerId, email: actor.email, status: provider.type === 'empresa' ? 'needs_confirmation' : 'active',
      representation: provider.type === 'persona' ? 'own' : '', source: 'verified_intake_uid', createdAt: timestamp() };
    tx.create(membershipRef, membership);
    tx.create(auditRef, { action: 'verified_intake_account_associated', providerId, actor, at: timestamp() });
    return membership;
  });
}
module.exports = { activatePersonalMembership, attachVerifiedIntakeMembership };
