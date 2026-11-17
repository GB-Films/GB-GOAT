const { HttpsError } = require('firebase-functions/v2/https');
const { classifyPersonalProvider } = require('./providerPersonalClassification');
const { id, email, hash } = require('./providerPortalModel');
async function portalPersonalClassification({ db, timestamp, actor, input, findAccount, findAccountByUid }) {
  if (input.confirmPersonal !== true) throw new HttpsError('failed-precondition', 'Confirmá que esta ficha corresponde a una persona.');
  if (!findAccount || !findAccountByUid) throw new HttpsError('unavailable', 'No está disponible la comprobación de cuentas.');
  const targetEmail = email(input.email);
  let account;
  try { account = await findAccount(targetEmail); }
  catch { throw new HttpsError('failed-precondition', 'No encontramos esa cuenta verificada. Revisá la asociación existente.'); }
  if (!account?.uid) throw new HttpsError('failed-precondition', 'No encontramos esa cuenta verificada. Revisá la asociación existente.');
  const operationKey = id(input.operationKey), providerId = id(input.providerId);
  const source = { version: 'personal-classification-admin-v1', operationKey, providerId, targetUid: account.uid, targetEmail, actor };
  try {
    return await classifyPersonalProvider({ db, timestamp, operatorEmail: actor.email, findAccountByUid,
      apply: input.action === 'classifyPersonalProvider', input: {
        operationKey, providerId, targetUid: account.uid, targetEmail, operatorUid: actor.uid, operatorEmail: actor.email,
        confirmedPersonal: true, reason: 'Confirmación administrativa explícita de ficha personal desde Accesos de proveedores.', authorizationSha256: hash(source),
        ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
        ...(input.expectedPreservationHash === undefined ? {} : { expectedPreservationHash: input.expectedPreservationHash }),
      } });
  } catch (error) {
    if (error.code === 'ERR_ASSERTION') throw new HttpsError('failed-precondition', error.message.split('\n')[0]);
    throw error;
  }
}
module.exports = { portalPersonalClassification };
