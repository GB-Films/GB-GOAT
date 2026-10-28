import test from 'node:test';
import assert from 'node:assert/strict';
import { contractPreparationIssue, placeContractField } from './contractPreparation';

test('placing or moving a signature preserves one field for that signer, stays within the sheet and retains other people', () => {
  const first = placeContractField([], 'one@example.com', 1, .9, .95);
  assert.equal(first[0].x + first[0].w, 1); assert.equal(first[0].y + first[0].h, 1);
  const two = placeContractField(first, 'two@example.com', 2, .2, .5);
  const moved = placeContractField(two, 'one@example.com', 2, .1, .1);
  assert.equal(moved.length, 2); assert.equal(moved.find(field => field.signerEmail === 'one@example.com')!.id, first[0].id);
  assert.equal(moved.find(field => field.signerEmail === 'two@example.com')!.y, .5);
  assert.equal(contractPreparationIssue([{ providerId: '1', name: 'Uno', email: 'one@example.com' }, { providerId: '2', name: 'Dos', email: 'two@example.com' }], moved, 2), '');
});

test('requesting signatures requires every provider to have a separate, valid and non-overlapping field', () => {
  const signers = [{ providerId: '1', name: 'Uno', email: 'one@example.com' }, { providerId: '2', name: 'Dos', email: 'two@example.com' }];
  const one = placeContractField([], signers[0].email, 1, .2, .5);
  assert.match(contractPreparationIssue(signers, one, 2), /cada firmante/);
  const overlap = placeContractField(one, signers[1].email, 1, .2, .5);
  assert.match(contractPreparationIssue(signers, overlap, 2), /superpongan/);
  assert.match(contractPreparationIssue(signers, [{ ...one[0], page: 3 }, { ...overlap[1], y: .1 }], 2), /página/);
  assert.match(contractPreparationIssue([signers[0], { ...signers[1], email: signers[0].email }], overlap, 2), /cuenta distinta/);
});
