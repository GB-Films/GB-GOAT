import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAreaSelection } from './areaSelectionPreference';

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
