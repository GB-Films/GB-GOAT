const { HttpsError } = require("firebase-functions/v2/https");
const logger = require('firebase-functions/logger');
const M = require("./providerPortalModel");
const { createPortalReimbursements, ownAdvanceFile } = require("./providerPortalReimbursements");
const { createPortalInvoiceUpload, createPortalInvoiceRemoval, portalInvoiceRows } = require("./providerPortalInvoice");
const { confirmationContent, confirmationState } = require('./providerProfileConfirmation');
const { approvedEin } = require('./providerFiscalIdentifierException');
const { createAccountChoiceService } = require('./providerAccountChoice');
const { createTeamOnboarding } = require('./teamOnboarding');
const { hasTeamWorkAccess } = require('./teamWorkAccess');
const { createThirdPartyIntake } = require("./providerIntake");
const { createProviderRegistration } = require('./providerRegistration');
const { rememberSignedRegistration } = require('./providerRegistrationEvidence');
const { createProviderRegistrationLookup } = require('./providerRegistrationLookup');
const { activatePersonalMembership, attachVerifiedIntakeMembership } = require('./providerPortalAccess');
const { DECLARED_COMPANY_EVIDENCE } = require('./providerEvidence');
const { companyRepresentation, assertCompanyAccount, DECLARED_COMPANY_VERSION } = require('./providerRepresentation');
const { applySignedCompanyRepresentation } = require('./signedCompanyRepresentation');
const { thirdPartyDeclaration, thirdPartyDetails } = require('./providerThirdPartyDeclaration');
const { applySignedProviderProfile } = require('./signedProviderProfile');
const { createSignedThirdPartyService, needsThirdPartyApplication } = require('./signedThirdPartyDeclaration');
const { administrativeRecordRef, isAdministrativeRecord, assertProviderPortalAllowed } = require('./providerAdministrativeRecords');
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
  findAccountByUid,
  registrationLog = (entry) => logger.warn('provider_registration_failed', entry),
}) {
  const uploadInvoice = createPortalInvoiceUpload({ db, sign, timestamp });
  const removeInvoice = createPortalInvoiceRemoval({ db, timestamp });
  const reimbursements = createPortalReimbursements({ db });
  const accountChoices = createAccountChoiceService({ db, timestamp, clock, verifyGoogleToken });
  const thirdParties = createSignedThirdPartyService({ db, timestamp, clock, sign });
  const teamOnboarding = createTeamOnboarding({ db, timestamp, clock });
  const registerThirdPartyIntake = createThirdPartyIntake({ db, timestamp, clock });
  const registerProvider = createProviderRegistration({ db, timestamp, clock });
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
    await assertProviderPortalAllowed(db, providerId);
    return row;
  };
  async function works(providerId, actor) {
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
        if (row) {
          if (actor) row.invoices = await portalInvoiceRows(db, doc.data(), row.key, providerId, actor);
          result.push(row);
        }
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
    if (decl.kind === 'third_party') return thirdParties.apply(ref);
    const applicable = value => value.status === 'pending_signature' || value.kind === 'profile' && value.status === 'pending_review';
    if (!applicable(decl)) return decl;
    const proof = await sign.verify(decl.signing, actor, decl.contentHash);
    if (!proof.complete)
      fail("Falta completar la firma y el PDF de evidencia.");
    if (decl.content.signerDni && proof.signerDni !== decl.content.signerDni) fail('El DNI de la firma no coincide con el DNI declarado. Prepará una declaración con los datos correctos.');
    if (decl.kind === 'representation' && decl.content.version === DECLARED_COMPANY_VERSION) {
      const evidence = await sign.evidence.manifest(decl.providerId, actor, decl.content.evidence.map(file => file.id), DECLARED_COMPANY_EVIDENCE);
      if (hash(evidence) !== hash(decl.content.evidence)) fail('Los respaldos no coinciden con la declaración firmada.');
    }
    let selectedAccount;
    if (decl.kind === 'profile' && decl.content.accountChoice?.changesIdentity) {
      if (!findAccountByUid) fail('No está disponible la comprobación de la cuenta elegida.');
      try { selectedAccount = await findAccountByUid(decl.content.accountChoice.selected.uid); }
      catch { fail('No pudimos comprobar la cuenta elegida. Verificala antes de aplicar.'); }
    }
    return db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data();
      const providerRef = db.doc(`providers/${decl.providerId}`);
      const provider = (await tx.get(providerRef)).data();
      const membershipRef = db.doc(
        `providerPortalUsers/${actor.uid}/memberships/${decl.providerId}`,
      );
      const membership = (await tx.get(membershipRef)).data();
      if (!applicable(current)) return current;
      if (current.contentHash !== decl.contentHash) fail('La declaración cambió mientras comprobabas la firma.');
      if (current.content.fiscalIdentifier?.type === 'EIN') {
        const exception = (await tx.get(db.doc(`providerFiscalIdentifierExceptions/${decl.providerId}`))).data();
        const approved = approvedEin(decl.providerId, provider, actor, exception);
        if (!approved || hash(approved) !== hash(current.content.fiscalIdentifier)) fail('La excepción del EIN cambió. Consultá a Gran Berta antes de aplicar la declaración.');
      }
      if (
        !membership ||
        !["active", "needs_confirmation"].includes(membership.status) || membership.email !== actor.email
      )
        throw new HttpsError("permission-denied", "Representación revocada.");
      const updates = {};
      let status = "signed";
      if (decl.kind === "representation") {
        if (current.content.version === DECLARED_COMPANY_VERSION) {
          await applySignedCompanyRepresentation({ db, tx, ref, declaration: current, providerRef, provider, membershipRef, membership, actor, proof, timestamp });
          status = 'applied';
        } else status = 'pending_review';
      }
      if (decl.kind === "profile") {
        if (membership.status !== 'active') throw new HttpsError('permission-denied', 'La cuenta aprobada ya no está activa para esta ficha.');
        const application = await applySignedProviderProfile({ db, tx, ref, declaration: current, providerRef, provider, membership, actor, selectedAccount, timestamp });
        status = 'applied';
        tx.update(ref, application);
      }
      const result = { ...current, status, proof, signedAt: timestamp() };
      tx.update(ref, {
        status,
        proof,
        signedAt: timestamp(),
        ...(decl.kind !== 'profile' ? { commonApplied: Object.keys(updates) } : {}),
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
    if (input.action === 'registrationStatuses') return createProviderRegistrationLookup({db})(actor, input);
    if (input.action === 'registerProvider') {
      const supportReference = typeof input.attemptId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.attemptId) ? input.attemptId : require('node:crypto').randomUUID();
      try {
        identity(request, true);
        return await registerProvider(actor, input);
      } catch (error) {
        // No form, identity, bank data or invitation tokens in diagnostics.
        const frames = typeof error.stack === 'string' ? error.stack.split('\n').slice(1,5).map(line => line.trim()) : [];
        registrationLog({ supportReference, code:String(error.code || 'unknown').slice(0,80), errorType:String(error.name || 'Error').slice(0,80), frames });
        if (error instanceof HttpsError) throw new HttpsError(error.code, error.message, { ...(error.details && typeof error.details === 'object' ? error.details : {}), supportReference });
        throw new HttpsError('internal', 'El servidor encontró un error al guardar el alta. Compartí la referencia con Gran Berta para revisar este intento.', { supportReference });
      }
    }
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
        const [providerRow, preparationRow, administrativeRow] = await Promise.all([tx.get(db.doc(`providers/${providerId}`)), tx.get(db.doc("providerPortalConfig/accessPreparation")), tx.get(administrativeRecordRef(db, providerId))]);
        const provider = providerRow.data(), preparation = preparationRow.data();
        if (
          !provider || isAdministrativeRecord(administrativeRow.data(), providerId) ||
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
        if (isAdministrativeRecord((await administrativeRecordRef(db, row.id).get()).data(), row.id)) return null;
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
      const authority = (await db.doc(`providerPortalCompanyApprovals/${providerId}`).get()).data();
      return { evidence: await sign.evidence.list(providerId, actor), pendingReview: own.some(d => d.status === 'pending_review'),
        authority: authority?.uid === actor.uid && membership.status === 'active' && membership.declarationId === authority.declarationId
          && authority.company?.name === text(provider.businessName || provider.name) && authority.company?.cuit === String(provider.cuit || provider.cuitNormalized || '').replace(/\D/g, '')
          ? { method: authority.method || 'administrative_review', signedAt: authority.signedAt || '', declarationId: authority.declarationId } : null,
        company: { name: provider.businessName || provider.name, cuit: provider.cuit || provider.cuitNormalized || '', registeredEmail: provider.personalGoogleAccount?.email || provider.portalAccessEmail || '' } };
    }
    if (input.action === "reimbursements") return reimbursements(providerId);
    if (input.action === "overview") {
      const provider = (await db.doc(`providers/${providerId}`).get()).data();
      const [work, financial, declarations, intake, preferences] = await Promise.all([
        works(providerId, actor),
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
      const declarationRows = await thirdParties.recover(declarations.docs);
      if (provider.registration?.status !== 'complete') await rememberSignedRegistration({db,timestamp,actor,providerId,
        declarations:declarations.docs.map(row=>({id:row.id,...row.data()}))});
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
        works: declarationRows.some((d, i) => d.status === 'active' && needsThirdPartyApplication(declarations.docs[i].data())) ? await works(providerId, actor) : work,
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
        declarations: declarationRows.map((r) => {
          return {
            id: r.id,
            kind: r.kind,
            status: r.status,
            content: r.content,
            signedAt: r.proof?.signedAt || "",
            signing: r.signing,
            decisions: r.decisions || {},
            commonApplied: r.commonApplied || [],
            owned: r.actor.uid === actor.uid,
            revocation: r.revocation || null,
            applicationIssue: r.applicationIssue || '',
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
      const fiscalIdentifier = ['representation', 'profile'].includes(kind)
        ? approvedEin(providerId, provider, actor, (await db.doc(`providerFiscalIdentifierExceptions/${providerId}`).get()).data()) : null;
      if (kind === "representation") {
        if (provider.type !== 'empresa') fail('El alta de una persona física no requiere firma de representación.');
        if (!["own", "authorized_representative"].includes(input.capacity))
          fail("Indicá en qué carácter actuás.");
        if (
          provider.type === "empresa" &&
          input.capacity !== "authorized_representative"
        )
          fail("Para una empresa indicá representante autorizado.");
        assertCompanyAccount(provider, actor, membership);
        content = companyRepresentation(provider, actor, input,
          await sign.evidence.manifest(providerId, actor, input.evidenceIds, DECLARED_COMPANY_EVIDENCE), fiscalIdentifier);
      }
      if (kind === "profile") {
        content = {
          application: 'signed_immediate',
          changes: M.ownAccountProfileChanges(provider, input.changes, input.ownAccountConfirmed, input.confirmProfile === true, fiscalIdentifier),
          terms:
            "Declaro que los cambios detallados son verídicos y autorizo su aplicación al completar la firma desde mi cuenta Google aprobada. No requieren una aprobación administrativa posterior.",
        };
        if (input.confirmProfile === true) {
          content.accountChoice = await accountChoices.resolve(providerId, actor, provider, input);
          if (String(provider.email || '') !== content.accountChoice.selected.email)
            content.changes.email = { before: String(provider.email || ''), after: content.accountChoice.selected.email, critical: true };
          content.confirmation = confirmationContent(provider, actor, content.changes, input, content.accountChoice, fiscalIdentifier);
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
      if (kind !== 'representation') content.provider = {
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
      if (fiscalIdentifier && String(content.provider.cuit || '').replace(/\D/g, '') === fiscalIdentifier.value) content.fiscalIdentifier = fiscalIdentifier;
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
      let file, advanceContext = {};
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
        const advance = ['advance', 'reimbursement'].includes(input.kind);
        if (advance) {
          const project = (await db.doc(`projects/${id(parts[0])}`).get()).data();
          if (!project || !e || !M.ownExpense(e, project, `projects/${parts.join('/')}`)) fail('El trabajo cambió. Actualizá tus reintegros.');
          const selected = ownAdvanceFile(e, providerId, input);
          file = selected.file; advanceContext = { paymentId: selected.paymentId, reimbursementId: selected.reimbursementId || '' };
        } else if (e?.providerId !== providerId)
          throw new HttpsError("permission-denied", "Trabajo ajeno.");
        const index = Number(input.index ?? (advance ? 0 : undefined));
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
        ...advanceContext,
      });
    }
    if (input.action === "removeInvoice") {
      identity(request, true);
      return removeInvoice({ providerId, actor, input });
    }
    if (input.action === "uploadInvoice") {
      identity(request, true);
      return uploadInvoice({ providerId, actor, input });
    }
    fail("Acción desconocida.");
  };
}
module.exports = { createProviderPortalHandler, identity, internalRoles };
