import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, writeBatch, serverTimestamp, getDocs, collection, getDoc } from 'firebase/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Local emulator required.');
const env = await initializeTestEnvironment({ projectId: 'demo-goat-provider-intake', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
const google = (uid = 'person', extra = {}) => env.authenticatedContext(uid, {
  email: 'personal@other.test', email_verified: true,
  firebase: { sign_in_provider: 'google.com' }, ...extra,
}).firestore();
const seed = async (token, data = {}) => env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'providerInvites', token), {
    status: 'pending', used: false, expiresAt: new Date(Date.now() + 3600000), ...data,
  });
});
let sequence = 12345678;
const provider = (token, overrides = {}) => ({
  type: 'persona', name: 'Persona', lastName: 'Prueba', fullName: 'Persona Prueba',
  dni: '12345678', dniNormalized: '12345678', cuit: '20123456786', cuitNormalized: '20123456786',
  email: 'personal@other.test', phone: '1111111111', address: 'Domicilio', category: 'Otra', categoryOther: 'Prueba',
  bankAccount_cbu: '', bankAccount_alias: 'alias.personal', source: 'provider_invite', inviteToken: token,
  personalGoogleAccount: { version: 'personal-google-v1', uid: 'person', email: 'personal@other.test', personalUse: true, acceptedAt: serverTimestamp() },
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...overrides,
});
const intake = (db, token, id = token, overrides = {}, multi = false, target = null) => {
  const batch = writeBatch(db);
  const digits = String(sequence++);
  const data = provider(token, { dni: digits, dniNormalized: digits, cuit: `20${digits}6`, cuitNormalized: `20${digits}6`, ...overrides });
  batch.set(doc(db, 'providers', id), data);
  batch.update(doc(db, 'providerInvites', token), multi ? {
    usageCount: 1, lastUsedAt: serverTimestamp(), lastProviderId: id, lastProviderType: 'persona', updatedAt: serverTimestamp(),
  } : { used: true, status: 'used', usedAt: serverTimestamp(), providerId: id, providerType: 'persona' });
  for (const kind of ['dni', 'cuit']) {
    const value = data[`${kind}Normalized`];
    batch.set(doc(db, 'providerIdentifiers', `${kind}_${value}`), { providerId: id, inviteToken: token, providerType: data.type, identifierType: kind, value, createdAt: serverTimestamp() });
  }
  if (target) batch.update(doc(db, target), {
    providerId: id, providerName: data.fullName,
    providerInviteAssignment: { token, providerId: id, assignedAt: serverTimestamp() }, updatedAt: serverTimestamp(),
  });
  return batch.commit();
};
try {
  await seed('valid');
  await assertSucceeds(intake(google(), 'valid'));
  await assertFails(intake(google(), 'valid', 'replay'));
  await seed('multi', { mode: 'multi_use', usageCount: 0 });
  await assertSucceeds(intake(google(), 'multi', 'multi', {}, true));
  for (const kind of ['budgetItems', 'areaExpenses']) {
    const token = `linked-${kind}`;
    const target = `projects/project/${kind}/expense`;
    await seed(token, { projectId: 'project', collectionName: kind, expenseId: 'expense' });
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), target), { providerId: '', providerName: '', area: 'Post', subcategory: '', paymentHistory: [], paid: false, providerInviteLink: { status: 'pending' } }));
    await assertSucceeds(intake(google(), token, token, {}, false, target));
    await assertFails(updateDoc(doc(google(), target), { providerId: 'valid', providerName: 'Otra persona' }));
  }
  const invalidContexts = [env.unauthenticatedContext().firestore(), google('other'), google('person', { email_verified: false }), google('person', { firebase: { sign_in_provider: 'password' } }), google('person', { firebase: { sign_in_provider: 'custom' } })];
  for (const [index, db] of invalidContexts.entries()) {
    const token = `identity-${index}`;
    await seed(token);
    await assertFails(intake(db, token));
  }
  for (const [index, overrides] of [
    { email: 'other@other.test' },
    { personalGoogleAccount: { version: 'personal-google-v1', uid: 'person', email: 'personal@other.test', personalUse: false, acceptedAt: serverTimestamp() } },
    { personalGoogleAccount: { version: 'personal-google-v1', uid: 'person', email: 'personal@other.test', personalUse: true, acceptedAt: new Date(0) } },
    { personalGoogleAccount: null }, { role: 'admin' }, { createdAt: new Date(0) },
    { name: 'x'.repeat(10000) }, { phone: 123 }, { address: null },
  ].entries()) {
    const token = `data-${index}`;
    await seed(token);
    await assertFails(intake(google(), token, token, overrides));
  }
  for (const [token, data] of [['expired', { expiresAt: new Date(0) }], ['cancelled', { status: 'cancelled' }]]) {
    await seed(token, data);
    await assertFails(intake(google(), token));
  }
  await seed('orphan');
  await assertFails(setDoc(doc(google(), 'providers', 'orphan'), provider('orphan')));
  await assertFails(updateDoc(doc(google(), 'providerInvites', 'orphan'), { used: true, status: 'used', usedAt: serverTimestamp(), providerId: 'valid', providerType: 'persona' }));
  await assertFails(updateDoc(doc(google(), 'providers', 'valid'), { email: 'other@other.test' }));
  await assertFails(updateDoc(doc(google(), 'providers', 'valid'), { 'personalGoogleAccount.uid': 'other' }));
  await assertFails(getDocs(collection(google(), 'providers')));
  await assertFails(getDoc(doc(google('stranger'), 'providers', 'valid')));
  await assertFails(setDoc(doc(google(), 'users', 'person'), { role: 'admin', email: 'personal@other.test' }));
  const admin = env.authenticatedContext('admin', { email: 'info@granbertafilms.com', email_verified: true }).firestore();
  await assertFails(updateDoc(doc(admin, 'providers', 'valid'), { email: 'other@other.test' }));
  await assertFails(updateDoc(doc(admin, 'providers', 'valid'), { 'personalGoogleAccount.acceptedAt': serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(admin, 'providers', 'valid'), { phone: '2222222222' }));
  assert.equal((await getDoc(doc(admin, 'providers', 'valid'))).data().email, 'personal@other.test');
  console.log('PASS personal Google intake: non-Gmail account, immutable declaration, single-use/multi-use, spoofing/replay/privacy/role denial.');
} finally { await env.cleanup(); }
