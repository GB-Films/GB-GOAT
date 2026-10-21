export const moneyCents = (value: unknown) => Math.round((Number(value) || 0) * 100);
export function validateSharedAllocations(allocations: Array<{ amount: number }>, expected: number) {
  return allocations.length > 0 && allocations.length <= 30 && expected > 0
    && Number.isFinite(expected) && allocations.every(row => Number.isFinite(row.amount) && moneyCents(row.amount) > 0)
    && allocations.reduce((sum, row) => sum + moneyCents(row.amount), 0) === moneyCents(expected);
}
