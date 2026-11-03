import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { saveProjectPin } from '../src/lib/projectPins.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Local Firestore emulator required');
const env = await initializeTestEnvironment({
  projectId: 'demo-goat-project-pins',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
});
const roles = ['admin', 'ayudante_admin', 'colaborador'];
const dbFor = uid => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
try {
  await env.withSecurityRulesDisabled(async ctx => {
    for (const role of [...roles, 'other']) {
      await setDoc(doc(ctx.firestore(), 'users', role), {
        uid: role, email: `${role}@example.test`, role: role === 'other' ? 'colaborador' : role,
        displayName: 'Usuario de prueba', pinnedProjectIds: ['keep', 'remove'], updatedAt: 'unchanged',
      });
    }
  });
  for (const role of roles) {
    const db = dbFor(role), ref = doc(db, 'users', role);
    const before = (await getDoc(ref)).data();
    // Reproduce the rejected payload from the old UI for non-owner accounts.
    await assertFails(updateDoc(ref, { pinnedProjectIds: ['keep'], updatedAt: serverTimestamp() }));
    await assertSucceeds(saveProjectPin(db, role, 'remove', false));
    await assertSucceeds(saveProjectPin(db, role, 'remove', false));
    assert.deepEqual((await getDoc(ref)).data().pinnedProjectIds, ['keep']);
    await assertSucceeds(saveProjectPin(db, role, 'add', true));
    await assertSucceeds(saveProjectPin(db, role, 'add', true));
    assert.deepEqual((await getDoc(ref)).data().pinnedProjectIds, ['keep', 'add']);
    await Promise.all([
      assertSucceeds(saveProjectPin(db, role, 'parallel-a', true)),
      assertSucceeds(saveProjectPin(dbFor(role), role, 'parallel-b', true)),
    ]);
    const after = (await getDoc(ref)).data();
    assert.deepEqual(new Set(after.pinnedProjectIds), new Set(['keep', 'add', 'parallel-a', 'parallel-b']));
    assert.deepEqual({ ...after, pinnedProjectIds: before.pinnedProjectIds }, before, 'only favorites change');
    await assertFails(saveProjectPin(db, 'other', 'foreign-pin', true));
    await assertFails(updateDoc(ref, { pinnedProjectIds: [], email: 'foreign@example.test' }));
    if (role !== 'admin') await assertFails(updateDoc(ref, { pinnedProjectIds: [], role: 'admin' }));
  }
  await assertFails(saveProjectPin(env.unauthenticatedContext().firestore(), 'other', 'anonymous', true));
  console.log('PASS project pins: add/remove, idempotency, concurrent favorites, preserved profile and rejected foreign/privilege writes');
} finally {
  await env.cleanup();
}
