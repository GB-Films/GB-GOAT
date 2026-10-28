const test = require('node:test');
const assert = require('node:assert/strict');
const { contractFields } = require('./providerProjectContracts');
const field = { id: 'field', signerEmail: 'person@example.test', page: 1, x: .2, y: .3, w: .32, h: .11 };
test('contract fields must cover the assigned people exactly and fit the PDF page', () => {
  assert.deepEqual(contractFields([field], [field.signerEmail], 2), [field]);
  for (const changed of [null, { ...field, page: 3 }, { ...field, x: .9 }, { ...field, x: NaN }, { ...field, signerEmail: 'other@example.test' }, { ...field, w: .01 }]) {
    assert.throws(() => contractFields([changed], [field.signerEmail], 2));
  }
  assert.throws(() => contractFields([], [field.signerEmail], 1));
  const other = { ...field, id: 'other', signerEmail: 'two@example.test' };
  assert.throws(() => contractFields([field, other], [field.signerEmail, other.signerEmail], 2), /superponerse/);
  assert.throws(() => contractFields([field, { ...other, id: field.id, page: 2 }], [field.signerEmail, other.signerEmail], 2), /identificadores/);
});
