import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const { createProviderPortalAdminHandler } = require('../functions/providerPortalAdmin');
const projectId = 'demo-goat-work-authorizations';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Local emulator required');
const env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
const app = admin.initializeApp({ projectId }, 'work-authorizations'), db = app.firestore();
const downloads = [];
const call = createProviderPortalAdminHandler({ db, timestamp: () => admin.firestore.FieldValue.serverTimestamp(),
  clock: () => new Date('2026-11-05T12:00:00Z'), sign: { declarationFile: async (...args) => { downloads.push(args); return { base64: 'JVBERg==', fileName: 'declaracion.pdf', contentType: 'application/pdf' }; } } });
const scope = { projectId: 'p', collectionName: 'areaExpenses', itemId: 'work', providerId: 'supplier' };
const request = (uid, data = {}, verified = true) => ({ auth: { uid, token: { email: `${uid}@example.test`, email_verified: verified } }, data: { ...scope, action: 'workAuthorizations', ...data } });
const base = { kind: 'third_party', providerId: 'supplier', status: 'active', effectiveRoles: ['invoice', 'payment'],
  actor: { uid: 'supplier-user', email: 'supplier@example.test' }, proof: { complete: true, signedAt: '2026-11-04T12:00:00Z', signedPdfSha256: 'private-hash' }, signing: { secret: 'signing-reference' },
  content: { termsVersion: 'third-party-v5', validity: 'until_revoked', workKeys: ['p/areaExpenses/work'], terms: 'private signed terms', ownAccount: { cbu: 'PRIVATE-OWN-CBU' },
    party: { name: 'Persona autorizada', cuit: '20333333334', holder: 'Persona autorizada', holderCuit: '20333333334', cbu: '0000000000000000000001', alias: 'tercero.cuenta', email: 'private@example.test' } } };
try {
  for (const uid of ['admin', 'producer', 'stranger', 'pending']) await db.doc(`users/${uid}`).set({ email: `${uid}@example.test`, role: uid === 'admin' ? 'admin' : 'colaborador' });
  await db.doc('projects/p').set({ createdBy: 'admin', activeAreas: ['Arte'], collaboratorEmails: ['producer@example.test', 'pending@example.test'] });
  await db.doc('projects/foreign').set({ createdBy: 'someone', collaboratorEmails: [] });
  for (const uid of ['producer', 'pending']) await db.doc(`projects/p/collaborators/${uid}@example.test`).set({ role: 'jefe_produccion', allowedTabs: ['areas'], allowedCategories: ['Arte'] });
  await db.doc('providers/supplier').set({ type: 'persona', name: 'Prestador' });
  await db.doc('projects/p/areaExpenses/work').set({ providerId: 'supplier', area: 'Arte', total: 10, thirdPartyPayoutRequired: true });
  await db.doc('projects/p/areaExpenses/other').set({ providerId: 'supplier', area: 'Arte', total: 20 });
  for (const [key, value] of Object.entries({ active: base, revoked: { ...base, status: 'revoked' },
    expired: { ...base, content: { ...base.content, termsVersion: 'third-party-v3', validity: '', expiresOn: '2026-01-01' } },
    partial: { ...base, effectiveRoles: ['payment'] }, signedNotApplied: { ...base, status: 'pending_review' },
    unsigned: { ...base, proof: { complete: false } }, otherWork: { ...base, content: { ...base.content, workKeys: ['p/areaExpenses/other'], party: { ...base.content.party, alias: 'SECRET-OTHER-WORK' } } },
    foreignProvider: { ...base, providerId: 'different' },
  })) await db.doc(`providerPortalDeclarations/${key}`).set(value);
  const result = await call(request('producer'));
  assert.equal(result.required, true);
  assert.deepEqual(result.authorizations.filter(row => row.valid).map(row => row.id), ['active']);
  assert.equal(result.authorizations.length, 5);
  assert.equal(result.authorizations[0].content.party.name, base.content.party.name);
  for (const secret of ['PRIVATE-OWN-CBU', 'private@example.test', 'SECRET-OTHER-WORK', 'signing-reference', 'private-hash', 'private signed terms', 'supplier-user']) assert(!JSON.stringify(result).includes(secret), secret);
  assert.equal(result.authorizations[0].content.workKeys, undefined);
  assert.equal((await db.doc('providerPortalDeclarations/signedNotApplied').get()).data().status, 'pending_review', 'view must not apply or repair declarations');
  assert.equal((await db.collection('providerPortalAudit').get()).size, 0);
  await assert.rejects(call(request('producer', {}, false)), /Iniciá sesión/);
  await assert.rejects(call(request('stranger', { global: true })), /acceso/);
  await assert.rejects(call(request('producer', { projectId: 'foreign' })), /acceso/);
  await assert.rejects(call(request('producer', { providerId: 'different' })), /cambió/);
  await assert.rejects(call(request('producer', { collectionName: 'users' })), /gasto válido/);
  await assert.rejects(call(request('producer', { itemId: 'missing' })), /proveedor asignado/);
  const file = { action: 'workAuthorizationFile', declarationId: 'active', artifact: 'untrusted' };
  assert.equal((await call(request('producer', file))).fileName, 'declaracion.pdf');
  assert.equal(downloads[0][1], 'signed', 'only the signed declaration artifact may be requested');
  for (const declarationId of ['otherWork', 'foreignProvider', 'unsigned']) await assert.rejects(call(request('producer', { ...file, declarationId })), /no corresponde/);
  await db.doc('providerPortalDeclarations/multi').set({ ...base, content: { ...base.content, workKeys: ['p/areaExpenses/work', 'foreign/areaExpenses/private'] } });
  assert.equal((await call(request('producer'))).authorizations.find(row => row.id === 'multi').canDownload, false);
  await assert.rejects(call(request('producer', { ...file, declarationId: 'multi' })), /otros proyectos/);
  assert.equal((await call(request('admin', { ...file, declarationId: 'multi' }))).fileName, 'declaracion.pdf');
  await db.doc('teamAccessEmails/pending@example.test').set({ status: 'pending' });
  await assert.rejects(call(request('pending')), /alta de equipo/);
  await db.doc('projects/p').update({ teamOnboardingBlockedEmails: ['producer@example.test'] });
  await assert.rejects(call(request('producer')), /acceso/);
  await db.doc('projects/p/areaExpenses/work').update({ providerId: 'changed' });
  await assert.rejects(call(request('admin', file)), /cambió/);
  console.log('PASS work authorizations: scoped signed declarations, validity, bank data, downloads and negative permissions; no writes on read.');
} finally { await env.cleanup(); await app.delete(); }
