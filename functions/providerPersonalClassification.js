'use strict';
// Administrative repair, deliberately not exported as a callable. The only
// business write is a missing provider.type -> persona; access activates normally.
const assert = require('node:assert/strict');
const { hash, email, id } = require('./providerPortalModel');
const { isAdministrativeRecord } = require('./providerAdministrativeRecords');
const { hasTeamWorkAccess } = require('./teamWorkAccess');

const version = row => row.exists ? `${row.updateTime.seconds}.${String(row.updateTime.nanoseconds).padStart(9, '0')}` : 'missing';
const preserved = provider => Object.fromEntries(Object.entries(provider).filter(([key]) => !['type', 'updatedAt'].includes(key)));
function classificationInput(input) {
  const allowed = ['operationKey', 'providerId', 'targetUid', 'targetEmail', 'operatorUid', 'operatorEmail', 'confirmedPersonal', 'reason', 'authorizationSha256', 'expectedVersion', 'expectedPreservationHash'];
  assert(input && Object.keys(input).every(key => allowed.includes(key)), 'La entrada contiene campos no permitidos.');
  for (const key of ['operationKey', 'providerId', 'targetUid', 'operatorUid']) assert.equal(id(input[key]), input[key], `Revisá ${key}.`);
  for (const key of ['targetEmail', 'operatorEmail']) assert(/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(input[key]) && email(input[key]) === input[key], `Revisá ${key}.`);
  assert.equal(input.confirmedPersonal, true, 'Falta confirmar expresamente que la ficha corresponde a una persona.');
  assert(typeof input.reason === 'string' && input.reason.trim().length >= 10 && input.reason.length <= 1000, 'Falta el motivo de la corrección.');
  assert(/^[a-f0-9]{64}$/.test(input.authorizationSha256 || ''), 'Falta la huella de la autorización.');
  if (input.expectedVersion !== undefined) assert(/^\d+\.\d{9}$/.test(input.expectedVersion), 'Versión inválida.');
  if (input.expectedPreservationHash !== undefined) assert(/^[a-f0-9]{64}$/.test(input.expectedPreservationHash), 'Huella de preservación inválida.');
  return input;
}
function verifiedAccount(account, uid, expectedEmail) {
  assert(account && account.uid === uid && email(account.email) === expectedEmail
    && account.emailVerified === true && !account.disabled
    && account.providerData?.some(provider => provider.providerId === 'google.com'), 'La cuenta Google no coincide, no está verificada o está deshabilitada.');
  return { uid, email: expectedEmail, emailVerified: true, disabled: false, provider: 'google.com' };
}
async function preservationSnapshot(db, read, input) {
  const paths = [`providerPortalUsers/${input.targetUid}/memberships/${input.providerId}`, `users/${input.targetUid}`];
  const rows = await Promise.all(paths.map(path => read(db.doc(path))));
  const records = rows.map((row, index) => ({ path: paths[index], exists: row.exists, data: row.data() || null }));
  // Direct subcollections avoid collection-group indexes. The catalog must be
  // complete; a cap aborts, never turns a truncated inventory into a repair.
  const projects = await read(db.collection('projects').select().limit(1001));
  assert(projects.size <= 1000, 'El catálogo requiere paginación administrativa; no se modificó la ficha.');
  records.push(...projects.docs.map(row => ({ path: row.ref.path, exists: true, data: null })));
  const collections = ['providerFinancialRecords', 'providerPortalDeclarations', ...projects.docs.flatMap(row =>
    ['areaExpenses', 'budgetItems', 'cashMovements'].map(collection => `${row.ref.path}/${collection}`))];
  for (let offset = 0; offset < collections.length; offset += 8) {
    const results = await Promise.all(collections.slice(offset, offset + 8).map(collection => read(db.collection(collection).where('providerId', '==', input.providerId).limit(501))));
    for (const result of results) {
      assert(result.size <= 500, 'La preservación requiere una revisión paginada; no se modificó la ficha.');
      records.push(...result.docs.map(row => ({ path: row.ref.path, exists: true, data: row.data() })));
    }
  }
  return records.sort((a, b) => a.path.localeCompare(b.path));
}
async function classifyPersonalProvider({ db, timestamp, input: raw, operatorEmail, findAccountByUid, apply = false, backupBefore = async () => {} }) {
  const input = classificationInput(raw);
  assert.equal(operatorEmail, input.operatorEmail, 'La sesión oficial no corresponde al operador.');
  assert(['gb-goat'].includes(db.projectId) || db.projectId?.startsWith('demo-'), 'Proyecto no permitido.');
  if (apply) assert(input.expectedVersion && input.expectedPreservationHash, 'Primero revisá una vista previa con versión y huella.');
  const accounts = async () => ({
    operator: verifiedAccount(await findAccountByUid(input.operatorUid), input.operatorUid, input.operatorEmail),
    target: verifiedAccount(await findAccountByUid(input.targetUid), input.targetUid, input.targetEmail),
  });
  const beforeAccounts = await accounts();
  const providerRef = db.doc(`providers/${input.providerId}`);
  const auditId = `personal_classification_${hash(input.operationKey)}`;
  const auditRef = db.doc(`providerPortalAudit/${auditId}`);
  const fingerprint = hash(Object.fromEntries(Object.entries(input).filter(([key]) => !['expectedVersion', 'expectedPreservationHash'].includes(key))));
  const result = await db.runTransaction(async tx => {
    const [providerRow, priorAudit, operator, operatorGate, administrative, companyApproval] = await Promise.all([
      tx.get(providerRef), tx.get(auditRef), tx.get(db.doc(`users/${input.operatorUid}`)),
      tx.get(db.doc(`teamAccessEmails/${input.operatorEmail}`)), tx.get(db.doc(`providerAdministrativeRecords/${input.providerId}`)),
      tx.get(db.doc(`providerPortalCompanyApprovals/${input.providerId}`)),
    ]);
    const actor = operator.data();
    assert(actor?.role === 'admin' && (!actor.uid || actor.uid === input.operatorUid) && email(actor.email) === input.operatorEmail && hasTeamWorkAccess(actor)
      && (!operatorGate.exists || operatorGate.data().status === 'ready' && (!operatorGate.data().uid || operatorGate.data().uid === input.operatorUid)), 'Sólo un administrador global habilitado puede corregir esta clasificación.');
    assert(providerRow.exists, 'La ficha no existe.');
    const provider = providerRow.data();
    assert(!isAdministrativeRecord(administrative.data(), input.providerId) && !companyApproval.exists, 'La ficha es administrativa o tiene una representación de empresa; requiere otro circuito.');
    assert(!provider.businessName, 'La ficha tiene razón social; no se clasifica automáticamente como persona.');
    if (provider.personalGoogleAccount) assert(provider.personalGoogleAccount.uid === input.targetUid && email(provider.personalGoogleAccount.email) === input.targetEmail, 'La ficha ya tiene otra identidad verificada.');
    const protectedRows = await preservationSnapshot(db, ref => tx.get(ref), input);
    assert(!protectedRows.some(row => row.path.startsWith('providerPortalDeclarations/') && row.data.kind === 'representation'
      && !['revoked', 'cancelled', 'rejected'].includes(row.data.status)), 'La ficha tiene una declaración de representación; requiere revisión administrativa.');
    const membership = protectedRows.find(row => row.path.startsWith('providerPortalUsers/'))?.data;
    assert(membership && membership.email === input.targetEmail && ['active', 'needs_confirmation'].includes(membership.status)
      && (!membership.providerId || membership.providerId === input.providerId)
      && (!membership.representation || membership.representation === 'own'), 'La asociación no coincide o está revocada/suspendida.');
    const preservedHash = hash(preserved(provider));
    if (priorAudit.exists) {
      const audit = priorAudit.data();
      assert(audit.fingerprint === fingerprint && audit.preservedHash === preservedHash && provider.type === 'persona', 'La operación ya existe con otro contenido o la ficha cambió; no se repite.');
      return { outcome: 'already_applied', auditId, providerId: input.providerId, preservedHash, writes: [] };
    }
    assert(!Object.hasOwn(provider, 'type'), 'La clasificación ya está definida; esta herramienta sólo corrige un campo ausente.');
    const snapshot = { provider: { path: providerRef.path, version: version(providerRow), data: provider }, protectedRows, accounts: beforeAccounts };
    const preservationHash = hash({ preserved: preserved(provider), protectedRows, accounts: beforeAccounts });
    if (input.expectedVersion) assert.equal(version(providerRow), input.expectedVersion, 'La versión cambió desde la vista previa.');
    if (input.expectedPreservationHash) assert.equal(preservationHash, input.expectedPreservationHash, 'Cambió la ficha, asociación o sus documentos desde la vista previa.');
    const plan = { outcome: apply ? 'applied' : 'preview', providerId: input.providerId, auditId, fingerprint,
      expectedVersion: version(providerRow), expectedPreservationHash: preservationHash, preservedHash,
      protectedDocuments: protectedRows.length, plannedWrites: [providerRef.path, auditRef.path], writes: apply ? [providerRef.path, auditRef.path] : [], fields: ['type', 'updatedAt'],
      patch: { type: 'persona', updatedAt: 'serverTimestamp' } };
    await backupBefore(snapshot);
    if (!apply) return plan;
    assert.deepEqual(await accounts(), beforeAccounts, 'Cambió el estado de las cuentas; no se modificó la ficha.');
    tx.update(providerRef, { type: 'persona', updatedAt: timestamp() }, { lastUpdateTime: providerRow.updateTime });
    tx.create(auditRef, { action: 'legacy_personal_classification_corrected', version: 1, operationKey: input.operationKey,
      providerId: input.providerId, actor: { uid: input.operatorUid, email: input.operatorEmail },
      target: { uid: input.targetUid, email: input.targetEmail }, reason: input.reason, authorizationSha256: input.authorizationSha256,
      fingerprint, beforeVersion: version(providerRow), beforeHash: hash(provider), preservedHash,
      preservationHash, afterType: 'persona', afterHashWithoutUpdatedAt: hash({ ...preserved(provider), type: 'persona' }), changedFields: ['type', 'updatedAt'], at: timestamp() });
    return { ...plan, beforeAccounts, protectedRows };
  });
  if (result.outcome === 'applied') {
    // A failed post-check is a checkpoint AFTER commit, never an automatic rollback/retry.
    try {
      const afterProvider = (await providerRef.get()).data();
      assert.equal(afterProvider.type, 'persona');
      assert.equal(hash(preserved(afterProvider)), result.preservedHash);
      assert.deepEqual(await preservationSnapshot(db, ref => ref.get(), input), result.protectedRows);
      assert.deepEqual(await accounts(), result.beforeAccounts);
      assert.equal((await auditRef.get()).data().fingerprint, fingerprint);
      result.verification = 'passed';
    } catch {
      result.verification = 'failed_after_commit';
      result.next = 'Detener y releer ficha/auditoría; no repetir ni revertir automáticamente.';
    }
    delete result.beforeAccounts;
    delete result.protectedRows;
  }
  return result;
}
module.exports = { classifyPersonalProvider, classificationInput, verifiedAccount, version, preserved };
