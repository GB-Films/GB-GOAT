import assert from 'node:assert/strict';
import test from 'node:test';
import {
  areaSelectionPreferenceKey, readAreaSelectionPreference,
  resolveAreaSelection, writeAreaSelectionPreference,
} from './areaSelectionPreference';

test('an account without a saved selection sees every accessible active area', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
  assert.deepEqual(resolveAreaSelection(
    ['Producción de campo', 'Post-producción'],
    readAreaSelectionPreference(storage, 'tomás', 'samsung'),
  ), ['Producción de campo', 'Post-producción']);
});

test('the saved selection belongs to one account and project and survives reload', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
  writeAreaSelectionPreference(storage, 'user-a', 'samsung', ['Producción de campo']);
  assert.deepEqual(resolveAreaSelection(
    ['Producción de campo', 'Post-producción'],
    readAreaSelectionPreference(storage, 'user-a', 'samsung'),
  ), ['Producción de campo']);
  assert.equal(readAreaSelectionPreference(storage, 'user-b', 'samsung'), null);
  assert.equal(readAreaSelectionPreference(storage, 'user-a', 'stella'), null);
  assert.notEqual(areaSelectionPreferenceKey('user-a', 'samsung'), areaSelectionPreferenceKey('user-a', 'stella'));
});

test('clearing is preserved, while obsolete or invalid preferences fall back to all visible areas', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
  writeAreaSelectionPreference(storage, 'user', 'project', []);
  assert.deepEqual(resolveAreaSelection(['Campo', 'Post'], readAreaSelectionPreference(storage, 'user', 'project')), []);
  writeAreaSelectionPreference(storage, 'user', 'project', ['Old area']);
  assert.deepEqual(resolveAreaSelection(['Campo', 'Post'], readAreaSelectionPreference(storage, 'user', 'project')), ['Campo', 'Post']);
  store.set(areaSelectionPreferenceKey('user', 'project'), '{broken');
  assert.deepEqual(resolveAreaSelection(['Campo', 'Post'], readAreaSelectionPreference(storage, 'user', 'project')), ['Campo', 'Post']);
});
