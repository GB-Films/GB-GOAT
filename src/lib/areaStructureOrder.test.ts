import assert from 'node:assert/strict';
import test from 'node:test';
import { moveNamedSubcategory, reorderDisplayedCategories } from './areaStructureOrder';

test('reordering visible areas preserves positions of hidden categories', () => {
  assert.deepEqual(
    reorderDisplayedCategories(['Arte', 'Post', 'Rodaje'], ['Arte', 'Rodaje'], 1, 0),
    ['Rodaje', 'Post', 'Arte'],
  );
});

test('the general Subcategoria row stays first while named rows are reordered', () => {
  assert.deepEqual(
    moveNamedSubcategory(['Vestuario', 'Utilería'], ['Vestuario', 'Utilería'], 2, 1, true, true, true),
    { subcategory: 'Utilería', source: ['Utilería', 'Vestuario'], target: ['Utilería', 'Vestuario'] },
  );
  assert.equal(moveNamedSubcategory(['Vestuario'], ['Vestuario'], 0, 1, true, true, true), null);
});

test('moving a named row across areas accounts for the general row in the destination', () => {
  assert.deepEqual(
    moveNamedSubcategory(['Vestuario'], ['Catering'], 0, 1, false, true, false),
    { subcategory: 'Vestuario', source: [], target: ['Vestuario', 'Catering'] },
  );
});
