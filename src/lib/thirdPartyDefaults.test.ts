import test from 'node:test';
import assert from 'node:assert/strict';
import { thirdPartyFormDefaults } from './thirdPartyDefaults';
test('recupera al emisor y su cuenta sin autorizar trabajos nuevos ni confirmar responsabilidad', () => {
  const state = thirdPartyFormDefaults({ thirdPartyDefaults: { name: 'Emisor', cuit: '20111111112', alias: 'emisor.cuenta' }, thirdPartyIntake: { party: { name: 'Anterior' }, workKeys: ['viejo'] } });
  assert.equal(state.name, 'Emisor'); assert.equal(state.account, 'emisor.cuenta');
  assert.deepEqual(state.workKeys, []); assert.equal(state.responsibilityConfirmed, false);
  assert.equal(thirdPartyFormDefaults(null).name, '');
});
