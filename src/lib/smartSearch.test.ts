import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesSmartSearch } from './smartSearch';

test('search ignores accents, case, punctuation and token order', () => {
  assert.ok(matchesSmartSearch('ia real 0554', 'G GB 0554', 'Real o IA'));
  assert.ok(matchesSmartSearch('ggb0554', 'G GB 0554 · Real o IA'));
  assert.ok(matchesSmartSearch('perez jose', 'José Luis Pérez'));
  assert.ok(matchesSmartSearch('produ CAM', 'Producción de Campo'));
  assert.ok(matchesSmartSearch('20301234567', '20-30123456-7'));
  assert.ok(matchesSmartSearch('jose equipo', 'José Pérez', 'jose@equipo.com'));
  assert.ok(matchesSmartSearch('  ', 'cualquiera'));
  assert.equal(matchesSmartSearch('0555 real', 'G GB 0554 Real o IA'), false);
  assert.equal(matchesSmartSearch('otra persona', 'José Pérez'), false);
});
