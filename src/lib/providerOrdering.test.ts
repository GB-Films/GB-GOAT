import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase/firestore';
import { providerRegistrationLabel, providerTimestamp, sortProviders } from './providerOrdering';

test('registration ordering uses creation time, preserves all undated records last in either direction and does not mutate input', () => {
  const providers = [
    { id: 'missing', name: 'Ana', updatedAt: new Date('2026-10-29T18:00:00Z') },
    { id: 'new', name: 'Zoe', createdAt: Timestamp.fromDate(new Date('2026-10-29T13:00:00Z')) },
    { id: 'old', name: 'Beatriz', createdAt: { seconds: Date.parse('2026-10-01T12:00:00Z') / 1000 }, updatedAt: new Date('2026-10-29T19:00:00Z') },
    { id: 'invalid', name: 'Celia', createdAt: 'not-a-date' },
    { id: 'tie', name: 'Álvaro', createdAt: '2026-10-29T13:00:00Z' },
  ];
  assert.deepEqual(sortProviders(providers, 'registration-desc').map(row => row.id), ['tie', 'new', 'old', 'missing', 'invalid']);
  assert.deepEqual(sortProviders(providers, 'registration-asc').map(row => row.id), ['old', 'tie', 'new', 'missing', 'invalid']);
  assert.deepEqual(sortProviders(providers, 'name').map(row => row.id), ['tie', 'missing', 'old', 'invalid', 'new']);
  assert.deepEqual(sortProviders(providers, 'updated-desc').slice(0, 2).map(row => row.id), ['old', 'missing']);
  assert.deepEqual(providers.map(row => row.id), ['missing', 'new', 'old', 'invalid', 'tie']);
});

test('registration timestamps support stored Firestore and local date shapes without guessing missing dates', () => {
  const date = new Date('2026-10-29T12:00:00Z');
  for (const value of [date, Timestamp.fromDate(date), { seconds: date.getTime() / 1000, nanoseconds: 0 }, { toDate: () => date }, date.toISOString(), date.getTime()]) {
    assert.equal(providerTimestamp(value), date.getTime());
  }
  assert.equal(providerTimestamp({ seconds: 0, nanoseconds: 500_000_000 }), 500);
  for (const value of [null, undefined, '', {}, new Date(NaN), Infinity, false, { toMillis: () => { throw Error('invalid'); } }]) assert.equal(providerTimestamp(value), null);
  assert.equal(providerRegistrationLabel({ updatedAt: date }), 'Sin fecha de inscripción');
});

test('registration labels use the Argentine calendar date regardless of browser timezone', () => {
  assert.equal(providerRegistrationLabel({ createdAt: '2026-10-29T01:30:00Z' }), 'Inscripción: 28/10/2026');
});
