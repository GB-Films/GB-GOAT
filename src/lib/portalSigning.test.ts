import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSigningDni, personalSignatureFields, signingFailure, signingNextStep } from "./portalSigning";

const field = { id: "mine", signerEmail: "PERSONA@example.com", page: 2, x: .2, y: .7, w: .4, h: .12 };
test("only the current signer's real fields are selectable, without changing stored geometry", () => {
  const fields = [field, { ...field, id: "foreign", signerEmail: "other@example.com" }];
  assert.deepEqual(personalSignatureFields(fields, " persona@example.com "), [field]);
  assert.equal(personalSignatureFields(fields, "persona@example.com")[0], field);
  assert.deepEqual(personalSignatureFields(fields, ""), []);
  assert.deepEqual(personalSignatureFields(null, "persona@example.com"), []);
});
test("invalid page or field geometry cannot appear as a valid signing target", () => {
  for (const invalid of [{ page: 0 }, { page: 1.5 }, { x: -.1 }, { y: NaN }, { w: 0 }, { h: Infinity }, { x: .9 }, { y: .99 }, { id: "" }]) {
    assert.deepEqual(personalSignatureFields([{ ...field, ...invalid }], "persona@example.com"), []);
  }
});
test("DNI formatting is removed without silently accepting letters", () => {
  assert.equal(normalizeSigningDni(" 12.345.678 "), "12345678");
  assert.equal(normalizeSigningDni("12-345-678"), "12345678");
  assert.equal(normalizeSigningDni("12ABC345"), "12ABC345");
});

const complete = { preparing: false, hasUrl: true, loadError: '', ready: true, fieldCount: 1,
  selectedPage: 2, targetPage: 2, validDni: true, dniConfirmed: true, hasSignature: true, accepted: true };
test('guidance identifies every blocking requirement before allowing confirmation', () => {
  const cases = [
    [{ preparing: true }, 'preparing'], [{ hasUrl: false }, 'loading'],
    [{ loadError: 'PDF error' }, 'load_error'], [{ ready: false }, 'loading'],
    [{ fieldCount: 0, selectedPage: undefined }, 'unassigned'],
    [{ selectedPage: undefined }, 'field'], [{ validDni: false }, 'dni'],
    [{ dniConfirmed: false }, 'dni_confirmation'], [{ hasSignature: false }, 'signature'],
    [{ accepted: false }, 'consent'], [{}, 'ready'],
  ] as const;
  for (const [change, step] of cases) assert.equal(signingNextStep({ ...complete, ...change }).step, step);
  assert.match(signingNextStep({ ...complete, selectedPage: undefined }).message, /página 2/);
});
test('uncertain or already saved results require checking documents before another attempt', () => {
  for (const code of ['functions/deadline-exceeded', 'functions/unavailable', 'functions/internal',
    'auth/network-request-failed', 'functions/unauthenticated', 'functions/permission-denied', 'portal/signature-saved']) {
    assert.equal(signingFailure({ code }).checkDocuments, true, code);
  }
  assert.equal(signingFailure({ message: 'Failed to fetch' }).checkDocuments, true);
  assert.match(signingFailure({ code: 'portal/signature-saved' }).message, /quedó guardada/);
  assert.deepEqual(signingFailure({ code: 'functions/failed-precondition', message: 'Firebase: Revisá tu DNI. (functions/failed-precondition)' }),
    { checkDocuments: false, message: 'Revisá tu DNI.' });
});
