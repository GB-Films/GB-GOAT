const { FieldPath } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { hasTeamWorkAccess } = require('./teamWorkAccess');
const { id } = require('./providerPortalModel');
const { wire } = require('./projectScopedReads');

const directoryFields = ['type', 'name', 'lastName', 'businessName', 'fullName', 'dni', 'dniNormalized', 'cuit', 'cuitNormalized', 'dni_cuit',
  'email', 'adminEmail', 'phone', 'address', 'category', 'categoryOther', 'dietaryRestriction', 'source', 'nickname', 'apodo', 'alias',
  'preferredName', 'provisional', 'administrativeRegistrationExempt', 'createdAt', 'updatedAt'];
const detailFields = [...directoryFields, 'birthDate', 'bankAccount_cbu', 'bankAccount', 'bankAccount_alias', 'bankAccount_holder', 'taxCondition'];
const pageSize = 200;
const projectProviderFields = (doc, fields) => {
  const data = doc.data();
  return wire({ ...Object.fromEntries(fields.filter(field => data[field] !== undefined).map(field => [field, data[field]])), id: doc.id });
};

async function readProductionProviderDirectory({ db, actor, user, input }) {
  if (user?.role !== 'jefe_produccion' || !hasTeamWorkAccess(user)
    || (await db.doc(`teamAccessEmails/${actor.email}`).get()).data()?.status === 'pending')
    throw new HttpsError('permission-denied', 'La consulta general requiere el rol Jefe de Producción de Equipo.');

  const providers = db.collection('providers');
  if (input.action === 'productionProviderDetail') {
    const [snapshot] = await db.getAll(providers.doc(id(input.providerId)), { fieldMask: detailFields });
    if (!snapshot.exists) throw new HttpsError('not-found', 'La ficha ya no está disponible.');
    return { provider: projectProviderFields(snapshot, detailFields) };
  }
  const cursor = input.cursor ?? '';
  if (typeof cursor !== 'string' || cursor.includes('/') || Buffer.byteLength(cursor) > 1500)
    throw new HttpsError('invalid-argument', 'Volvé a cargar el padrón.');
  const ordered = providers.select(...directoryFields).orderBy(FieldPath.documentId()).limit(pageSize + 1);
  const snapshot = await (cursor ? ordered.startAfter(cursor) : ordered).get();
  return {
    providers: snapshot.docs.slice(0, pageSize).map(doc => projectProviderFields(doc, directoryFields)),
    nextCursor: snapshot.size > pageSize ? snapshot.docs[pageSize - 1].id : '',
  };
}

module.exports = { readProductionProviderDirectory };
