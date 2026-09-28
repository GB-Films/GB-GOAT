import { hasRecordedPayment } from './expenseEdits';

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

export type ProviderInviteTargetIssue =
  | 'TARGET_EXPENSE_NOT_FOUND'
  | 'TARGET_EXPENSE_ALREADY_ASSIGNED'
  | 'TARGET_EXPENSE_HAS_PAYMENTS';

type ProviderInviteTargetSnapshot = {
  exists?: boolean;
  providerId?: unknown;
  providerName?: unknown;
  paymentLocked?: unknown;
  paid?: unknown;
  paymentHistory?: unknown;
} | null | undefined;

// Explica por qué el gasto de un link de alta ya no puede recibir al proveedor.
// Es el mismo criterio que aplican las reglas de Firestore al asignar.
export const getProviderInviteTargetIssue = (
  target: ProviderInviteTargetSnapshot,
): ProviderInviteTargetIssue | null => {
  if (!target || target.exists === false) return 'TARGET_EXPENSE_NOT_FOUND';
  if (String(target.providerId || '').trim() || String(target.providerName || '').trim()) {
    return 'TARGET_EXPENSE_ALREADY_ASSIGNED';
  }
  if (hasRecordedPayment(target as Parameters<typeof hasRecordedPayment>[0])) {
    return 'TARGET_EXPENSE_HAS_PAYMENTS';
  }
  return null;
};
