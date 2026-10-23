import assert from 'node:assert/strict';
import test from 'node:test';
import { collapseAroundDraggedRow } from './dragPointerAnchor';

for (const removedBefore of [0, 240, 900]) {
  test(`freezes height before collapse and reserves ${removedBefore}px without scrolling`, () => {
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    let collapsed = false;
    const list = { style: { minHeight: '' }, getBoundingClientRect: () => ({ height: 1800 }) };
    const source = {
      dataset: { structureDragId: 'area-subcategory|field|named|Honorarios' },
      closest: () => list,
      isConnected: true,
      getBoundingClientRect: () => ({ top: 226 - (collapsed ? removedBefore : 0) }),
    };
    Object.defineProperty(globalThis, 'document', {
      configurable: true, value: { querySelectorAll: () => [source] },
    });
    try {
      const layout = collapseAroundDraggedRow(source.dataset.structureDragId, () => {
        assert.equal(list.style.minHeight, '1800px', 'must prevent scroll clamping before changing the DOM');
        collapsed = true;
      });
      assert.deepEqual(layout, { minHeight: 1800, paddingTop: removedBefore });
      assert.equal(source.getBoundingClientRect().top + layout!.paddingTop, 226);
    } finally {
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
      else Reflect.deleteProperty(globalThis, 'document');
    }
  });
}
