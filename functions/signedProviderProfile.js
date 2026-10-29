const M = require('./providerPortalModel');
const { snapshot, assertConfirmationUnchanged } = require('./providerProfileConfirmation');
const { checkAccountReview } = require('./providerAccountChoice');

async function applySignedProviderProfile({ db, tx, ref, declaration, providerRef, provider, membership, actor, selectedAccount, timestamp }) {
  const applied = new Set(declaration.commonApplied || []), changes = {};
  if (declaration.content.confirmation) {
    const before = { ...declaration.content.confirmation.before };
    for (const key of applied) if (declaration.content.changes[key]) before[key] = declaration.content.changes[key].after;
    assertConfirmationUnchanged(provider, { before: snapshot(before) });
  }
  for (const [key, change] of Object.entries(declaration.content.changes)) {
    if (String(provider[key] ?? '') !== (applied.has(key) ? change.after : change.before)) M.fail('Los datos cambiaron mientras firmabas. Prepará una nueva declaración.');
    if (!applied.has(key)) changes[key] = change.after;
  }
  const identifiers = [];
  for (const field of ['cuit', 'dni']) if (Object.hasOwn(changes, field)) {
    const value = String(changes[field]).replace(/\D/g, ''), previous = String(provider[field + 'Normalized'] || provider[field] || '').replace(/\D/g, '');
    if (!new RegExp(field === 'dni' ? '^\\d{7,9}$' : '^\\d{11}$').test(value)) M.fail(`Revisá el ${field.toUpperCase()} declarado.`);
    changes[field + 'Normalized'] = value;
    const nextRef = db.doc(`providerIdentifiers/${field}_${value}`), next = await tx.get(nextRef);
    if (next.exists && next.data().providerId !== declaration.providerId) M.fail('Ese identificador ya corresponde a otro proveedor. Corregí la declaración antes de aplicar.');
    const oldRef = previous && previous !== value ? db.doc(`providerIdentifiers/${field}_${previous}`) : null;
    identifiers.push({ field, value, nextRef, oldRef, old: oldRef ? await tx.get(oldRef) : null });
  }
  if (Object.hasOwn(changes, 'name') || Object.hasOwn(changes, 'lastName')) changes.fullName = [changes.name ?? provider.name, changes.lastName ?? provider.lastName].filter(Boolean).join(' ');
  if (provider.type === 'empresa' && Object.hasOwn(changes, 'businessName')) changes.name = changes.businessName;
  const choice = declaration.content.accountChoice;
  let targetRef, target, oldRef;
  if (choice) {
    if (choice.previousAccessEmail !== M.email(provider.portalAccessEmail || provider.email)) M.fail('Cambió la cuenta de acceso. Prepará una nueva confirmación.');
    if (choice.changesIdentity) {
      oldRef = db.doc(`providerPortalUsers/${actor.uid}/memberships/${declaration.providerId}`);
      targetRef = db.doc(`providerPortalUsers/${M.id(choice.selected.uid)}/memberships/${declaration.providerId}`);
      target = (await tx.get(targetRef)).data();
      checkAccountReview(declaration, provider, membership, target, selectedAccount);
      changes.portalAccessEmail = choice.selected.email;
      if (provider.personalGoogleAccount?.uid === actor.uid) changes.personalGoogleAccount = { ...provider.personalGoogleAccount, uid: choice.selected.uid, email: choice.selected.email, changedByDeclarationId: ref.id };
    } else if (choice.selected.uid !== actor.uid || choice.selected.email !== actor.email || choice.signedWith.uid !== actor.uid || choice.signedWith.email !== actor.email) M.fail('La cuenta elegida no corresponde a quien firmó.');
  }
  for (const item of identifiers) {
    if (item.old?.exists && item.old.data().providerId === declaration.providerId) tx.delete(item.oldRef);
    tx.set(item.nextRef, { providerId: declaration.providerId, providerType: provider.type || 'persona', identifierType: item.field, value: item.value, updatedAt: timestamp() }, { merge: true });
  }
  if (targetRef) {
    if (choice.selected.uid !== actor.uid) tx.update(oldRef, { status: 'revoked', revokedAt: timestamp(), replacedByDeclarationId: ref.id });
    const authorized = provider.type === 'empresa' && target?.status === 'active' && target.representation === 'authorized_representative';
    tx.set(targetRef, { ...(target || {}), providerId: declaration.providerId, email: choice.selected.email,
      status: provider.type === 'empresa' && !authorized ? 'needs_confirmation' : 'active', representation: provider.type === 'empresa' ? authorized ? 'authorized_representative' : '' : 'own',
      source: 'verified_account_change', accountChangeDeclarationId: ref.id, accountVerifiedAt: timestamp() });
  }
  if (Object.keys(changes).length) tx.update(providerRef, { ...changes, updatedAt: timestamp(), portalRevision: Number(provider.portalRevision || 0) + 1 });
  tx.create(db.collection('providerPortalAudit').doc(), { action: 'signed_profile_applied', providerId: declaration.providerId, declarationId: ref.id,
    actor, before: M.publicProfile(provider), after: M.publicProfile({ ...provider, ...changes }), at: timestamp() });
  return { commonApplied: Object.keys(declaration.content.changes), ...(choice?.changesIdentity ? { accountChoiceApplied: { selected: choice.selected, at: timestamp(), authority: 'signed_verified_accounts' } } : {}) };
}
module.exports = { applySignedProviderProfile };
