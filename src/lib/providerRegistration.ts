// A manually entered/imported supplier is provisional until its own registration.
// Bank data alone, a name, and an administrative email do not prove an intake.
export function hasProviderRegistration(provider: any): boolean {
  return Boolean(provider?.personalGoogleAccount?.uid || provider?.registration?.status === 'complete'
    || ['provider_invite', 'team_onboarding'].includes(provider?.source));
}

export type RegistrationEvidence = {
  status: 'loading' | 'ready' | 'error';
  registeredIds: ReadonlySet<string>;
};

export function expenseRegistrationState(item: any, providers: any[], evidence?: RegistrationEvidence): 'unassigned' | 'registered' | 'provisional' | 'loading' | 'error' {
  if (!item?.providerId && !item?.providerName) return 'unassigned';
  const provider = providers.find(row => row.id === item.providerId);
  if (hasProviderRegistration(provider) || evidence?.registeredIds.has(item.providerId)) return 'registered';
  if (evidence && evidence.status !== 'ready') return evidence.status;
  return 'provisional';
}

export function expenseNeedsProviderRegistration(item: any, providers: any[], evidence?: RegistrationEvidence): boolean {
  return expenseRegistrationState(item, providers, evidence) === 'provisional';
}
