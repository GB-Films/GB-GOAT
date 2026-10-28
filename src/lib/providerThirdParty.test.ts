import assert from "node:assert/strict";
import test from "node:test";
import { emptyThirdParty, providerFiscalErrors, thirdPartyDraftErrors, initialThirdPartyCapture, thirdPartyCapture } from "./providerThirdParty";
const party = { ...emptyThirdParty, name: "Familiar", relationship: "Hermana", activity: "Fotografía", cuit: "20333333334", holder: "Familiar", alias: "alias.familiar" };
const own = { type: "persona", cuit: "", bankAccount_cbu: "", bankAccount_alias: "" };
test("third-party billing never exempts the supplier from supplying their own bank account", () => {
  assert.ok(providerFiscalErrors(own, true, party).bankAccount);
  assert.deepEqual(providerFiscalErrors({ ...own, bankAccount_alias: 'own.alias' }, true, party), {});
  assert.equal(own.cuit, ""); assert.equal(own.bankAccount_alias, "");
  assert.ok(providerFiscalErrors(own, false, party).cuit);
  assert.ok(providerFiscalErrors(own, false, party).bankAccount);
  assert.ok(providerFiscalErrors({ ...own, type: "empresa" }, true, party).thirdParty);
  assert.ok(providerFiscalErrors({ ...own, type: "empresa" }, true, party).cuit);
  assert.ok(providerFiscalErrors({ ...own, cuit: "123" }, true, party).cuit);
  assert.ok(providerFiscalErrors({ ...own, cuit: "20123456786" }, true, party, true).cuit);
});
test("third-party intake requires relationship, actual third-party activity, CUIT and bank holder/account", () => {
  assert.deepEqual(thirdPartyDraftErrors(party), {});
  for (const key of ["name", "relationship", "activity", "cuit", "holder", "alias"]) assert.ok(Object.keys(thirdPartyDraftErrors({ ...party, [key]: "" })).length);
  for (const invalid of [{ cuit: "123" }, { cbu: "123" }, { activity: "a".repeat(501) }]) assert.ok(Object.keys(thirdPartyDraftErrors({ ...party, ...invalid })).length);
  assert.ok(providerFiscalErrors(own, true, emptyThirdParty).thirdParty);
});
test("closing, reopening or changing type preserves the draft, and only saving a valid draft activates the exception", () => {
  let state = thirdPartyCapture(initialThirdPartyCapture, { type: "open" });
  state = thirdPartyCapture(state, { type: "edit", draft: { ...party, cuit: "123" } });
  state = thirdPartyCapture(state, { type: "save" });
  assert.equal(state.enabled, false); assert.equal(state.open, true);
  state = thirdPartyCapture(state, { type: "close" });
  state = thirdPartyCapture(state, { type: "open" });
  assert.equal(state.draft.cuit, "123");
  state = thirdPartyCapture(state, { type: "edit", draft: party });
  state = thirdPartyCapture(state, { type: "save" });
  assert.equal(state.enabled, true); assert.equal(state.open, false);
  state = thirdPartyCapture(state, { type: "changeType" });
  assert.equal(state.enabled, false); assert.deepEqual(state.draft, party);
  state = thirdPartyCapture(state, { type: "open" });
  assert.deepEqual(state.draft, party);
});
