import { normalizeEmail } from './identity';

export const DEFAULT_CASH_RETURN_RECIPIENT = 'tomas@granberta.com';

export function resolveCashReturnRecipientEmail(
  recipients: ReadonlyArray<{ email?: string | null }>,
  manualChoice = '',
): string {
  const chosen = normalizeEmail(manualChoice);
  const manualRecipient = chosen
    ? recipients.find(recipient => normalizeEmail(recipient.email) === chosen)
    : undefined;
  if (manualRecipient?.email) return manualRecipient.email;
  return recipients.find(recipient => normalizeEmail(recipient.email) === DEFAULT_CASH_RETURN_RECIPIENT)?.email || '';
}
