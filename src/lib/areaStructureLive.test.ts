import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAreaLocations, compareManualAreaExpenses, liveAreaProjectPatch, optimisticAreaExpenseMove, reconcileAreaExpenseSnapshot } from './areaStructureLive';

const rows: Array<{ id: string; area: string; subcategory: string; order: number; areaStructureRevision?: number; total?: number;
  paymentHistory?: { id: string; amount: number }[]; invoice?: { path: string } }> = [
  { id: 'paid', area: 'Arte', subcategory: 'Vestuario', order: 0, total: 100, paymentHistory: [{ id: 'payment', amount: 100 }], invoice: { path: 'original.pdf' } },
  { id: 'second', area: 'Arte', subcategory: 'Vestuario', order: 1 },
  { id: 'target', area: 'Campo', subcategory: 'Comidas', order: 0 },
];
const move = { kind: 'expense' as const, itemId: 'paid', fromArea: 'Arte', fromSubcategory: 'Vestuario', targetArea: 'Campo', targetSubcategory: 'Comidas', beforeExpenseId: 'target' };

test('dropping a paid row shows its new group and position immediately without touching its financial data', () => {
  const visible = applyAreaLocations(rows, optimisticAreaExpenseMove(rows, move));
  const paid = visible.find(row => row.id === 'paid')!;
  assert.equal(paid.area, 'Campo'); assert.equal(paid.order, 0);
  assert.equal(visible.find(row => row.id === 'target')!.order, 1);
  assert.equal(visible.find(row => row.id === 'second')!.order, 0);
  assert.strictEqual(paid.paymentHistory, rows[0].paymentHistory); assert.strictEqual(paid.invoice, rows[0].invoice);
  assert.equal(rows[0].area, 'Arte', 'the pending projection can be discarded on a rejected move');
  const edited = rows.map(row => row.id === 'paid' ? { ...row, paymentHistory: [{ id: 'new-payment', amount: 200 }] } : row);
  assert.equal(applyAreaLocations(edited, optimisticAreaExpenseMove(rows, move))[0].paymentHistory![0].id, 'new-payment');
});

test('reordering within a group, across subcategories, and to the default group never duplicates a row', () => {
  for (const destination of [
    { targetArea: 'Arte', targetSubcategory: 'Vestuario' },
    { targetArea: 'Arte', targetSubcategory: 'Utilería' },
    { targetArea: 'Campo', targetSubcategory: 'Sin subcategoria' },
  ]) {
    const result = applyAreaLocations(rows, optimisticAreaExpenseMove(rows, { ...move, ...destination, beforeExpenseId: undefined }));
    assert.equal(result.length, rows.length); assert.equal(new Set(result.map(row => row.id)).size, rows.length);
    assert.equal(result[0].area, destination.targetArea);
    assert.equal(result[0].subcategory, destination.targetSubcategory === 'Sin subcategoria' ? '' : destination.targetSubcategory);
  }
  const reordered = applyAreaLocations(rows, optimisticAreaExpenseMove(rows, { ...move, targetArea: 'Arte', targetSubcategory: 'Vestuario', beforeExpenseId: undefined }));
  assert.deepEqual(reordered.filter(row => row.area === 'Arte').sort(compareManualAreaExpenses).map(row => row.id), ['second', 'paid']);
  assert.deepEqual(optimisticAreaExpenseMove(rows, { ...move, fromSubcategory: 'stale' }), []);
  assert.deepEqual(optimisticAreaExpenseMove(rows, { ...move, beforeExpenseId: 'deleted' }), []);
});

test('a delayed snapshot cannot undo an acknowledged move or erase concurrent financial changes', () => {
  const confirmed = applyAreaLocations(rows, [{ id: 'paid', after: { area: 'Campo', subcategory: 'Comidas', order: 2, areaStructureRevision: 3 } }]);
  const incoming = rows.map(row => ({ ...row, total: 150, paymentHistory: [{ id: 'concurrent', amount: 50 }], areaStructureRevision: 2 }));
  const merged = reconcileAreaExpenseSnapshot(confirmed, incoming);
  assert.equal(merged[0].area, 'Campo'); assert.equal(merged[0].areaStructureRevision, 3);
  assert.equal(merged[0].paymentHistory![0].id, 'concurrent'); assert.equal(merged[0].total, 150);
  const next = incoming.map(row => ({ ...row, area: 'Post', areaStructureRevision: 4 }));
  assert.equal(reconcileAreaExpenseSnapshot(merged, next)[0].area, 'Post');
  assert.equal(reconcileAreaExpenseSnapshot(merged, []).length, 0, 'server deletions do not resurrect acknowledged rows');
});

test('manual tie breaks agree with server timestamps and IDs; live structure never hydrates private commercial fields', () => {
  const tied = [{ id: 'b', order: 0, createdAt: { seconds: 2 } }, { id: 'a', order: 0, createdAt: { toMillis: () => 2000 } }, { id: 'c', order: 0, createdAt: '1970-01-01T00:00:01Z' }];
  assert.deepEqual(tied.sort(compareManualAreaExpenses).map(row => row.id), ['c', 'a', 'b']);
  const patch = liveAreaProjectPatch({ budgetRevision: 3, activeAreas: ['Arte'], budgetTotal: 999999, budgetItems: ['private'], createdBy: 'foreign', collaboratorEmails: ['foreign'] });
  assert.equal(patch.budgetRevision, 3); assert.deepEqual(patch.activeAreas, ['Arte']);
  for (const key of ['budgetTotal', 'budgetItems', 'createdBy', 'collaboratorEmails']) assert.equal(Object.hasOwn(patch, key), false);
  assert.equal(patch.categories, undefined, 'legacy category defaults are preserved');
});
