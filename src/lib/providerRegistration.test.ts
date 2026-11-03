import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasProviderRegistration, expenseNeedsProviderRegistration, expenseRegistrationState } from './providerRegistration';
test('only intake evidence completes registration; name, email, bank and legacy identity stay provisional', () => {
  for (const provider of [{}, {email:'contact@example.test', bankAccount_cbu:'123'}, {dni_cuit:'12.345.678'}, {source:'manual'}, {source:'import'}]) assert.equal(hasProviderRegistration(provider), false);
  for (const provider of [{source:'provider_invite'}, {source:'team_onboarding'}, {personalGoogleAccount:{uid:'person'}}, {registration:{status:'complete'}}]) assert.equal(hasProviderRegistration(provider), true);
});
test('an applied historical signature is recognized without rewriting or claiming the supplier record', () => {
  const row={providerId:'legacy',providerName:'Persona'},providers=[{id:'legacy',source:'manual'}];
  const evidence={status:'ready' as const,registeredIds:new Set(['legacy'])};
  assert.equal(expenseNeedsProviderRegistration(row,providers,evidence),false);
  assert.equal(expenseRegistrationState(row,providers,evidence),'registered');
  assert.deepEqual(providers,[{id:'legacy',source:'manual'}]);
  assert.equal(expenseNeedsProviderRegistration({...row,providerId:'different'},providers,evidence),true);
});
test('pending and failed historical checks never call an unverified supplier provisional or registered', () => {
  const row={providerId:'legacy'},providers=[{id:'legacy'}];
  for(const status of ['loading','error'] as const){
    const evidence={status,registeredIds:new Set<string>()};
    assert.equal(expenseNeedsProviderRegistration(row,providers,evidence),false);
    assert.equal(expenseRegistrationState(row,providers,evidence),status);
    assert.equal(expenseRegistrationState(row,[{id:'legacy',source:'provider_invite'}],evidence),'registered');
  }
  assert.equal(expenseRegistrationState(row,providers,{status:'ready',registeredIds:new Set()}),'provisional');
});
test('expense warning follows exact provider ID and disappears after the same record completes intake', () => {
  const row = {providerId:'old',providerName:'Persona'};
  assert.equal(expenseNeedsProviderRegistration(row,[{id:'old'}]),true);
  assert.equal(expenseNeedsProviderRegistration(row,[{id:'different',name:'Persona',source:'provider_invite'}]),true);
  assert.equal(expenseNeedsProviderRegistration(row,[{id:'old',source:'provider_invite'}]),false);
  assert.equal(expenseNeedsProviderRegistration({providerName:'Persona'},[]),true);
  assert.equal(expenseNeedsProviderRegistration({},[]),false);
});
