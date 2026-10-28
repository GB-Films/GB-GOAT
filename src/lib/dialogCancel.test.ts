import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDialogCancel } from './dialogCancel';
test('cancelling the file picker stops propagation and leaves both dialogs open', () => {
  let closed = 0, prevented = 0, stopped = 0;
  handleDialogCancel({ target: {}, currentTarget: {}, stopPropagation: () => stopped++, preventDefault: () => prevented++ }, () => closed++);
  assert.equal(closed, 0); assert.equal(stopped, 1); assert.equal(prevented, 0);
});
test('Escape closes only the targeted dialog and prevents the browser default close', () => {
  let closed = 0, prevented = 0, stopped = 0;
  const dialog = {};
  handleDialogCancel({ target: dialog, currentTarget: dialog, stopPropagation: () => stopped++, preventDefault: () => prevented++ }, () => closed++);
  assert.equal(closed, 1); assert.equal(stopped, 1); assert.equal(prevented, 1);
});
