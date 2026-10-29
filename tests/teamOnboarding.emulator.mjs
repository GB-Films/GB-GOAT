import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, query, where, setDoc, updateDoc } from 'firebase/firestore';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const { createTeamOnboarding } = require('../functions/teamOnboarding');
const { createProviderPortalHandler } = require('../functions/providerPortal');
const { hasTeamWorkAccess } = require('../functions/teamWorkAccess');
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw Error('Local emulators required');
const projectId = 'demo-goat-team-onboarding';
const env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') }, storage: { rules: readFileSync('storage.rules', 'utf8') } });
const app = admin.initializeApp({ projectId });
const db = app.firestore();
const deps = { db, timestamp: () => admin.firestore.FieldValue.serverTimestamp(), findAccount: async email => ({uid:email.split('@')[0],email}) };
const service = createTeamOnboarding(deps);
const actor = uid => ({ uid, email: `${uid}@example.test`, name: 'Equipo' });
const ctx = uid => env.authenticatedContext(uid, { email_verified: true, email: actor(uid).email });
const form = (uid, number) => ({ type:'persona', name:'Nombre', lastName:'Apellido', dni:String(30000000 + number), cuit:String(20000000000 + number), email:actor(uid).email, phone:'123456', address:'Calle 123', category:'Producción', bankAccount_alias:'cuenta.propia', bankAccount_cbu:'', birthDate:'', dietaryRestriction:'', categoryOther:'' });
const submit = (uid, number) => service.submit(actor(uid), {form:form(uid,number),personalAccountAccepted:true,ownAccountConfirmed:true});
let checks=0;
async function check(name, fn) { await fn(); checks++; console.log(`PASS ${name}`); }
async function seed(uid, provider, project=false) {
  await db.doc(`userInvites/invite_${uid}`).set({email:actor(uid).email,status:'pending',used:false});
  if(provider) await db.doc(`providers/provider_${uid}`).set(provider);
  if(project) {
    await db.doc(`projects/project_${uid}`).set({createdBy:'owner',collaboratorEmails:[actor(uid).email]});
    await db.doc(`projects/project_${uid}/collaborators/${actor(uid).email}`).set({email:actor(uid).email,role:'jefe_area',canEditBudgetAreas:true,allowedTabs:['areas'],allowedCategories:['Producción']});
    await db.doc(`projects/project_${uid}/areaExpenses/expense`).set({area:'Producción',subcategory:'',total:100});
  }
}
const boot = uid => service.bootstrap(actor(uid), {inviteToken:`invite_${uid}`});
const upload = (uid, scope='area_editor') => ctx(uid).storage().ref(`projects/project_${uid}/areaExpenses/expense/comprobantes/test.pdf`).put(new Uint8Array([37,80,68,70]),{contentType:'application/pdf',customMetadata:{projectId:`project_${uid}`,collectionName:'areaExpenses',itemId:'expense',paymentId:'payment',uploadAccessScope:scope,originalFileName:'test.pdf'}});
try {
  await db.doc('users/admin').set({uid:'admin',email:actor('admin').email,role:'admin'});
  await db.doc('providerPortalConfig/current').set({enabled:true});
  await check('legacy access preserved', async()=>{
    await seed('legacy',null,true); await db.doc('users/legacy').set({...actor('legacy'),role:'colaborador'});
    assert.equal((await boot('legacy')).status,'legacy');
    await assertSucceeds(getDoc(doc(ctx('legacy').firestore(),'projects/project_legacy')));
    await assertSucceeds(getDocs(query(collection(ctx('legacy').firestore(),'projects'),where('collaboratorEmails','array-contains',actor('legacy').email))));
    await assertSucceeds(upload('legacy'));
  });
  await check('existing provider links once and preserves invoice data', async()=>{
    const p={...form('known',1),fullName:'Nombre Apellido'};await seed('known',p);
    const results=await Promise.all([boot('known'),boot('known'),boot('known')]);
    assert(results.every(r=>r.status==='ready' && r.providerId==='provider_known'));
    assert.deepEqual((await db.doc('providers/provider_known').get()).data(),p);
    assert.equal((await db.doc('userInvites/invite_known').get()).data().used,true);
    assert(hasTeamWorkAccess((await db.doc('users/known').get()).data()));
    assert.equal((await db.collection('providerPortalUsers/known/memberships').get()).size,1);
  });
  await check('new profile, idempotent completion and reviewed critical fields', async()=>{
    await seed('new');assert.equal((await boot('new')).status,'needs_profile');
    await assertFails(getDocs(collection(ctx('new').firestore(),'providers')));
    const result=await Promise.all([submit('new',2),submit('new',2)]);assert.equal(result[0].providerId,result[1].providerId);
    const p=(await db.doc(`providers/${result[0].providerId}`).get()).data();assert.equal(p.cuit,'');assert.equal(p.bankAccount_alias,'');
    assert.equal((await db.doc('teamProviderSubmissions/new').get()).data().status,'pending');
    await service.admin(actor('admin'),{action:'reviewTeamProfile',uid:'new',decision:'approved'});
    assert.equal((await db.doc(`providers/${result[0].providerId}`).get()).data().cuit,form('new',2).cuit);
    assert.equal((await db.doc('users/new').get()).data().role,'colaborador');
  });
  await check('wrong email, cancelled token and non-Google rejected', async()=>{
    await seed('wrong');await assert.rejects(service.bootstrap(actor('other'),{inviteToken:'invite_wrong'}));
    await db.doc('userInvites/invite_wrong').update({status:'cancelled'});await assert.rejects(boot('wrong'));
    const portal=createProviderPortalHandler({...deps, sign:{}});
    await assert.rejects(portal({auth:{uid:'new',token:{email:actor('new').email,email_verified:true,firebase:{sign_in_provider:'password'}}},data:{action:'teamBootstrap'}}));
  });
  await check('ambiguous and revoked associations remain blocked', async()=>{
    await seed('ambiguous',{...form('ambiguous',3)});await db.doc('providers/second').set({...form('ambiguous',3)});
    assert.equal((await boot('ambiguous')).status,'needs_review');
    await seed('revoked',{...form('revoked',4)});await db.doc('providerPortalUsers/revoked/memberships/provider_revoked').set({email:actor('revoked').email,status:'revoked'});
    assert.equal((await boot('revoked')).status,'needs_review');
    assert.equal((await db.doc('providerPortalUsers/revoked/memberships/provider_revoked').get()).data().status,'revoked');
  });
  await check('DNI collision cannot attach another identity', async()=>{
    await seed('collision');await boot('collision');const f=form('collision',1);
    assert.equal((await service.submit(actor('collision'),{form:f,personalAccountAccepted:true,ownAccountConfirmed:true})).status,'needs_review');
    assert.equal((await db.collection('providers').where('email','==',actor('collision').email).get()).size,0);
  });
  await check('preassigned ACL blocked atomically at invitation, retained and reviewed', async()=>{
    await seed('prior',null,true);
    const invite=await service.admin(actor('admin'),{action:'teamCreateInvite',email:actor('prior').email});
    await assertFails(upload('prior'));
    await assertFails(getDoc(doc(ctx('prior').firestore(),'projects/project_prior')));
    assert.equal((await service.bootstrap(actor('prior'),{inviteToken:invite.token})).status,'needs_review');
    await assertFails(updateDoc(doc(ctx('admin').firestore(),'projects/project_prior'),{teamOnboardingBlockedEmails:[]}));
    await assertFails(updateDoc(doc(ctx('admin').firestore(),`projects/project_prior/collaborators/${actor('prior').email}`),{role:'admin'}));
    await service.admin(actor('admin'),{action:'reviewTeamAccess',uid:'prior',confirmProjectAssignments:true});
    assert.equal((await service.bootstrap(actor('prior'),{})).status,'needs_profile');
    await assertFails(upload('prior'));
    await submit('prior',5);
    await assertSucceeds(upload('prior'));
    await assertSucceeds(getDoc(doc(ctx('prior').firestore(),'projects/project_prior')));
    assert.equal((await db.doc(`projects/project_prior/collaborators/${actor('prior').email}`).get()).data().role,'jefe_area');
  });
  await check('SDK cannot forge onboarding, invitation or pending assignment', async()=>{
    await seed('pending');await boot('pending');
    await assertFails(updateDoc(doc(ctx('pending').firestore(),'users/pending'),{teamOnboarding:{version:1,status:'ready',providerId:'provider_known'}}));
    await assertFails(setDoc(doc(ctx('pending').firestore(),'userInvites/forged'),{email:actor('pending').email,status:'pending',used:false}));
    await assertFails(setDoc(doc(ctx('pending').firestore(),'users/forged'),{uid:'forged',email:actor('pending').email,role:'admin'}));
    await assertFails(updateDoc(doc(ctx('admin').firestore(),'projects/project_legacy'),{collaboratorEmails:[actor('legacy').email,actor('pending').email]}));
    await assertFails(updateDoc(doc(ctx('admin').firestore(),'projects/project_legacy'),{createdBy:'pending'}));
    await assertFails(setDoc(doc(ctx('admin').firestore(),`projects/project_legacy/collaborators/${actor('pending').email}`),{uid:'pending',email:actor('pending').email,role:'colaborador'}));
    await assert.rejects(service.admin(actor('pending'),{action:'teamCreateInvite',email:'someone@example.test'}));
  });
  await check('ready users can be assigned and list their projects', async()=>{
    const adb=ctx('admin').firestore();
    await assertSucceeds(setDoc(doc(adb,`projects/project_legacy/collaborators/${actor('known').email}`),{uid:'known',email:actor('known').email,role:'colaborador'}));
    await assertSucceeds(updateDoc(doc(adb,'projects/project_legacy'),{collaboratorEmails:[actor('legacy').email,actor('known').email]}));
    const projects=await assertSucceeds(getDocs(query(collection(ctx('known').firestore(),'projects'),where('collaboratorEmails','array-contains',actor('known').email))));
    assert.equal(projects.size,1);
  });
  await check('cancelled pending invitation can be replaced without stranding its profile', async()=>{
    const first=await service.admin(actor('admin'),{action:'teamCreateInvite',email:actor('renew').email});
    await service.bootstrap(actor('renew'),{inviteToken:first.token});
    await db.doc(`userInvites/${first.token}`).update({status:'cancelled'});
    const second=await service.admin(actor('admin'),{action:'teamCreateInvite',email:actor('renew').email});
    assert.notEqual(first.token,second.token);
    assert.equal((await service.bootstrap(actor('renew'),{inviteToken:second.token})).status,'needs_profile');
    await assertFails(updateDoc(doc(ctx('admin').firestore(),'users/renew'),{role:'jefe_produccion'}));
  });
  await check('owner UID without a user profile is blocked before the first login', async()=>{
    await db.doc('projects/project_owned').set({createdBy:'owned',collaboratorEmails:[]});
    await db.doc('projects/project_owned/areaExpenses/expense').set({area:'Producción',subcategory:'',total:100});
    const invite=await service.admin(actor('admin'),{action:'teamCreateInvite',email:actor('owned').email});
    assert.equal(invite.requiresAccessReview,true);
    await assertFails(upload('owned','project_owner'));
    await assertFails(getDoc(doc(ctx('owned').firestore(),'projects/project_owned')));
    assert.equal((await service.bootstrap(actor('owned'),{inviteToken:invite.token})).status,'needs_review');
    await service.admin(actor('admin'),{action:'reviewTeamAccess',uid:'owned',confirmProjectAssignments:true});
    await submit('owned',8);
    await assertSucceeds(upload('owned','project_owner'));
    assert.equal((await db.doc('projects/project_owned').get()).data().createdBy,'owned');
  });
  await check('an unavailable Auth lookup cannot leave unblocked ownership grants', async()=>{
    const failing=createTeamOnboarding({...deps,findAccount:async()=>{throw Object.assign(Error('unavailable'),{code:'auth/internal-error'});}});
    await assert.rejects(failing.admin(actor('admin'),{action:'teamCreateInvite',email:actor('unavailable').email}),/unavailable/);
    assert.equal((await db.doc(`teamAccessEmails/${actor('unavailable').email}`).get()).exists,false);
    const absent=createTeamOnboarding({...deps,findAccount:async()=>{throw Object.assign(Error('not found'),{code:'auth/user-not-found'});}});
    assert((await absent.admin(actor('admin'),{action:'teamCreateInvite',email:actor('absent').email})).token);
  });
  console.log(`TEAM ONBOARDING: ${checks} scenarios passed`);
} finally { await env.cleanup(); await app.delete(); }
