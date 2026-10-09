import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadDashboardData, withDashboardTimeout } from './dashboardLoad';

test('publishes projects before financial reads finish and isolates failed reads', async () => {
  const events: string[] = [];
  let resolveFinance!: (value: number) => void;
  const finance = new Promise<number>((resolve) => { resolveFinance = resolve; });
  const loading = loadDashboardData({
    loadProjects: async () => ['pending', 'failed', 'ready'],
    loadFinance: async (project) => {
      if (project === 'failed') throw new Error('permission-denied');
      return project === 'pending' ? finance : 6;
    },
    onProjects: (projects) => events.push(`projects:${projects.length}`),
    onFinance: (project) => events.push(`ready:${project}`),
    onFinanceError: (project) => events.push(`failed:${project}`),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events[0], 'projects:3');
  assert.ok(events.includes('ready:ready'));
  assert.ok(events.includes('failed:failed'));
  assert.ok(!events.includes('ready:pending'));
  resolveFinance(2);
  await loading;
  assert.ok(events.includes('ready:pending'));
});

test('a stalled financial read ends with an error without hiding projects', async () => {
  const events: string[] = [];
  await loadDashboardData({
    loadProjects: async () => ['stalled'],
    loadFinance: () => new Promise<never>(() => {}),
    onProjects: () => events.push('visible'),
    onFinance: () => events.push('ready'),
    onFinanceError: () => events.push('error'),
    timeoutMs: 10,
  });
  assert.deepEqual(events, ['visible', 'error']);
});

test('a stalled project read rejects instead of keeping the dashboard loading forever', async () => {
  await assert.rejects(withDashboardTimeout(new Promise(() => {}), 10), /DASHBOARD_LOAD_TIMEOUT/);
});

test('project permission errors are surfaced, not presented as an empty workspace', async () => {
  let published = false;
  await assert.rejects(loadDashboardData({
    loadProjects: async () => { throw new Error('permission-denied'); },
    loadFinance: async () => 0,
    onProjects: () => { published = true; },
    onFinance: () => {},
    onFinanceError: () => {},
  }), /permission-denied/);
  assert.equal(published, false);
});
