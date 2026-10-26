const { test } = require("node:test");
const assert = require("node:assert/strict");
const { authorizedParty } = require("./providerAuthorization");
const record = {
  thirdPartyAuthorizationId: "auth",
  providerId: "own",
  kind: "payment",
  payeeName: "Familiar",
  allocations: [
    { projectId: "p", collectionName: "areaExpenses", itemId: "e" },
  ],
};
const declaration = {
  kind: "third_party",
  providerId: "own",
  status: "active",
  proof: { complete: true },
  effectiveRoles: ["payment"],
  content: {
    expiresOn: "2026-12-31",
    party: { name: "Familiar", cuit: "20111111112" },
    workKeys: ["p/areaExpenses/e"],
  },
};
test("approved payment authority does not authorize an invoice, another work, another provider or a changed payee", () => {
  const date = new Date("2026-10-26T19:00Z");
  assert.equal(authorizedParty(record, declaration, date).role, "payment");
  for (const r of [
    { ...record, kind: "invoice", issuerCuit: "20111111112" },
    { ...record, providerId: "other" },
    { ...record, payeeName: "Different" },
    {
      ...record,
      allocations: [
        { projectId: "other", collectionName: "areaExpenses", itemId: "e" },
      ],
    },
  ])
    assert.throws(() => authorizedParty(r, declaration, date));
  for (const d of [
    { ...declaration, status: "revoked" },
    { ...declaration, effectiveRoles: [] },
    {
      ...declaration,
      content: { ...declaration.content, expiresOn: "2026-01-01" },
    },
  ])
    assert.throws(() => authorizedParty(record, d, date));
});
test("authorization remains valid through its last day in Buenos Aires", () => {
  assert.equal(
    authorizedParty(
      record,
      {
        ...declaration,
        content: { ...declaration.content, expiresOn: "2026-10-26" },
      },
      new Date("2026-10-27T02:30:00Z"),
    ).role,
    "payment",
  );
  assert.throws(() =>
    authorizedParty(
      record,
      {
        ...declaration,
        content: { ...declaration.content, expiresOn: "2026-10-26" },
      },
      new Date("2026-10-27T03:00:00Z"),
    ),
  );
});
