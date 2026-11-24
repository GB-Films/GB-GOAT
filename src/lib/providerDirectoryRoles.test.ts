import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasGlobalRole, providerDirectoryAccess, PROVIDER_CREATE_ROLES } from './roles';

test('the general Providers menu and route use the Equipo role and expose profile administration only to its operators', () => {
  assert.equal(providerDirectoryAccess('jefe_produccion'), 'view');
  assert.equal(hasGlobalRole('jefe_produccion', PROVIDER_CREATE_ROLES), false);
  assert.equal(providerDirectoryAccess('colaborador'), null);
  assert.equal(providerDirectoryAccess('portal'), null);
  assert.equal(providerDirectoryAccess(undefined), null);
  assert.equal(providerDirectoryAccess('admin'), 'manage');
  assert.equal(providerDirectoryAccess('ayudante_admin'), 'manage');
});
