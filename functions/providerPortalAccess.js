const { administrativeRecordRef, isAdministrativeRecord } = require('./providerAdministrativeRecords');
const { HttpsError } = require('firebase-functions/v2/https');
const { email, text } = require('./providerPortalModel');
function personalIdentityMatches(provider, actor) {
  return !provider.personalGoogleAccount || provider.personalGoogleAccount.uid === actor.uid && email(provider.personalGoogleAccount.email) === actor.email;
}
function legacyPersonalCandidate(provider, membership, actor) {
  return !!provider && !Object.hasOwn(provider, 'type') && !text(provider.businessName)
    && membership?.representation === 'own' && personalIdentityMatches(provider, actor);
}
async function legacyPersonalAllowed({ db, read, providerId, provider, membership, actor }) {
  if (!legacyPersonalCandidate(provider, membership, actor)) return false;
  const [approval, history] = await Promise.all([
    read(db.doc(`providerPortalCompanyApprovals/${providerId}`)),
    read(db.collection('providerPortalDeclarations').where('providerId', '==', providerId).limit(501)),
  ]);
  return !approval.exists && history.size <= 500 && !history.docs.some(row => row.data().kind === 'representation'
    && !['revoked', 'cancelled', 'rejected'].includes(row.data().status));
}
async function verifyPortalAccount(findAccountByUid, actor) {
  if (!findAccountByUid) throw new HttpsError('unavailable', 'No pudimos comprobar tu cuenta. Intentá nuevamente.');
  let account;
  try { account = await findAccountByUid(actor.uid); }
  catch (error) {
    if (error?.code === 'auth/user-not-found') throw new HttpsError('permission-denied', 'No encontramos tu cuenta Google. Contactá a administración.');
    throw new HttpsError('unavailable', 'No pudimos comprobar tu cuenta. Intentá nuevamente.');
  }
  if (!account || account.disabled || account.emailVerified !== true || account.uid !== actor.uid || email(account.email) !== actor.email
    || !account.providerData?.some(provider => provider.providerId === 'google.com'))
    throw new HttpsError('permission-denied', 'Tu cuenta Google no está habilitada o no coincide con el acceso. Contactá a administración.');
}
// Called only after the portal has verified the Google identity. It can activate
// an existing association; it cannot create one or restore a revoked association.
async function activatePersonalMembership({ db, actor, providerId, timestamp }) {
  const membershipRef = db.doc(`providerPortalUsers/${actor.uid}/memberships/${providerId}`);
  const providerRef = db.doc(`providers/${providerId}`);
  const auditRef = db.collection('providerPortalAudit').doc();
  return db.runTransaction(async tx => {
    const membership = (await tx.get(membershipRef)).data();
    const provider = (await tx.get(providerRef)).data();
    if (isAdministrativeRecord((await tx.get(administrativeRecordRef(db, providerId))).data(), providerId)) return null;
    if (!membership || membership.status !== 'needs_confirmation' || membership.email !== actor.email || !provider) return membership;
    const legacy = await legacyPersonalAllowed({ db, read: ref => tx.get(ref), providerId, provider, membership, actor });
    if (provider.type !== 'persona' && !legacy || provider.type === 'persona' && !personalIdentityMatches(provider, actor)) return membership;
    const activation = { status: 'active', representation: 'own', activationMethod: legacy ? 'verified_google_legacy_personal' : 'verified_google_no_signature', activatedAt: timestamp() };
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
    if (prior) return prior;
    const provider = (await tx.get(providerRef)).data();
    if (isAdministrativeRecord((await tx.get(administrativeRecordRef(db, providerId))).data(), providerId)) return prior;
    const account = provider?.personalGoogleAccount;
    if (provider?.source !== 'provider_invite' || !['persona', 'empresa'].includes(provider.type)
      || account?.uid !== actor.uid || account.email !== actor.email || account.version !== 'personal-google-v1' || account.personalUse !== true) return prior;
    const membership = { providerId, email: actor.email, status: provider.type === 'empresa' ? 'needs_confirmation' : 'active',
      representation: provider.type === 'persona' ? 'own' : '', source: 'verified_intake_uid', createdAt: timestamp() };
    tx.create(membershipRef, membership);
    tx.create(auditRef, { action: 'verified_intake_account_associated', providerId, actor, at: timestamp() });
    return membership;
  });
}
module.exports = { activatePersonalMembership, attachVerifiedIntakeMembership, legacyPersonalAllowed, personalIdentityMatches, verifyPortalAccount };
