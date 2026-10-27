import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { ref, getBytes } from "firebase/storage";
const require = createRequire(
  new URL("../functions/package.json", import.meta.url),
);
const admin = require("firebase-admin");
const { createProviderPortalHandler } = require("../functions/providerPortal");
const {
  createProviderPortalAdminHandler,
} = require("../functions/providerPortalAdmin");
const { createSignBridge } = require("../functions/providerPortalSign");
const { accessCandidates, hash } = require("../functions/providerPortalModel");
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_STORAGE_EMULATOR_HOST
)
  throw Error(
    "Local emulators are required; never run this test against production.",
  );
const projectId = "demo-goat-provider-portal";
const signRoot = resolve(
  process.env.GB_SIGN_TEST_ROOT || "../GB-Sign-provider-portal",
);
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
  storage: { rules: readFileSync("storage.rules", "utf8") },
});
const signEnv = await initializeTestEnvironment({
  projectId: "gb-sign-e1776",
  firestore: {
    rules: readFileSync(resolve(signRoot, "firestore.rules"), "utf8"),
  },
  storage: { rules: readFileSync(resolve(signRoot, "storage.rules"), "utf8") },
});
const app = admin.initializeApp({
  projectId,
  storageBucket: `${projectId}.appspot.com`,
});
const db = app.firestore();
const sign = createSignBridge(db);
const { createPortalFileReader } = require("../functions/providerPortalFiles");
const {
  createProviderFinanceHandler,
} = require("../functions/providerFinance");
const deps = {
  db,
  sign,
  timestamp: () => admin.firestore.FieldValue.serverTimestamp(),
  readFile: createPortalFileReader({ db, readLocalFile: sign.readLocalFile }),
  clock: () => new Date("2026-10-26T19:00:00Z"),
};
const portal = createProviderPortalHandler(deps),
  manage = createProviderPortalAdminHandler(deps);
const request = (uid, email, data) => ({
  auth: {
    uid,
    token: {
      email,
      email_verified: true,
      name: "Persona prueba",
      auth_time: Date.now() / 1000,
      firebase: { sign_in_provider: "google.com" },
    },
  },
  data,
});
const own = (data) => portal(request("own", "own@example.test", data));
const other = (data) => portal(request("other", "other@example.test", data));
const adminCall = (data) =>
  manage(request("admin", "admin@example.test", data));
const authContext = (uid) =>
  env.authenticatedContext(uid, {
    email_verified: true,
    email: `${uid}@example.test`,
    email_verified: true,
  });
async function signActual(declaration) {
  const entry = (await sign.list({ email: "own@example.test" })).find(
    (d) => d.documentId === declaration.id,
  );
  assert(entry);
  const script = `import {signDocument} from ${JSON.stringify(pathToFileURL(resolve(signRoot, "functions/index.js")).href)};const result=await signDocument.run(${JSON.stringify(
    {
      auth: {
        uid: "sign-own",
        token: {
          email: "own@example.test",
          email_verified: true,
          name: "Persona prueba",
          firebase: { sign_in_provider: "custom" },
          goatPortal: true,
          goatUid: "own",
          identityProvider: "google.com",
        },
      },
      data: {
        projectId: entry.projectId,
        docId: entry.documentId,
        requestId: entry.id,
        fieldId: entry.signatureFields[0].id,
        documentSha256: entry.sha256,
        signatureType: "typed",
        acceptedText:
          "Declaro que revisé este documento y acepto firmarlo electrónicamente con mi cuenta verificada, dejando constancia de mi identidad declarada, fecha y evidencia asociada al documento.",
        typedName: "Persona prueba",
        dni: "12345678",
      },
      rawRequest: { headers: {}, ip: "127.0.0.1" },
    },
  )});console.log(JSON.stringify(result));`;
  execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: signRoot,
    env: {
      ...process.env,
      GCLOUD_PROJECT: "gb-sign-e1776",
      GOOGLE_CLOUD_PROJECT: "gb-sign-e1776",
      FIREBASE_CONFIG: JSON.stringify({
        projectId: "gb-sign-e1776",
        storageBucket: "gb-sign-e1776.firebasestorage.app",
      }),
    },
    stdio: "pipe",
  });
}
try {
  await db.doc("providerPortalConfig/current").set({ enabled: true });
  await db
    .doc("users/admin")
    .set({ uid: "admin", role: "admin", email: "admin@example.test" });
  await db.doc("users/producer").set({
    uid: "producer",
    role: "jefe_produccion",
    email: "producer@example.test",
  });
  for (const [id, email] of [
    ["supplier", "own@example.test"],
    ["foreign", "other@example.test"],
  ])
    await db.doc(`providers/${id}`).set({
      name: id,
      type: "persona",
      cuit: "20111111112",
      email,
      address: "old",
      bankAccount_alias: "original.alias",
      internalNote: "never export",
    });
  await db.doc("clients/client").set({ secret: "private" });
  await db.doc("projects/project").set({
    name: "Project test",
    activeAreas: ["Campo"],
    collaboratorEmails: ["producer@example.test"],
  });
  await db.doc("projects/project/collaborators/producer@example.test").set({
    role: "jefe_produccion",
    allowedCategories: ["Campo"],
    allowedTabs: ["areas"],
  });
  await db.doc("projects/project/areaExpenses/work").set({
    providerId: "supplier",
    description: "Servicio propio",
    area: "Campo",
    total: 100,
    paymentHistory: [
      {
        id: "p1",
        amount: 50,
        receipt: { path: "receipt.pdf", fileName: "receipt.pdf" },
      },
    ],
  });
  await db.doc("projects/project/areaExpenses/foreign").set({
    providerId: "foreign",
    description: "Servicio ajeno",
    area: "Campo",
    total: 9000,
    paymentHistory: [],
  });
  await db
    .doc("projects/project/budgetItems/mirror")
    .set({ providerId: "supplier", area: "Campo", total: 100 });
  const plan = await adminCall({ action: "prepareAccess" });
  assert.equal(plan.unique, 2);
  assert.equal((await db.collection("providerPortalCandidates").get()).size, 0);
  await adminCall({ action: "prepareAccess", apply: true });
  const boot = await own({ action: "bootstrap" });
  assert.equal(boot.memberships.length, 1);
  assert.equal(boot.memberships[0].providerId, "supplier");
  assert.equal(boot.memberships[0].status, "needs_confirmation");
  await assert.rejects(
    own({ action: "overview", providerId: "supplier" }),
    /No representás/,
  );
  const representation = await own({
    action: "prepareRepresentation",
    providerId: "supplier",
    attemptId: "represent-1",
    capacity: "own",
  });
  await assert.rejects(
    own({
      action: "completeDeclaration",
      providerId: "supplier",
      declarationId: representation.id,
    }),
    /Falta completar/,
  );
  // Recover a timeout after Sign saved the original but before GOAT saved its link.
  await db
    .doc(`providerPortalDeclarations/${representation.id}`)
    .update({
      status: "preparing",
      signing: admin.firestore.FieldValue.delete(),
    });
  const recovered = await own({
    action: "prepareRepresentation",
    providerId: "supplier",
    attemptId: "represent-1",
    capacity: "own",
  });
  assert.equal(recovered.id, representation.id);
  assert.equal(recovered.status, "pending_signature");
  const requestDoc=(await sign.list({email:'own@example.test'})).find(d=>d.documentId===representation.id);
  const assignedFile=await own({action:'signingFile',documentId:representation.id,projectId:requestDoc.projectId,requestId:requestDoc.id,artifact:'original'});assert(assignedFile.sha256);
  await assert.rejects(own({action:'signingFile',documentId:representation.id,projectId:'other_project',requestId:requestDoc.id,artifact:'original'}));
  await signActual(representation);
  assert.equal(
    (
      await own({
        action: "completeDeclaration",
        providerId: "supplier",
        declarationId: representation.id,
      })
    ).status,
    "applied",
  );
  const view = await own({ action: "overview", providerId: "supplier" });
  assert.equal(view.works.length, 1);
  assert.equal(view.works[0].total, 100);
  assert(!JSON.stringify(view).includes("Servicio ajeno"));
  assert(!JSON.stringify(view).includes("internalNote"));
  assert(!JSON.stringify(view).includes("receipt.pdf"));
  await other({ action: "bootstrap" });
  await assert.rejects(other({ action: "overview", providerId: "supplier" }));
  await assert.rejects(
    own({
      action: "download",
      providerId: "foreign",
      workKey: "project/areaExpenses/foreign",
      kind: "invoice",
      index: 0,
    }),
  );
  // A signed upload is a document only. It neither creates a cost nor records another payment.
  const original = await sign.file(
    { email: "own@example.test" },
    representation.id,
    "original",
  );
  const upload = {
    action: "uploadInvoice",
    providerId: "supplier",
    workKey: "project/areaExpenses/work",
    attemptId: "upload1",
    file: {
      base64: original.base64,
      contentType: "application/pdf",
      fileName: "factura.pdf",
    },
  };
  await own(upload);
  await own({ ...upload, attemptId: "retry-different-id" });
  const invoiceExpense = (
    await db.doc("projects/project/areaExpenses/work").get()
  ).data();
  assert.equal(invoiceExpense.invoices.length, 1);
  assert.equal(invoiceExpense.total, 100);
  assert.equal(invoiceExpense.paymentHistory.length, 1);
  assert.equal(
    (
      await own({
        action: "download",
        providerId: "supplier",
        workKey: upload.workKey,
        kind: "invoice",
        index: 0,
      })
    ).sha256,
    original.sha256,
  );
  assert.equal(
    (
      await portal(
        request("producer", "producer@example.test", {
          action: "internalInvoice",
          uploadId: invoiceExpense.invoices[0].portalUploadId,
        }),
      )
    ).sha256,
    original.sha256,
  );
  await assert.rejects(
    other({
      action: "internalInvoice",
      uploadId: invoiceExpense.invoices[0].portalUploadId,
    }),
  );
  await assertFails(
    getBytes(
      ref(authContext("own").storage(), invoiceExpense.invoices[0].path),
    ),
  );
  const before = await db.doc("providers/supplier").get();
  const change = await own({
    action: "prepareProfile",
    providerId: "supplier",
    attemptId: "profile-1",
    changes: {
      address: "new",
      cuit: "20222222223",
      bankAccount_alias: "new.alias",
    },
  });
  await signActual(change);
  assert.equal(
    (
      await own({
        action: "completeDeclaration",
        providerId: "supplier",
        declarationId: change.id,
      })
    ).status,
    "pending_review",
  );
  const intermediate = (await db.doc("providers/supplier").get()).data();
  assert.equal(intermediate.address, "new");
  assert.equal(intermediate.cuit, before.data().cuit);
  assert.equal(intermediate.bankAccount_alias, "original.alias");
  await assert.rejects(
    manage(
      request("own", "own@example.test", {
        action: "review",
        declarationId: change.id,
        decision: "approved",
        reason: "forged",
      }),
    ),
  );
  await adminCall({
    action: "review",
    declarationId: change.id,
    decision: "approved",
    reason: "Identidad y cuenta cotejadas",
  });
  const after = (await db.doc("providers/supplier").get()).data();
  assert.equal(after.cuit, "20222222223");
  assert.equal(after.bankAccount_alias, "new.alias");
  assert.equal(
    (await db.doc("providerIdentifiers/cuit_20222222223").get()).data()
      .providerId,
    "supplier",
  );
  // The single personal email is not editable through ordinary profile changes.
  await assert.rejects(own({
    action: "prepareProfile",
    providerId: "supplier",
    attemptId: "contact-1",
    changes: { email: "different-contact@example.test" },
  }), /Dato no editable/);
  // A reviewed correction of a legacy record cannot transfer its frozen access.
  await db.doc("providers/supplier").update({ email: "different-contact@example.test" });
  await adminCall({ action: "prepareAccess", apply: true });
  const hijack = await portal(
    request("different-contact", "different-contact@example.test", {
      action: "bootstrap",
    }),
  );
  assert.equal(hijack.memberships.length, 0);
  assert.equal(
    (await own({ action: "bootstrap" })).memberships[0].status,
    "active",
  );

  assert.equal(
    (
      await own({
        action: "completeDeclaration",
        providerId: "supplier",
        declarationId: change.id,
      })
    ).status,
    "applied",
  );
  await assert.rejects(
    adminCall({
      action: "review",
      declarationId: change.id,
      decision: "approved",
      reason: "repeat",
    }),
  );
  const third = await own({
    action: "prepareThirdParty",
    providerId: "supplier",
    attemptId: "party-1",
    name: "Familiar",
    relationship: "Hermana del prestador",
    activity: "Fotografía",
    cuit: "20333333334",
    holder: "Familiar",
    alias: "family.alias",
    roles: ["payment", "invoice"],
    workKeys: ["project/areaExpenses/work"],
    expiresOn: "2026-12-31",
  });
  await signActual(third);
  await own({
    action: "completeDeclaration",
    providerId: "supplier",
    declarationId: third.id,
  });
  await adminCall({
    action: "review",
    declarationId: third.id,
    decision: "approved",
    roles: ["payment"],
    reason: "Beneficiario y cuenta verificados",
  });
  assert.deepEqual(
    (await db.doc(`providerPortalDeclarations/${third.id}`).get()).data()
      .effectiveRoles,
    ["payment"],
  );
  assert.equal(
    (await db.doc("projects/project/areaExpenses/work").get()).data()
      .paymentHistory.length,
    1,
  ); // A declaration never makes another payment.
  await adminCall({
    action: "review",
    declarationId: third.id,
    decision: "rejected",
    roles: ["invoice"],
    reason: "Encuadre fiscal no corresponde",
  });
  const finance = createProviderFinanceHandler({
    db,
    clock: () => new Date("2026-10-26T19:00Z"),
    timestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    verifyFile: async () => null,
    readFile: async () => "",
  });
  const actualPayment = {
    action: "create",
    id: "authorised-payment",
    providerId: "supplier",
    kind: "payment",
    date: "2026-10-26",
    net: 10,
    total: 10,
    currency: "ARS",
    method: "transfer",
    payeeName: "Familiar",
    account: "Test account",
    reference: "test-authorized",
    thirdPartyAuthorizationId: third.id,
    allocations: [
      {
        projectId: "project",
        collectionName: "areaExpenses",
        itemId: "work",
        amount: 10,
      },
    ],
  };
  await finance(request("admin", "admin@example.test", actualPayment));
  assert.equal(
    (await db.doc("providerFinancialRecords/authorised-payment").get()).data()
      .thirdPartyAuthorization.declarationId,
    third.id,
  );
  await own({
    action: "revokeThirdParty",
    providerId: "supplier",
    declarationId: third.id,
  });
  assert.equal(
    (await db.doc(`providerPortalDeclarations/${third.id}`).get()).data()
      .status,
    "revoked",
  );
  await assert.rejects(
    finance(
      request("admin", "admin@example.test", {
        ...actualPayment,
        id: "revoked-authority",
        reference: "test-revoked",
      }),
    ),
    /no está vigente/,
  );
  const tamper = await own({
    action: "prepareProfile",
    providerId: "supplier",
    attemptId: "tamper-1",
    changes: { address: "do not apply" },
  });
  const signApp = admin.app("provider-portal-sign");
  const signDb = signApp.firestore();
  const signDoc = (
    await signDb
      .doc(`projects/${tamper.signing.projectId}/documents/${tamper.id}`)
      .get()
  ).data();
  await signApp
    .storage()
    .bucket()
    .file(signDoc.storagePath)
    .save(Buffer.from("tampered"), {
      resumable: false,
      contentType: "application/pdf",
    });
  await assert.rejects(signActual(tamper), (e) =>
    String(e.stderr).includes("El original cambió"),
  );
  assert.equal(
    (
      await signDb
        .doc(`projects/${tamper.signing.projectId}/documents/${tamper.id}`)
        .collection("signatures")
        .get()
    ).size,
    0,
  );
  const unverified = env
    .authenticatedContext("fake-producer", {
      email: "producer@example.test",
      email_verified: false,
    })
    .firestore();
  await assertFails(
    getDoc(doc(unverified, "projects/project/areaExpenses/work")),
  );
  const external = authContext("own").firestore(),
    producer = authContext("producer").firestore();
  for (const path of [
    "providers/supplier",
    "providers/foreign",
    "clients/client",
    "projects/project",
    "projects/project/areaExpenses/work",
    "users/admin",
  ])
    await assertFails(getDoc(doc(external, path)));
  await assertSucceeds(getDoc(doc(external, "users/own")));
  await assertFails(getDocs(collection(external, "providers")));
  await assertFails(getDocs(collection(external, "users")));
  await assertFails(
    setDoc(doc(external, "users/own"), {
      role: "colaborador",
      uid: "own",
      email: "own@example.test",
    }),
  );
  await assertFails(
    setDoc(doc(external, "providerPortalUsers/own/memberships/foreign"), {
      status: "active",
    }),
  );
  await assertFails(
    updateDoc(doc(external, `providerPortalDeclarations/${third.id}`), {
      status: "active",
    }),
  );
  await assertSucceeds(
    getDoc(doc(producer, "projects/project/areaExpenses/work")),
  );
  await assertSucceeds(getDoc(doc(producer, "providers/supplier")));
  const signContext = signEnv.authenticatedContext("sign-own", {
    email_verified: true,
    email: "own@example.test",
    email_verified: true,
  });
  await assertFails(
    updateDoc(
      doc(
        signContext.firestore(),
        `projects/${representation.signing.projectId}/documents/${representation.id}`,
      ),
      { sha256: "forged" },
    ),
  );
  const [pdf] = await app
    .storage()
    .bucket("gb-sign-e1776.firebasestorage.app")
    .file(
      `projects/${representation.signing.projectId}/documents/${representation.id}/original.pdf`,
    )
    .download();
  assert(pdf.length > 100);
  // New person intake: no invented fiscal/bank data, no company path, and real Sign evidence.
  const intakeParty = { name: "Familiar del nuevo prestador", relationship: "Hermana", activity: "Servicios de fotografía", cuit: "20333333334", holder: "Familiar", cbu: "", alias: "family.alias" };
  const intakeForm = { type: "persona", name: "Persona", lastName: "Nueva", dni: "23456789", cuit: "", phone: "1111111111", address: "Domicilio", category: "Otra", categoryOther: "Sonido", email: "own@example.test", bankAccount_cbu: "", bankAccount_alias: "" };
  const register = (changes = {}) => own({ action: "registerThirdPartyIntake", inviteToken: "new-person", attemptId: "new-person-1", form: intakeForm, party: intakeParty, personalAccountAccepted: true, ...changes });
  await db.doc("providerInvites/new-person").set({ status: "pending", used: false, projectId: "project", collectionName: "areaExpenses", expenseId: "new-person-work", expiresAt: admin.firestore.Timestamp.fromDate(new Date("2026-12-31")) });
  await db.doc("projects/project/areaExpenses/new-person-work").set({ providerId: "", providerName: "", description: "Sonido del prestador", area: "Campo", total: 200, paymentHistory: [], providerInviteLink: { status: "pending" } });
  const beforeIntake = (await db.collection("providers").get()).size;
  await assert.rejects(register({ form: { ...intakeForm, type: "empresa" } }), /sólo para personas/);
  await assert.rejects(register({ party: { ...intakeParty, relationship: "" } }), /relación/);
  await assert.rejects(register({ party: { ...intakeParty, activity: "" } }), /actividad/);
  await assert.rejects(register({ personalAccountAccepted: false }), /cuenta Google/);
  await assert.rejects(register({ form: { ...intakeForm, email: "other@example.test" } }), /cuenta cambió/);
  await assert.rejects(portal({ ...request("own", "own@example.test", { action: "registerThirdPartyIntake" }), auth: { ...request("own", "own@example.test", {}).auth, token: { email: "own@example.test", email_verified: true, firebase: { sign_in_provider: "password" } } } }), /Google/);
  assert.equal((await db.collection("providers").get()).size, beforeIntake);
  for (const [token, inviteChanges, targetChanges] of [
    ["intake-expired", { expiresAt: admin.firestore.Timestamp.fromDate(new Date(0)) }, null],
    ["intake-cancelled", { status: "cancelled" }, null],
    ["intake-used", { status: "used", used: true }, null],
    ["intake-paid-work", {}, { paymentLocked: true }],
    ["intake-assigned-work", {}, { providerId: "foreign" }],
  ]) {
    const invite = { status: "pending", used: false, expiresAt: admin.firestore.Timestamp.fromDate(new Date("2026-12-31")), ...inviteChanges };
    if (targetChanges) {
      Object.assign(invite, { projectId: "project", collectionName: "areaExpenses", expenseId: token });
      await db.doc(`projects/project/areaExpenses/${token}`).set({ providerId: "", paymentHistory: [], ...targetChanges });
    }
    await db.doc(`providerInvites/${token}`).set(invite);
    await assert.rejects(register({ inviteToken: token, attemptId: token }));
  }
  const added = await register();
  assert.equal((await register()).providerId, added.providerId);
  await assert.rejects(register({ party: { ...intakeParty, activity: "Otros servicios" } }), /otros datos/);
  const newProvider = (await db.doc(`providers/${added.providerId}`).get()).data();
  assert.equal(newProvider.cuit, ""); assert.equal(newProvider.bankAccount_alias, "");
  const intakeDraft = (await db.doc(`providerPortalIntakeRequests/${added.providerId}`).get()).data();
  assert.equal(newProvider.thirdPartyIntake, undefined, "third-party personal/bank data are not added to the broad supplier catalog");
  assert.equal(intakeDraft.party.relationship, "Hermana");
  assert.equal(intakeDraft.party.activity, "Servicios de fotografía");
  assert.deepEqual(intakeDraft.workKeys, ["project/areaExpenses/new-person-work"]);
  await assertFails(getDoc(doc(external, `providerPortalIntakeRequests/${added.providerId}`)));
  await assertFails(getDoc(doc(authContext("admin").firestore(), `providerPortalIntakeRequests/${added.providerId}`)));
  assert.equal((await db.doc("providerIdentifiers/cuit_20333333334").get()).exists, false, "the third party's CUIT never becomes the service provider's identifier");
  assert.equal((await db.doc("projects/project/areaExpenses/new-person-work").get()).data().providerId, added.providerId);
  assert.deepEqual((await db.doc("projects/project/areaExpenses/new-person-work").get()).data().paymentHistory, []);
  await assert.rejects(register({ attemptId: "new-person-again" }), /enlace no está disponible/);
  await db.doc("providerInvites/intake-duplicate").set({ status: "pending", used: false });
  await assert.rejects(register({ inviteToken: "intake-duplicate" }), /DNI/);
  const general = await register({ inviteToken: "intake-duplicate", attemptId: "general-legacy", form: { ...intakeForm, dni: "34567890" } });
  assert.deepEqual((await db.doc(`providerPortalIntakeRequests/${general.providerId}`).get()).data().workKeys, [], "a general legacy invitation never grants a global authorization");
  await db.doc("providerInvites/intake-multi").set({ status: "pending", used: false, mode: "multi_use", usageCount: 0 });
  const multi = await register({ inviteToken: "intake-multi", attemptId: "multi-use", form: { ...intakeForm, dni: "45678901", cuit: "20456789016", bankAccount_alias: "own.alias" } });
  assert.equal((await db.doc(`providers/${multi.providerId}`).get()).data().bankAccount_alias, "own.alias");
  await register({ inviteToken: "intake-multi", attemptId: "multi-use", form: { ...intakeForm, dni: "45678901", cuit: "20456789016", bankAccount_alias: "own.alias" } });
  assert.equal((await db.doc("providerInvites/intake-multi").get()).data().usageCount, 1);
  assert.equal((await db.doc("providerInvites/intake-multi").get()).data().used, false);
  await db.doc("providerInvites/intake-legacy-linked").set({ status: "pending", used: false, projectId: "project", expenseId: "legacy-intake-work" });
  await db.doc("projects/project/areaExpenses/legacy-intake-work").set({ providerId: "", providerName: "", area: "Campo", description: "Trabajo de enlace anterior", total: 200, paymentHistory: [] });
  const legacy = await register({ inviteToken: "intake-legacy-linked", attemptId: "legacy-linked", form: { ...intakeForm, dni: "56789012" } });
  assert.deepEqual((await db.doc(`providerPortalIntakeRequests/${legacy.providerId}`).get()).data().workKeys, ["project/areaExpenses/legacy-intake-work"]);
  assert.equal((await db.doc(`providerPortalUsers/own/memberships/${added.providerId}`).get()).data().status, "needs_confirmation");
  await assertFails(getDoc(doc(external, `providers/${added.providerId}`)));
  await assertFails(getDoc(doc(external, "projects/project/areaExpenses/foreign")));
  await assert.rejects(own({ action: "overview", providerId: added.providerId }), /No representás/);
  const newRepresentation = await own({ action: "prepareRepresentation", providerId: added.providerId, attemptId: "new-representation", capacity: "own" });
  await signActual(newRepresentation);
  await own({ action: "completeDeclaration", providerId: added.providerId, declarationId: newRepresentation.id });
  const afterRepresentation = await own({ action: "overview", providerId: added.providerId });
  assert.equal(afterRepresentation.thirdPartyIntake.party.relationship, "Hermana");
  const newThird = await own({ action: "prepareThirdParty", providerId: added.providerId, attemptId: "new-authorization", ...afterRepresentation.thirdPartyIntake.party, roles: ["invoice", "payment"], workKeys: afterRepresentation.thirdPartyIntake.workKeys, expiresOn: "2026-12-31" });
  await assert.rejects(other({ action: "completeDeclaration", providerId: added.providerId, declarationId: newThird.id }));
  assert.equal((await db.doc(`providerPortalDeclarations/${newThird.id}`).get()).data().status, "pending_signature");
  await assert.rejects(own({ action: "completeDeclaration", providerId: added.providerId, declarationId: newThird.id }), /Falta completar/);
  await signActual(newThird);
  await own({ action: "completeDeclaration", providerId: added.providerId, declarationId: newThird.id });
  const newReview = (await adminCall({ action: "reviews" })).reviews.find(d => d.id === newThird.id);
  assert.equal(newReview.content.party.activity, "Servicios de fotografía");
  assert.equal(newReview.status, "pending_review");
  await adminCall({ action: "review", declarationId: newThird.id, roles: ["invoice"], decision: "approved", reason: "Revisión de prueba en emulador" });
  assert.deepEqual((await db.doc(`providerPortalDeclarations/${newThird.id}`).get()).data().effectiveRoles, ["invoice"]);
  const companyRef = db.doc("providers/company-no-third");
  await companyRef.set({ type: "empresa", businessName: "Empresa de prueba", cuit: "30111111112" });
  await assert.rejects(finance(request("admin", "admin@example.test", { ...actualPayment, id: "company-third-payment-blocked", providerId: "company-no-third", thirdPartyAuthorizationId: newThird.id })), /Sólo personas físicas/);
  assert.equal((await db.doc("providerFinancialRecords/company-third-payment-blocked").get()).exists, false);
  await db.doc("providerPortalUsers/own/memberships/company-no-third").set({ email: "own@example.test", status: "active" });
  await assert.rejects(own({ action: "prepareThirdParty", providerId: "company-no-third", attemptId: "company-third", ...intakeParty, roles: ["payment"], workKeys: ["project/areaExpenses/new-person-work"], expiresOn: "2026-12-31" }), /empresas/);
  await db.doc("providers/unknown-type").set({ name: "Antecedente sin tipo" });
  await db.doc("providerPortalUsers/own/memberships/unknown-type").set({ email: "own@example.test", status: "active" });
  await assert.rejects(own({ action: "prepareThirdParty", providerId: "unknown-type", attemptId: "unknown-third", ...intakeParty, roles: ["payment"], workKeys: ["project/areaExpenses/new-person-work"], expiresOn: "2026-12-31" }), /persona física/);
  await db.doc("providerPortalDeclarations/company-pending-history").set({ kind: "third_party", providerId: "company-no-third", status: "pending_review", proof: { complete: true }, content: { roles: ["payment"], expiresOn: "2026-12-31" } });
  await assert.rejects(adminCall({ action: "review", declarationId: "company-pending-history", roles: ["payment"], decision: "approved", reason: "No permitida" }), /empresas/);
  assert.equal((await db.doc("providerPortalDeclarations/company-pending-history").get()).data().status, "pending_review");
  assert.equal((await db.collection("providers").get()).size, beforeIntake + 6);
  console.log("PASS: person intake without own CUIT/bank → representation → real GB Sign third-party declaration → role review; company, forgery, duplicate and work isolation guards.");
  console.log(
    "PASS: real GB Sign PDF/signature/artifacts → GOAT application; critical review, scoped third-party decisions, no duplicate payment; external isolation and producer access.",
  );
} finally {
  await env.cleanup();
  await signEnv.cleanup();
  await app.delete();
}
