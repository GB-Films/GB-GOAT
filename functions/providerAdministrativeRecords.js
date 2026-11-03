const { fail, id, email, text } = require('./providerPortalModel');
const { signedProfileRegistration } = require('./providerRegistrationEvidence');
const VERSION = 'administrative-provider-v1';
const administrativeRecordRef = (db, providerId) => db.doc(`providerAdministrativeRecords/${id(providerId)}`);
const isAdministrativeRecord = (record, providerId) => record?.version === VERSION
  && record.status === 'active' && record.providerId === providerId;
const hasOwnRegistration = provider => Boolean(provider?.personalGoogleAccount || provider?.registration?.status === 'complete'
  || ['provider_invite', 'team_onboarding'].includes(provider?.source));

async function assertProviderPortalAllowed(db, providerId, tx) {
  const ref = administrativeRecordRef(db, providerId);
  const row = await (tx ? tx.get(ref) : ref.get());
  if (isAdministrativeRecord(row.data(), providerId)) fail('Esta ficha es administrativa y no requiere alta ni acceso al portal.');
}

function createProviderAdministrativeRecords({ db, timestamp }) {
  async function state(providerId) {
    providerId = id(providerId);
    const [provider, record] = await Promise.all([db.doc(`providers/${providerId}`).get(), administrativeRecordRef(db, providerId).get()]);
    if (!provider.exists) fail('Proveedor inexistente.');
    return { providerId, active: isAdministrativeRecord(record.data(), providerId),
      canEnable: provider.data().type === 'empresa' && !hasOwnRegistration(provider.data()),
      contactEmail: provider.data().email || '' };
  }
  async function set(actor, input) {
    const providerId = id(input.providerId);
    if (typeof input.enabled !== 'boolean') fail('Elegí el tipo de gestión de la ficha.');
    const contactEmail = email(input.contactEmail);
    if (typeof input.contactEmail !== 'string' || input.contactEmail.length > 300
      || contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) fail('Revisá el correo de contacto interno.');
    const ref = administrativeRecordRef(db, providerId), providerRef = db.doc(`providers/${providerId}`);
    await db.runTransaction(async tx => {
      const [providerRow, priorRow] = await Promise.all([tx.get(providerRef), tx.get(ref)]);
      const provider = providerRow.data(), prior = priorRow.data();
      if (!provider) fail('Proveedor inexistente.');
      if (input.enabled) {
        if (provider.type !== 'empresa' || hasOwnRegistration(provider)) fail('La ficha administrativa es para empresas sin alta propia en el portal.');
        const [memberships, declarations, approval] = await Promise.all([
          tx.get(db.collectionGroup('memberships').limit(10001)),
          tx.get(db.collection('providerPortalDeclarations').where('providerId', '==', providerId).limit(501)),
          tx.get(db.doc(`providerPortalCompanyApprovals/${providerId}`)),
        ]);
        if (memberships.size > 10000 || declarations.size > 500) fail('El historial requiere una revisión acotada antes de cambiar la gestión.');
        if (approval.exists || memberships.docs.some(row => (row.id === providerId || row.data().providerId === providerId) && row.data().status !== 'revoked')
          || declarations.docs.some(row => signedProfileRegistration(row.data())
            || row.data().kind === 'representation' && (row.data().proof?.complete || ['preparing', 'pending_signature'].includes(row.data().status))))
          fail('Esta empresa ya tiene un alta o una representación en curso. Gestioná ese acceso antes de cambiar su ficha.');
      }
      const active = isAdministrativeRecord(prior, providerId);
      if (active === input.enabled && (!input.enabled || prior.contactEmail === contactEmail && provider.email === contactEmail
        && !provider.portalAccessEmail && !provider.accessPreparation)) return;
      tx.set(ref, { version: VERSION, providerId, status: input.enabled ? 'active' : 'inactive',
        contactEmail: input.enabled ? contactEmail : prior?.contactEmail || '', updatedBy: actor, updatedAt: timestamp(),
        ...(prior ? {} : { createdAt: timestamp() }) });
      // The catalog email stays a contact. An old prepared email is never used as a company identity.
      if (input.enabled) tx.update(providerRef, { email: contactEmail, portalAccessEmail: '', accessPreparation: null, updatedAt: timestamp() });
      tx.create(db.collection('providerPortalAudit').doc(), { action: 'provider_administrative_management_changed', providerId, actor,
        enabled: input.enabled, contactEmail, previous: prior || null,
        previousContactEmail: text(provider.email), previousPreparedEmail: text(provider.portalAccessEmail), at: timestamp() });
    });
    return state(providerId);
  }
  return { state, set };
}
module.exports = { VERSION, administrativeRecordRef, isAdministrativeRecord, hasOwnRegistration, assertProviderPortalAllowed, createProviderAdministrativeRecords };
