const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildBaniPatch, syncGoatProject } = require('./baniProjectSync');

const input = { projectId: 'test-project', data: { name: 'Test', clientName: 'Client', projectCode: 'G AS 0001', budgetTotal: 12345, status: 'Post', shootingDate: '2026-10-01' }, version: { seconds: 10, nanoseconds: 1 }, now: 100 };

test('creates only identity and neutral BANI defaults, without money or invented dates', () => {
  const result = buildBaniPatch(input);
  assert.equal(result.id, 'goat-test-project');
  assert.equal(result.client, 'Client');
  assert.equal(result.projectPhase, 'budget');
  assert.equal(result.goatSource.status, 'Post');
  for (const field of ['budgetTotal', 'budgetAmount', 'deadline', 'startDate', 'projectTimeEntries']) assert.equal(field in result, false);
  assert.deepEqual(result.budgetVersions, []);
});

test('legacy links preserve names, clients, budgets, hours, team and dates', () => {
  const existing = { name: 'Legacy name', client: 'GB', clientFinal: 'Brand', budgetVersions: [{ id: 'v1' }], projectTimeEntries: [{ hours: 2 }], assignedTeam: [{ memberId: 'a' }], deadline: '2026-10-10', projectPhase: 'active' };
  const result = buildBaniPatch({ ...input, existing });
  for (const key of Object.keys(existing)) assert.equal(key in result, false);
  assert.equal(result.goatProjectId, input.projectId);
});

test('updates source identity only when GOAT identity actually changes', () => {
  const existing = { ...buildBaniPatch(input), name: 'Local legacy title', clientFinal: 'Brand' };
  assert.equal(buildBaniPatch({ ...input, version: { seconds: 11 }, existing }).name, undefined);
  const result = buildBaniPatch({ ...input, data: { ...input.data, name: 'Renamed', clientName: 'New client' }, version: { seconds: 11 }, existing });
  assert.equal(result.name, 'Renamed');
  assert.equal(result.client, 'New client');
  assert.equal(result.clientFinal, 'New client');
  assert.equal(result.updatedAt, undefined);
});

test('duplicate and out-of-order events cannot overwrite newer identity', () => {
  const existing = buildBaniPatch(input);
  assert.equal(buildBaniPatch({ ...input, existing }), null);
  assert.equal(buildBaniPatch({ ...input, existing, version: { seconds: 10, nanoseconds: 0 } }), null);
  assert.notEqual(buildBaniPatch({ ...input, existing, version: { seconds: 10, nanoseconds: 2 } }), null);
});

test('rejects wrong links and malformed identity', () => {
  assert.throws(() => buildBaniPatch({ ...input, existing: { goatProjectId: 'other' } }));
  assert.throws(() => buildBaniPatch({ ...input, projectId: 'bad/path' }));
  assert.throws(() => buildBaniPatch({ ...input, data: { name: '' } }));
});

function fakeDb(initial = {}) {
  const documents = new Map(Object.entries(initial));
  let writes = 0;
  const ref = path => ({
    path, id: path.split('/').at(-1),
    collection: name => collection(`${path}/${name}`),
    get: async () => snapshot(path),
  });
  const snapshot = path => ({ ref: ref(path), exists: documents.has(path), data: () => documents.get(path), updateTime: input.version });
  const collection = path => ({
    doc: id => ref(`${path}/${id}`),
    where: (key, operation, value) => ({ limit: () => ({ query: true, path, key, value }) }),
  });
  return {
    documents, get writes() { return writes; }, collection,
    runTransaction: async callback => callback({
      get: async target => {
        if (!target.query) return snapshot(target.path);
        const docs = [...documents].filter(([path, data]) => path.startsWith(`${target.path}/`) && data[target.key] === target.value).map(([path]) => snapshot(path));
        return { docs, size: docs.length, empty: !docs.length };
      },
      create: (target, patch) => { assert.equal(documents.has(target.path), false); documents.set(target.path, patch); writes++; },
      update: (target, patch) => { documents.set(target.path, { ...documents.get(target.path), ...patch }); writes++; },
    }),
  };
}

test('transaction creates once, repeated delivery has no additional writes', async () => {
  const sourceDb = fakeDb({ 'projects/test-project': input.data });
  const targetDb = fakeDb();
  const args = { sourceDb, targetDb, projectId: input.projectId, ownerUid: 'owner' };
  assert.equal((await syncGoatProject(args)).outcome, 'created');
  assert.equal((await syncGoatProject(args)).outcome, 'unchanged');
  assert.equal(targetDb.writes, 1);
});

test('links into an existing project rather than creating a duplicate', async () => {
  const sourceDb = fakeDb({ 'projects/test-project': input.data });
  const targetDb = fakeDb({ 'users/owner/postProjects/legacy': { name: 'Old name', projectTimeEntries: [{ hours: 4 }] } });
  await syncGoatProject({ sourceDb, targetDb, projectId: input.projectId, ownerUid: 'owner', targetId: 'legacy' });
  assert.equal(targetDb.documents.size, 1);
  assert.deepEqual(targetDb.documents.get('users/owner/postProjects/legacy').projectTimeEntries, [{ hours: 4 }]);
  assert.equal(targetDb.documents.get('users/owner/postProjects/legacy').name, 'Old name');
});

test('source deletion leaves BANI history untouched', async () => {
  const targetDb = fakeDb();
  assert.equal((await syncGoatProject({ sourceDb: fakeDb(), targetDb, ownerUid: 'owner', projectId: 'deleted' })).outcome, 'source-missing');
  assert.equal(targetDb.writes, 0);
});

test('duplicate legacy links fail without overwriting either history', async () => {
  const targetDb = fakeDb({ 'users/owner/postProjects/a': { goatProjectId: input.projectId }, 'users/owner/postProjects/b': { goatProjectId: input.projectId } });
  await assert.rejects(syncGoatProject({ sourceDb: fakeDb({ 'projects/test-project': input.data }), targetDb, ownerUid: 'owner', projectId: input.projectId }), /Multiple BANI projects/);
  assert.equal(targetDb.writes, 0);
});
