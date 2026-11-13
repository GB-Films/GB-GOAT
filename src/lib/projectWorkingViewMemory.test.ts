import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectWorkingViewMemory } from './projectWorkingViewMemory';
import { resolveAreaSelection } from './areaSelectionPreference';

test('leaving and reopening a project restores the working view immediately, without waiting for an effect', () => {
  const memory = createProjectWorkingViewMemory();
  const selection = memory.entry<string[] | null>('user', 'project', 'areas.selection', null);
  selection.set(['Arte']);
  memory.entry('user', 'other-project', 'areas.selection', null);
  const reopened = memory.entry<string[] | null>('user', 'project', 'areas.selection', null);
  assert.deepEqual(resolveAreaSelection(['Arte','Sonido'], reopened.getSnapshot()), ['Arte']);
  assert.equal(reopened, selection);
  reopened.set([]);
  assert.deepEqual(resolveAreaSelection(['Arte','Sonido'], selection.getSnapshot()), []);
});

test('users, projects and budget/area collapses are independent, including updates to an old mounted scope', () => {
  const memory = createProjectWorkingViewMemory();
  const areas = memory.entry<Record<string,boolean>>('a', 'one', 'areas.collapsed', {});
  areas.set({Arte:true});
  for (const [user,project,field] of [['b','one','areas.collapsed'], ['a','two','areas.collapsed'], ['a','one','budget.collapsed']]) {
    assert.deepEqual(memory.entry(user, project, field, {}).getSnapshot(), {});
  }
  const second = memory.entry('a', 'two', 'areas.collapsed', {});
  areas.set(previous => ({...previous,Sonido:true}));
  assert.deepEqual(second.getSnapshot(), {});
});

test('reload starts fresh; remembered tab, search, sort and collapsed subcategories last only within a page instance', () => {
  const memory = createProjectWorkingViewMemory();
  for (const [field,initial,next] of [['activeTab','resumen','areas'], ['areas.search','','extra'], ['areas.sort','manual','provider'], ['budget.search','','arte']]) {
    memory.entry('user','project',field,initial).set(next);
    assert.equal(memory.entry('user','project',field,initial).getSnapshot(), next);
    assert.equal(createProjectWorkingViewMemory().entry('user','project',field,initial).getSnapshot(), initial);
  }
  memory.entry('user','project','areas.subcategories.collapsed',{}).set({'Arte__Vestuario':true});
  assert.deepEqual(memory.entry('user','project','areas.subcategories.collapsed',{}).getSnapshot(), {'Arte__Vestuario':true});
  assert.deepEqual(createProjectWorkingViewMemory().entry('user','project','areas.subcategories.collapsed',{}).getSnapshot(), {});
});

test('subscribers receive functional updates synchronously; unsubscribed views and identical values do not notify', () => {
  const entry = createProjectWorkingViewMemory().entry('user','project','counter',0);
  const observed:number[]=[];
  const unsubscribe = entry.subscribe(() => observed.push(entry.getSnapshot()));
  entry.set(n => n+1); entry.set(n => n+1); entry.set(2);
  assert.deepEqual(observed,[1,2]);
  unsubscribe(); entry.set(3); assert.deepEqual(observed,[1,2]);
});

test('no account/project is never saved into a shared anonymous scope', () => {
  const memory = createProjectWorkingViewMemory();
  const pending = memory.entry(undefined,'project','areas.search','');
  pending.set('old');
  assert.equal(memory.entry(undefined,'project','areas.search','').getSnapshot(),'');
  assert.equal(memory.entry('user','project','areas.search','').getSnapshot(),'');
});
