const { fail, id, text, hash, thirdPartyIdentity } = require("./providerPortalModel");

// Compatibility path for existing personal invitations; new registrations require an own bank account.
// The public SDK intake keeps its existing, stricter schema and permissions.
function createThirdPartyIntake({ db, timestamp, clock = () => new Date() }) {
  return async (actor, input) => {
    const values = input.form;
    if (!values || values.type !== "persona") fail("Esta alternativa es sólo para personas físicas.");
    const limits = { name: 160, lastName: 160, dni: 20, cuit: 30, phone: 60, address: 300, category: 100, categoryOther: 300, birthDate: 10, dietaryRestriction: 300, bankAccount_cbu: 22, bankAccount_alias: 100 };
    const form = {};
    for (const [key, max] of Object.entries(limits)) {
      if (typeof (values[key] ?? "") !== "string" || String(values[key] || "").length > max) fail("Revisá los datos del prestador.");
      form[key] = text(values[key], max);
    }
    for (const key of ["name", "lastName", "phone", "address", "category"]) if (!form[key]) fail("Completá los datos personales del prestador.");
    if (form.category === "Otra" && !form.categoryOther) fail("Indicá tu actividad como prestador.");
    const digits = value => value.replace(/\D/g, "");
    const dni = digits(form.dni), cuit = digits(form.cuit);
    if (!/^\d{7,9}$/.test(dni)) fail("Ingresá un DNI válido.");
    if (form.cuit && !/^\d{11}$/.test(cuit)) fail("El CUIT/CUIL propio debe tener 11 números o quedar vacío.");
    if (form.bankAccount_cbu && !/^\d{22}$/.test(form.bankAccount_cbu)) fail("CBU propio inválido.");
    if (input.personalAccountAccepted !== true) fail("Confirmá que la cuenta Google es personal y te pertenece.");
    if (String(values.email || "").trim().toLowerCase() !== actor.email) fail("La cuenta cambió. Volvé a confirmar el alta.");
    const party = thirdPartyIdentity(input.party || {});
    const token = id(input.inviteToken), attempt = id(input.attemptId);
    const providerId = `intake_${hash({ uid: actor.uid, token, attempt }).slice(0, 40)}`;
    const ref = db.doc(`providers/${providerId}`), inviteRef = db.doc(`providerInvites/${token}`);
    const intakeRef = db.doc(`providerPortalIntakeRequests/${providerId}`);
    const fingerprint = hash({ form, party, token, uid: actor.uid, email: actor.email });
    return db.runTransaction(async tx => {
      const previous = await tx.get(ref);
      if (previous.exists) {
        if (previous.data().intakeSubmissionHash !== fingerprint) fail("El alta ya se guardó con otros datos. Continuá desde Mi proveedor.");
        const captured = (await tx.get(intakeRef)).data();
        if (!captured || captured.submissionHash !== fingerprint) fail("Administración debe revisar la solicitud guardada antes de continuar.");
        return { providerId, status: "registered", resumed: true };
      }
      if (!form.bankAccount_cbu && !form.bankAccount_alias) fail("Completá tu CBU o alias propio. La autorización del tercero se gestiona después desde Mi proveedor.");
      const invite = (await tx.get(inviteRef)).data();
      if (!invite || invite.status !== "pending" || invite.used !== false) fail("Este enlace no está disponible. Pedí uno nuevo a administración.");
      if (invite.expiresAt != null && (!invite.expiresAt.toDate || invite.expiresAt.toDate() <= clock())) fail("El enlace de alta venció.");
      let targetRef = null, workKeys = [];
      if (invite.projectId || invite.expenseId || invite.collectionName) {
        const collectionName = invite.collectionName == null ? "areaExpenses" : invite.collectionName;
        if (!["areaExpenses", "budgetItems"].includes(collectionName)) fail("Trabajo de la invitación inválido.");
        targetRef = db.doc(`projects/${id(invite.projectId)}/${collectionName}/${id(invite.expenseId)}`);
        const target = (await tx.get(targetRef)).data();
        if (!target || target.providerId || target.providerName || target.paymentLocked === true || target.paid === true || (Array.isArray(target.paymentHistory) && target.paymentHistory.length)) fail("El trabajo ya no está disponible para esta alta.");
        workKeys = [targetRef.path.replace(/^projects\//, "")];
      }
      const identifiers = [["dni", dni], ...(cuit ? [["cuit", cuit]] : [])].map(([kind, value]) => ({ kind, value, ref: db.doc(`providerIdentifiers/${kind}_${value}`) }));
      for (const item of identifiers) if ((await tx.get(item.ref)).exists) fail(`Ya existe un proveedor con ese ${item.kind === "dni" ? "DNI" : "CUIT/CUIL"}.`);
      const now = timestamp();
      tx.create(ref, {
        ...form, type: "persona", fullName: `${form.name} ${form.lastName}`, dniNormalized: dni, cuitNormalized: cuit,
        email: actor.email, source: "provider_invite", inviteToken: token, createdAt: now, updatedAt: now,
        personalGoogleAccount: { version: "personal-google-v1", uid: actor.uid, email: actor.email, personalUse: true, acceptedAt: now },
        intakeSubmissionHash: fingerprint,
        thirdPartyIntakeId: providerId,
      });
      // Kept outside the broadly readable internal supplier catalog. Default rules deny SDK access.
      tx.create(intakeRef, { version: "third-party-intake-v1", providerId, party, workKeys, roles: ["invoice", "payment"], capturedByUid: actor.uid, capturedAt: now, submissionHash: fingerprint });
      for (const item of identifiers) tx.create(item.ref, { providerId, providerType: "persona", identifierType: item.kind, value: item.value, inviteToken: token, createdAt: now });
      // Personal access does not require a representation signature. The separate
      // third-party authorization still requires its own signature and review.
      tx.create(db.doc(`providerPortalUsers/${actor.uid}/memberships/${providerId}`), { providerId, email: actor.email, status: "active", representation: "own", activationMethod: "verified_google_no_signature", source: "personal_google_intake", createdAt: now });
      if (targetRef) tx.update(targetRef, { providerId, providerName: `${form.name} ${form.lastName}`, providerInviteAssignment: { token, providerId, assignedAt: now }, updatedAt: now });
      tx.update(inviteRef, invite.mode === "multi_use" ? { usageCount: Number(invite.usageCount || 0) + 1, lastUsedAt: now, lastProviderId: providerId, lastProviderType: "persona", updatedAt: now } : { used: true, status: "used", usedAt: now, providerId, providerType: "persona" });
      return { providerId, status: "registered" };
    });
  };
}
module.exports = { createThirdPartyIntake };
