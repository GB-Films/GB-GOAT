const { HttpsError } = require('firebase-functions/v2/https');
const M = require('./providerPortalModel');
const { hasTeamWorkAccess } = require('./teamWorkAccess');
const { signedProfileRegistration } = require('./providerRegistrationEvidence');
const { isAdministrativeRecord, administrativeRecordRef } = require('./providerAdministrativeRecords');
const OWNER = 'info@granbertafilms.com';
const ROLES = ['colaborador', 'jefe_produccion', 'ayudante_admin', 'admin'];
const deny = message => { throw new HttpsError('permission-denied', message); };
const conflict = message => { throw new HttpsError('failed-precondition', message); };
const normalize = s => M.text(s, 500).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const registered = p => Boolean(p?.personalGoogleAccount?.uid || p?.registration?.status === 'complete' || ['provider_invite', 'team_onboarding'].includes(p?.source));
const personal = p => p && (!p.type || p.type === 'persona');
const accountEmail = p => M.email(p.personalGoogleAccount?.email || p.portalAccessEmail || p.email);
const identity = p => ({ type: p.type || 'persona', account: p.personalGoogleAccount || null, email: accountEmail(p), registration: p.registration || null, source: p.source || '' });
function verifiedAccount(account, expectedEmail, expectedUid) {
  if (!account || account.disabled || account.emailVerified !== true || M.email(account.email) !== expectedEmail
    || !account.providerData?.some(p => p.providerId === 'google.com') || expectedUid && account.uid !== expectedUid)
    conflict('La cuenta Google registrada no está disponible o no coincide con la ficha. La persona debe revisar su acceso en Mi proveedor.');
  return { uid: M.id(account.uid), email: M.email(account.email), name: M.text(account.displayName), photoURL: M.text(account.photoURL, 1000) };
}
function createTeamProviderAssignment({ db, timestamp, findAccount }) {
  async function assertAdmin(actor, tx) {
    const read = ref => tx ? tx.get(ref) : ref.get();
    const [user, gate] = await Promise.all([read(db.doc(`users/${M.id(actor.uid)}`)), read(db.doc(`teamAccessEmails/${actor.email}`))]);
    if (actor.email !== OWNER && (!hasTeamWorkAccess(user.data()) || user.data()?.role !== 'admin'
      || M.email(user.data()?.email) !== actor.email || gate.exists && gate.data().status !== 'ready')) deny('Sólo administración puede incorporar personas al equipo.');
  }
  async function catalog(tx) {
    const query = db.collection('providers').limit(2001);
    const rows = await (tx ? tx.get(query) : query.get());
    if (rows.size > 2000) conflict('El catálogo requiere paginación antes de incorporar personas. Contactá a administración.');
    return rows;
  }
  async function history(providerId, tx) {
    const query = db.collection('providerPortalDeclarations').where('providerId', '==', providerId).limit(501);
    const rows = await (tx ? tx.get(query) : query.get());
    if (rows.size > 500) conflict('El historial de esta ficha requiere revisión administrativa.');
    return rows.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  async function getAccount(p) {
    const target = accountEmail(p);
    if (!target || !/^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(target)) conflict('Esta ficha no tiene un correo de acceso registrado. La persona debe completar su alta primero.');
    if (p.personalGoogleAccount?.email && p.portalAccessEmail && M.email(p.personalGoogleAccount.email) !== M.email(p.portalAccessEmail)) conflict('La ficha tiene dos correos de acceso distintos. Revisá la asociación antes de incorporarla.');
    if (!findAccount) conflict('No está disponible la comprobación de cuentas. Volvé a intentar.');
    let account;
    try { account = await findAccount(target); }
    catch (error) {
      if (error?.code === 'auth/user-not-found') conflict('La persona todavía no ingresó con su cuenta Google registrada. Debe completar su acceso a Mi proveedor antes de incorporarla.');
      throw new HttpsError('unavailable', 'No pudimos comprobar la cuenta Google. Volvé a intentar; no se asignó ningún rol.');
    }
    return verifiedAccount(account, target, p.personalGoogleAccount?.uid);
  }
  async function context(actor, providerId, account, tx) {
    const read = ref => tx ? tx.get(ref) : ref.get();
    const [providers, membership, user, gate, administrative] = await Promise.all([
      catalog(tx), read(db.doc(`providerPortalUsers/${account.uid}/memberships/${providerId}`)),
      read(db.doc(`users/${account.uid}`)), read(db.doc(`teamAccessEmails/${account.email}`)), read(administrativeRecordRef(db, providerId)),
    ]);
    const provider = providers.docs.find(p => p.id === providerId)?.data();
    if (!personal(provider) || isAdministrativeRecord(administrative.data(), providerId)) conflict('Elegí una persona dada de alta, no una empresa o ficha administrativa.');
    if (accountEmail(provider) !== account.email || provider.personalGoogleAccount?.uid && provider.personalGoogleAccount.uid !== account.uid) conflict('La cuenta registrada cambió. Volvé a buscar y seleccionar a la persona.');
    const member = membership.data();
    if (!member || member.status !== 'active' || member.email !== account.email || member.representation && member.representation !== 'own') conflict('La persona no tiene un acceso personal activo a esta ficha. Debe revisar Mi proveedor antes de incorporarse.');
    const declarations = registered(provider) ? [] : await history(providerId, tx);
    if (!registered(provider) && !declarations.some(d => signedProfileRegistration(d, account))) conflict('Esta ficha es provisoria. La persona debe completar su alta antes de incorporarse al equipo.');
    if (providers.docs.some(p => p.id !== providerId && personal(p.data()) && registered(p.data())
      && (p.data().personalGoogleAccount?.uid === account.uid || accountEmail(p.data()) === account.email)))
      conflict('Esa cuenta está asociada a más de una ficha personal. Revisá la identidad antes de dar acceso al equipo.');
    const profile = user.data(), access = gate.data();
    if (access?.uid && access.uid !== account.uid) conflict('El correo de acceso quedó asociado a otra identidad. Revisá la asociación.');
    if (profile && (profile.uid && profile.uid !== account.uid || M.email(profile.email) !== account.email)) conflict('El perfil del equipo no coincide con la cuenta registrada. Revisá la asociación.');
    // Legacy profiles can retain mixed-case emails; exact queries must not miss
    // an older UID that would collide with this verified Google identity.
    const byEmailQuery = db.collection('users').limit(2001);
    const byEmail = await (tx ? tx.get(byEmailQuery) : byEmailQuery.get());
    if (byEmail.size > 2000) conflict('El directorio del equipo requiere paginación antes de incorporar personas.');
    if (byEmail.docs.some(d => d.id !== account.uid && M.email(d.data().email) === account.email)) conflict('Ese correo ya pertenece a otro usuario del equipo. Revisá la asociación.');
    let invite = null;
    if (access?.inviteToken) {
      invite = await read(db.doc(`userInvites/${M.id(access.inviteToken)}`));
      const i = invite.data();
      if (i && (M.email(i.email) !== account.email || i.acceptedBy && i.acceptedBy !== account.uid || i.usedBy && i.usedBy !== account.uid)) conflict('La invitación anterior pertenece a otra identidad. Revisá el acceso antes de continuar.');
    }
    const projectsQuery = db.collection('projects').limit(1001), projects = await (tx ? tx.get(projectsQuery) : projectsQuery.get());
    if (projects.size > 1000) conflict('Los permisos de proyectos requieren paginación antes de incorporar personas.');
    const assignments = [];
    for (let offset = 0; offset < projects.docs.length; offset += 40) {
      const group = projects.docs.slice(offset, offset + 40);
      const collabs = await Promise.all(group.map(p => read(p.ref.collection('collaborators').doc(account.email))));
      group.forEach((p, index) => {
        const data = p.data(), collaborator = collabs[index];
        if (data.createdBy === account.uid || collaborator.exists || M.list(data.collaboratorEmails).includes(account.email) || M.list(data.teamOnboardingBlockedEmails).includes(account.email))
          assignments.push({ project: p, collaborator });
      });
    }
    if (assignments.length > 200) conflict('Esta cuenta tiene demasiadas asignaciones previas para incorporarla en una sola operación.');
    const projectView = assignments.map(({ project, collaborator }) => ({ id: project.id, name: M.text(project.data().name || project.id),
      owner: project.data().createdBy === account.uid, role: collaborator.data()?.role || 'Acceso por proyecto',
      areas: M.list(collaborator.data()?.allowedCategories).map(a => M.text(a)) }));
    const alreadyMember = hasTeamWorkAccess(profile) && (!access || access.status === 'ready');
    const fingerprint = M.hash({ providerId, identity: identity(provider), registrationEvidence: declarations.filter(d => signedProfileRegistration(d, account)).map(d => d.id),
      account, member, user: profile ? { uid: profile.uid || '', email: profile.email, role: profile.role || '', teamOnboarding: profile.teamOnboarding || null } : null, gate: access || null,
      invite: invite?.data() || null, assignments: assignments.map(({ project, collaborator }) => ({ id: project.id, name: project.data().name || '', owner: project.data().createdBy || '',
        emails: project.data().collaboratorEmails || [], blocked: project.data().teamOnboardingBlockedEmails || [], collaborator: collaborator.data() || null })) });
    return { provider, profile, access, invite, assignments, fingerprint, alreadyMember,
      preview: { providerId, name: M.text(provider.fullName || [provider.name, provider.lastName].filter(Boolean).join(' ')), email: account.email,
        role: profile?.role || null, alreadyMember, projects: projectView, fingerprint } };
  }
  async function search(actor, input) {
    await assertAdmin(actor);
    if (typeof input.search !== 'string' || input.search.length > 120 || normalize(input.search).length < 2) conflict('Escribí al menos dos letras del nombre o correo.');
    const tokens = normalize(input.search).split(' '), providers = await catalog();
    const matches = providers.docs.filter(d => personal(d.data()) && tokens.every(token => normalize([d.data().fullName, d.data().name, d.data().lastName, accountEmail(d.data())].join(' ')).includes(token)));
    if (matches.length > 50) conflict('Hay muchas coincidencias. Agregá apellido o correo para precisar la búsqueda.');
    const candidates = [];
    for (const row of matches) {
      const p = row.data();
      const registeredProvider = registered(p) || (await history(row.id)).some(d => signedProfileRegistration(d));
      const reason = !registeredProvider ? 'Alta pendiente' : !accountEmail(p) ? 'Sin correo de acceso registrado' : '';
      candidates.push({ providerId: row.id, name: M.text(p.fullName || [p.name, p.lastName].filter(Boolean).join(' ')), email: accountEmail(p), available: !reason, reason });
    }
    return { candidates: candidates.sort((a, b) => a.name.localeCompare(b.name, 'es')) };
  }
  async function preview(actor, input) {
    await assertAdmin(actor);
    const providerId = M.id(input.providerId), provider = (await db.doc(`providers/${providerId}`).get()).data();
    if (!personal(provider)) conflict('Elegí una persona dada de alta.');
    return (await context(actor, providerId, await getAccount(provider))).preview;
  }
  async function assign(actor, input) {
    await assertAdmin(actor);
    if (!ROLES.includes(input.role)) conflict('Elegí un rol válido.');
    if (input.role === 'admin' && actor.email !== OWNER) deny('Sólo la cuenta dueña puede asignar administrador general.');
    const providerId = M.id(input.providerId), requestId = M.id(input.requestId);
    const provider = (await db.doc(`providers/${providerId}`).get()).data();
    if (!personal(provider)) conflict('Elegí una persona dada de alta.');
    const account = await getAccount(provider);
    if (account.email === OWNER) deny('El rol de la cuenta dueña se administra por su acceso protegido.');
    const receiptRef = db.doc(`providerTeamAssignments/${M.hash({ uid: actor.uid, requestId })}`);
    const intent = M.hash({ providerId, role: input.role, fingerprint: input.fingerprint });
    return db.runTransaction(async tx => {
      await assertAdmin(actor, tx);
      const receipt = await tx.get(receiptRef);
      if (receipt.exists) {
        if (receipt.data().intent !== intent || receipt.data().targetUid !== account.uid || receipt.data().targetEmail !== account.email) conflict('El intento corresponde a otra asignación. Actualizá la búsqueda.');
        const current = (await tx.get(db.doc(`users/${account.uid}`))).data();
        if (!hasTeamWorkAccess(current)) conflict('El acceso cambió después de la asignación. Revisá el equipo.');
        return { assigned: true, resumed: true, uid: account.uid, email: account.email, role: current.role };
      }
      const c = await context(actor, providerId, account, tx);
      if (typeof input.fingerprint !== 'string' || input.fingerprint !== c.fingerprint) conflict('La ficha o los permisos cambiaron. Volvé a seleccionar a la persona y revisá el rol.');
      if (c.alreadyMember) return { alreadyMember: true, uid: account.uid, email: account.email, role: c.profile.role };
      if (c.profile?.role === 'admin' && actor.email !== OWNER) deny('Sólo la cuenta dueña puede modificar administradores generales.');
      if (c.assignments.length && input.confirmExistingProjects !== true) conflict('Confirmá las asignaciones de proyectos que ya tenía esta persona.');
      const now = timestamp(), userRef = db.doc(`users/${account.uid}`), gateRef = db.doc(`teamAccessEmails/${account.email}`);
      const teamOnboarding = { ...(c.profile?.teamOnboarding || {}), version: 1, status: 'ready', providerId,
        source: 'registered_provider_assignment', aclReviewed: true, assignedByUid: actor.uid, assignedAt: now };
      tx.set(userRef, { ...(c.profile || {}), uid: account.uid, email: account.email, role: input.role,
        displayName: c.profile?.displayName || account.name || c.preview.name, photoURL: c.profile?.photoURL || account.photoURL || '',
        teamOnboarding, ...(!c.profile ? { createdAt: now } : {}), updatedAt: now });
      tx.set(gateRef, { ...(c.access || {}), uid: account.uid, email: account.email, status: 'ready', source: 'registered_provider_assignment', updatedAt: now });
      for (const { project, collaborator } of c.assignments) {
        const blocked = M.list(project.data().teamOnboardingBlockedEmails);
        if (blocked.includes(account.email)) tx.update(project.ref, { teamOnboardingBlockedEmails: blocked.filter(e => e !== account.email) });
        if (collaborator.data()?.teamOnboardingBlockedEmail === account.email) tx.update(collaborator.ref, { teamOnboardingBlockedEmail: '' });
      }
      if (c.invite?.exists && ['pending', 'accepted'].includes(c.invite.data().status) && c.invite.data().used === false)
        tx.update(c.invite.ref, { status: 'used', used: true, usedBy: account.uid, usedByEmail: account.email, usedAt: now, completedVia: 'registered_provider_assignment' });
      tx.create(receiptRef, { intent, providerId, targetUid: account.uid, targetEmail: account.email, role: input.role, actor,
        previousRole: c.profile?.role || null, previousOnboarding: c.profile?.teamOnboarding || null, projectIds: c.preview.projects.map(p => p.id), createdAt: now });
      return { assigned: true, uid: account.uid, email: account.email, role: input.role };
    });
  }
  return { search, preview, assign };
}
module.exports = { createTeamProviderAssignment, verifiedAccount };
