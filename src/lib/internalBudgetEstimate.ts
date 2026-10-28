// Deliberately limited to the canonical BANI provider and an explicit row classification.
// Existing rows and provider master records keep their current meaning.
export const BANI_PROVIDER_ID = 'MuwmMfDvOBC3tQkZLzvz';
export const isInternalBudgetEstimate = (row: any) => row?.providerId === BANI_PROVIDER_ID && row?.economicNature === 'internal_estimate';
export const effectiveBudgetEstimates = <T extends { area?: string; total?: number }>(items: T[]) => items.filter(item =>
  isInternalBudgetEstimate(item) || !items.some(other => other.area === item.area && isInternalBudgetEstimate(other)));
