import { test } from 'node:test';
import assert from 'node:assert/strict';
// Browser-independent form invariant is also enforced independently on the server.
import { validateSharedAllocations } from './sharedAllocations';
test('distribution checks cents, partial values and exact total', () => {
  assert.equal(validateSharedAllocations([{ amount: 300000 }, { amount: 450000 }, { amount: 450000 }], 1200000), true);
  assert.equal(validateSharedAllocations([{ amount: 0.1 }, { amount: 0.2 }], 0.3), true);
  assert.equal(validateSharedAllocations([{ amount: 300 }], 301), false);
  assert.equal(validateSharedAllocations([{ amount: -1 }, { amount: 2 }], 1), false);
  assert.equal(validateSharedAllocations([], 0), false);
});
