const { HttpsError } = require("firebase-functions/v2/https");
const M = require("./providerPortalModel");
const { createThirdPartyIntake } = require("./providerIntake");
const { fail, text, email, id, list, hash } = M;
const internalRoles = [
  "admin",
  "ayudante_admin",
  "jefe_produccion",
  "colaborador",
];
function identity(request, recent = false) {
  const auth = request.auth;
  if (!auth?.uid || !auth.token?.email)
    throw new HttpsError("unauthenticated", "Iniciá sesión.");
  if (
    auth.token.email_verified !== true ||
    auth.token.firebase?.sign_in_provider !== "google.com"
  )
    throw new HttpsError(
      "permission-denied",
      "Ingresá con tu cuenta Google y verificá tu correo.",
    );
  if (recent && Date.now() / 1000 - Number(auth.token.auth_time || 0) > 600)
    throw new HttpsError(
      "unauthenticated",
      "Volvé a iniciar sesión para confirmar los cambios.",
    );
  return {
    uid: auth.uid,
    email: email(auth.token.email),
    name: text(auth.token.name),
  };
}
function createProviderPortalHandler({
  db,
  timestamp,
  sign,
  readFile,
  clock = () => new Date(),
}) {
  const registerThirdPartyIntake = createThirdPartyIntake({ db, timestamp, clock });
  const config = async () => {
    if (
      (await db.doc("providerPortalConfig/current").get()).data()?.enabled !==
      true
    )
      fail("El portal todavía no está habilitado.");
  };
  const member = async (actor, providerId, active = true) => {
    const ref = db.doc(
      `providerPortalUsers/${actor.uid}/memberships/${id(providerId)}`,
    );
    const row = (await ref.get()).data();
    if (
      !row ||
      row.email !== actor.email ||
      !["active", ...(!active ? ["needs_confirmation"] : [])].includes(
        row.status,
      )
    )
      throw new HttpsError(
        "permission-denied",
        "No representás a este proveedor.",
      );
    return row;
  };
  async function works(providerId) {
    const snapshots = await Promise.all(
      ["budgetItems", "areaExpenses"].map((c) =>
        db
          .collectionGroup(c)
          .where("providerId", "==", providerId)
          .limit(501)
          .get(),
      ),
    );
    if (snapshots.some((s) => s.size > 500))
      fail("El historial requiere paginación administrativa.");
    const projects = new Map();
    const result = [];
    for (const snapshot of snapshots)
      for (const doc of snapshot.docs) {
        if (
          !/^projects\/[^/]+\/(budgetItems|areaExpenses)\/[^/]+$/.test(
            doc.ref.path,
          )
        )
          continue;
        const projectId = doc.ref.path.split("/")[1];
        if (!projects.has(projectId))
          projects.set(
            projectId,
            (await db.doc(`projects/${projectId}`).get()).data() || {},
          );
        const row = M.ownExpense(
          doc.data(),
          projects.get(projectId),
          doc.ref.path,
        );
        if (row) result.push(row);
      }
    return result;
  }
  async function syncDeclaration(ref, actor) {
    const snap = await ref.get();
    if (!snap.exists) fail("Declaración inexistente.");
    const decl = snap.data();
    if (decl.actor.uid !== actor.uid || decl.actor.email !== actor.email)
      throw new HttpsError(
        "permission-denied",
        "La declaración pertenece a otra cuenta.",
      );
    await member(actor, decl.providerId, false);
    if (decl.status === "preparing") {
      const signing = await sign.prepare({
        ...decl,
        id: ref.id,
        preparedAt: decl.createdAt?.toDate?.().toISOString() || "",
      });
      await db.runTransaction(async (tx) => {
        const row = (await tx.get(ref)).data();
        if (row.status === "preparing")
          tx.update(ref, { signing, status: "pending_signature" });
      });
      return syncDeclaration(ref, actor);
    }
    if (decl.status !== "pending_signature") return decl;
    const proof = await sign.verify(decl.signing, actor, decl.contentHash);
    if (!proof.complete)
      fail("Falta completar la firma y el PDF de evidencia.");
    return db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data();
      const providerRef = db.doc(`providers/${decl.providerId}`);
      const provider = (await tx.get(providerRef)).data();
      const membershipRef = db.doc(
        `providerPortalUsers/${actor.uid}/memberships/${decl.providerId}`,
      );
      const membership = (await tx.get(membershipRef)).data();
      if (current.status !== "pending_signature") return current;
      if (
        !membership ||
        !["active", "needs_confirmation"].includes(membership.status)
      )
        throw new HttpsError("permission-denied", "Representación revocada.");
      const updates = {};
      let status = "signed";
      if (decl.kind === "representation") {
        tx.update(membershipRef, {
          status: "active",
          representation: decl.content.capacity,
          declarationId: ref.id,
          confirmedAt: timestamp(),
        });
        status = "applied";
      }
      if (decl.kind === "profile") {
        for (const [key, change] of Object.entries(decl.content.changes)) {
          if (String(provider[key] ?? "") !== change.before)
            fail(
              "Los datos cambiaron mientras firmabas. Prepará una nueva declaración.",
            );
          if (!change.critical) updates[key] = change.after;
        }
        if (Object.keys(updates).length)
          tx.update(providerRef, {
            ...updates,
            portalRevision: Number(provider.portalRevision || 0) + 1,
          });
        status = Object.values(decl.content.changes).some((c) => c.critical)
          ? "pending_review"
          : "applied";
      }
      if (decl.kind === "third_party") status = "pending_review";
      const result = { ...current, status, proof, signedAt: timestamp() };
      tx.update(ref, {
        status,
        proof,
        signedAt: timestamp(),
        commonApplied: Object.keys(updates),
      });
      return result;
    });
  }
  return async (request) => {
    const actor = identity(request);
    const input = request.data || {};
    if (input.action === "internalInvoice") {
      const user = (await db.doc(`users/${actor.uid}`).get()).data();
      if (
        !internalRoles.includes(user?.role) &&
        actor.email !== "info@granbertafilms.com"
      )
        throw new HttpsError("permission-denied", "Sólo equipo autorizado.");
      const upload = (
        await db.doc(`providerPortalInvoiceUploads/${id(input.uploadId)}`).get()
      ).data();
      if (!upload) fail("Carga inexistente.");
      const [projectId, c, itemId] = upload.workKey.split("/");
      const project = (await db.doc(`projects/${projectId}`).get()).data();
      const collab = await db
        .doc(`projects/${projectId}/collaborators/${actor.email}`)
        .get();
      if (
        !(
          user?.role === "admin" ||
          actor.email === "info@granbertafilms.com" ||
          project?.createdBy === actor.uid ||
          list(project?.collaboratorEmails).includes(actor.email) ||
          collab.exists
        )
      )
        throw new HttpsError("permission-denied", "Proyecto ajeno.");
      const e = (
        await db.doc(`projects/${projectId}/${c}/${itemId}`).get()
      ).data();
      const file = list(e?.invoices).find(
        (f) => f.portalUploadId === input.uploadId,
      );
      if (!file) fail("El documento fue retirado.");
      return readFile(file, {
        providerId: upload.providerId,
        workKey: upload.workKey,
        kind: "invoice",
      });
    }
    await config();
    if (input.action === "registerThirdPartyIntake") {
      identity(request, true);
      return registerThirdPartyIntake(actor, input);
    }
    if (input.action === "bootstrap") {
      // Candidates are prepared by administration; ambiguous/shared email is never auto-associated.
      const candidateRef = db.doc(
        `providerPortalCandidates/${hash(actor.email)}`,
      );
      await db.runTransaction(async (tx) => {
        const candidate = (await tx.get(candidateRef)).data();
        if (
          !candidate ||
          candidate.email !== actor.email ||
          candidate.status !== "ready" ||
          candidate.providerIds.length !== 1
        )
          return;
        const providerId = id(candidate.providerIds[0]);
        const ref = db.doc(
          `providerPortalUsers/${actor.uid}/memberships/${providerId}`,
        );
        const prior = await tx.get(ref);
        const provider = (
          await tx.get(db.doc(`providers/${providerId}`))
        ).data();
        const preparation = (
          await tx.get(db.doc("providerPortalConfig/accessPreparation"))
        ).data();
        if (
          !provider ||
          candidate.generation !== preparation?.generation ||
          email(provider.portalAccessEmail) !== actor.email
        )
          return;
        if (!prior.exists)
          tx.create(ref, {
            providerId,
            email: actor.email,
            status: "needs_confirmation",
            createdAt: timestamp(),
            source: "verified_email_candidate",
          });
      });
      const memberships = await db
        .collection(`providerPortalUsers/${actor.uid}/memberships`)
        .get();
      const entries = [];
      for (const row of memberships.docs) {
        const m = row.data();
        if (
          !["active", "needs_confirmation"].includes(m.status) ||
          m.email !== actor.email
        )
          continue;
        const p = (await db.doc(`providers/${row.id}`).get()).data();
        if (!p) continue;
        entries.push({
          providerId: row.id,
          status: m.status,
          name: text(
            p.businessName || [p.name, p.lastName].filter(Boolean).join(" "),
          ),
          cuit: text(p.cuit),
          capacity: m.representation || "",
          type: p.type || "persona",
        });
      }
      return { memberships: entries, actor, signing: await sign.list(actor) };
    }
    if (input.action === "signingSession") return sign.session(actor);
    if (input.action === "myDocuments")
      return { documents: await sign.list(actor) };
    if (input.action === "signingFile")
      return sign.file(
        actor,
        id(input.documentId),
        input.artifact || "original",
        {
          projectId: id(input.projectId),
          requestId: M.requestKey(input.requestId),
        },
      );
    const providerId = id(input.providerId);
    const membership = await member(
      actor,
      providerId,
      input.action !== "prepareRepresentation" &&
        input.action !== "completeDeclaration",
    );
    if (input.action === "overview") {
      const provider = (await db.doc(`providers/${providerId}`).get()).data();
      const [work, financial, declarations, intake] = await Promise.all([
        works(providerId),
        db
          .collection("providerFinancialRecords")
          .where("providerId", "==", providerId)
          .limit(501)
          .get(),
        db
          .collection("providerPortalDeclarations")
          .where("providerId", "==", providerId)
          .limit(501)
          .get(),
        provider.type === "persona" ? db.doc(`providerPortalIntakeRequests/${providerId}`).get() : Promise.resolve(null),
      ]);
      if (financial.size > 500 || declarations.size > 500)
        fail("El historial requiere paginación.");
      // Only this provider's scoped data leave the boundary, never arbitrary financial fields or file tokens.
      return {
        provider: M.publicProfile(provider),
        thirdPartyIntake: intake?.data()?.providerId === providerId
          ? { party: intake.data().party, workKeys: intake.data().workKeys, roles: intake.data().roles }
          : null,
        works: work,
        financial: financial.docs.map((s) => {
          const r = s.data();
          return {
            id: s.id,
            kind: r.kind,
            status: r.status,
            date: r.date,
            currency: r.currency,
            totalCents: r.totalCents,
            number: r.number || "",
            title: r.title || "",
            issuerName: r.issuerName || "",
            allocations: list(r.allocations).map((a) => ({
              projectId: a.projectId,
              amountCents: a.amountCents,
            })),
            hasFile: Boolean(r.file),
          };
        }),
        declarations: declarations.docs.map((s) => {
          const r = s.data();
          return {
            id: s.id,
            kind: r.kind,
            status: r.status,
            content: r.content,
            signedAt: r.proof?.signedAt || "",
            signing: r.signing,
            decisions: r.decisions || {},
            commonApplied: r.commonApplied || [],
            owned: r.actor.uid === actor.uid,
            revocation: r.revocation || null,
          };
        }),
      };
    }
    if (
      input.action === "prepareRepresentation" ||
      input.action === "prepareProfile" ||
      input.action === "prepareThirdParty"
    ) {
      identity(request, true);
      const provider = (await db.doc(`providers/${providerId}`).get()).data();
      if (!provider) fail("Proveedor inexistente.");
      const kind =
        input.action === "prepareRepresentation"
          ? "representation"
          : input.action === "prepareProfile"
            ? "profile"
            : "third_party";
      let content;
      if (kind === "representation") {
        if (!["own", "authorized_representative"].includes(input.capacity))
          fail("Indicá en qué carácter actuás.");
        if (
          provider.type === "empresa" &&
          input.capacity !== "authorized_representative"
        )
          fail("Para una empresa indicá representante autorizado.");
        content = {
          capacity: input.capacity,
          terms:
            "Declaro que la cuenta Google con la que firmo me pertenece y es de uso personal; la utilizaré para ingresar a GOAT y firmar documentos. Identifico esta ficha como correspondiente al proveedor por cuya cuenta actúo, en el carácter declarado. Esta confirmación de representación no ratifica la exactitud de los datos administrativos anteriores; podré solicitar sus correcciones en Mis datos mediante una declaración específica.",
          personalAccountDeclarationVersion: "personal-google-v1",
          profile: {
            name: text(
              provider.businessName ||
                [provider.name, provider.lastName].filter(Boolean).join(" "),
            ),
            cuit: text(provider.cuit),
          },
        };
      }
      if (kind === "profile")
        content = {
          changes: M.profileChanges(provider, input.changes),
          terms:
            "Declaro que los cambios detallados son verídicos y solicito su uso administrativo desde su entrada en vigencia. CUIT, identidad y cuenta bancaria requieren revisión.",
        };
      if (kind === "third_party") {
        if (provider.type !== "persona") fail("Esta alternativa requiere una ficha de persona física. Las empresas no pueden solicitar facturación o cobro mediante terceros.");
        const work = await works(providerId);
        content = M.thirdParty(
          input,
          work.map((w) => w.key),
        );
        content.workDetails = work
          .filter((w) => content.workKeys.includes(w.key))
          .map((w) => ({
            key: w.key,
            projectName: w.projectName,
            description: w.description,
            total: w.total,
            currency: w.currency,
          }));
        content.projectIds = [
          ...new Set(content.workDetails.map((w) => w.key.split("/")[0])),
        ];
        if (content.expiresOn < M.dateKey(clock()))
          fail("La autorización ya está vencida.");
      }
      content.provider = {
        name: text(
          provider.businessName ||
            [provider.name, provider.lastName].filter(Boolean).join(" "),
        ),
        cuit: text(provider.cuit),
      };
      content.capacity =
        content.capacity ||
        membership.representation ||
        "authorized_representative";
      const contentHash = hash({ kind, providerId, actor, content });
      const declarationId = hash({
        uid: actor.uid,
        attempt: id(input.attemptId),
      });
      const ref = db.doc(`providerPortalDeclarations/${declarationId}`);
      const existing = await ref.get();
      if (existing.exists && existing.data().contentHash !== contentHash)
        fail("El intento anterior tiene otros datos.");
      if (!existing.exists)
        await ref.create({
          kind,
          providerId,
          actor,
          content,
          contentHash,
          status: "preparing",
          createdAt: timestamp(),
        });
      const current = (await ref.get()).data();
      if (current.status === "preparing") {
        const signing = await sign.prepare({
          id: declarationId,
          kind,
          providerId,
          actor,
          content,
          contentHash,
          preparedAt: current.createdAt?.toDate?.().toISOString() || "",
        });
        await db.runTransaction(async (tx) => {
          const row = (await tx.get(ref)).data();
          if (row.status === "preparing")
            tx.update(ref, { signing, status: "pending_signature" });
        });
      }
      return { id: declarationId, ...(await ref.get()).data() };
    }
    if (input.action === "completeDeclaration") {
      const ref = db.doc(
        `providerPortalDeclarations/${id(input.declarationId)}`,
      );
      if ((await ref.get()).data()?.providerId !== providerId)
        throw new HttpsError("permission-denied", "Proveedor incorrecto.");
      const result = await syncDeclaration(ref, actor);
      return { status: result.status };
    }
    if (input.action === "revokeThirdParty") {
      identity(request, true);
      const ref = db.doc(
        `providerPortalDeclarations/${id(input.declarationId)}`,
      );
      await db.runTransaction(async (tx) => {
        const r = (await tx.get(ref)).data();
        if (
          !r ||
          r.providerId !== providerId ||
          r.kind !== "third_party" ||
          !["active", "pending_review"].includes(r.status)
        )
          fail("Autorización no revocable.");
        tx.update(ref, {
          status: "revoked",
          revocation: { actor, at: timestamp() },
        });
      });
      return { status: "revoked" };
    }
    if (input.action === "download") {
      let file;
      if (input.recordId) {
        const r = (
          await db.doc(`providerFinancialRecords/${id(input.recordId)}`).get()
        ).data();
        if (!r || r.providerId !== providerId)
          throw new HttpsError("permission-denied", "Comprobante ajeno.");
        // Confirm every allocation belongs to this provider, even if an imported record is malformed.
        for (const a of list(r.allocations)) {
          const e = (
            await db
              .doc(
                `projects/${id(a.projectId)}/${["budgetItems", "areaExpenses"].includes(a.collectionName) ? a.collectionName : "invalid"}/${id(a.itemId)}`,
              )
              .get()
          ).data();
          if (e?.providerId !== providerId)
            fail(
              "El original incluye terceros. Pedí una constancia individual.",
            );
        }
        file = r.file;
      } else {
        const parts = text(input.workKey, 500).split("/");
        if (
          parts.length !== 3 ||
          !["budgetItems", "areaExpenses"].includes(parts[1])
        )
          fail("Trabajo inválido.");
        const e = (
          await db
            .doc(`projects/${id(parts[0])}/${parts[1]}/${id(parts[2])}`)
            .get()
        ).data();
        if (e?.providerId !== providerId)
          throw new HttpsError("permission-denied", "Trabajo ajeno.");
        const index = Number(input.index);
        if (!Number.isInteger(index) || index < 0 || index > 500)
          fail("Documento inválido.");
        if (input.kind === "invoice") file = M.expenseInvoices(e)[index];
        if (input.kind === "other") file = list(e.otherReceipts)[index];
        if (input.kind === "payment")
          file = list(e.paymentHistory)[index]?.receipt;
      }
      if (!file) fail("No hay original disponible.");
      return readFile(file, {
        providerId,
        workKey: input.workKey || "",
        kind: input.kind || "shared",
      });
    }
    if (input.action === "uploadInvoice") {
      identity(request, true);
      const parts = text(input.workKey, 500).split("/");
      if (
        parts.length !== 3 ||
        !["budgetItems", "areaExpenses"].includes(parts[1])
      )
        fail("Trabajo inválido.");
      const ref = db.doc(
        `projects/${id(parts[0])}/${parts[1]}/${id(parts[2])}`,
      );
      const current = (await ref.get()).data();
      if (current?.providerId !== providerId)
        throw new HttpsError("permission-denied", "Trabajo ajeno.");
      const result = await sign.storeInvoice({
        providerId,
        actor,
        attemptId: id(input.attemptId),
        file: input.file,
        workKey: input.workKey,
      });
      await db.runTransaction(async (tx) => {
        const e = (await tx.get(ref)).data();
        if (e?.providerId !== providerId)
          throw new HttpsError("permission-denied", "Trabajo ajeno.");
        const uploadRef = db.doc(
          `providerPortalInvoiceUploads/${result.portalUploadId}`,
        );
        const upload = await tx.get(uploadRef);
        if (upload.exists && upload.data().workKey !== input.workKey)
          fail("El intento pertenece a otro trabajo.");
        const invoices = list(e.invoices);
        if (invoices.some((f) => f.portalUploadId === result.portalUploadId))
          return;
        if (invoices.length >= 100)
          fail("Revisá el límite de archivos de este trabajo.");
        tx.update(ref, {
          invoices: [...invoices, result],
          updatedAt: timestamp(),
        });
        if (!upload.exists)
          tx.create(uploadRef, {
            workKey: input.workKey,
            providerId,
            actor,
            path: result.path,
            sha256: result.sha256,
            createdAt: timestamp(),
          });
      });
      return { uploaded: true };
    }
    fail("Acción desconocida.");
  };
}
module.exports = { createProviderPortalHandler, identity, internalRoles };
