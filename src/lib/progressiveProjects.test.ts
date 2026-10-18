import test from 'node:test';
import assert from 'node:assert/strict';
import { publishProgressiveProjects } from './progressiveProjects';

test('projects become navigable before commercial requests resolve, without exposing legacy private fields', async () => {
  let finish!: (value: any) => void;
  const pending = new Promise<any>(resolve => { finish = resolve; });
  const renders: any[][] = [];
  const loading = publishProgressiveProjects([{ id: 'p', name: 'Proyecto', projectCode: 'G EX 0001', clientName: 'Privado', budgetTotal: 900 }],
    () => pending, rows => renders.push(rows), () => true, () => assert.fail('unexpected error'));
  assert.deepEqual(renders, [[{ id: 'p', name: 'Proyecto', projectCode: 'G EX 0001' }]]);
  finish({ id: 'p', name: 'Proyecto', clientName: 'Autorizado', budgetTotal: 900 });
  await loading;
  assert.equal((renders[1][0] as Record<string, unknown>).clientName, 'Autorizado');
});

test('one failed commercial read does not hide projects or block successful authorized metadata', async () => {
  const renders: any[][] = [], errors: unknown[] = [];
  await publishProgressiveProjects([{ id: 'a', name: 'A', clientName: 'Legacy A' }, { id: 'b', name: 'B' }],
    async project => { if (project.id === 'a') throw Error('permission-denied'); return { ...project, clientName: 'Permitido' }; },
    rows => renders.push(rows), () => true, error => errors.push(error));
  assert.equal(errors.length, 1);
  assert.equal(renders.at(-1)![0].clientName, undefined);
  assert.equal(renders.at(-1)![1].clientName, 'Permitido');
});

test('a late response cannot update a newer snapshot, another account or an unmounted screen', async () => {
  let current = true, finish!: (value: any) => void;
  const pending = new Promise<any>(resolve => { finish = resolve; });
  const renders: any[][] = [];
  const loading = publishProgressiveProjects([{ id: 'p', name: 'Old' }], () => pending, rows => renders.push(rows), () => current, () => {});
  current = false;
  finish({ id: 'p', name: 'Old', clientName: 'No publicar' });
  await loading;
  assert.equal(renders.length, 1);
  await publishProgressiveProjects([{ id: 'p', name: 'Old' }], () => pending, () => assert.fail('stale publish'), () => false, () => {});
});
