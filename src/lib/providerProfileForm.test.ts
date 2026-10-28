import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingProfileFields, proposedProfileValue } from './providerProfileForm';
test('los datos firmados pendientes permanecen visibles sin cambiar los datos aprobados', () => {
  const provider = { dni: '', name: 'Persona', bankAccount_cbu: '' };
  const declaration = (id: string, signedAt: string, after: string) => ({ id, kind: 'profile', owned: true, status: 'pending_review', signedAt, content: { changes: { dni: { critical: true, after } } } });
  const pending = pendingProfileFields([declaration('latest','2026-10-28T15:00:00Z','12345678'), declaration('older','2026-10-28T14:00:00Z','23456789'), { ...declaration('unowned','2026-10-28T16:00:00Z','99999999'), owned: false }]);
  assert.equal(proposedProfileValue('dni', {}, provider, pending), '12345678');
  assert.equal(proposedProfileValue('dni', { dni: '' }, provider, pending), '');
  assert.equal(provider.dni, '');
  assert.equal(pendingProfileFields([{ ...declaration('not-signed','','11111111'), status: 'pending_signature' }]).dni, undefined);
});
