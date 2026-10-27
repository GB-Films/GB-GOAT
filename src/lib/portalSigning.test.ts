import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSigningDni, personalSignatureFields } from "./portalSigning";

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
