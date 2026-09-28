import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_LINKED_PROVIDER_INVITE_DAYS,
  PROVIDER_INVITE_CLOCK_SKEW_MARGIN_MS,
  buildLinkedProviderInviteExpiration,
  getProviderInviteTargetIssue,
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

test('a missing provider invite target is reported as deleted', () => {
  assert.equal(getProviderInviteTargetIssue({ exists: false }), 'TARGET_EXPENSE_NOT_FOUND');
  assert.equal(getProviderInviteTargetIssue(null), 'TARGET_EXPENSE_NOT_FOUND');
});

test('a provider invite target with a provider is reported as assigned', () => {
  assert.equal(
    getProviderInviteTargetIssue({ exists: true, providerName: 'Rental Sur' }),
    'TARGET_EXPENSE_ALREADY_ASSIGNED',
  );
  assert.equal(
    getProviderInviteTargetIssue({ exists: true, providerId: 'prov-1' }),
    'TARGET_EXPENSE_ALREADY_ASSIGNED',
  );
});

test('a provider invite target with recorded payments is reported as paid', () => {
  assert.equal(
    getProviderInviteTargetIssue({ exists: true, paid: true }),
    'TARGET_EXPENSE_HAS_PAYMENTS',
  );
  assert.equal(
    getProviderInviteTargetIssue({ exists: true, paymentLocked: true }),
    'TARGET_EXPENSE_HAS_PAYMENTS',
  );
  assert.equal(
    getProviderInviteTargetIssue({ exists: true, paymentHistory: [{ amount: 10 }] }),
    'TARGET_EXPENSE_HAS_PAYMENTS',
  );
});

test('an unassigned unpaid provider invite target has no issue', () => {
  assert.equal(
    getProviderInviteTargetIssue({ exists: true, providerId: '', providerName: '', paid: false, paymentLocked: false, paymentHistory: [] }),
    null,
  );
});
