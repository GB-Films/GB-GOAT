const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createPortalFileReader } = require("./providerPortalFiles");
const file = {
  path: "projects/p/areaExpenses/e/comprobantes/receipt.pdf",
  portalSafe: true,
};
const context = {
  providerId: "own",
  workKey: "p/areaExpenses/e",
  kind: "payment",
};
function reader({
  grant,
  upload,
  metadata = {},
  sha256 = "a".repeat(64),
} = {}) {
  return createPortalFileReader({
    db: {
      doc: (path) => ({
        get: async () => ({
          data: () =>
            path.startsWith("providerPortalFileGrants/") ? grant : upload,
        }),
      }),
    },
    readLocalFile: async (f) => ({
      path: f.path,
      base64: "JVBERg==",
      fileName: "test.pdf",
      contentType: "application/pdf",
      sha256,
      metadata,
    }),
  });
}
test("untrusted portalSafe flags and forged paths cannot expose an original", async () => {
  await assert.rejects(reader()(file, context));
  await assert.rejects(
    reader()(
      { ...file, path: "administration/private/legal.pdf" },
      { ...context, kind: "invoice" },
    ),
  );
});
test("approval is bound to actual content; replacing a file invalidates its grant", async () => {
  const grant = { safeForProvider: true, sha256: "a".repeat(64) };
  const result = await reader({ grant })(file, context);
  assert.equal(result.base64, "JVBERg==");
  assert(!("metadata" in result));
  assert(!("path" in result));
  await assert.rejects(
    reader({ grant, sha256: "b".repeat(64) })(file, context),
  );
});
test("a correctly scoped fiscal invoice is readable, but a bank receipt still needs explicit publication", async () => {
  const metadata = {
    metadata: {
      projectId: "p",
      collectionName: "areaExpenses",
      expenseId: "e",
    },
  };
  await reader({ metadata })(file, { ...context, kind: "invoice" });
  await assert.rejects(reader({ metadata })(file, context));
  await assert.rejects(
    reader({
      metadata: {
        metadata: {
          projectId: "other",
          collectionName: "areaExpenses",
          expenseId: "e",
        },
      },
    })(file, { ...context, kind: "invoice" }),
  );
});
test("portal uploads must match the server-owned provider/work/path/content association", async () => {
  const upload = {
    providerId: "own",
    workKey: context.workKey,
    path: file.path,
    sha256: "a".repeat(64),
  };
  await reader({ upload })({ ...file, portalUploadId: "server-id" }, context);
  await assert.rejects(
    reader({ upload: { ...upload, providerId: "other" } })(
      { ...file, portalUploadId: "server-id" },
      context,
    ),
  );
});
