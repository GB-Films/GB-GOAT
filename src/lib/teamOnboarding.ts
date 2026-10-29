export const needsTeamOnboarding = (profile: any) => !!profile?.teamOnboarding
  && !(profile.teamOnboarding.version === 1 && profile.teamOnboarding.status === 'ready'
    && typeof profile.teamOnboarding.providerId === 'string' && profile.teamOnboarding.providerId.length > 0);
export const isTeamUserAssignable = (profile: any) => !needsTeamOnboarding(profile);
export function teamReturnPath(path: unknown) {
  return typeof path === 'string' && /^\/proyectos(?:\/[^?#]*)?$/.test(path) ? path : '/proyectos';
}
