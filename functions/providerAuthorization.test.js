const { test } = require("node:test");
const assert = require("node:assert/strict");
const { authorizedParty } = require("./providerAuthorization");
const record = {
  thirdPartyAuthorizationId: "auth",
  providerId: "own",
  kind: "payment",
  payeeName: "Familiar",
  method: 'transfer', account: '0000000000000000000001', payeeCuit: '20111111112',
  allocations: [
    { projectId: "p", collectionName: "areaExpenses", itemId: "e", invoiceId: 'invoice' },
  ],
};
const declaration = {
  kind: "third_party",
  providerId: "own",
  status: "active",
  proof: { complete: true },
  effectiveRoles: ["invoice", "payment"],
  content: {
    termsVersion: 'third-party-v3',
    expiresOn: "2026-12-31",
    party: { name: "Familiar", cuit: "20111111112", holderCuit: '20111111112', cbu: '0000000000000000000001' },
    workKeys: ["p/areaExpenses/e"],
  },
};
test("reviewed issuer and account cannot be swapped for another CUIT, account, work, provider or payee", () => {
  const date = new Date("2026-10-26T19:00Z");
  assert.equal(authorizedParty(record, declaration, date).role, "payment");
  for (const r of [
    { ...record, kind: "invoice", issuerCuit: "20111111113" },
    { ...record, account: '0000000000000000000002' },
    { ...record, payeeCuit: '20111111113' },
    { ...record, method: 'cash' },
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
    { ...declaration, effectiveRoles: ['payment'] },
    { ...declaration, content: { ...declaration.content, termsVersion: 'third-party-v2' } },
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
test('nuevas autorizaciones sin vencimiento siguen limitadas a trabajos y revocación; las anteriores conservan su fecha', () => {
  const content = { ...declaration.content, termsVersion: 'third-party-v4', validity: 'until_revoked' };
  delete content.expiresOn;
  const indefinite = { ...declaration, content };
  assert.equal(authorizedParty(record, indefinite, new Date('2035-01-01')).validity, 'until_revoked');
  assert.throws(() => authorizedParty(record, { ...indefinite, status: 'revoked' }));
  assert.throws(() => authorizedParty({ ...record, allocations: [{ projectId: 'new', collectionName: 'areaExpenses', itemId: 'e', invoiceId: 'invoice' }] }, indefinite));
  assert.throws(() => authorizedParty(record, { ...indefinite, content: { ...content, validity: undefined } }));
  assert.throws(() => authorizedParty(record, declaration, new Date('2027-01-02')));
});
