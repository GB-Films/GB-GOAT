const { HttpsError } = require('firebase-functions/v2/https');
const { id, list, fail } = require('./providerPortalModel');
const { projectFinanceAccess } = require('./projectFinanceAccess');
const { thirdPartyIsCurrent } = require('./providerThirdPartyDeclaration');
const { isInternalBudgetEstimate } = require('./internalBudgetEstimate');

// Read-only: never applies, approves or repairs a declaration while showing bank data.
function createProviderWorkAuthorizations({ db, sign, clock = () => new Date() }) {
  return async (actor, input, global) => {
    const projectId = id(input.projectId), itemId = id(input.itemId);
    if (!['areaExpenses', 'budgetItems'].includes(input.collectionName)) fail('Elegí un gasto válido.');
    await projectFinanceAccess({ db, actor, projectId });
    const key = `${projectId}/${input.collectionName}/${itemId}`;
    const expense = (await db.doc(`projects/${key}`).get()).data();
    if (!expense?.providerId || isInternalBudgetEstimate(expense)) fail('El gasto ya no tiene un proveedor asignado.');
    if (input.providerId !== expense.providerId) fail('El proveedor del gasto cambió. Actualizá la página.');
    const provider = (await db.doc(`providers/${id(expense.providerId)}`).get()).data();
    const belongs = d => d?.kind === 'third_party' && d.providerId === expense.providerId
      && d.proof?.complete === true && list(d.content?.workKeys).includes(key);
    const canDownload = d => global || list(d.content.workKeys).every(work => work.split('/')[0] === projectId);
    if (input.action === 'workAuthorizationFile') {
      const d = (await db.doc(`providerPortalDeclarations/${id(input.declarationId)}`).get()).data();
      if (!belongs(d)) throw new HttpsError('permission-denied', 'La declaración no corresponde a este gasto.');
      if (!canDownload(d)) throw new HttpsError('permission-denied', 'La constancia incluye otros proyectos. Pedila a administración.');
      return sign.declarationFile(d.signing, 'signed');
    }
    const rows = await db.collection('providerPortalDeclarations').where('providerId', '==', expense.providerId).limit(501).get();
    if (rows.size > 500) fail('Administración debe revisar el historial de declaraciones.');
    return { required: expense.thirdPartyPayoutRequired === true, authorizations: rows.docs
      .map(row => ({ ...row.data(), id: row.id })).filter(belongs).map(d => ({
        id: d.id, status: d.status,
        valid: provider?.type === 'persona' && d.status === 'active' && thirdPartyIsCurrent(d.content, clock())
          && ['invoice', 'payment'].every(role => list(d.effectiveRoles).includes(role)),
        effectiveRoles: list(d.effectiveRoles), signedByEmail: d.actor?.email || '', signedAt: d.proof.signedAt || '',
        canDownload: canDownload(d),
        content: { validity: d.content.validity || '', expiresOn: d.content.expiresOn || '',
          party: Object.fromEntries(['name', 'cuit', 'holder', 'holderCuit', 'cbu', 'alias'].map(field => [field, String(d.content.party?.[field] || '')])) },
      })) };
  };
}
module.exports = { createProviderWorkAuthorizations };
