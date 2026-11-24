const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const { projectFinanceAccess } = require('./projectFinanceAccess');
const { fail, hash, id } = require('./providerPortalModel');

const scopeFields = ['projectId', 'collectionName', 'expenseId', 'provisionalProviderId'];
const linkedFields = [...scopeFields, 'projectName', 'area', 'subcategory', 'description'];
const copyFields = (data, keys) => Object.fromEntries(keys
  .filter(key => Object.hasOwn(data, key))
  .map(key => [key, data[key]]));

function createDetachProviderInvite({ db, timestamp }) {
  return async (actor, input) => {
    const projectId = id(input.projectId);
    const itemId = id(input.itemId);
    const inviteToken = id(input.inviteToken);
    const collectionName = input.collectionName;
    if (!['areaExpenses', 'budgetItems'].includes(collectionName)) fail('La fila del enlace no es válida.');

    const expenseRef = db.doc(`projects/${projectId}/${collectionName}/${itemId}`);
    const inviteRef = db.doc(`providerInvites/${inviteToken}`);
    const fingerprint = hash(inviteToken);
    const auditId = `provider-invite-detached-${hash({ collectionName, itemId, fingerprint })}`;
    const auditRef = db.doc(`projects/${projectId}/activityLog/${auditId}`);

    return db.runTransaction(async tx => {
      const access = await projectFinanceAccess({ db, transaction: tx, actor, projectId });
      if (!access.admin) throw new HttpsError('permission-denied', 'Sólo administración del proyecto puede desvincular el enlace.');
      const [expenseSnap, inviteSnap, auditSnap] = await Promise.all([tx.get(expenseRef), tx.get(inviteRef), tx.get(auditRef)]);
      const expense = expenseSnap.data(), invite = inviteSnap.data();
      if (!expense || !invite) fail('Ya no encontramos el gasto o su enlace. Actualizá el proyecto.');

      const rowLink = expense.providerInviteLink;
      if (auditSnap.exists) {
        if (linkedFields.some(key => Object.hasOwn(invite, key)) || rowLink?.token === inviteToken)
          fail('El alcance del enlace cambió. Actualizá el proyecto y revisá la fila.');
        return { status: 'detached' };
      }
      if (invite.projectId !== projectId || invite.expenseId !== itemId || (invite.collectionName || 'areaExpenses') !== collectionName)
        fail('El enlace no corresponde a esta fila. Actualizá y seleccioná el enlace correcto.');
      if (rowLink && rowLink.token !== inviteToken)
        fail('La fila tiene otro enlace de alta. Actualizá y revisá sus enlaces antes de continuar.');
      const used = invite.status === 'used' && invite.used === true;
      const unused = ['pending', 'cancelled'].includes(invite.status) && invite.used === false;
      if ((!used && !unused) || (invite.mode && invite.mode !== 'single_use'))
        fail('El enlace tiene un estado que requiere revisión de Administración.');

      const removeScope = Object.fromEntries(linkedFields.map(key => [key, FieldValue.delete()]));
      tx.update(inviteRef, { ...removeScope, updatedAt: timestamp() });
      if (rowLink) tx.update(expenseRef, { providerInviteLink: null, updatedAt: timestamp() });
      tx.create(auditRef, {
        action: 'provider_invite_detached', collectionName, itemId, inviteFingerprint: fingerprint,
        previousScope: copyFields(invite, linkedFields),
        previousInviteStatus: invite.status, previousInviteUsed: invite.used,
        previousInviteProviderId: invite.providerId || '',
        previousRowLink: rowLink ? copyFields(rowLink, ['status', 'createdAt', 'createdBy', 'expiresAt']) : null,
        deletedBy: actor.uid, deletedByEmail: actor.email, deletedByName: access.user?.displayName || '',
        deletedByRole: 'admin', createdAt: timestamp(),
      });
      return { status: 'detached' };
    });
  };
}

module.exports = { createDetachProviderInvite };
