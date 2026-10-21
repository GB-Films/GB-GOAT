import assert from 'node:assert/strict';
import test from 'node:test';
import { collapseAroundDraggedRow } from './dragPointerAnchor';

const runCollapse = (windowScroll: number, removedHeight: number, parentScroll?: number, draggableId = 'area-category|second') => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let pageScroll = windowScroll;
  let nestedScroll = parentScroll ?? 0;
  let collapsed = false;
  let anchorGap = 0;
  const parent = parentScroll === undefined ? null : {
    parentElement: null,
    scrollHeight: 1000,
    clientHeight: 300,
    get scrollTop() { return nestedScroll; },
    set scrollTop(value: number) { nestedScroll = Math.max(0, value); },
  };
  const source = {
    dataset: { structureDragId: draggableId },
    parentElement: parent,
    isConnected: true,
    getBoundingClientRect: () => ({
      top: 600 - (collapsed ? removedHeight : 0)
        + windowScroll - pageScroll
        + (parentScroll ?? 0) - nestedScroll
        + anchorGap,
    }),
  };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { querySelectorAll: () => [source] },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      getComputedStyle: () => ({ overflowY: 'auto' }),
      scrollBy: ({ top }: { top: number }) => { pageScroll = Math.max(0, pageScroll + top); },
    },
  });
  try {
    const gap = collapseAroundDraggedRow(draggableId, () => { collapsed = true; });
    anchorGap = gap;
    return { gap, finalTop: source.getBoundingClientRect().top, pageScroll, nestedScroll };
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
};

test('retains the row under the pointer when the page is already at the top', () => {
  assert.deepEqual(runCollapse(0, 300), { gap: 300, finalTop: 600, pageScroll: 0, nestedScroll: 0 });
});

test('uses available page scroll before adding a spacer', () => {
  assert.deepEqual(runCollapse(400, 300), { gap: 0, finalTop: 600, pageScroll: 100, nestedScroll: 0 });
});

test('uses nested scroll and reserves only the remainder', () => {
  assert.deepEqual(runCollapse(0, 300, 100), { gap: 200, finalTop: 600, pageScroll: 0, nestedScroll: 0 });
});

test('keeps a subcategory aligned when preceding expenses collapse', () => {
  assert.deepEqual(runCollapse(0, 240, undefined, 'area-subcategory|field|named|travel'), {
    gap: 240, finalTop: 600, pageScroll: 0, nestedScroll: 0,
  });
});
