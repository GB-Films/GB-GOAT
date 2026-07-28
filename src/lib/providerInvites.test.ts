import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_LINKED_PROVIDER_INVITE_DAYS,
  PROVIDER_INVITE_CLOCK_SKEW_MARGIN_MS,
  buildLinkedProviderInviteExpiration,
} from './providerInvites';

test('linked provider invites stay below Firestore maximum expiration', () => {
  const now = new Date('2026-07-28T12:00:00.000Z');
  const expiration = buildLinkedProviderInviteExpiration(MAX_LINKED_PROVIDER_INVITE_DAYS, now);
  const firestoreMaximum = now.getTime() + MAX_LINKED_PROVIDER_INVITE_DAYS * 24 * 60 * 60 * 1000;

  assert.equal(
    expiration.getTime(),
    firestoreMaximum - PROVIDER_INVITE_CLOCK_SKEW_MARGIN_MS,
  );
  assert.ok(expiration.getTime() < firestoreMaximum);
});

test('linked provider invite expiration clamps excessive durations', () => {
  const now = new Date('2026-07-28T12:00:00.000Z');

  assert.equal(
    buildLinkedProviderInviteExpiration(30, now).getTime(),
    buildLinkedProviderInviteExpiration(MAX_LINKED_PROVIDER_INVITE_DAYS, now).getTime(),
  );
});
