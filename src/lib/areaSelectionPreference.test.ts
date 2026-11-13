import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAreaSelection, revealMovedExpenseArea } from './areaSelectionPreference';
import { createProjectWorkingViewMemory } from './projectWorkingViewMemory';
import { applyAreaLocations, optimisticAreaExpenseMove } from './areaStructureLive';

test('without a working selection all accessible areas are visible', () => {
  assert.deepEqual(resolveAreaSelection(['Campo','Post'], null), ['Campo','Post']);
});
test('cleared selection stays cleared and does not turn back into all areas', () => {
  assert.deepEqual(resolveAreaSelection(['Campo','Post'], []), []);
});
test('restored selection respects current permissions, category order and removed categories', () => {
  assert.deepEqual(resolveAreaSelection(['Campo','Post'], ['Post','Campo','Privada']), ['Campo','Post']);
  assert.deepEqual(resolveAreaSelection(['Campo','Post'], ['Privada','Post']), ['Post']);
  assert.deepEqual(resolveAreaSelection(['Campo','Post'], ['Eliminada']), ['Campo','Post']);
  assert.deepEqual(resolveAreaSelection([], ['Privada']), []);
});

test('an expense move works in a fresh working view and reveals a previously filtered destination', () => {
  for (const initial of [null, [], ['Arte']] as (string[] | null)[]) {
    const memory = createProjectWorkingViewMemory(), selection = memory.entry<string[] | null>('editor', 'project', 'areas.selection', initial);
    const rows = [{ id: 'paid', area: 'Arte', subcategory: 'Vestuario', order: 0, paymentHistory: [{ amount: 100 }] }];
    const moved = applyAreaLocations(rows, optimisticAreaExpenseMove(rows, { kind: 'expense', itemId: 'paid', fromArea: 'Arte', fromSubcategory: 'Vestuario', targetArea: 'Campo', targetSubcategory: 'Comidas' }));
    selection.set(current => revealMovedExpenseArea(current, 'Campo'));
    assert(resolveAreaSelection(['Arte', 'Campo'], selection.getSnapshot()).includes(moved[0].area));
    assert.strictEqual(moved[0].paymentHistory, rows[0].paymentHistory);
    if (initial === null) assert.equal(selection.getSnapshot(), null, 'show-all default stays show-all');
    else assert.equal(selection.getSnapshot()!.filter(area => area === 'Campo').length, 1);
    const previous = selection.getSnapshot(); selection.set(current => revealMovedExpenseArea(current, 'Campo'));
    assert.strictEqual(selection.getSnapshot(), previous, 'a repeated reveal cannot duplicate the target');
  }
});
