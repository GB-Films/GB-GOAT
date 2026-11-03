const { HttpsError } = require('firebase-functions/v2/https');
const { hash, id, thirdPartyIdentity } = require('./providerPortalModel');
const { signedProfileRegistration } = require('./providerRegistrationEvidence');
const fail = message => { throw new HttpsError('failed-precondition', message); };
const digits = value => String(value || '').replace(/\D/g, '');
const fields = { name:160, lastName:160, businessName:160, dni:20, cuit:30, email:300, phone:60, address:300,
  birthDate:10, category:100, categoryOther:300, bankAccount_cbu:22, bankAccount_alias:100, dietaryRestriction:300 };
function validateRegistration(input, actor, allowEmptyCuit = false) {
  if (!input || !['persona','empresa'].includes(input.type) || Object.keys(input).some(k => k !== 'type' && !(k in fields))) fail('Revisá los datos del alta.');
  const form = { type:input.type };
  for (const [key,max] of Object.entries(fields)) {
    if (typeof (input[key] ?? '') !== 'string' || (input[key] || '').length > max) fail('Revisá los datos del alta.');
    form[key] = (input[key] || '').trim();
  }
  if (form.email.toLowerCase() !== actor.email) fail('Usá la cuenta Google con la que ingresaste.');
  form.email = actor.email;
  for (const key of ['phone','address','category', ...(form.type === 'persona' ? ['name','lastName'] : ['businessName'])]) if (!form[key]) fail('Completá los campos obligatorios.');
  if (form.type === 'persona' && !/^\d{7,9}$/.test(digits(form.dni))) fail('Revisá tu DNI.');
  if (!(allowEmptyCuit && !form.cuit) && !/^\d{11}$/.test(digits(form.cuit))) fail('Revisá tu CUIT/CUIL.');
  form.bankAccount_cbu = digits(form.bankAccount_cbu);
  if (form.bankAccount_cbu && !/^\d{22}$/.test(form.bankAccount_cbu)) fail('El CBU/CVU debe tener 22 números.');
  if (!form.bankAccount_cbu && !form.bankAccount_alias) fail('Completá tu CBU o alias propio.');
  if (form.category === 'Otra' && !form.categoryOther) fail('Indicá tu actividad.');
  if (form.birthDate && (!/^\d{4}-\d{2}-\d{2}$/.test(form.birthDate) || Number.isNaN(Date.parse(form.birthDate)) || new Date(form.birthDate).toISOString().slice(0,10) !== form.birthDate)) fail('Revisá la fecha de nacimiento.');
  return form;
}
function identifiers(provider) {
  const legacy = digits(provider.dni_cuit);
  return {
    dni: digits(provider.dniNormalized || provider.dni) || (legacy.length >= 7 && legacy.length <= 9 ? legacy : ''),
    cuit: digits(provider.cuitNormalized || provider.cuit) || (legacy.length === 11 ? legacy : ''),
  };
}
function hasRegistration(provider) {
  return !!provider.personalGoogleAccount?.uid || provider.registration?.status === 'complete'
    || ['provider_invite','team_onboarding'].includes(provider.source);
}
function assertProvisional(provider, form, actor) {
  if (hasRegistration(provider) || provider.personalGoogleAccount) fail('Esta ficha ya tiene un alta. Ingresá a Mi proveedor con la cuenta registrada.');
  // A prepared association can only be completed by its verified Google email.
  if ((provider.portalAccessEmail || provider.accessPreparation) && (!actor || String(provider.portalAccessEmail || '').trim().toLowerCase() !== actor.email)) fail('Esta ficha ya tiene un acceso asociado. Ingresá con esa cuenta o consultá a Gran Berta.');
  const prior = identifiers(provider), next = identifiers(form);
  if ((provider.type && provider.type !== form.type) || (provider.businessName && form.type !== 'empresa')
    || (prior.dni && (form.type !== 'persona' || prior.dni !== next.dni)) || (prior.cuit && prior.cuit !== next.cuit)) fail('El DNI y el CUIT no coinciden con la misma ficha. Revisá los datos o consultá a Gran Berta.');
}
function createProviderRegistration({ db, timestamp, clock = () => new Date(), legacyThirdPartyDraft = false }) {
  return async (actor, input) => {
    if (input.personalAccountAccepted !== true || input.ownAccountConfirmed !== true) fail('Confirmá que la cuenta Google y los datos bancarios son propios.');
    const form = validateRegistration(input.form, actor, legacyThirdPartyDraft), token = id(input.inviteToken), attempt = id(input.attemptId);
    const party = legacyThirdPartyDraft ? thirdPartyIdentity(input.party || {}) : null;
    const receiptRef = db.doc(`providerRegistrationSubmissions/${hash({ uid:actor.uid, token, attempt })}`);
    const fingerprint = hash({ form, party, uid:actor.uid, email:actor.email, token });
    const inviteRef = db.doc(`providerInvites/${token}`);
    const newRef = db.collection('providers').doc();
    return db.runTransaction(async tx => {
      const receipt = (await tx.get(receiptRef)).data();
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) fail('El alta ya se guardó con otros datos. Continuá desde Mi proveedor.');
        return { providerId:receipt.providerId, status:'registered', reused:receipt.reused, resumed:true };
      }
      const invite = (await tx.get(inviteRef)).data();
      if (!invite || invite.used !== false || invite.status !== 'pending') fail('Este enlace no está disponible. Pedí uno nuevo a Gran Berta.');
      if (invite.expiresAt != null && (!invite.expiresAt.toDate || invite.expiresAt.toDate() <= clock())) fail('Este link venció. Pedí uno nuevo a Gran Berta.');
      const values = identifiers(form);
      const keys = [...(form.type === 'persona' ? [['dni', values.dni]] : []), ...(values.cuit ? [['cuit', values.cuit]] : [])];
      const refs = keys.map(([kind,value]) => ({ kind,value,ref:db.doc(`providerIdentifiers/${kind}_${value}`) }));
      const indexRows = await Promise.all(refs.map(item => tx.get(item.ref)));
      if (indexRows.some(row => row.exists && (typeof row.data().providerId !== 'string' || !/^[\w-]{1,160}$/.test(row.data().providerId)))) fail('El identificador debe ser revisado por Gran Berta antes de completar el alta.');
      // Historical imports used formatted dni_cuit and may have no index. A bounded,
      // transactional catalog scan avoids treating an absent index as a new person.
      const catalog = await tx.get(db.collection('providers').limit(10001));
      if (catalog.size > 10000) fail('Gran Berta debe revisar el catálogo antes de completar el alta.');
      const matches = catalog.docs.filter(row => keys.some(([kind,value]) => identifiers(row.data())[kind] === value));
      const candidateIds = new Set([...matches.map(row => row.id), ...indexRows.filter(row => row.exists).map(row => row.data().providerId),
        ...(invite.provisionalProviderId ? [id(invite.provisionalProviderId)] : [])]);
      if (candidateIds.size > 1) fail('Hay más de una ficha con ese DNI o CUIT. Gran Berta debe unificarlas antes del alta.');
      const existingId = [...candidateIds][0];
      const previous = existingId ? catalog.docs.find(row => row.id === existingId) : null;
      if (existingId && !previous) fail('El identificador apunta a una ficha que debe revisar Gran Berta.');
      const providerRef = previous?.ref || newRef, providerId = providerRef.id;
      const membershipRef = db.doc(`providerPortalUsers/${actor.uid}/memberships/${providerId}`);
      if (previous) {
        assertProvisional(previous.data(), form, actor);
        const declarations = await tx.get(db.collection('providerPortalDeclarations').where('providerId','==',providerId).limit(501));
        if (declarations.size > 500) fail('Gran Berta debe revisar el historial antes de completar el alta.');
        if (declarations.docs.some(row => signedProfileRegistration(row.data()))) fail('Esta ficha ya tiene datos confirmados con firma. Actualizalos desde Mi proveedor.');
        // Unfiltered collection-group queries need no additional production index.
        // Check the document ID too: older memberships may omit providerId.
        const memberships = await tx.get(db.collectionGroup('memberships').limit(10001));
        if (memberships.size > 10000) fail('Gran Berta debe revisar las asociaciones antes de completar el alta.');
        if (memberships.docs.filter(row => row.id === providerId || row.data().providerId === providerId).some(row => row.ref.path !== membershipRef.path || row.data().email !== actor.email
          || !['active','needs_confirmation'].includes(row.data().status))) fail('Esta ficha ya tiene un acceso asociado. Consultá a Gran Berta.');
      }
      let targetRef = null, target = null;
      if (invite.projectId || invite.expenseId || invite.collectionName) {
        const collectionName = invite.collectionName || 'areaExpenses';
        if (!['areaExpenses','budgetItems'].includes(collectionName)) fail('El trabajo del link no es válido.');
        targetRef = db.doc(`projects/${id(invite.projectId)}/${collectionName}/${id(invite.expenseId)}`);
        target = (await tx.get(targetRef)).data();
        if (!target) fail('El gasto de este link ya no existe.');
        if (invite.provisionalProviderId) {
          if (!previous || invite.provisionalProviderId !== providerId || target.providerId !== providerId) fail('Este link corresponde a otra ficha provisoria. Revisá DNI y CUIT.');
          // Same provider ID: paid/locked rows are left byte-for-byte unchanged.
        } else if (target.providerId || target.providerName || target.paid === true || target.paymentLocked === true || (Array.isArray(target.paymentHistory) && target.paymentHistory.length)) {
          fail('El gasto ya tiene un proveedor o pagos. Pedí un link para completar la ficha existente.');
        }
      } else if (invite.provisionalProviderId) fail('El link de la ficha provisoria no tiene un trabajo válido.');
      const membership = (await tx.get(membershipRef)).data();
      if (membership && (membership.email !== actor.email || !['active','needs_confirmation'].includes(membership.status))) fail('Esta ficha ya tiene un acceso asociado. Consultá a Gran Berta.');
      const now = timestamp();
      const data = {
        ...form, name:form.type === 'empresa' ? form.businessName : form.name,
        lastName:form.type === 'persona' ? form.lastName : '',
        fullName:form.type === 'persona' ? `${form.name} ${form.lastName}` : form.businessName,
        dniNormalized:form.type === 'persona' ? values.dni : '', cuitNormalized:values.cuit,
        bankAccount_holder:form.type === 'persona' ? `${form.name} ${form.lastName}` : form.businessName,
        source:'provider_invite', inviteToken:token, updatedAt:now,
        personalGoogleAccount:{ version:'personal-google-v1', uid:actor.uid, email:actor.email, personalUse:true, acceptedAt:now },
        registration:{ status:'complete', completedAt:now, completedByUid:actor.uid, reusedProvisional:!!previous },
        ...(party ? {thirdPartyIntakeId:providerId} : {}),
      };
      if (previous) tx.update(providerRef, data);
      else tx.create(providerRef, { ...data, createdAt:now });
      for (let i=0;i<refs.length;i++) {
        const item=refs[i];
        if (!indexRows[i].exists) tx.create(item.ref, { providerId,providerType:form.type,identifierType:item.kind,value:item.value,inviteToken:token,createdAt:now });
      }
      const access = { providerId,email:actor.email,status:form.type === 'empresa' ? 'needs_confirmation' : 'active',representation:form.type === 'persona' ? 'own' : '',source:'verified_intake_uid',updatedAt:now };
      if (membership) tx.update(membershipRef,access);
      else tx.create(membershipRef,{...access,createdAt:now});
      if (targetRef && !invite.provisionalProviderId) tx.update(targetRef, { providerId,providerName:data.fullName,providerInviteAssignment:{token,providerId,assignedAt:now},updatedAt:now });
      tx.update(inviteRef, invite.mode === 'multi_use'
        ? { usageCount:Number(invite.usageCount || 0)+1,lastUsedAt:now,lastProviderId:providerId,lastProviderType:form.type,updatedAt:now }
        : { used:true,status:'used',usedAt:now,providerId,providerType:form.type });
      tx.create(receiptRef, { providerId,reused:!!previous,fingerprint,uid:actor.uid,createdAt:now });
      if (party) tx.create(db.doc(`providerPortalIntakeRequests/${providerId}`), { version:'third-party-intake-v1',providerId,party,
        workKeys:targetRef ? [targetRef.path.replace(/^projects\//,'')] : [],roles:['invoice','payment'],capturedByUid:actor.uid,capturedAt:now,submissionHash:fingerprint });
      tx.create(db.collection('providerPortalAudit').doc(), { action:previous ? 'provisional_provider_completed' : 'provider_registered',providerId,actor,inviteToken:token,before:previous?.data() || null,membershipBefore:membership || null,at:now });
      return { providerId,status:'registered',reused:!!previous };
    });
  };
}
module.exports = { createProviderRegistration, validateRegistration, identifiers, hasRegistration, assertProvisional };
