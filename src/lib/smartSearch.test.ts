import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesSmartSearch } from './smartSearch';
import { providerMatchesLegacyReference, providerMatchesSearch, providerSearchText } from './providerConstants';
import { normalizeSearchText } from './identity';

test('search ignores accents, case, punctuation and token order', () => {
  assert.ok(matchesSmartSearch('ia real 0554', 'G GB 0554', 'Real o IA'));
  assert.ok(matchesSmartSearch('ggb0554', 'G GB 0554 · Real o IA'));
  assert.ok(matchesSmartSearch('perez jose', 'José Luis Pérez'));
  assert.ok(matchesSmartSearch('Íris', 'Iris'));
  assert.ok(matchesSmartSearch('produ CAM', 'Producción de Campo'));
  assert.ok(matchesSmartSearch('20301234567', '20-30123456-7'));
  assert.ok(matchesSmartSearch('jose equipo', 'José Pérez', 'jose@equipo.com'));
  assert.ok(matchesSmartSearch('  ', 'cualquiera'));
  assert.equal(matchesSmartSearch('0555 real', 'G GB 0554 Real o IA'), false);
  assert.equal(matchesSmartSearch('otra persona', 'José Pérez'), false);
});

test('provider listing and picker match accents on either side of the search', () => {
  const provider = { name: 'Inés', lastName: 'Díaz', nickname: 'Iris', cuit: '20-12345678-3' };
  for (const query of ['INES DIAZ', 'INÉS DÍAZ', 'Ine\u0301s Di\u0301az']) {
    assert.ok(providerSearchText(provider).includes(normalizeSearchText(query)));
    assert.ok(providerMatchesSearch(provider, query));
  }
  assert.ok(providerMatchesSearch(provider, 'ÍRIS'));
  assert.ok(providerMatchesSearch(provider, '20-12345678-3'));
  assert.equal(providerMatchesSearch(provider, 'INES MORA'), false);
  assert.ok(providerMatchesLegacyReference(provider, 'INÉS DÍAZ'));
  assert.equal(providerMatchesLegacyReference(provider, 'INES DIAZ'), false);
});
