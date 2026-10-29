const { HttpsError } = require("firebase-functions/v2/https");
const M = require("./providerPortalModel");
const { confirmationContent, assertConfirmationUnchanged, confirmationState } = require('./providerProfileConfirmation');
const { createAccountChoiceService } = require('./providerAccountChoice');
const { createTeamOnboarding } = require('./teamOnboarding');
const { hasTeamWorkAccess } = require('./teamWorkAccess');
const { createThirdPartyIntake } = require("./providerIntake");
const { activatePersonalMembership, attachVerifiedIntakeMembership } = require('./providerPortalAccess');
const { COMPANY_EVIDENCE } = require('./providerEvidence');
const { companyRepresentation } = require('./providerRepresentation');
const { thirdPartyDeclaration, thirdPartyDetails } = require('./providerThirdPartyDeclaration');
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
  verifyGoogleToken,
}) {
  const accountChoices = createAccountChoiceService({ db, timestamp, clock, verifyGoogleToken });
  const teamOnboarding = createTeamOnboarding({ db, timestamp, clock });
  const registerThirdPartyIntake = createThirdPartyIntake({ db, timestamp, clock });
  const preferencesRef = (providerId, actor) => db.doc(`providerPortalPreferences/${hash({ providerId, uid: actor.uid })}`);
  async function saveThirdPartyDetails(providerId, actor, input) {
    const party = thirdPartyDetails(input);
    await db.runTransaction(async tx => {
      const p = (await tx.get(db.doc(`providers/${providerId}`))).data();
      const m = (await tx.get(db.doc(`providerPortalUsers/${actor.uid}/memberships/${providerId}`))).data();
      if (p?.type !== 'persona' || m?.status !== 'active' || m.email !== actor.email) fail('No podés guardar datos para esta ficha.');
      tx.set(preferencesRef(providerId, actor), { providerId, uid: actor.uid, email: actor.email, party, updatedAt: timestamp() });
    });
    return { party };
  }
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
    if (decl.content.signerDni && proof.signerDni !== decl.content.signerDni) fail('El DNI de la firma no coincide con el DNI declarado. Prepará una declaración con los datos correctos.');
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
        !["active", "needs_confirmation"].includes(membership.status) || membership.email !== actor.email
      )
        throw new HttpsError("permission-denied", "Representación revocada.");
      const updates = {};
      let status = "signed";
      if (decl.kind === "representation") {
        status = 'pending_review';
      }
      if (decl.kind === "profile") {
        if (decl.content.confirmation) assertConfirmationUnchanged(provider, decl.content.confirmation);
        if (decl.content.accountChoice && email(provider.portalAccessEmail || provider.email) !== decl.content.accountChoice.previousAccessEmail)
          fail('Cambió la cuenta de acceso mientras firmabas. Prepará una nueva confirmación.');
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
        status = Object.values(decl.content.changes).some((c) => c.critical) || decl.content.accountChoice?.changesIdentity
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
        !hasTeamWorkAccess(user) &&
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
    if (input.action === 'teamBootstrap') return teamOnboarding.bootstrap(actor, input);
    if (input.action === 'teamComplete') return teamOnboarding.submit(actor, input);
    if (input.action === "registerThirdPartyIntake") {
      identity(request, true);
      return registerThirdPartyIntake(actor, input);
    }
    if (input.action === "bootstrap") {
      const registrations = await db.collection('providers').where('personalGoogleAccount.uid', '==', actor.uid).limit(51).get();
      if (registrations.size > 50) fail('Administración debe revisar las fichas asociadas a esta cuenta.');
      for (const registration of registrations.docs) await attachVerifiedIntakeMembership({ db, actor, providerId: registration.id, timestamp });
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
        if (prior.exists) return;
        const [providerRow, preparationRow] = await Promise.all([tx.get(db.doc(`providers/${providerId}`)), tx.get(db.doc("providerPortalConfig/accessPreparation"))]);
        const provider = providerRow.data(), preparation = preparationRow.data();
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
      for (let offset = 0; offset < memberships.docs.length; offset += 8) {
        const batch = await Promise.all(memberships.docs.slice(offset, offset + 8).map(async row => {
        let m = row.data();
        if (
          !["active", "needs_confirmation"].includes(m.status) ||
          m.email !== actor.email
        )
          return null;
        const p = (await db.doc(`providers/${row.id}`).get()).data();
        if (!p) return null;
        if (m.status === 'needs_confirmation' && p.type === 'persona') {
          m = await activatePersonalMembership({ db, actor, providerId: row.id, timestamp });
          if (!m || !['active', 'needs_confirmation'].includes(m.status) || m.email !== actor.email) return null;
        }
        return {
          providerId: row.id,
          status: m.status,
          name: text(
            p.businessName || [p.name, p.lastName].filter(Boolean).join(" "),
          ),
          cuit: text(p.cuit),
          capacity: m.representation || "",
          type: p.type || "persona",
        };
        }));
        entries.push(...batch.filter(Boolean));
      }
      return { memberships: entries, actor, ...(input.includeDocuments === false ? {} : { signing: await sign.list(actor) }) };
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
        input.action !== "completeDeclaration" &&
        !['uploadEvidence', 'evidenceFile', 'companyState'].includes(input.action),
    );
    if (input.action === 'uploadEvidence') {
      identity(request, true);
      const provider = (await db.doc(`providers/${providerId}`).get()).data();
      return sign.evidence.upload(providerId, actor, input, provider?.type);
    }
    if (input.action === 'verifyAccount') return accountChoices.verify(providerId, actor, input);
    if (input.action === 'evidenceFile') return sign.evidence.read(providerId, id(input.evidenceId), actor);
    if (input.action === 'saveThirdPartyDetails') { identity(request, true); return saveThirdPartyDetails(providerId, actor, input); }
    if (input.action === 'companyState') {
      const provider = (await db.doc(`providers/${providerId}`).get()).data();
      if (provider?.type !== 'empresa') fail('Esta ficha no es una empresa.');
      const declarations = await db.collection('providerPortalDeclarations').where('providerId', '==', providerId).limit(501).get();
      if (declarations.size > 500) fail('Administración debe revisar el historial.');
      const own = declarations.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.kind === 'representation' && d.actor.uid === actor.uid);
      return { evidence: await sign.evidence.list(providerId, actor), pendingReview: own.some(d => d.status === 'pending_review'), company: { name: provider.businessName || provider.name, cuit: provider.cuit || provider.cuitNormalized || '' } };
    }
    if (input.action === "overview") {
      const provider = (await db.doc(`providers/${providerId}`).get()).data();
      const [work, financial, declarations, intake, preferences] = await Promise.all([
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
        provider.type === 'persona' ? preferencesRef(providerId, actor).get() : Promise.resolve(null),
      ]);
      if (financial.size > 500 || declarations.size > 500)
        fail("El historial requiere paginación.");
      // Only this provider's scoped data leave the boundary, never arbitrary financial fields or file tokens.
      return {
        provider: M.publicProfile(provider),
        profileConfirmation: confirmationState(provider, membership, actor, declarations.docs.map(s => ({ id: s.id, ...s.data() }))),
        thirdPartyDefaults: preferences?.data()?.uid === actor.uid && preferences.data().email === actor.email
          ? preferences.data().party
          : declarations.docs.map(doc => doc.data()).filter(d => d.kind === 'third_party' && d.actor.uid === actor.uid && d.actor.email === actor.email)
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))[0]?.content.party || null,
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
        if (provider.type !== 'empresa') fail('El alta de una persona física no requiere firma de representación.');
        if (!["own", "authorized_representative"].includes(input.capacity))
          fail("Indicá en qué carácter actuás.");
        if (
          provider.type === "empresa" &&
          input.capacity !== "authorized_representative"
        )
          fail("Para una empresa indicá representante autorizado.");
        content = companyRepresentation(provider, actor, input,
          await sign.evidence.manifest(providerId, actor, input.evidenceIds, COMPANY_EVIDENCE));
      }
      if (kind === "profile") {
        content = {
          changes: M.ownAccountProfileChanges(provider, input.changes, input.ownAccountConfirmed, input.confirmProfile === true),
          terms:
            "Declaro que los cambios detallados son verídicos y solicito su uso administrativo desde su entrada en vigencia. CUIT, identidad y cuenta bancaria requieren revisión.",
        };
        if (input.confirmProfile === true) {
          content.accountChoice = await accountChoices.resolve(providerId, actor, provider, input);
          if (String(provider.email || '') !== content.accountChoice.selected.email)
            content.changes.email = { before: String(provider.email || ''), after: content.accountChoice.selected.email, critical: true };
          content.confirmation = confirmationContent(provider, actor, content.changes, input, content.accountChoice);
          content.terms = content.confirmation.terms;
          if (provider.type !== 'empresa') content.signerDni = content.confirmation.profile.dni.replace(/\D/g, '');
        }
        if (input.ownAccountConfirmed === true) {
          const value = key => content.changes[key]?.after ?? provider[key] ?? '';
          if (value('bankAccount_cbu') || value('bankAccount_alias')) {
            const holder = provider.type === 'empresa' ? value('businessName') || provider.name : [value('name'), value('lastName')].filter(Boolean).join(' ');
            content.terms += ` Confirmo que la cuenta provista pertenece a ${holder}, proveedor de esta ficha.`;
            content.accountOwnership = { confirmed: true, holder, cbu: value('bankAccount_cbu'), alias: value('bankAccount_alias') };
          }
        }
      }
      if (kind === "third_party") {
        if (provider.type !== "persona") fail("Esta alternativa requiere una ficha de persona física. Las empresas no pueden solicitar facturación o cobro mediante terceros.");
        const work = await works(providerId);
        content = thirdPartyDeclaration(provider, actor, input, work.map(w => w.key));
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
      }
      content.provider = {
        name: text(
          provider.businessName ||
            [provider.name, provider.lastName].filter(Boolean).join(" "),
        ),
        cuit: text(provider.cuit),
      };
      if (content.confirmation) {
        const p = content.confirmation.profile;
        content.provider = { name: p.type === 'empresa' ? p.businessName || p.name : [p.name, p.lastName].filter(Boolean).join(' '), cuit: p.cuit };
      }
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
      let clientPreview = {};
      if (['preparing', 'pending_signature'].includes(current.status)) {
        const prepared = await sign.prepare({
          id: declarationId,
          kind,
          providerId,
          actor,
          content,
          contentHash,
          preparedAt: current.createdAt?.toDate?.().toISOString() || "",
        }, true);
        const { signingDocument, originalFile, ...signing } = prepared;
        clientPreview = { signingDocument, originalFile };
        await db.runTransaction(async (tx) => {
          const row = (await tx.get(ref)).data();
          if (row.status === "preparing")
            tx.update(ref, { signing, status: "pending_signature" });
        });
      }
      if (kind === 'third_party') await saveThirdPartyDetails(providerId, actor, content.party);
      return { id: declarationId, ...(await ref.get()).data(), ...clientPreview };
    }
    if (input.action === "completeDeclaration") {
      const ref = db.doc(
        `providerPortalDeclarations/${id(input.declarationId)}`,
      );
      if ((await ref.get()).data()?.providerId !== providerId)
        throw new HttpsError("permission-denied", "Proveedor incorrecto.");
      const result = await syncDeclaration(ref, actor);
      return { status: result.status, confirmation: !!result.content?.confirmation };
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
      if (current.thirdPartyPayoutRequired) fail('La factura del tercero debe registrarse con la autorización revisada desde la ficha completa de administración.');
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
        if (e.thirdPartyPayoutRequired) fail('Este trabajo requiere la factura y cuenta del tercero aprobadas por administración.');
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
