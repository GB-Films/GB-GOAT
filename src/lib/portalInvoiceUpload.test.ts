import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceFileType, invoiceWorkUnavailable, portalInvoiceFailure, submitPortalInvoice } from './portalInvoiceUpload';
import { verifyRegistrationSession } from './providerRegistrationFlow';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderInvoiceUpload } from '../components/ProviderInvoiceUpload';

const work = { key: 'project/areaExpenses/work', projectName: 'Proyecto', description: 'Servicio', invoiceCount: 0 };
const file = new File(['%PDF-fixture'], 'factura.pdf', { type: 'application/pdf' });
test('upload requires a selected empty work, accepts phone PDFs without MIME and rejects unsupported/oversized files', async () => {
  assert.equal(invoiceFileType(new File(['%PDF-x'], 'factura.PDF')), 'application/pdf');
  for (const f of [new File(['x'], 'f.heic', { type: 'image/heic' }), new File([], 'f.pdf'), { name: 'f.pdf', type: 'application/pdf', size: 2097153 }]) assert.throws(() => invoiceFileType(f));
  for (const w of [undefined, { ...work, invoiceCount: 1 }, { ...work, hasInvoice: true }, { ...work, thirdPartyPayoutRequired: true }]) assert(invoiceWorkUnavailable(w));
  let requests = 0;
  await assert.rejects(submitPortalInvoice({ providerId: 'p', work: { ...work, hasInvoice: true }, file, attemptId: 'a' }, {
    verifySession: async () => {}, read: async () => 'bytes', request: async () => { requests++; },
  }), /ya tiene una factura/);
  assert.equal(requests, 0);
});
test('stale Google session stops before file read; explicit verification allows the same selected file to upload', async () => {
  let fresh = false, reads = 0, sends = 0;
  const user = { uid: 'u', email: 'own@example.test', getIdTokenResult: async () => ({ signInProvider: 'google.com', claims: {
    email: 'own@example.test', email_verified: true, auth_time: fresh ? Date.now() / 1000 : 1,
  } }) };
  const deps = { verifySession: () => verifyRegistrationSession(() => user, user), read: async () => { reads++; return 'bytes'; },
    request: async (input: any) => { sends++; assert.equal(input.workKey, work.key); assert.equal(input.file.fileName, file.name); return { uploaded: true }; } };
  const input = { providerId: 'p', work, file, attemptId: 'stable-attempt' };
  await assert.rejects(submitPortalInvoice(input, deps), e => portalInvoiceFailure(e).verify === true);
  assert.equal(reads, 0); assert.equal(sends, 0);
  fresh = true;
  assert.equal((await submitPortalInvoice(input, deps)).uploaded, true);
  assert.equal(reads, 1); assert.equal(sends, 1);
});
test('account changes while reading prevent sending; ambiguous network retry retains work, file and attempt', async () => {
  let uid = 'first', requests = 0;
  await assert.rejects(submitPortalInvoice({ providerId: 'p', work, file, attemptId: 'a' }, {
    verifySession: async () => { if (uid !== 'first') throw Object.assign(Error(), { code: 'registration/account-changed' }); },
    read: async () => { uid = 'other'; return 'bytes'; }, request: async () => { requests++; },
  }), e => /cuenta no coincide/.test(portalInvoiceFailure(e).message));
  assert.equal(requests, 0);
  const sent: unknown[] = [], input = { providerId: 'p', work, file, attemptId: 'retry' };
  const deps = { verifySession: async () => {}, read: async () => 'bytes', request: async (payload: any) => {
    sent.push(payload); if (sent.length === 1) throw Object.assign(Error('lost response'), { code: 'functions/unavailable' }); return { uploaded: true, resumed: true };
  } };
  await assert.rejects(submitPortalInvoice(input, deps), e => /no se duplicará/.test(portalInvoiceFailure(e).message));
  assert.equal((await submitPortalInvoice(input, deps)).resumed, true);
  assert.deepEqual(sent[0], sent[1]);
});
test('upload failures tell the provider how to recover without exposing internal messages', () => {
  assert.equal(portalInvoiceFailure({ code: 'auth/popup-blocked' }).verify, true);
  assert.equal(portalInvoiceFailure({ code: 'functions/already-exists' }).refresh, true);
  assert.match(portalInvoiceFailure({ code: 'functions/failed-precondition', message: 'Este trabajo cambió de área.' }).message, /cambió/);
  assert(!portalInvoiceFailure({ code: 'functions/internal', message: 'private bank token' }).message.includes('private'));
});
test('invoice form identifies project/work, marks occupied work and requires an explicit submit without delete controls', () => {
  const html = renderToStaticMarkup(createElement(ProviderInvoiceUpload, { providerId: 'p', works: [work, { ...work, key: 'shared', hasInvoice: true }], onUploaded: async () => {} }));
  assert.match(html, /Proyecto y trabajo/); assert.match(html, /Proyecto · Servicio · Factura cargada/);
  assert.match(html, /type="file"/); assert.match(html, /type="button"[^>]*disabled=""[^>]*>Cargar factura/);
  assert(!html.includes('Eliminar')); assert(!html.includes('Reemplazar'));
});
