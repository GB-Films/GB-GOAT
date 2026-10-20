import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initializeApp } from 'firebase/app';
import { collection, getFirestore, or, query, queryEqual, where } from 'firebase/firestore';
import { dashboardProjectsQuery, sortDashboardProjects } from './dashboardProjects';

const db = getFirestore(initializeApp({ projectId: 'demo-dashboard-visibility' }, 'dashboard-visibility-test'));

test('admin dashboard includes legacy documents without a creation date', () => {
  assert.ok(queryEqual(dashboardProjectsQuery(db, { uid: 'admin', email: 'admin@example.invalid', isAdmin: true }), query(collection(db, 'projects'))));
  const projects = [{ id: 'legacy', name: 'Legacy' }, { id: 'old', createdAt: '2026-01-01' }, { id: 'new', createdAt: { toMillis: () => 1790000000000 } }];
  assert.deepEqual(sortDashboardProjects(projects).map(p => p.id), ['new', 'old', 'legacy']);
  assert.equal(projects[0].id, 'legacy');
});

test('removing the date order keeps collaborator/owner authorization filters', () => {
  const actual = dashboardProjectsQuery(db, { uid: 'member', email: ' Member@Example.Invalid ', isAdmin: false });
  const expected = query(collection(db, 'projects'), or(where('createdBy', '==', 'member'), where('collaboratorEmails', 'array-contains', 'member@example.invalid')));
  assert.ok(queryEqual(actual, expected));
  assert.ok(!queryEqual(actual, query(collection(db, 'projects'))));
});

test('unknown or missing creation dates remain visible with deterministic ordering', () => {
  assert.deepEqual(sortDashboardProjects([{ id: 'b', name: 'B', createdAt: 'invalid' }, { id: 'a', name: 'A' }]).map(p => p.id), ['a', 'b']);
});
