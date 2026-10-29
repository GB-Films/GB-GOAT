import assert from 'node:assert/strict';
import test from 'node:test';
import { needsTeamOnboarding, isTeamUserAssignable, teamReturnPath } from './teamOnboarding';
test('new staff cannot bypass intake with an incomplete ready marker; legacy is preserved',()=>{
  assert.equal(needsTeamOnboarding({role:'colaborador'}),false);
  for(const marker of [{status:'needs_profile'},{status:'needs_review'},{status:'ready'}, {version:1,status:'ready',providerId:''}]) {
    assert.equal(needsTeamOnboarding({teamOnboarding:marker}),true);
    assert.equal(isTeamUserAssignable({teamOnboarding:marker}),false);
  }
  assert.equal(needsTeamOnboarding({teamOnboarding:{version:1,status:'ready',providerId:'own'}}),false);
});
test('return from intake stays on authorized project routes, never an external redirect',()=>{
  assert.equal(teamReturnPath('/proyectos/one'),'/proyectos/one');
  for(const path of ['https://example.test','//example.test','/equipo','/proyectos?invite=abc',null]) assert.equal(teamReturnPath(path),'/proyectos');
});
