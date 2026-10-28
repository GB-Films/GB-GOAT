const test = require('node:test'), assert = require('node:assert/strict');
const { ownAccountProfileChanges } = require('./providerPortalModel');
test('la cuenta propia requiere confirmación y su titular se deriva de la identidad del proveedor', () => {
 const provider = { type: 'persona', name: 'Persona', lastName: 'Ejemplo', bankAccount_alias: 'old.alias' };
 assert.throws(() => ownAccountProfileChanges(provider, { bankAccount_alias: 'new.alias' }, false));
 const changes = ownAccountProfileChanges(provider, { bankAccount_alias: 'new.alias' }, true);
 assert.equal(changes.bankAccount_holder.after, 'Persona Ejemplo');
 assert.equal(changes.bankAccount_holder.critical, true);
 assert.throws(() => ownAccountProfileChanges(provider, { bankAccount_holder: 'Otra persona' }, true));
 assert.equal(ownAccountProfileChanges({ type: 'empresa', businessName: 'Empresa SRL', bankAccount_alias: 'old.alias' }, { bankAccount_alias: 'new.alias' }, true).bankAccount_holder.after, 'Empresa SRL');
 assert.equal(ownAccountProfileChanges(provider, { address: 'Nuevo domicilio' }, false).address.after, 'Nuevo domicilio');
});
