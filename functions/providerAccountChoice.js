const { fail, email, id, hash } = require('./providerPortalModel');
const VERSION = 'google-account-choice-v1';
const MAX_AGE_MS = 10 * 60 * 1000;
function googleIdentity(claims, now) {
  const authTime = Number(claims?.auth_time) * 1000;
  if (!claims?.uid || claims.email_verified !== true || claims.firebase?.sign_in_provider !== 'google.com'
    || !Number.isFinite(authTime) || authTime > now + 30000 || now - authTime > MAX_AGE_MS
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email(claims.email)))
    fail('Verificá nuevamente esa cuenta con Google.');
  return { uid: id(claims.uid), email: email(claims.email), authTime };
}
function createAccountChoiceService({ db, timestamp, clock, verifyGoogleToken }) {
  const reference = key => db.doc(`providerPortalAccountVerifications/${id(key)}`);
  async function verify(providerId, actor, input) {
    if (!verifyGoogleToken || typeof input.idToken !== 'string' || input.idToken.length > 16000) fail('Falta verificar la cuenta con Google.');
    let claims;
    try { claims = await verifyGoogleToken(input.idToken); }
    catch { fail('No pudimos verificar esa cuenta con Google. Volvé a intentarlo.'); }
    const now = clock().getTime(), selected = googleIdentity(claims, now);
    if (selected.email !== email(input.expectedEmail)) fail('La cuenta elegida en Google no coincide con el correo que querés usar.');
    const key = hash({ providerId, actor, selected });
    await db.runTransaction(async tx => {
      const m = (await tx.get(db.doc(`providerPortalUsers/${actor.uid}/memberships/${providerId}`))).data();
      const previous = await tx.get(reference(key));
      if (m?.status !== 'active' || m.email !== actor.email) fail('Tu acceso a esta ficha cambió. Volvé a ingresar.');
      if (!previous.exists) tx.create(reference(key), { version: VERSION, providerId, actor, selected,
        expiresAtMs: Math.min(now + MAX_AGE_MS, selected.authTime + MAX_AGE_MS), verifiedAt: timestamp() });
    });
    return { verificationId: key, email: selected.email };
  }
  async function resolve(providerId, actor, provider, input) {
    let selected = { uid: actor.uid, email: actor.email };
    let verificationId = '';
    if (input.accountVerificationId) {
      const verification = (await reference(input.accountVerificationId).get()).data();
      if (verification?.version !== VERSION || verification.providerId !== providerId
        || verification.actor?.uid !== actor.uid || verification.actor.email !== actor.email
        || !Number.isFinite(verification.expiresAtMs) || verification.expiresAtMs <= clock().getTime()) fail('La verificación de la otra cuenta venció. Verificala otra vez con Google.');
      selected = { uid: verification.selected.uid, email: verification.selected.email };
      verificationId = input.accountVerificationId;
    }
    if (email(input.selectedAccountEmail || actor.email) !== selected.email)
      fail('Primero verificá con Google la cuenta que querés usar.');
    return { version: VERSION, selected, signedWith: { uid: actor.uid, email: actor.email }, verificationId,
      previousAccessEmail: email(provider.portalAccessEmail || provider.email),
      changesIdentity: selected.uid !== actor.uid || selected.email !== actor.email };
  }
  return { verify, resolve };
}
function checkAccountReview(declaration, provider, membership, targetMembership, account) {
  const choice = declaration.content.accountChoice;
  if (choice?.version !== VERSION || choice.signedWith.uid !== declaration.actor.uid || choice.signedWith.email !== declaration.actor.email)
    fail('La selección de cuenta no es válida. Pedí una nueva confirmación.');
  if (email(provider.portalAccessEmail || provider.email) !== choice.previousAccessEmail)
    fail('Cambió la cuenta de acceso. Pedí una nueva confirmación.');
  if (membership?.status !== 'active' || membership.email !== declaration.actor.email)
    fail('El acceso de quien firmó ya no está activo.');
  if (!account || account.disabled || !account.emailVerified || account.uid !== choice.selected.uid
    || email(account.email) !== choice.selected.email || !account.providerData?.some(p => p.providerId === 'google.com'))
    fail('La cuenta elegida ya no es una cuenta Google verificada disponible.');
  if (targetMembership && (targetMembership.status === 'revoked' || (choice.selected.uid !== declaration.actor.uid && targetMembership.email !== choice.selected.email)))
    fail('La cuenta elegida tiene una asociación revocada o incompatible. Revisá el acceso por separado.');
  return choice;
}
module.exports = { VERSION, googleIdentity, createAccountChoiceService, checkAccountReview };
