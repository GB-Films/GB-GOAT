const { HttpsError } = require('firebase-functions/v2/https');
const { hash, id, email } = require('./providerPortalModel');
const { hasTeamWorkAccess } = require('./teamWorkAccess');
const deny = message => { throw new HttpsError('permission-denied', message); };
const conflict = message => { throw new HttpsError('failed-precondition', message); };
const FIELDS = { name:160, lastName:160, dni:20, cuit:30, email:300, phone:60, address:300, birthDate:10,
  category:100, categoryOther:300, bankAccount_cbu:22, bankAccount_alias:100, dietaryRestriction:300 };
const plain = p => Object.fromEntries(Object.keys(FIELDS).map(k => [k, String(p?.[k] || '')]));
const core = p => ({ type:p?.type || '', ...plain(p) });
const digits = s => s.replace(/\D/g, '');
function validateForm(input, actor) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.type !== 'persona'
    || Object.keys(input).some(k => !['type','businessName',...Object.keys(FIELDS)].includes(k))) conflict('Completá tu ficha personal.');
  const form = {};
  for (const [k,max] of Object.entries(FIELDS)) {
    if (typeof (input[k] ?? '') !== 'string' || (input[k] || '').length > max) conflict('Revisá los datos de la ficha.');
    form[k] = (input[k] || '').trim();
  }
  if (email(form.email) !== actor.email) deny('Usá el correo Google con el que ingresaste.');
  form.email = actor.email;
  for (const k of ['name','lastName','phone','address','category']) if (!form[k]) conflict('Completá los campos obligatorios.');
  if (!/^\d{7,9}$/.test(digits(form.dni)) || !/^\d{11}$/.test(digits(form.cuit))) conflict('Revisá DNI y CUIT/CUIL.');
  if (form.bankAccount_cbu && !/^\d{22}$/.test(form.bankAccount_cbu)) conflict('El CBU/CVU debe tener22 números.');
  if (!form.bankAccount_cbu && !form.bankAccount_alias) conflict('Completá tu CBU/CVU o alias propio.');
  if (form.category === 'Otra' && !form.categoryOther) conflict('Indicá tu actividad.');
  if (form.birthDate && (!/^\d{4}-\d{2}-\d{2}$/.test(form.birthDate)
    || Number.isNaN(Date.parse(form.birthDate)) || new Date(form.birthDate).toISOString().slice(0,10) !== form.birthDate)) conflict('Revisá la fecha de nacimiento.');
  return { type:'persona', ...form };
}
const complete = p => { try { validateForm(core(p), {email:email(p.email)}); return true; } catch { return false; } };
function createTeamOnboarding({ db, timestamp, clock = () => new Date(), findAccount }) {
  const users = uid => db.doc(`users/${id(uid)}`);
  const requests = uid => db.doc(`teamProviderSubmissions/${id(uid)}`);
  // Read the whole bounded operational catalog: old ACLs may have no email field
  // and may exist only as a collaborator document, outside collaboratorEmails.
  async function accessRows(tx, actorEmail, actorUid='') {
    const projects=await tx.get(db.collection('projects').limit(1001));
    if(projects.size>1000) conflict('Administración debe paginar los permisos antes de invitar.');
    const rows=[];
    for(let offset=0;offset<projects.docs.length;offset+=50) {
      const group=projects.docs.slice(offset,offset+50);
      const collabs=await Promise.all(group.map(p=>tx.get(p.ref.collection('collaborators').doc(actorEmail))));
      group.forEach((p,i)=>{
        if((actorUid && p.data().createdBy===actorUid) || collabs[i].exists || (p.data().collaboratorEmails || []).includes(actorEmail)
          || (p.data().teamOnboardingBlockedEmails || []).includes(actorEmail)) rows.push({project:p,collab:collabs[i]});
      });
    }
    return rows;
  }
  function projectGate(tx, rows, actorEmail, blocked) {
    for(const row of rows) {
      const before=row.project.data().teamOnboardingBlockedEmails || [];
      const next=blocked ? [...new Set([...before,actorEmail])] : before.filter(e=>e!==actorEmail);
      tx.update(row.project.ref,{teamOnboardingBlockedEmails:next});
      if(row.collab.exists) tx.update(row.collab.ref,{teamOnboardingBlockedEmail:blocked ? actorEmail : ''});
    }
  }
  async function context(tx, actor, input) {
    const userRef=users(actor.uid), user=(await tx.get(userRef)).data();
    // Compatibility is explicit: no backfill, no rewrite or new condition on legacy users.
    if (user && !user.teamOnboarding) return { legacy:true, profile:user };
    const token=id(user?.teamOnboarding?.inviteToken || input.inviteToken);
    const inviteRef=db.doc(`userInvites/${token}`), invite=(await tx.get(inviteRef)).data();
    if (!invite || email(invite.email)!==actor.email || (user && email(user.email)!==actor.email)) deny('La invitación corresponde a otra cuenta o ya no está disponible.');
    if (invite.expiresAt && (!invite.expiresAt.toDate || invite.expiresAt.toDate() <= clock())) deny('La invitación venció.');
    const pending=invite.status==='pending' && invite.used===false;
    const accepted=invite.status==='accepted' && invite.acceptedBy===actor.uid && invite.used===false;
    const used=invite.status==='used' && invite.usedBy===actor.uid && invite.used===true;
    if (!(pending || accepted || (used && user?.teamOnboarding?.status==='ready'))) deny('La invitación fue usada o cancelada.');
    if(user?.teamOnboarding?.status==='ready') return {finished:true,profile:user};
    const accessRef=db.doc(`teamAccessEmails/${actor.email}`),access=(await tx.get(accessRef)).data();
    if(access?.inviteToken && access.inviteToken!==token) deny('Hay otra invitación vigente para esta cuenta.');
    const accessRowsForActor=await accessRows(tx,actor.email,actor.uid);
    const hasPriorAccess=accessRowsForActor.length>0 && !user?.teamOnboarding?.aclReviewed;
    const catalog=await tx.get(db.collection('providers').limit(2001));
    if (catalog.size>2000) conflict('Administración debe revisar el catálogo antes de vincular tu ficha.');
    const candidates=catalog.docs.filter(s => {
      const p=s.data();
      return email(p.email)===actor.email || email(p.portalAccessEmail)===actor.email || p.personalGoogleAccount?.uid===actor.uid;
    });
    const selected=user?.teamOnboarding?.resolvedProviderId;
    const match=selected ? candidates.find(s=>s.id===selected) : candidates.length===1 ? candidates[0] : null;
    const membershipRef=match ? db.doc(`providerPortalUsers/${actor.uid}/memberships/${match.id}`) : null;
    const membership=membershipRef ? (await tx.get(membershipRef)).data() : null;
    const p=match?.data();
    const safe=!!p && p.type==='persona' && email(p.email)===actor.email && (!p.personalGoogleAccount?.uid || p.personalGoogleAccount.uid===actor.uid)
      && (!membership || (membership.email===actor.email && ['active','needs_confirmation'].includes(membership.status)));
    const ambiguous=(candidates.length>0 && !match) || (!!match && !safe);
    return { userRef,user,token,inviteRef,invite,catalog,candidates,match,membershipRef,membership,safe,ambiguous,
      accessRef,accessRows:accessRowsForActor,hasPriorAccess };
  }
  function save(tx, actor, c, status, providerId='', reviewStatus='') {
    const now=timestamp();
    const teamOnboarding={version:1,status,providerId,inviteToken:c.token,reviewStatus,
      aclReviewed:c.user?.teamOnboarding?.aclReviewed===true,
      ...(c.user?.teamOnboarding?.resolvedProviderId ? {resolvedProviderId:c.user.teamOnboarding.resolvedProviderId} : {})};
    const profile={...(c.user || {}),uid:actor.uid,email:actor.email,displayName:c.user?.displayName || actor.name || '',
      role:c.user?.role || 'colaborador',teamOnboarding};
    tx.set(c.userRef,{...profile,...(!c.user ? {createdAt:now} : {}),updatedAt:now});
    tx.set(c.accessRef,{uid:actor.uid,email:actor.email,inviteToken:c.token,status:status==='ready' ? 'ready' : 'pending',updatedAt:now});
    projectGate(tx,c.accessRows,actor.email,status!=='ready');
    if (status==='ready') {
      tx.update(c.inviteRef,{status:'used',used:true,usedBy:actor.uid,usedByEmail:actor.email,usedAt:now});
      const ref=db.doc(`providerPortalUsers/${actor.uid}/memberships/${providerId}`);
      if (!c.membership) tx.create(ref,{providerId,email:actor.email,status:'active',representation:'own',source:'verified_team_onboarding',createdAt:now});
      // Preserve revoked and existing memberships; safe() never restores a revoked one.
    } else tx.update(c.inviteRef,{status:'accepted',used:false,acceptedBy:actor.uid,acceptedByEmail:actor.email,acceptedAt:now});
    return {profile, status,providerId,reviewStatus};
  }
  async function bootstrap(actor,input) {
    return db.runTransaction(async tx=>{
      const c=await context(tx,actor,input);
      if(c.legacy) return {profile:c.profile,status:'legacy'};
      if(c.finished) return {profile:c.profile,status:'ready',providerId:c.profile.teamOnboarding.providerId};
      if(c.ambiguous || c.hasPriorAccess) return save(tx,actor,c,'needs_review');
      if(c.match && complete(c.match.data())) return save(tx,actor,c,'ready',c.match.id);
      return {...save(tx,actor,c,'needs_profile',c.match?.id || ''),form:c.match ? core(c.match.data()) : {type:'persona',email:actor.email}};
    });
  }
  async function submit(actor,input) {
    if(input.personalAccountAccepted!==true || input.ownAccountConfirmed!==true) conflict('Confirmá tu cuenta Google y que sos titular de la cuenta provista.');
    const form=validateForm(input.form,actor);
    return db.runTransaction(async tx=>{
      const c=await context(tx,actor,input);
      if(c.legacy) return {profile:c.profile,status:'legacy'};
      if(c.finished) return {profile:c.profile,status:'ready',providerId:c.profile.teamOnboarding.providerId,resumed:true};
      if(c.ambiguous || c.hasPriorAccess) return save(tx,actor,c,'needs_review');
      const providerId=c.match?.id || `team_${hash(actor.uid).slice(0,40)}`;
      const providerRef=db.doc(`providers/${providerId}`), previous=c.match?.data();
      const identifiers=[['dni',digits(form.dni)],['cuit',digits(form.cuit)]].map(([kind,value])=>({kind,value,ref:db.doc(`providerIdentifiers/${kind}_${value}`)}));
      for(const item of identifiers) {
        const prior=(await tx.get(item.ref)).data();
        if((prior && prior.providerId!==providerId) || c.catalog.docs.some(s=>s.id!==providerId && digits(String(s.data()[item.kind] || ''))===item.value)) {
          // An identifier collision is not permission to attach another person's record.
          return save(tx,actor,c,'needs_review');
        }
        item.exists=!!prior;
      }
      const submissionRef=requests(actor.uid), priorSubmission=await tx.get(submissionRef);
      if(priorSubmission.exists) conflict('Ya hay una ficha enviada. Actualizá la página para continuar.');
      const now=timestamp();
      const initial={type:'persona',name:form.name,lastName:form.lastName,fullName:`${form.name} ${form.lastName}`,dni:form.dni,dniNormalized:digits(form.dni),
        email:actor.email,phone:form.phone,address:form.address,birthDate:form.birthDate,category:form.category,categoryOther:form.categoryOther,dietaryRestriction:form.dietaryRestriction,
        cuit:'',bankAccount_cbu:'',bankAccount_alias:'',source:'team_onboarding',createdAt:now,updatedAt:now,
        personalGoogleAccount:{version:'personal-google-v1',uid:actor.uid,email:actor.email,personalUse:true,acceptedAt:now}};
      if(!previous) tx.create(providerRef,initial);
      tx.create(submissionRef,{uid:actor.uid,email:actor.email,providerId,status:'pending',form,
        baselineHash:hash(core(previous || initial)),createdAt:now,source:'team_onboarding',
        ownAccountConfirmed:true,personalAccountAccepted:true});
      for(const item of identifiers) if(!item.exists) tx.create(item.ref,{providerId,providerType:'persona',identifierType:item.kind,value:item.value,source:'team_onboarding',createdAt:now});
      return save(tx,actor,c,'ready',providerId,'pending');
    });
  }
  async function admin(actor,input) {
    const caller=(await users(actor.uid).get()).data();
    if(actor.email!=='info@granbertafilms.com' && (!hasTeamWorkAccess(caller) || caller.role!=='admin')) deny('Sólo administración puede revisar altas de equipo.');
    if(input.action==='teamCreateInvite') {
      const target=email(input.email);
      if(typeof input.email!=='string' || input.email.length>254 || !/^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(target)) conflict('Ingresá un correo válido.');
      // Storage authorizes project owners by UID, even without a user profile.
      // Resolve an existing Auth account before the atomic ACL block; only an
      // actual not-found response is safe to treat as a not-yet-created account.
      if(typeof findAccount!=='function') conflict('No está disponible la comprobación de cuenta para invitar.');
      let targetUid='';
      try {
        const account=await findAccount(target);
        if(!account || email(account.email)!==target) conflict('No pudimos verificar la cuenta invitada.');
        targetUid=id(account.uid);
      } catch(error) {
        if(error?.code!=='auth/user-not-found') throw error;
      }
      const token=require('node:crypto').randomBytes(20).toString('hex');
      return db.runTransaction(async tx=>{
        const priorUsers=await tx.get(db.collection('users').where('email','==',target).limit(2));
        if(priorUsers.docs.some(s=>hasTeamWorkAccess(s.data()))) return {alreadyMember:true};
        const accessRef=db.doc(`teamAccessEmails/${target}`), access=(await tx.get(accessRef)).data();
        if(access?.inviteToken) {
          const old=(await tx.get(db.doc(`userInvites/${id(access.inviteToken)}`))).data();
          if(old && ['pending','accepted'].includes(old.status) && old.used===false) return {token:access.inviteToken,resumed:true};
        }
        const rows=await accessRows(tx,target,targetUid),now=timestamp();
        tx.create(db.doc(`userInvites/${token}`),{token,email:target,status:'pending',used:false,onboardingVersion:1,createdBy:actor.uid,createdByEmail:actor.email,createdAt:now});
        tx.set(accessRef,{email:target,inviteToken:token,status:'pending',updatedAt:now});
        for(const existing of priorUsers.docs) {
          if(existing.data().teamOnboarding) tx.update(existing.ref,{'teamOnboarding.inviteToken':token,updatedAt:now});
        }
        projectGate(tx,rows,target,true);
        return {token,requiresAccessReview:rows.length>0};
      });
    }
    if(input.action==='teamReviews') {
      const [us,rs]=await Promise.all([db.collection('users').where('teamOnboarding.status','==','needs_review').limit(101).get(),db.collection('teamProviderSubmissions').where('status','==','pending').limit(101).get()]);
      if(us.size>100 || rs.size>100) conflict('Paginar revisiones de equipo.');
      const catalog=us.empty ? null : await db.collection('providers').limit(2001).get();
      if(catalog?.size>2000) conflict('Paginar catálogo antes de revisar.');
      const links=await Promise.all(us.docs.map(async s=>{
        const projects=await db.collection('projects').where('teamOnboardingBlockedEmails','array-contains',s.data().email).limit(1001).get();
        if(projects.size>1000) conflict('Paginar permisos antes de revisar el alta.');
        return {uid:s.id,email:s.data().email,aclReviewed:s.data().teamOnboarding.aclReviewed===true,
          projects:await Promise.all(projects.docs.map(async p=>({id:p.id,name:p.data().name || p.id,role:(await p.ref.collection('collaborators').doc(s.data().email).get()).data()?.role || 'Acceso por proyecto'}))),
          candidates:catalog.docs.filter(p=>email(p.data().email)===email(s.data().email)).map(p=>({providerId:p.id,name:p.data().fullName || p.data().name,type:p.data().type}))};
      }));
      return {links,submissions:rs.docs.map(s=>({id:s.id,...s.data()}))};
    }
    return db.runTransaction(async tx=>{
      const uid=id(input.uid), userRef=users(uid), user=(await tx.get(userRef)).data();
      if(!user?.teamOnboarding) conflict('Alta de equipo inexistente.');
      const now=timestamp(),auditRef=db.collection('providerPortalAudit').doc();
      if(input.action==='reviewTeamAccess') {
        if(user.teamOnboarding.status!=='needs_review' || input.confirmProjectAssignments!==true) conflict('Confirmá la revisión de los permisos preexistentes.');
        const rows=await accessRows(tx,user.email,uid);
        tx.update(userRef,{'teamOnboarding.aclReviewed':true,'teamOnboarding.status':'needs_profile',updatedAt:now});
        tx.create(auditRef,{action:'team_preexisting_access_reviewed',actor,uid,projectIds:rows.map(r=>r.project.id),at:now});
        return {status:'reviewed'};
      }
      if(input.action==='resolveTeamProvider') {
        if(user.teamOnboarding.status!=='needs_review') conflict('La asociación ya cambió.');
        const providerId=id(input.providerId), p=(await tx.get(db.doc(`providers/${providerId}`))).data();
        if(p?.type!=='persona' || email(p.email)!==email(user.email) || (p.personalGoogleAccount?.uid && p.personalGoogleAccount.uid!==uid)) conflict('Elegí una ficha personal con ese mismo correo verificado.');
        tx.update(userRef,{'teamOnboarding.resolvedProviderId':providerId,'teamOnboarding.status':'needs_profile',updatedAt:now});
        tx.create(auditRef,{action:'team_provider_link_resolved',actor,uid,providerId,at:now});
        return {status:'resolved'};
      }
      if(input.action!=='reviewTeamProfile' || !['approved','rejected'].includes(input.decision)) conflict('Revisión inválida.');
      const ref=requests(uid), r=(await tx.get(ref)).data();
      if(!r || r.status!=='pending' || r.providerId!==user.teamOnboarding.providerId) conflict('La revisión ya cambió.');
      const providerRef=db.doc(`providers/${id(r.providerId)}`), p=(await tx.get(providerRef)).data();
      if(!p || hash(core(p))!==r.baselineHash) conflict('La ficha cambió: revisá sus datos actuales antes de aprobar.');
      const form=validateForm(r.form,{email:r.email});
      const oldCuit=digits(String(p.cuit || '')),newCuit=digits(form.cuit),newDni=digits(form.dni);
      const refs=[['cuit',newCuit],['dni',newDni]].map(([kind,value])=>({kind,value,ref:db.doc(`providerIdentifiers/${kind}_${value}`)}));
      for(const item of refs){const prior=(await tx.get(item.ref)).data();if(prior && prior.providerId!==r.providerId) conflict('DNI/CUIT asociado a otro proveedor.');item.exists=!!prior;}
      const oldRef=oldCuit && oldCuit!==newCuit ? db.doc(`providerIdentifiers/cuit_${oldCuit}`) : null;
      const old=oldRef ? (await tx.get(oldRef)).data() : null;
      if(input.decision==='approved') {
        // Baseline guard prevents overwriting a newer administrative/bank correction.
        tx.update(providerRef,{...form,fullName:`${form.name} ${form.lastName}`,dniNormalized:newDni,cuitNormalized:newCuit,bankAccount_holder:`${form.name} ${form.lastName}`,updatedAt:now});
        for(const item of refs) if(!item.exists) tx.create(item.ref,{providerId:r.providerId,providerType:'persona',identifierType:item.kind,value:item.value,source:'team_review',createdAt:now});
        if(old?.providerId===r.providerId) tx.delete(oldRef);
      } else {
        for(const item of refs) if(item.exists && digits(String(p[item.kind] || ''))!==item.value) tx.delete(item.ref);
      }
      tx.update(ref,{status:input.decision,reviewedBy:actor,reviewedAt:now});
      tx.update(userRef,{'teamOnboarding.reviewStatus':input.decision,updatedAt:now});
      tx.create(auditRef,{action:'team_profile_reviewed',actor,uid,providerId:r.providerId,decision:input.decision,at:now});
      return {status:input.decision};
    });
  }
  return {bootstrap,submit,admin};
}
module.exports={createTeamOnboarding,validateForm};
