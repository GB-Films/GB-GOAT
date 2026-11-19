const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const { createProviderPortalHandler } = require('../functions/providerPortal');
const { createProviderPortalAdminHandler } = require('../functions/providerPortalAdmin');
const { createPortalFileReader, portalFileGrantRef } = require('../functions/providerPortalFiles');

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/);
const deps = createRequire(require.resolve('../functions/package.json'));
const { Firestore, FieldValue } = deps('@google-cloud/firestore');
const db = new Firestore({ projectId: 'demo-goat-download-requests' });
const bytes = 'JVBERi0=';
const originalSha = 'a'.repeat(64);
const file = { path: 'providerFinance/own/record/receipt.pdf', fileName: 'receipt.pdf' };
const token = email => ({ email, email_verified: true, firebase: { sign_in_provider: 'google.com' } });
const request = (uid, action, fields = {}) => ({ auth: { uid, token: token(`${uid}@example.test`) }, data: { action, ...fields } });

test('providers can request and open exact original versions from their own files', async () => {
  let sha256 = originalSha;
  const readLocalFile = async source => ({ base64: bytes, sha256, path: source.path, fileName: source.fileName, contentType: 'application/pdf' });
  const sign = { readLocalFile };
  const timestamp = FieldValue.serverTimestamp;
  const portal = createProviderPortalHandler({ db, timestamp, sign, readFile: createPortalFileReader({ db, readLocalFile }) });
  const manage = createProviderPortalAdminHandler({ db, timestamp, sign });
  const grant = portalFileGrantRef(db, 'own', file);
  const work = db.doc('projects/project/areaExpenses/work');
  const transfer = { providerId: 'own', status: 'active', kind: 'payment', file, allocations: [{ projectId: 'project', collectionName: 'areaExpenses', itemId: 'work' }] };
  const record = db.doc('providerFinancialRecords/record');
  const source = { providerId: 'own', recordId: 'record', requestIfPending: true };
  const download = (uid = 'worker', fields = source) => portal(request(uid, 'download', fields));
  const pending = () => manage(request('admin', 'pendingFileDownloads'));
  const review = (action, fields = {}) => manage(request('admin', action, { requestId: grant.id, ...fields }));
  try {
    await Promise.all([
      db.doc('providerPortalConfig/current').set({ enabled: true }), db.doc('providers/own').set({ type: 'persona' }),
      db.doc('providers/other').set({ type: 'persona' }),
      db.doc('providerPortalUsers/worker/memberships/own').set({ status: 'active', email: 'worker@example.test' }),
      db.doc('providerPortalUsers/other/memberships/other').set({ status: 'active', email: 'other@example.test' }),
      db.doc('users/admin').set({ role: 'admin' }), work.set({ providerId: 'own' }), record.set(transfer),
    ]);
    await assert.rejects(download('other', { ...source, providerId: 'other' }), /ajeno/);
    await assert.rejects(manage(request('other', 'pendingFileDownloads')), /Sólo administración/);
    assert.equal((await grant.get()).exists, false);
    assert.deepEqual(await download(), { status: 'pending_review' });
    const firstRequest = await grant.get();
    assert.deepEqual(await download(), { status: 'pending_review' });
    assert((await grant.get()).updateTime.isEqual(firstRequest.updateTime));
    assert.equal((await pending()).files[0].providerId, 'own');
    assert.equal((await pending()).files.length, 1);
    assert.equal((await review('reviewFile')).sha256, originalSha);
    sha256 = 'b'.repeat(64);
    await assert.rejects(review('approveFile', { sha256: originalSha }), /cambió/);
    assert.deepEqual(await download(), { status: 'pending_review' });
    assert.equal((await review('reviewFile')).sha256, sha256);
    await review('approveFile', { sha256 });
    assert.equal((await pending()).files.length, 0);
    const original = await download();
    assert.equal(original.base64, bytes);
    assert.equal(original.path, undefined);
    assert.equal(original.sha256, sha256);
    await assert.rejects(download('other', { ...source, providerId: 'other' }), /ajeno/);
    await work.update({ providerId: 'other' });
    await assert.rejects(download(), /incluye terceros/);
    await work.update({ providerId: 'own' });
    sha256 = 'c'.repeat(64);
    assert.deepEqual(await download(), { status: 'pending_review' });
    await review('closeFileDownload');
    assert.equal((await pending()).files.length, 0);
    assert.deepEqual(await download(), { status: 'closed' });
  } finally {
    await db.terminate();
  }
});
