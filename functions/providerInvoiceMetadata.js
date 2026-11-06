function distinctInvoiceExpenseCount(allocations) {
  if (!Array.isArray(allocations) || !allocations.length) return null;
  const valid = value => typeof value === 'string' && /^[\w-]{1,160}$/.test(value);
  if (allocations.some(row => !valid(row?.projectId) || !['areaExpenses', 'budgetItems'].includes(row.collectionName) || !valid(row.itemId))) return null;
  return new Set(allocations.map(row => `${row.projectId}/${row.collectionName}/${row.itemId}`)).size;
}
module.exports = { distinctInvoiceExpenseCount };
