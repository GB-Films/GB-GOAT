import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasProviderRegistration, expenseNeedsProviderRegistration } from './providerRegistration';
test('only intake evidence completes registration; name, email, bank and legacy identity stay provisional', () => {
  for (const provider of [{}, {email:'contact@example.test', bankAccount_cbu:'123'}, {dni_cuit:'12.345.678'}, {source:'manual'}, {source:'import'}]) assert.equal(hasProviderRegistration(provider), false);
  for (const provider of [{source:'provider_invite'}, {source:'team_onboarding'}, {personalGoogleAccount:{uid:'person'}}, {registration:{status:'complete'}}]) assert.equal(hasProviderRegistration(provider), true);
});
test('expense warning follows exact provider ID and disappears after the same record completes intake', () => {
  const row = {providerId:'old',providerName:'Persona'};
  assert.equal(expenseNeedsProviderRegistration(row,[{id:'old'}]),true);
  assert.equal(expenseNeedsProviderRegistration(row,[{id:'different',name:'Persona',source:'provider_invite'}]),true);
  assert.equal(expenseNeedsProviderRegistration(row,[{id:'old',source:'provider_invite'}]),false);
  assert.equal(expenseNeedsProviderRegistration({providerName:'Persona'},[]),true);
  assert.equal(expenseNeedsProviderRegistration({},[]),false);
});
