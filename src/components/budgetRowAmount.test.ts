import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { MemoryRouter } from 'react-router-dom';

test('desktop area edits send numeric prices and quantities to the save handler', async () => {
  const dom = new JSDOM('<div id="app"></div>');
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { BudgetRowCell } = await import('../pages/project-detail/BudgetRowCell');
  const root = createRoot(dom.window.document.getElementById('app')!);
  const item = { id: 'gasto-ficticio', unitPrice: 80, quantity: 2, total: 160 };
  const writes: Array<{ id: string; updates: Record<string, unknown> }> = [];
  const onUpdate = async (id: string, updates: Record<string, unknown>) => { writes.push({ id, updates }); };

  try {
    await act(async () => root.render(createElement(MemoryRouter, null,
      createElement(BudgetRowCell, { item, collectionName: 'areaExpenses', type: 'price', onUpdate }),
      createElement(BudgetRowCell, { item, collectionName: 'areaExpenses', type: 'quantity', onUpdate }),
    )));
    const [price, quantity] = [...dom.window.document.querySelectorAll<HTMLInputElement>('input[type=number]')];
    assert.ok(price && quantity);
    const finish = async (input: HTMLInputElement, value: string) => {
      await act(async () => {
        input.value = value;
        input.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }));
      });
    };
    await finish(price, '425.5');
    await finish(quantity, '3');
    assert.deepEqual(writes, [
      { id: item.id, updates: { unitPrice: 425.5, total: 851 } },
      { id: item.id, updates: { quantity: 3, total: 240 } },
    ]);
    await finish(quantity, '');
    assert.equal(quantity.value, '2', 'clearing an input restores the saved value');
    assert.equal(writes.length, 2, 'clearing an input does not save a zero amount');
    await finish(price, '0');
    assert.deepEqual(writes.at(-1), { id: item.id, updates: { unitPrice: 0, total: 0 } });
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
