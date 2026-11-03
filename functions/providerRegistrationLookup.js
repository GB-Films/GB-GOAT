const { HttpsError } = require('firebase-functions/v2/https');
const { hasTeamWorkAccess } = require('./teamWorkAccess');
const { signedProfileRegistration } = require('./providerRegistrationEvidence');

function createProviderRegistrationLookup({ db }) {
  return async (actor, input) => {
    const [user, gate] = await Promise.all([
      db.doc(`users/${actor.uid}`).get(), db.doc(`teamAccessEmails/${actor.email}`).get(),
    ]);
    if ((actor.email !== 'info@granbertafilms.com' && !hasTeamWorkAccess(user.data())) || (gate.exists && gate.data()?.status !== 'ready')) {
      throw new HttpsError('permission-denied', 'Sólo el equipo autorizado puede consultar el catálogo.');
    }
    if (!Array.isArray(input.providerIds) || input.providerIds.length > 500
      || input.providerIds.some(value => typeof value !== 'string' || !/^[\w-]{1,160}$/.test(value))) {
      throw new HttpsError('invalid-argument', 'Consultá hasta 500 proveedores por vez.');
    }
    const ids = [...new Set(input.providerIds)], registered = new Set();
    for (let offset = 0; offset < ids.length; offset += 30) {
      const group = ids.slice(offset, offset + 30);
      const history = await db.collection('providerPortalDeclarations').where('providerId', 'in', group)
        .select('providerId', 'kind', 'status', 'proof.complete', 'content.confirmation.version').limit(1001).get();
      if (history.size > 1000) throw new HttpsError('resource-exhausted', 'El historial requiere una consulta más acotada.');
      for (const row of history.docs) {
        const declaration = row.data();
        if (group.includes(declaration.providerId) && signedProfileRegistration(declaration)) registered.add(declaration.providerId);
      }
    }
    // Only the state of an already visible catalog entry leaves this boundary.
    // No declaration, signer, proof, banking data or file link is exposed or changed.
    return { registeredProviderIds: [...registered].sort() };
  };
}
module.exports = { createProviderRegistrationLookup };
