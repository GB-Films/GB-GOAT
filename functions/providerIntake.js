const { fail } = require('./providerPortalModel');
const { createProviderRegistration } = require('./providerRegistration');

// Compatibility for old personal invitations. Identity resolution is shared with
// ordinary intake; third-party drafts stay private and grant no authority.
function createThirdPartyIntake(deps) {
  const register = createProviderRegistration({ ...deps, legacyThirdPartyDraft:true });
  return async (actor, input) => {
    if (input.form?.type !== 'persona') fail('Esta alternativa es sólo para personas físicas.');
    if (String(input.form.email || '').trim().toLowerCase() !== actor.email) fail('La cuenta cambió. Volvé a confirmar el alta.');
    return register(actor, { ...input, ownAccountConfirmed:true });
  };
}
module.exports = { createThirdPartyIntake };
