const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifiedAccount } = require('./teamProviderAssignment');
test('team incorporation uses the registered verified Google account, never an arbitrary contact or disabled identity', () => {
  const good = { uid: 'u', email: 'person@company.test', emailVerified: true, disabled: false, providerData: [{ providerId: 'google.com' }] };
  assert.equal(verifiedAccount(good, good.email, 'u').uid, 'u');
  for (const change of [{ disabled: true }, { emailVerified: false }, { email: 'other@example.test' }, { uid: 'other' }, { providerData: [{ providerId: 'password' }] }])
    assert.throws(() => verifiedAccount({ ...good, ...change }, good.email, 'u'));
});
