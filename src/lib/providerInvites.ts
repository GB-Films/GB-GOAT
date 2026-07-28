export const MAX_LINKED_PROVIDER_INVITE_DAYS = 7;
export const PROVIDER_INVITE_CLOCK_SKEW_MARGIN_MS = 5 * 60 * 1000;

export const clampLinkedProviderInviteDays = (value: number) => (
  Math.max(1, Math.min(MAX_LINKED_PROVIDER_INVITE_DAYS, Math.floor(value) || MAX_LINKED_PROVIDER_INVITE_DAYS))
);

export const buildLinkedProviderInviteExpiration = (days: number, now = new Date()) => {
  const durationMs = clampLinkedProviderInviteDays(days) * 24 * 60 * 60 * 1000;

  // Firestore validates this client-generated timestamp against request.time.
  // Keep the maximum duration slightly below seven days so harmless clock skew
  // between the browser and Firebase does not turn a valid invite into a denial.
  return new Date(now.getTime() + durationMs - PROVIDER_INVITE_CLOCK_SKEW_MARGIN_MS);
};
