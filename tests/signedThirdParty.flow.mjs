import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { hash } = require('../functions/providerPortalModel');
const { createSignedThirdPartyService } = require('../functions/signedThirdPartyDeclaration');

export async function testSignedThirdParty({ db, deps, own, adminCall, signActual, third, admin }) {
  const original = (await db.doc(`providerPortalDeclarations/${third.id}`).get()).data();
  const content = { ...original.content, termsVersion: 'third-party-v4' };
  const legacy = { ...original, content, status: 'pending_signature', id: 'legacy-third-party-test' };
  delete legacy.activation; delete legacy.effectiveRoles; delete legacy.proof; delete legacy.signedAt;
  legacy.contentHash = hash({ kind: legacy.kind, providerId: legacy.providerId, actor: legacy.actor, content });
  legacy.signing = await deps.sign.prepare(legacy);
  const ref = db.doc(`providerPortalDeclarations/${legacy.id}`);
  await ref.set(legacy);
  await signActual(legacy);
  const proof = await deps.sign.verify(legacy.signing, legacy.actor, legacy.contentHash);
  assert.equal(proof.complete, true);
  await ref.update({ status: 'pending_review', proof });
  const financialBefore = (await db.collection('providerFinancialRecords').get()).docs.map(row => ({ id: row.id, ...row.data() }));
  const workRef = db.doc('projects/project/areaExpenses/third-party-work');
  const workBefore = (await workRef.get()).data();
  const service = createSignedThirdPartyService(deps);
  const auditCount = async () => (await db.collection('providerPortalAudit').where('declarationId', '==', legacy.id).get()).size;

  const overview = await own({ action: 'overview', providerId: legacy.providerId });
  assert.equal(overview.declarations.find(d => d.id === legacy.id).status, 'active', 'a historical signed declaration applies on return without admin approval');
  assert.deepEqual((await ref.get()).data().effectiveRoles, ['invoice', 'payment']);
  assert.equal((await ref.get()).data().decisions, undefined);
  assert.equal(await auditCount(), 1);
  await Promise.all([service.apply(ref), service.apply(ref), service.apply(ref)]);
  assert.equal(await auditCount(), 1, 'retries do not duplicate application');

  await ref.update({ status: 'pending_review', effectiveRoles: [], activation: admin.firestore.FieldValue.delete() });
  await Promise.all([service.apply(ref), service.apply(ref)]);
  assert.equal(await auditCount(), 2, 'simultaneous completions have a single winner');
  await ref.update({ status: 'pending_review', effectiveRoles: [] });
  const authorizations = (await adminCall({ action: 'authorizations', providerId: legacy.providerId })).authorizations;
  assert.equal(authorizations.find(d => d.id === legacy.id).valid, true, 'administrative reads also recover old signed declarations');
  await ref.update({ status: 'active', effectiveRoles: ['payment'], decisions: { payment: { decision: 'approved', reason: 'antecedente' } } });
  await adminCall({ action: 'authorizations', providerId: legacy.providerId });
  const reviews = await adminCall({ action: 'reviews' });
  assert.equal(reviews.reviews.some(d => d.kind === 'third_party'), false);
  assert.deepEqual((await ref.get()).data().effectiveRoles, ['invoice', 'payment']);
  assert.equal((await ref.get()).data().decisions.invoice, undefined, 'automatic activation does not invent fiscal approval');

  for (const status of ['revoked', 'rejected']) {
    await ref.update({ status, effectiveRoles: [] });
    await service.apply(ref);
    assert.equal((await ref.get()).data().status, status);
  }
  await ref.update({ status: 'pending_review', decisions: { invoice: { decision: 'rejected' } }, effectiveRoles: [] });
  await service.apply(ref);
  assert.deepEqual((await ref.get()).data().effectiveRoles, []);
  await ref.update({ decisions: {}, status: 'pending_review' });
  const membershipRef = db.doc(`providerPortalUsers/${legacy.actor.uid}/memberships/${legacy.providerId}`);
  const membership = (await membershipRef.get()).data();
  const racing = createSignedThirdPartyService({ ...deps, sign: { verify: async (...args) => {
    const verified = await deps.sign.verify(...args);
    await membershipRef.update({ status: 'revoked' });
    return verified;
  } } });
  await assert.rejects(racing.apply(ref), /cuenta registrada/);
  assert.equal((await ref.get()).data().status, 'pending_review');
  await membershipRef.set(membership);

  await workRef.update({ providerId: 'foreign' });
  await assert.rejects(service.apply(ref), /trabajo cambió/);
  assert.equal((await ref.get()).data().status, 'pending_review');
  const broken = await own({ action: 'overview', providerId: legacy.providerId });
  assert.match(broken.declarations.find(d => d.id === legacy.id).applicationIssue, /nueva declaración/);
  await workRef.set(workBefore);
  const projectRef = db.doc('projects/project');
  const projectBefore = (await projectRef.get()).data();
  await projectRef.update({ activeAreas: [] });
  await assert.rejects(service.apply(ref), /trabajo cambió/);
  assert.equal((await ref.get()).data().status, 'pending_review');
  await projectRef.set(projectBefore);
  await ref.update({ content: { ...content, party: { ...content.party, alias: 'tampered.alias' } } });
  await assert.rejects(service.apply(ref), /comprobar/);
  assert.equal((await ref.get()).data().status, 'pending_review');
  await ref.update({ content });
  await service.apply(ref);
  assert.deepEqual((await workRef.get()).data(), workBefore, 'only the third-party flag is written; money and history stay intact');
  assert.deepEqual((await db.collection('providerFinancialRecords').get()).docs.map(row => ({ id: row.id, ...row.data() })), financialBefore, 'signatures never create or modify financial records');
  console.log('PASS third-party signed activation, real legacy recovery, concurrency, revocation and immutable finances');
}
