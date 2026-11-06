import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceFileType, evidenceUploadFailure, uploadEvidenceBatch, verifyAndUploadEvidence, type PendingEvidence } from './providerEvidenceUpload';
import { verifyRegistrationSession } from './providerRegistrationFlow';
const file = (name = 'dni.pdf', type = 'application/pdf') => new File(['%PDF-fictitious'], name, { type });
const pending = (name = 'dni.pdf', attemptId = 'same-attempt') => ({ file: file(name), attemptId });
const problem = (code: string) => Object.assign(Error(code), { code });
const result = { id: 'evidence', kind: 'identity_document', fileName: 'dni.pdf', sha256: 'a'.repeat(64) };
test('an expired session stops before reading or uploading; Google opens synchronously from the recovery click', async () => {
  const item = pending(), calls: string[] = [];
  let fresh = false, userActivation = true;
  const deps = {
    verifySession: async () => { calls.push('session'); if (!fresh) throw problem('auth/requires-recent-login'); },
    read: async () => { calls.push('read'); return 'bytes'; },
    request: async () => { calls.push('upload'); return result; },
    onUploaded: () => { calls.push('confirmed'); },
  };
  await assert.rejects(uploadEvidenceBatch('company', 'identity_document', [item], deps), /requires-recent-login/);
  assert.deepEqual(calls, ['session']);
  calls.length = 0;
  const recovery = verifyAndUploadEvidence(() => {
    assert.equal(userActivation, true, 'popup is opened before any asynchronous file/token work');
    calls.push('popup'); fresh = true; return Promise.resolve();
  }, () => uploadEvidenceBatch('company', 'identity_document', [item], deps));
  assert.deepEqual(calls, ['popup']); userActivation = false;
  await recovery;
  assert.deepEqual(calls, ['popup', 'session', 'read', 'session', 'upload', 'confirmed']);
});
test('popup blocking or cancellation preserves the batch without reading or uploading', async () => {
  for (const code of ['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request']) {
    let uploads = 0;
    await assert.rejects(verifyAndUploadEvidence(() => Promise.reject(problem(code)), async () => { uploads++; }), (error: any) => error.code === code);
    assert.equal(uploads, 0);
    assert.equal(evidenceUploadFailure(problem(code)).verify, true);
    assert.match(evidenceUploadFailure(problem(code)).message, /mismo archivo|archivo sigue seleccionado/);
  }
});
test('a timeout on the second side retries only that side using the original attempt ID', async () => {
  let queue: PendingEvidence[] = [pending('front.pdf', 'front-id'), pending('back.pdf', 'back-id')];
  const attempts: string[] = [], uploaded: string[] = [];
  let timeout = true;
  const deps = {
    verifySession: async () => {}, read: async () => 'bytes',
    request: async (input: Record<string, unknown>) => {
      attempts.push(String(input.attemptId));
      if (input.attemptId === 'back-id' && timeout) throw problem('functions/deadline-exceeded');
      return { ...result, id: input.attemptId };
    },
    onUploaded: (item: PendingEvidence) => { uploaded.push(item.attemptId); queue = queue.filter(row => row.attemptId !== item.attemptId); },
  };
  await assert.rejects(uploadEvidenceBatch('company', 'identity_document', [...queue], deps));
  assert.deepEqual(uploaded, ['front-id']); assert.equal(queue[0].attemptId, 'back-id');
  timeout = false; await uploadEvidenceBatch('company', 'identity_document', [...queue], deps);
  assert.deepEqual(attempts, ['front-id', 'back-id', 'back-id']);
  assert.deepEqual(uploaded, ['front-id', 'back-id']); assert.deepEqual(queue, []);
});
test('an account change during file reading prevents sending private evidence', async () => {
  const account = { uid: 'original', email: 'company@example.test' };
  let user = { ...account, getIdTokenResult: async () => ({ signInProvider: 'google.com', claims: { email: account.email, email_verified: true, auth_time: Date.now() / 1000 } }) };
  let uploads = 0;
  await assert.rejects(uploadEvidenceBatch('company', 'identity_document', [pending()], {
    verifySession: () => verifyRegistrationSession(() => user, account),
    read: async () => { user = { ...user, uid: 'another' }; return 'bytes'; },
    request: async () => { uploads++; return result; }, onUploaded: () => {},
  }), /account-changed/);
  assert.equal(uploads, 0);
});
test('missing browser MIME types are inferred, invalid files fail locally, and uncertain responses remain retryable', async () => {
  assert.equal(evidenceFileType(file('dni.PDF', '')), 'application/pdf');
  assert.equal(evidenceFileType(file('dni.JPG', '')), 'image/jpeg');
  assert.equal(evidenceFileType(file('dni.png', '')), 'image/png');
  for (const invalid of [file('dni.exe', ''), new File([], 'dni.pdf'), new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'dni.pdf')]) assert.throws(() => evidenceFileType(invalid));
  let confirmations = 0;
  await assert.rejects(uploadEvidenceBatch('company', 'identity_document', [pending()], {
    verifySession: async () => {}, read: async () => 'bytes', request: async () => null,
    onUploaded: () => { confirmations++; },
  }), /confirmación/);
  assert.equal(confirmations, 0);
  assert.equal(evidenceUploadFailure(problem('evidence/invalid-response')).retry, true);
  assert.doesNotMatch(evidenceUploadFailure({ code: 'functions/internal', message: 'PRIVATE_STACK' }).message, /PRIVATE_STACK/);
});
