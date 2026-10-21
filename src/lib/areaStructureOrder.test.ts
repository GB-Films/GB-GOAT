import assert from 'node:assert/strict';
import test from 'node:test';
import { moveAreaSubcategory, reorderDisplayedCategories } from './areaStructureOrder';

test('reordering visible areas preserves positions of hidden categories', () => {
  assert.deepEqual(
    reorderDisplayedCategories(['Arte', 'Post', 'Rodaje'], ['Arte', 'Rodaje'], 1, 0),
    ['Rodaje', 'Post', 'Arte'],
  );
});

test('the general Subcategoria row can move among named rows', () => {
  assert.deepEqual(
    moveAreaSubcategory(['', 'Vestuario', 'Utilería'], ['', 'Vestuario', 'Utilería'], 0, 2, true),
    { subcategory: '', source: ['Vestuario', 'Utilería', ''], target: ['Vestuario', 'Utilería', ''] },
  );
});

test('moving rows across areas keeps their requested position and rejects duplicate defaults', () => {
  assert.deepEqual(
    moveAreaSubcategory(['Vestuario'], ['', 'Catering'], 0, 1, false),
    { subcategory: 'Vestuario', source: [], target: ['', 'Vestuario', 'Catering'] },
  );
  assert.equal(moveAreaSubcategory(['', 'Vestuario'], ['', 'Catering'], 0, 1, false), null);
});
