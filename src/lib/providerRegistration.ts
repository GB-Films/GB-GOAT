// A manually entered/imported supplier is provisional until its own registration.
// Bank data alone, a name, and an administrative email do not prove an intake.
export function hasProviderRegistration(provider: any): boolean {
  return Boolean(provider?.personalGoogleAccount?.uid || provider?.registration?.status === 'complete'
    || ['provider_invite', 'team_onboarding'].includes(provider?.source));
}

export function expenseNeedsProviderRegistration(item: any, providers: any[]): boolean {
  if (!item?.providerId && !item?.providerName) return false;
  const provider = providers.find(row => row.id === item.providerId);
  return !hasProviderRegistration(provider);
}
