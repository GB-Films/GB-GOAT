import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { COMMERCIAL_FIELDS, splitProjectCommercial, mergeProjectCommercial } from './projectCommercialFields';
const backend = createRequire(import.meta.url)('../../functions/projectCommercial.js');

test('browser and trusted writers use the exact same private-field policy', () => {
  assert.deepEqual(COMMERCIAL_FIELDS, backend.COMMERCIAL_FIELDS);
  const source = { name: 'Ejemplo', projectCode: 'G EX 0001', createdBy: 'owner', budgetTotal: 100, clientName: 'Cliente', controlTotalContractAmount: 100, controlTotalUrl: 'https://example.com/private', crmSaleId: 'sale' };
  const split = splitProjectCommercial(source);
  assert.deepEqual(split, backend.splitProjectCommercial(source));
  assert.deepEqual(split.publicData, { name: 'Ejemplo', projectCode: 'G EX 0001', createdBy: 'owner' });
  assert.deepEqual(mergeProjectCommercial(split.publicData, { ...split.commercial, schemaVersion: 1, updatedAt: 'private-version' }), source);
  assert.equal(mergeProjectCommercial({ updatedAt: 'public-version', budgetTotal: 1 }, { budgetTotal: 2, updatedAt: 'private-version' }).updatedAt, 'public-version');
});
