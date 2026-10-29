const ROLES = ['admin', 'ayudante_admin', 'jefe_produccion', 'colaborador'];
// Absence of the marker preserves existing users. Only the server can write it.
function hasTeamWorkAccess(profile) {
  return !!profile && ROLES.includes(profile.role || 'colaborador')
    && (!profile.teamOnboarding || (profile.teamOnboarding.version === 1
      && profile.teamOnboarding.status === 'ready' && !!profile.teamOnboarding.providerId));
}
module.exports = { hasTeamWorkAccess };
