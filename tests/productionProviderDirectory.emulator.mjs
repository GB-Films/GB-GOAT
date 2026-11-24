import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const { createProviderFinanceHandler } = require('../functions/providerFinance');
const projectId = 'demo-goat-production-directory';
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/);
const env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
const app = admin.initializeApp({ projectId });
const db = app.firestore();
const handle = createProviderFinanceHandler({ db, timestamp: admin.firestore.FieldValue.serverTimestamp });
const claims = uid => ({ email: `${uid}@example.test`, email_verified: true });
const call = (uid, action, extra = {}, token = claims(uid)) => handle({ auth: { uid, token }, data: { action, ...extra } });
const provider = { type: 'empresa', businessName: 'Proveedor sin fecha', cuit: '30999999999', address: 'Domicilio ficticio',
  bankAccount_cbu: '0000000000000000000001', bankAccount_alias: 'alias.ficticio', bankAccount_holder: 'Titular de prueba',
  personalGoogleAccount: { uid: 'private-auth-id' }, privateEvidence: ['private-path'], linkedProjectIds: ['foreign'] };

try {
  const seed = db.batch();
  for (let index = 0; index < 200; index++) seed.set(db.doc(`providers/archive-${index}`), { type: 'persona', name: `Persona ficticia ${index}` });
  seed.set(db.doc('providers/legacy'), provider);
  for (const [uid, role] of Object.entries({ lead: 'jefe_produccion', 'pending-lead': 'jefe_produccion', collaborator: 'colaborador', admin: 'admin', assistant: 'ayudante_admin' }))
    seed.set(db.doc(`users/${uid}`), { role, email: claims(uid).email });
  seed.set(db.doc('teamAccessEmails/pending-lead@example.test'), { status: 'pending' });
  seed.set(db.doc('projects/own'), { createdBy: 'admin', collaboratorEmails: [claims('lead').email, claims('collaborator').email], activeAreas: ['Arte'] });
  seed.set(db.doc('projects/foreign'), { createdBy: 'admin', activeAreas: ['Arte'] });
  const permissions = { role: 'jefe_produccion', allowedTabs: ['areas', 'proveedores'], allowedCategories: ['Arte'], canEditBudgetAreas: true };
  seed.set(db.doc('projects/own/collaborators/lead@example.test'), permissions);
  seed.set(db.doc('projects/own/collaborators/collaborator@example.test'), permissions);
  seed.set(db.doc('projects/own/areaExpenses/work'), { area: 'Arte', subcategory: '', providerId: 'legacy', description: 'Visible autorizado' });
  seed.set(db.doc('projects/foreign/areaExpenses/foreign-work'), { area: 'Arte', subcategory: '', providerId: 'legacy', description: 'Trabajo ajeno' });
  await seed.commit();

  const first = await call('lead', 'productionProviderDirectory');
  assert.equal(first.providers.length, 200);
  assert.ok(first.nextCursor);
  const last = await call('lead', 'productionProviderDirectory', { cursor: first.nextCursor });
  assert.deepEqual(last, { providers: [{ id: 'legacy', type: 'empresa', businessName: provider.businessName,
    address: provider.address, cuit: provider.cuit }], nextCursor: '' });
  const { provider: detail } = await call('lead', 'productionProviderDetail', { providerId: 'legacy', projectId: 'foreign' });
  assert.equal(detail.cuit, provider.cuit);
  assert.equal(detail.bankAccount_cbu, provider.bankAccount_cbu);
  assert.equal(detail.bankAccount_alias, provider.bankAccount_alias);
  assert.equal(detail.bankAccount_holder, provider.bankAccount_holder);
  assert.equal(detail.personalGoogleAccount, undefined);
  assert.equal(detail.privateEvidence, undefined);
  assert.equal(detail.linkedProjectIds, undefined);
  assert.equal(detail.projects, undefined);
  await assert.rejects(call('lead', 'productionProviderDetail', { providerId: 'missing' }), { code: 'not-found' });
  for (const role of ['collaborator', 'pending-lead']) {
    await assert.rejects(call(role, 'productionProviderDirectory'), { code: 'permission-denied' });
    await assert.rejects(call(role, 'productionProviderDetail', { providerId: 'legacy' }), { code: 'permission-denied' });
  }
  await assert.rejects(call('lead', 'productionProviderDirectory', {}, { ...claims('lead'), email_verified: false }), { code: 'permission-denied' });
  await assert.rejects(call('lead', 'projectScopedSnapshot', { projectId: 'foreign', purpose: 'proveedores' }), { code: 'permission-denied' });
  assert.deepEqual((await call('lead', 'projectSummaries')).projects.map(project => project.id), ['own']);
  assert.equal((await call('lead', 'projectScopedSnapshot', { projectId: 'own', purpose: 'proveedores' })).areaExpenses[0].description, 'Visible autorizado');
  await assert.rejects(call('lead', 'create', { providerId: 'legacy' }), { code: 'permission-denied' });

  const lead = env.authenticatedContext('lead', claims('lead')).firestore();
  const collaborator = env.authenticatedContext('collaborator', claims('collaborator')).firestore();
  const operator = env.authenticatedContext('admin', claims('admin')).firestore();
  const assistant = env.authenticatedContext('assistant', claims('assistant')).firestore();
  await assertFails(getDoc(doc(lead, 'providers/legacy')));
  await assertFails(getDocs(collection(collaborator, 'providers')));
  await assertFails(setDoc(doc(lead, 'providers/should-not-create'), { name: 'Nombre ficticio' }));
  await assertFails(updateDoc(doc(lead, 'providers/legacy'), { bankAccount_alias: 'cambio' }));
  await assertFails(deleteDoc(doc(lead, 'providers/legacy')));
  await assertFails(getDocs(collection(lead, 'providerInvites')));
  await assertFails(setDoc(doc(lead, 'providerInvites/global-invite'), { status: 'pending', used: false }));
  await assertFails(setDoc(doc(lead, 'providerIdentifiers/dni_123'), { providerId: 'legacy', identifierType: 'dni', value: '123' }));
  await assertFails(getDocs(collection(lead, 'providerFinancialRecords')));
  await assertSucceeds(getDoc(doc(operator, 'providers/legacy')));
  await assertSucceeds(getDoc(doc(assistant, 'providers/legacy')));
  console.log('PASS global Jefe de Producción reads provider fichas only; project collaboration and administration remain scoped');
} finally {
  await env.cleanup();
  await app.delete();
}
