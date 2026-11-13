import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DragDropContext } from '@hello-pangea/dnd';
import { ExpenseGroupDropTarget } from '../pages/project-detail/ExpenseGroupDropTarget';
import { areaExpenseGroupDroppableId, areaExpenseAreaDroppableId, parseAreaExpenseDroppableId } from './areaExpenseDropTargets';
import { runAreaStructureChange, areaStructureErrorMessage, areaGroupBudgetVersion, type AreaStructureAttempt } from './areaStructureChanges';

test('a collapsed subcategory remains an append target across areas with encoded names', () => {
  const id = areaExpenseGroupDroppableId('Post / diseño', 'Animación | 2D', true);
  assert.deepEqual(parseAreaExpenseDroppableId(id), { area: 'Post / diseño', subcategory: 'Animación | 2D', appendOnly: true });
  assert.deepEqual(parseAreaExpenseDroppableId(areaExpenseGroupDroppableId('Arte', 'Sin subcategoria')), { area: 'Arte', subcategory: '', appendOnly: false });
  assert.deepEqual(parseAreaExpenseDroppableId(areaExpenseAreaDroppableId('Arte')), { area: 'Arte', subcategory: '', appendOnly: true });
  assert.equal(parseAreaExpenseDroppableId('area-expense-group|%bad|x'), null);
  const render = (collapsed: boolean) => renderToStaticMarkup(createElement(DragDropContext, { onDragEnd() {} },
    createElement(ExpenseGroupDropTarget, { collapsed, disabled: false, droppableId: id, children: createElement('button', null, 'Subcategoría destino') })));
  assert.match(render(true), /data-rfd-droppable-id=/);
  assert.match(render(true), /append/);
  assert.doesNotMatch(render(false), /data-rfd-droppable-id=/, 'expanded lists own their drop target without a duplicate header ID');
});

test('an acknowledged write with a failed refresh reuses the same operation instead of undoing or moving again', async () => {
  const attempts = new Map<string, AreaStructureAttempt>(), sent: Record<string, unknown>[] = [];
  const input = { action: 'reclassifyAreaExpenses' as const, projectId: 'project', expectedRevision: 0, kind: 'expense' as const,
    itemId: 'paid', fromArea: 'Arte', fromSubcategory: 'Vestuario', targetArea: 'Campo', targetSubcategory: 'Comidas' };
  let warned = 0;
  const call = async (value: Record<string, unknown>) => { sent.push(value); };
  await runAreaStructureChange({ input, attempts, call, refresh: async () => { throw Error('offline'); }, onRefreshError: () => warned++, newId: () => 'stable-attempt' });
  assert.equal(warned, 1); assert.equal(attempts.size, 1);
  await runAreaStructureChange({ input: { ...input, expectedRevision: 1 }, attempts, call, refresh: async () => {}, onRefreshError: () => warned++, newId: () => 'must-not-be-used' });
  assert.equal(sent[0].operationId, 'stable-attempt'); assert.equal(sent[1].operationId, 'stable-attempt'); assert.equal(attempts.size, 0);
  assert.equal(sent[1].expectedRevision, 0, 'live project updates must not change an uncertain committed attempt');
  assert.doesNotMatch(JSON.stringify(sent), /paymentHistory|total|providerId|cashAccount/);
});

test('domain failures stay actionable and never expose the old EXPENSE_CHANGED placeholder', () => {
  assert.equal(areaStructureErrorMessage({ code: 'functions/failed-precondition', message: 'El gasto cambió de ubicación. Actualizá la página.' }), 'El gasto cambió de ubicación. Actualizá la página.');
  assert.doesNotMatch(areaStructureErrorMessage(Error('EXPENSE_CHANGED')), /EXPENSE_CHANGED/);
});

test('a committed location applies without waiting for catalog reloads and the next drag gets a fresh operation', async () => {
  const attempts = new Map<string, AreaStructureAttempt>(), sent: Record<string, unknown>[] = [];
  let applied = 0, refreshed = 0, sequence = 0;
  const input = { action: 'reclassifyAreaExpenses' as const, projectId: 'project', expectedRevision: 0, kind: 'expense' as const,
    itemId: 'paid', fromArea: 'Arte', fromSubcategory: 'Vestuario', targetArea: 'Campo', targetSubcategory: 'Comidas' };
  const ack = { view: { project: { budgetRevision: 1 }, expenses: [] } };
  const run = () => runAreaStructureChange({ input, attempts, call: async value => { sent.push(value); return ack; },
    applyCommitted: result => { assert.strictEqual(result, ack); applied++; return true; }, refresh: async () => { refreshed++; },
    onRefreshError: () => assert.fail('no refresh is necessary'), newId: () => `operation-${++sequence}` });
  await run(); await run();
  assert.equal(applied, 2); assert.equal(refreshed, 0); assert.equal(attempts.size, 0);
  assert.notEqual(sent[0].operationId, sent[1].operationId);
});

test('a failed state application after an acknowledged write recovers without falsely reporting a failed move', async () => {
  let refreshed = false;
  await runAreaStructureChange({ input: { action: 'reclassifyAreaExpenses', projectId: 'project', expectedRevision: 0, kind: 'expense',
    fromArea: 'Arte', fromSubcategory: '', targetArea: 'Campo', targetSubcategory: '' }, attempts: new Map(), call: async () => ({}),
    applyCommitted: () => { throw Error('render failure'); }, refresh: async () => { refreshed = true; }, onRefreshError: () => assert.fail(), newId: () => 'attempt' });
  assert.equal(refreshed, true);
});

test('the opened budget version ignores timestamps while detecting changed assignments and notes', () => {
  assert.equal(areaGroupBudgetVersion(undefined), 'null');
  assert.equal(areaGroupBudgetVersion(300), areaGroupBudgetVersion({ budget: 300, updatedAt: 'later' }));
  assert.notEqual(areaGroupBudgetVersion(300), areaGroupBudgetVersion({ budget: 300, budgetAssigned: false }));
  assert.notEqual(areaGroupBudgetVersion(300), areaGroupBudgetVersion({ budget: 300, notes: 'Changed by another editor' }));
});
