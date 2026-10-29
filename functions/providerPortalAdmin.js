const { HttpsError } = require("firebase-functions/v2/https");
const { createTeamOnboarding } = require('./teamOnboarding');
const { hasTeamWorkAccess } = require('./teamWorkAccess');
const { checkCompanyReview } = require('./providerRepresentation');

const { COMPANY_EVIDENCE, LEGACY_COMPANY_EVIDENCE } = require('./providerEvidence');
const { checkThirdPartyReview, thirdPartyIsCurrent, THIRD_PARTY_VERSIONS } = require('./providerThirdPartyDeclaration');
const {
  expenseInvoices,
  dateKey,
  fail,
  id,
  email,
  text,
  hash,
  list,
  accessCandidates,
} = require("./providerPortalModel");
function createProviderPortalAdminHandler({
  db,
  timestamp,
  sign,
  clock = () => new Date(),
  findAccount,
}) {
  return async (request) => {
    if (!request.auth?.uid || request.auth.token?.email_verified !== true)
      throw new HttpsError("unauthenticated", "Iniciá sesión.");
    const actor = {
      uid: request.auth.uid,
      email: email(request.auth.token.email),
    };
    const user = (await db.doc(`users/${actor.uid}`).get()).data();
    const input = request.data || {};
    const teamAccess = (await db.doc(`teamAccessEmails/${actor.email}`).get()).data();
    if (actor.email !== 'info@granbertafilms.com'
      && ((user?.teamOnboarding && !hasTeamWorkAccess(user)) || teamAccess?.status === 'pending'))
      throw new HttpsError('permission-denied', 'Completá el alta de equipo antes de acceder al trabajo.');
    if (['teamCreateInvite','teamReviews','resolveTeamProvider','reviewTeamAccess','reviewTeamProfile'].includes(input.action))
      return createTeamOnboarding({ db, timestamp, clock, findAccount }).admin(actor, input);
    const global =
      ["admin", "ayudante_admin"].includes(user?.role) ||
      actor.email === "info@granbertafilms.com";
    const projectAction = [
      "projectDocuments",
      "projectFile",
      "connectProject",
      "projectContractSource",
      "prepareProjectContract",
    ].includes(input.action);
    if (!global) {
      if (!projectAction)
        throw new HttpsError("permission-denied", "Sólo administración.");
      const projectId = id(input.projectId),
        p = (await db.doc(`projects/${projectId}`).get()).data(),
        c = (
          await db
            .doc(`projects/${projectId}/collaborators/${actor.email}`)
            .get()
        ).data();
      if (
        !(
          p?.createdBy === actor.uid ||
          c?.role === "admin" ||
          (c?.role === "jefe_produccion" &&
            list(c.allowedTabs).includes("documentos"))
        )
      )
        throw new HttpsError(
          "permission-denied",
          "No administrás documentos de este proyecto.",
        );
    }
    if (['projectContractSource', 'prepareProjectContract'].includes(input.action)) {
      const projectId = id(input.projectId);
      if (!global) {
        const p = (await db.doc(`projects/${projectId}`).get()).data();
        const c = (await db.doc(`projects/${projectId}/collaborators/${actor.email}`).get()).data();
        if (p?.createdBy !== actor.uid && c?.role !== 'admin') throw new HttpsError('permission-denied', 'Sólo administración puede preparar contratos para firma.');
      }
      if (input.action === 'projectContractSource') return sign.projectContractSource(projectId, id(input.documentId));
      return sign.prepareProjectContract({ ...input, projectId, documentId: id(input.documentId) }, actor);
    }
    if (input.action === "projectFile") {
      if (input.source === "portal_declaration") {
        const d = (
          await db
            .doc(`providerPortalDeclarations/${id(input.documentId)}`)
            .get()
        ).data();
        if (
          !d ||
          !list(d.content.projectIds).includes(input.projectId) ||
          (!global && d.content.projectIds.length > 1)
        )
          fail("Declaración fuera del alcance de este proyecto.");
        return sign.declarationFile(d.signing, input.artifact);
      }
      return sign.projectFile(
        id(input.projectId),
        id(input.documentId),
        input.artifact,
      );
    }
    if (input.action === "authorizations") {
      const providerId = id(input.providerId);
      const provider = (await db.doc(`providers/${providerId}`).get()).data();
      const rows = await db
        .collection("providerPortalDeclarations")
        .where("providerId", "==", providerId)
        .limit(501)
        .get();
      if (rows.size > 500) fail("Paginar declaraciones.");
      return {
        authorizations: rows.docs
          .map((s) => ({ id: s.id, ...s.data() }))
          .filter((d) => d.kind === "third_party" && d.proof?.complete)
          .map((d) => ({
            ...d,
            valid:
              provider?.type === "persona" && d.status === "active" && thirdPartyIsCurrent(d.content, clock()),
          })),
      };
    }
    if (input.action === 'evidenceFile') return sign.evidence.read(id(input.providerId), id(input.evidenceId), actor, true);
    if (input.action === 'companyHistory') {
      const providerId = id(input.providerId);
      const provider = (await db.doc(`providers/${providerId}`).get()).data();
      if (provider?.type !== 'empresa') fail('Esta ficha no es una empresa.');
      const rows = await db.collection('providerPortalDeclarations').where('providerId', '==', providerId).limit(201).get();
      if (rows.size > 200) fail('Administración debe paginar el historial.');
      return { declarations: rows.docs.map(row => ({ id: row.id, ...row.data() })).filter(d => d.kind === 'representation'), approval: (await db.doc(`providerPortalCompanyApprovals/${providerId}`).get()).data() || null };
    }
    if (input.action === "declarationFile") {
      const providerId = id(input.providerId),
        d = (
          await db
            .doc(`providerPortalDeclarations/${id(input.declarationId)}`)
            .get()
        ).data();
      if (!d || d.providerId !== providerId || !d.proof?.complete)
        fail("Declaración inexistente o ajena.");
      return sign.declarationFile(d.signing, input.artifact);
    }
    if (input.action === "prepareAccess") {
      const providers = await db.collection("providers").limit(10001).get();
      if (providers.size > 10000) fail("Prepará la migración por lotes.");
      const plan = accessCandidates(
        providers.docs.map((s) => ({ id: s.id, ...s.data() })),
      );
      if (input.apply === true) {
        if (user?.role !== "admin" && actor.email !== "info@granbertafilms.com")
          throw new HttpsError(
            "permission-denied",
            "Sólo administrador global.",
          );
        // Freeze the access email separately; later contact edits must never grant representation.
        for (const candidate of plan.candidates.filter(
          (c) => c.status === "ready",
        )) {
          const providerRef = db.doc(`providers/${candidate.providerIds[0]}`);
          await db.runTransaction(async (tx) => {
            const p = (await tx.get(providerRef)).data();
            if (!p || email(p.portalAccessEmail || p.email) !== candidate.email)
              fail(
                "Cambió un correo mientras preparabas los accesos. Volvé a revisar.",
              );
            if (!p.portalAccessEmail)
              tx.update(providerRef, { portalAccessEmail: candidate.email });
          });
        }
        const generation = hash(plan);
        const writer = db.bulkWriter();
        const writes = [];
        for (const row of plan.candidates)
          writes.push(
            writer.set(db.doc(`providerPortalCandidates/${row.id}`), {
              ...row,
              generation,
              preparedAt: timestamp(),
              preparedBy: actor,
            }),
          );
        await Promise.all([Promise.all(writes), writer.close()]);
        await db.doc("providerPortalConfig/accessPreparation").set({
          generation,
          counts: {
            unique: plan.candidates.filter((c) => c.status === "ready").length,
            ambiguous: plan.candidates.filter((c) => c.status === "ambiguous")
              .length,
            missing: plan.missing.length,
          },
          at: timestamp(),
          actor,
        });
      }
      return {
        applied: input.apply === true,
        unique: plan.candidates.filter((c) => c.status === "ready").length,
        ambiguous: plan.candidates.filter((c) => c.status === "ambiguous"),
        missing: plan.missing,
      };
    }
    if (input.action === "reviews") {
      const records = await db
        .collection("providerPortalDeclarations")
        .where("status", "in", ["pending_review", "active"])
        .limit(201)
        .get();
      if (records.size > 200) fail("Paginar revisiones antes de continuar.");
      return {
        reviews: records.docs
          .map((s) => ({ id: s.id, ...s.data() }))
          .filter(
            (r) =>
              (r.kind !== 'profile' && r.status === "pending_review") ||
              (r.kind === "third_party" &&
                r.content.roles.some((role) => !r.decisions?.[role])),
          ),
      };
    }
    if (input.action === "setMembership") {
      let uid = input.uid ? id(input.uid) : null;
      const providerId = id(input.providerId);
      const provider = await db.doc(`providers/${providerId}`).get();
      if (!provider.exists) fail("Proveedor inexistente.");
      const accountEmail = email(input.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail))
        fail("Email inválido.");
      if (!["needs_confirmation", "revoked"].includes(input.status))
        fail("Estado inválido.");
      if (input.status !== "revoked" || !uid) {
        if (!findAccount) fail("Falta la consulta segura de cuentas.");
        let account;
        try {
          account = await findAccount(accountEmail);
        } catch {
          fail(
            "La persona debe haber ingresado con ese correo. Asociá una cuenta verificada.",
          );
        }
        if (
          !account ||
          (input.status !== "revoked" &&
            (account.disabled || !account.emailVerified)) ||
          email(account.email) !== accountEmail ||
          (uid && uid !== account.uid)
        )
          fail("La cuenta debe haber ingresado y verificado su correo.");
        uid = id(account.uid);
      }
      const membershipRef = db.doc(
        `providerPortalUsers/${uid}/memberships/${providerId}`,
      );
      await db.runTransaction(async (tx) => {
        const prior = (await tx.get(membershipRef)).data();
        const audit = db.collection("providerPortalAudit").doc();
        tx.set(membershipRef, {
          providerId,
          email: accountEmail,
          status: input.status,
          assignedAt: timestamp(),
          assignedBy: actor,
        });
        tx.create(audit, {
          action: "membership_changed",
          uid,
          providerId,
          previous: prior || null,
          status: input.status,
          actor,
          at: timestamp(),
        });
      });
      return { updated: true };
    }
    if (input.action === "review") {
      const ref = db.doc(
        `providerPortalDeclarations/${id(input.declarationId)}`,
      );
      const reason = text(input.reason, 1000);
      if (!reason) fail("Dejá el motivo de revisión.");
      if (!["approved", "rejected"].includes(input.decision))
        fail("Decisión inválida.");
      const preview = (await ref.get()).data();
      if (preview?.kind === "profile") fail("Los datos firmados se aplican desde la cuenta del proveedor, sin revisión administrativa.");
      let verifiedManifest = null;
      if (input.decision === 'approved' && preview?.kind === 'representation' && preview.content.evidence?.length) {
        verifiedManifest = await sign.evidence.manifest(preview.providerId, preview.actor, preview.content.evidence.map(e => e.id), preview.content.version === 'company-representation-v2' ? LEGACY_COMPANY_EVIDENCE : COMPANY_EVIDENCE);
      }
      return db.runTransaction(async (tx) => {
        const d = (await tx.get(ref)).data();
        if (
          !d ||
          !["pending_review", "active"].includes(d.status) ||
          !d.proof?.complete
        )
          fail("Declaración no revisable.");
        const providerRef = db.doc(`providers/${d.providerId}`);
        const p = (await tx.get(providerRef)).data();
        const audit = db.collection("providerPortalAudit").doc();
        if (d.kind === 'representation') {
          if (d.status !== 'pending_review') fail('La representación ya fue revisada.');
          const membershipRef = db.doc(`providerPortalUsers/${d.actor.uid}/memberships/${d.providerId}`);
          const membership = (await tx.get(membershipRef)).data();
          checkCompanyReview(d, p, membership, input);
          if (input.decision === 'approved') {
            if (!verifiedManifest || hash(verifiedManifest) !== hash(d.content.evidence)) fail('Los respaldos no coinciden con la declaración firmada.');
            tx.update(membershipRef, { status: 'active', representation: 'authorized_representative', declarationId: ref.id, companyReviewVersion: d.content.version, confirmedAt: timestamp() });
            tx.set(db.doc(`providerPortalCompanyApprovals/${d.providerId}`), { providerId: d.providerId, uid: d.actor.uid, email: d.actor.email, declarationId: ref.id, company: d.content.provider,
              scope: text(input.approvedScope, 500), version: d.content.version, contentHash: d.contentHash, reviewedBy: actor, reviewedAt: timestamp() });
            tx.update(providerRef, { portalAccessEmail: d.actor.email, updatedAt: timestamp() });
          }
          tx.update(ref, { status: input.decision === 'approved' ? 'applied' : 'rejected', review: { actor, decision: input.decision, reason,
            checks: Object.fromEntries(['companyVerified','identityVerified','authorityVerified','scopeVerified'].map(key => [key, input.checks?.[key] === true])), approvedScope: text(input.approvedScope, 500), previousAccessEmail: p.portalAccessEmail || p.email || '', at: timestamp() } });
        } else if (d.kind === "third_party") {
          if (p?.type !== "persona" && input.decision === "approved")
            fail("Esta alternativa requiere una ficha de persona física. Las empresas no pueden activar nuevas autorizaciones de terceros.");
          if (!thirdPartyIsCurrent(d.content, clock()) && input.decision === 'approved')
            fail("Autorización vencida.");
          const roles = list(input.roles);
          checkThirdPartyReview(d, roles, input);
          if (
            !roles.length ||
            roles.some((r) => !d.content.roles.includes(r) || d.decisions?.[r])
          )
            fail("Elegí funciones pendientes.");
          const payoutRefs = input.decision === 'approved' && THIRD_PARTY_VERSIONS.includes(d.content.termsVersion)
            ? d.content.workKeys.map(key => db.doc(`projects/${key}`)) : [];
          const payoutRows = await Promise.all(payoutRefs.map(ref => tx.get(ref)));
          if (payoutRows.some(row => !row.exists || row.data().providerId !== d.providerId)) fail('Un trabajo cambió de proveedor; prepará una nueva autorización.');
          const decisions = { ...(d.decisions || {}) };
          for (const role of roles)
            decisions[role] = {
              decision: input.decision,
              actor,
              reason,
              checks: Object.fromEntries(['fiscalFrameVerified','declaredPayeeChecked'].map(key => [key, input.checks?.[key] === true])),
              at: timestamp(),
            };
          const effectiveRoles = d.content.roles.filter(
            (r) => decisions[r]?.decision === "approved",
          );
          const pending = d.content.roles.some((r) => !decisions[r]);
          tx.update(ref, {
            decisions,
            effectiveRoles,
            status: effectiveRoles.length
              ? "active"
              : pending
                ? "pending_review"
                : "rejected",
          });
          payoutRefs.forEach(workRef => tx.update(workRef, { thirdPartyPayoutRequired: true }));
        } else fail("Tipo no revisable.");
        tx.create(audit, {
          declarationId: ref.id,
          providerId: d.providerId,
          actor,
          reason,
          decision: input.decision,
          roles: list(input.roles),
          at: timestamp(),
        });
        return { reviewed: true };
      });
    }
    if (input.action === "projectDocuments") {
      const projectId = id(input.projectId);
      const result = await sign.projectDocuments(projectId);
      return {
        ...result,
        documents: result.documents.map((d) => ({
          ...d,
          fileAvailable: global || !d.multiProject,
        })),
      };
    }
    if (input.action === "connectProject") {
      const projectId = id(input.projectId);
      const p = (await db.doc(`projects/${projectId}`).get()).data();
      if (!p) fail("Proyecto inexistente.");
      return sign.connectProject(projectId, p, actor);
    }
    if (input.action === "providerFiles") {
      const providerId = id(input.providerId),
        files = [];
      for (const c of ["budgetItems", "areaExpenses"]) {
        const rows = await db
          .collectionGroup(c)
          .where("providerId", "==", providerId)
          .limit(501)
          .get();
        if (rows.size > 500) fail("Paginar archivos.");
        for (const s of rows.docs) {
          if (
            !/^projects\/[^/]+\/(budgetItems|areaExpenses)\/[^/]+$/.test(
              s.ref.path,
            )
          )
            continue;
          const e = s.data(),
            workKey = s.ref.path.split("/").slice(1).join("/");
          for (const [kind, values] of Object.entries({
            invoice: expenseInvoices(e),
            other: list(e.otherReceipts),
            payment: list(e.paymentHistory).map((p) => p.receipt),
          }))
            values.forEach((f, index) => {
              if (f)
                files.push({
                  fileName: f.fileName || "Comprobante",
                  kind,
                  source: { workKey, kind, index },
                });
            });
        }
      }
      const records = await db
        .collection("providerFinancialRecords")
        .where("providerId", "==", providerId)
        .limit(501)
        .get();
      if (records.size > 500) fail("Paginar archivos.");
      for (const s of records.docs) {
        const r = s.data();
        if (r.file)
          files.push({
            fileName: r.file.fileName || r.number || "Comprobante",
            kind: r.kind,
            source: { recordId: s.id },
          });
      }
      return { files };
    }
    if (input.action === "approveFile" || input.action === "reviewFile") {
      // A human confirms this original contains only information publishable to this provider.
      const providerId = id(input.providerId);
      let file;
      if (input.recordId) {
        const r = (
          await db.doc(`providerFinancialRecords/${id(input.recordId)}`).get()
        ).data();
        if (r?.providerId !== providerId) fail("Comprobante ajeno.");
        file = r.file;
      } else {
        const [projectId, c, itemId] = text(input.workKey, 500).split("/");
        if (!["areaExpenses", "budgetItems"].includes(c))
          fail("Trabajo inválido.");
        const e = (
          await db.doc(`projects/${id(projectId)}/${c}/${id(itemId)}`).get()
        ).data();
        if (e?.providerId !== providerId) fail("Trabajo ajeno.");
        const index = Number(input.index);
        if (!Number.isInteger(index) || index < 0) fail("Documento inválido.");
        file =
          input.kind === "payment"
            ? list(e.paymentHistory)[index]?.receipt
            : input.kind === "other"
              ? list(e.otherReceipts)[index]
              : expenseInvoices(e)[index];
      }
      if (!file) fail("Sin original.");
      const original = await sign.readLocalFile(file);
      if (input.action === "reviewFile") {
        const { metadata: _metadata, path: _path, ...safe } = original;
        return safe;
      }
      if (input.sha256 !== original.sha256)
        fail("Primero descargá y revisá esta versión del original.");
      const fingerprint = hash(file);
      await db
        .doc(`providerPortalFileGrants/${hash({ providerId, fingerprint })}`)
        .set({
          providerId,
          fingerprint,
          sha256: original.sha256,
          actor,
          approvedAt: timestamp(),
          safeForProvider: true,
        });
      return { approved: true };
    }
    fail("Acción administrativa desconocida.");
  };
}
module.exports = { createProviderPortalAdminHandler };
