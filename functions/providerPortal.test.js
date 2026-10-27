const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("./providerPortalModel");
const { identity } = require("./providerPortal");
test("only verified Google identities are accepted, including existing non-Gmail accounts", () => {
  const base = {
    auth: {
      uid: "u",
      token: {
        email: "person@company.test",
        email_verified: true,
        firebase: { sign_in_provider: "google.com" },
        auth_time: Date.now() / 1000,
      },
    },
  };
  assert.equal(identity(base, true).email, "person@company.test");
  assert.equal(
    identity({ auth: { ...base.auth, token: { ...base.auth.token, email: " Person@Hotmail.com " } } }).email,
    "person@hotmail.com",
  );
  for (const token of [
    { email_verified: false },
    { firebase: { sign_in_provider: "password" } },
    { firebase: { sign_in_provider: "microsoft.com" } },
    { firebase: { sign_in_provider: "custom" }, identityProvider: "google.com" },
    { auth_time: 1 },
  ])
    assert.throws(() =>
      identity(
        { auth: { ...base.auth, token: { ...base.auth.token, ...token } } },
        true,
      ),
    );
});
test("candidate preparation keeps missing/duplicate/shared emails out of automatic association", () => {
  const plan = M.accessCandidates([
    { id: "a", email: " A@Company.test " },
    { id: "b", email: "a@company.test" },
    { id: "c", email: "" },
    { id: "d", email: "own@other.test" },
  ]);
  assert.deepEqual(plan.missing, ["c"]);
  assert.equal(
    plan.candidates.find((c) => c.email === "a@company.test").status,
    "ambiguous",
  );
  assert.equal(
    plan.candidates.find((c) => c.email === "own@other.test").status,
    "ready",
  );
});
test("profile declaration freezes old/new values and separates critical fields from ordinary updates", () => {
  const c = M.profileChanges(
    { address: "old", cuit: "20111111112" },
    { address: "new", cuit: "20222222223" },
  );
  assert.deepEqual(c.address, { before: "old", after: "new", critical: false });
  assert.equal(c.cuit.critical, true);
  for (const changes of [
    { role: "admin" },
    { uid: "else" },
    { portalAccessEmail: "else@a.test" },
    { bankAccount_cbu: "bad" },
    {},
  ])
    assert.throws(() => M.profileChanges({}, changes));
});
test("third-party authorization is scoped to own selected work and does not imply a payment", () => {
  const p = {
    name: "Tercero",
    cuit: "20111111112",
    holder: "Titular",
    alias: "alias.test",
    roles: ["payment"],
    workKeys: ["project/areaExpenses/own"],
    expiresOn: "2026-12-31",
  };
  const a = M.thirdParty(p, p.workKeys);
  assert.deepEqual(a.roles, ["payment"]);
  assert.match(a.terms, /no acredita un pago/);
  for (const c of [
    { workKeys: ["other/areaExpenses/foreign"] },
    { roles: ["admin"] },
    { roles: [] },
    { holder: "" },
    { expiresOn: "bad" },
  ])
    assert.throws(() => M.thirdParty({ ...p, ...c }, p.workKeys));
});
test("provider projection never exports account details, tokens, margin or notes and ignores inactive expense mirrors", () => {
  const item = {
    providerId: "a",
    total: 100,
    area: "Post",
    internalNotes: "secret",
    invoice: { url: "private-token" },
    paymentHistory: [{ id: "p", amount: 60, receipt: { url: "private-url" } }],
  };
  const out = M.ownExpense(
    item,
    { name: "Work", activeAreas: ["Post"], budgetTotal: 100000 },
    "projects/pr/areaExpenses/e",
  );
  assert.equal(out.paid, 60);
  assert.equal(out.payments[0].hasReceipt, true);
  assert(!JSON.stringify(out).includes("private"));
  assert(!JSON.stringify(out).includes("secret"));
  assert(!("budgetTotal" in out));
  assert.equal(
    M.ownExpense(item, { activeAreas: ["Post"] }, "projects/pr/budgetItems/e"),
    null,
  );
});
test("statement hash is canonical and changes with actor, representation or content", () => {
  assert.equal(M.hash({ a: 1, b: 2 }), M.hash({ b: 2, a: 1 }));
  assert.notEqual(
    M.hash({ provider: "a", cbu: "123" }),
    M.hash({ provider: "b", cbu: "123" }),
  );
});

test("file paths and long request keys remain scoped to the exact Sign document", () => {
  assert.equal(M.requestKey("x".repeat(400)).length, 400);
  assert.throws(() => M.requestKey("project/other"));
  assert.equal(
    M.signingPath("projects/p/documents/d/original.pdf", "p", "d", "original"),
    "projects/p/documents/d/original.pdf",
  );
  assert.throws(() =>
    M.signingPath(
      "projects/other/documents/private/original.pdf",
      "p",
      "d",
      "original",
    ),
  );
  assert.throws(() =>
    M.signingPath("projects/p/artifacts/other/signed.pdf", "p", "d", "signed"),
  );
});
