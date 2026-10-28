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
module.exports = { activatePersonalMembership };
