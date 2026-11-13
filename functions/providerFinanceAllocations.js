const list = value => Array.isArray(value) ? value : [];
const allocationKey = row => `${row?.projectId}/${row?.collectionName}/${row?.itemId}`;
// Originals retain their historical applications. Deleted rows stop being live
// targets for payments, downloads, cancellation and project document counts.
function activeRecordAllocations(record) {
  const detached = new Set(list(record?.detachedExpenseKeys));
  return list(record?.allocations).filter(row => !detached.has(allocationKey(row)));
}
module.exports = { allocationKey, activeRecordAllocations };
