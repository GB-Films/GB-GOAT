import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCashReturnRecipientEmail } from './cashReturnRecipient';

const other = { email: 'other@example.test' };
const tomas = { email: 'tomas@granberta.com' };

test('a partial user list does not silently select another administrator before the default loads', () => {
  assert.equal(resolveCashReturnRecipientEmail([]), '');
  assert.equal(resolveCashReturnRecipientEmail([other]), '');
  assert.equal(resolveCashReturnRecipientEmail([other, tomas]), tomas.email);
});

test('a deliberate alternative is preserved when the default arrives or recipients reorder', () => {
  assert.equal(resolveCashReturnRecipientEmail([other], other.email), other.email);
  assert.equal(resolveCashReturnRecipientEmail([tomas, other], other.email), other.email);
});

test('a removed choice falls back only to the eligible default, otherwise requires selection', () => {
  assert.equal(resolveCashReturnRecipientEmail([tomas], other.email), tomas.email);
  assert.equal(resolveCashReturnRecipientEmail([other], 'removed@example.test'), '');
});

test('the default and explicit choice compare normalized emails and reset after a return', () => {
  assert.equal(resolveCashReturnRecipientEmail([{ email: 'Tomas@GranBerta.com' }]), 'Tomas@GranBerta.com');
  assert.equal(resolveCashReturnRecipientEmail([other, tomas], ' OTHER@EXAMPLE.TEST '), other.email);
  assert.equal(resolveCashReturnRecipientEmail([other, tomas], ''), tomas.email);
});
