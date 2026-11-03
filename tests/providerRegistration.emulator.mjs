import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, getDocs, collection, serverTimestamp } from 'firebase/firestore';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
const admin=require('firebase-admin');
const {createProviderPortalHandler}=require('../functions/providerPortal');
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Local emulator required. Production forbidden.');
const projectId='demo-goat-provider-intake';
const env=await initializeTestEnvironment({projectId,firestore:{rules:readFileSync('firestore.rules','utf8')}});
const app=admin.initializeApp({projectId}),db=app.firestore();
const portal=createProviderPortalHandler({db,timestamp:()=>admin.firestore.FieldValue.serverTimestamp()});
const request=(data,uid='person')=>({auth:{uid,token:{email:`${uid}@example.test`,email_verified:true,firebase:{sign_in_provider:'google.com'},auth_time:Date.now()/1000}},data});
const submit=(data,uid)=>portal(request(data,uid));
const seed=(token,extra={})=>db.doc(`providerInvites/${token}`).set({status:'pending',used:false,expiresAt:admin.firestore.Timestamp.fromMillis(Date.now()+3600000),...extra});
let sequence=12000000,passed=0;
const input=(token,extra={})=>{const dni=String(sequence++);return {action:'registerProvider',inviteToken:token,attemptId:token,personalAccountAccepted:true,ownAccountConfirmed:true,form:{type:'persona',name:'Persona',lastName:'Prueba',dni,cuit:`20${dni}6`,email:'person@example.test',phone:'111',address:'Casa',category:'Sonido',bankAccount_cbu:'',bankAccount_alias:'own.alias',...extra}};};
const pass=label=>{passed++;console.log(`PASS ${label}`);};
async function denied(data,pattern){
  const before=await db.collection('providers').get();
  const inviteBefore=(await db.doc(`providerInvites/${data.inviteToken}`).get()).data();
  await assert.rejects(submit(data),pattern);
  const after=await db.collection('providers').get();
  assert.deepEqual(after.docs.map(d=>({id:d.id,...d.data()})),before.docs.map(d=>({id:d.id,...d.data()})),'no provider created or modified on failure');
  assert.deepEqual((await db.doc(`providerInvites/${data.inviteToken}`).get()).data(),inviteBefore,'invite not consumed on failure');
}
try {
  await db.doc('providerPortalConfig/current').set({enabled:true});
  await seed('new');const first=input('new'),out=await submit(first);
  const saved=(await db.doc(`providers/${out.providerId}`).get()).data();
  assert.equal(out.reused,false);assert.equal(saved.personalGoogleAccount.uid,'person');assert.equal(saved.registration.status,'complete');
  assert.equal((await db.doc(`providerPortalUsers/person/memberships/${out.providerId}`).get()).data().status,'active');
  assert.equal((await submit(first)).providerId,out.providerId);
  await denied({...first,form:{...first.form,phone:'changed'}},/otros datos/);
  pass('new person, Google identity, own access, exact and changed retry');
  for(const variant of ['dni-legacy','cuit-legacy','both-indexed','no-index','seven-digit','nine-digit','company']){
    const token=`reuse-${variant}`,providerId=token;
    const data=input(token);const form=data.form;
    if(variant==='company')Object.assign(form,{type:'empresa',name:'',lastName:'',dni:'',businessName:'Empresa ficticia',cuit:`30${sequence++}9`});
    if(variant==='seven-digit')Object.assign(form,{dni:'1234567',cuit:'20123456789'});
    if(variant==='nine-digit')Object.assign(form,{dni:'123456789',cuit:'20123456780'});
    const before={name:'Carga provisoria',source:'manual',createdAt:admin.firestore.Timestamp.fromMillis(123000),createdBy:'operator',notes:'Preservar',bankAccount_alias:'anterior'};
    if(variant==='dni-legacy')before.dni_cuit=form.dni.slice(0,2)+'.'+form.dni.slice(2);
    else if(['cuit-legacy','company'].includes(variant))before.dni_cuit=form.cuit.slice(0,2)+'-'+form.cuit.slice(2,10)+'-'+form.cuit.slice(10);
    else before.dni=form.dni;
    if(variant==='both-indexed'){
      before.cuit=form.cuit;
      for(const [kind,value]of[['dni',form.dni],['cuit',form.cuit]])await db.doc(`providerIdentifiers/${kind}_${value}`).set({providerId,identifierType:kind});
    }
    await db.doc(`providers/${providerId}`).set(before);
    const rowRef=db.doc(`projects/fictitious/areaExpenses/${token}`);
    const row={providerId,providerName:'Carga provisoria',total:250,paid:true,paymentLocked:true,paymentHistory:[{id:'payment',amount:250,createdBy:'operator'}],invoices:[{name:'invoice.pdf'}],otherReceipts:[{name:'receipt.pdf'}]};
    await rowRef.set(row);await seed(token,{projectId:'fictitious',collectionName:'areaExpenses',expenseId:token,provisionalProviderId:providerId});
    const count=(await db.collection('providers').get()).size,result=await submit(data);
    assert.equal(result.providerId,providerId);assert.equal(result.reused,true);assert.equal((await db.collection('providers').get()).size,count);
    const after=(await db.doc(`providers/${providerId}`).get()).data();
    assert.equal(after.createdAt.toMillis(),123000);assert.equal(after.createdBy,'operator');assert.equal(after.notes,'Preservar');assert.equal(after.bankAccount_alias,'own.alias');
    assert.deepEqual((await rowRef.get()).data(),row,'paid row and receipts stay byte-for-byte unchanged');
    assert.equal((await db.doc(`providerIdentifiers/cuit_${form.cuit}`).get()).data().providerId,providerId);
    assert.equal((await db.doc(`providerPortalUsers/person/memberships/${providerId}`).get()).data().status,variant==='company'?'needs_confirmation':'active');
    assert.equal((await db.collection('providerPortalAudit').where('providerId','==',providerId).get()).docs[0].data().before.bankAccount_alias,'anterior');
    pass(`reuse ${variant}: same ID, paid history, original audit, identifiers, company/personal access`);
  }
  await seed('generic');const generic=input('generic');await db.doc('providers/generic-old').set({dni_cuit:generic.form.dni});
  assert.equal((await submit(generic)).providerId,'generic-old');pass('general link completes unindexed provisional');
  for (const association of ['prepared-email','own-active','own-pending','own-revoked']) {
    const token=`association-${association}`,data=input(token);
    await seed(token);await db.doc(`providers/${token}`).set({dni:data.form.dni,...(association==='prepared-email'?{portalAccessEmail:'person@example.test',accessPreparation:{generation:'existing'}}:{})});
    if(association!=='prepared-email')await db.doc(`providerPortalUsers/person/memberships/${token}`).set({providerId:token,email:'person@example.test',status:association==='own-active'?'active':association==='own-pending'?'needs_confirmation':'revoked'});
    if(association==='own-revoked')await denied(data,/acceso asociado/);
    else assert.equal((await submit(data)).providerId,token);
    pass(`${association}: only the same verified account can complete its provisional record, no revoked access restoration`);
  }
  const nameTarget='name-target';await db.doc(`providers/${nameTarget}`).set({name:'Carga sin documento'});
  await db.doc(`projects/fictitious/areaExpenses/${nameTarget}`).set({providerId:nameTarget,providerName:'Carga sin documento',paid:true,paymentHistory:[{amount:5}]});
  await seed(nameTarget,{projectId:'fictitious',collectionName:'areaExpenses',expenseId:nameTarget,provisionalProviderId:nameTarget});
  assert.equal((await submit(input(nameTarget))).providerId,nameTarget);
  pass('specific provisional link safely completes a record without identifiers, retaining its paid assignment');
  const signedData=input('already-signed');await seed('already-signed');
  await db.doc('providers/already-signed').set({type:'persona',dni:signedData.form.dni});
  await db.doc('providerPortalUsers/person/memberships/already-signed').set({providerId:'already-signed',email:'person@example.test',status:'active'});
  await db.doc('providerPortalDeclarations/already-signed').set({providerId:'already-signed',kind:'profile',status:'applied',proof:{complete:true},actor:{uid:'person',email:'person@example.test'},content:{confirmation:{version:'profile-confirmation-v1',accessEmail:'person@example.test'}}});
  await denied(signedData,/confirmados con firma/);
  const {rememberSignedRegistration}=require('../functions/providerRegistrationEvidence');
  await rememberSignedRegistration({db,timestamp:()=>admin.firestore.FieldValue.serverTimestamp(),actor:{uid:'person',email:'person@example.test'},providerId:'already-signed',declarations:[{id:'already-signed',...(await db.doc('providerPortalDeclarations/already-signed').get()).data()}]});
  assert.equal((await db.doc('providers/already-signed').get()).data().registration.status,'complete');
  assert.equal((await db.doc('providers/already-signed').get()).data().dni,signedData.form.dni);
  pass('signed legacy profile blocks unsigned intake; existing evidence marks registration without rewriting data');
  for(const kind of ['budgetItems','areaExpenses']){
    const token=`target-${kind}`,ref=db.doc(`projects/fictitious/${kind}/new-work`);
    await ref.set({providerId:'',providerName:'',paymentHistory:[],total:300});await seed(token,{projectId:'fictitious',collectionName:kind,expenseId:'new-work'});
    const result=await submit(input(token));assert.equal((await ref.get()).data().providerId,result.providerId);pass(`new intake assigns empty ${kind} atomically`);
  }
  await seed('multi',{mode:'multi_use',usageCount:0});const multi=input('multi');await submit(multi);await submit(multi);
  const second=input('multi');second.attemptId='second';await submit(second);assert.equal((await db.doc('providerInvites/multi').get()).data().usageCount,2);pass('multi-use counts exactly once per submission');
  for(const [label,extra]of[
    ['claimed',{personalGoogleAccount:{uid:'other'}}],['old-intake',{source:'provider_invite'}],['old-team',{source:'team_onboarding'}],
    ['prepared-access',{portalAccessEmail:'old@example.test'}],['different-cuit',{cuit:'30111111119'}],['different-type',{type:'empresa'}],
  ]){
    const token=`deny-${label}`,data=input(token);await seed(token);await db.doc(`providers/${token}`).set({dni:data.form.dni,...extra});
    await denied(data);assert.equal((await db.doc(`providerInvites/${token}`).get()).data().used,false);pass(`reject ${label} without consuming link`);
  }
  for(const status of ['active','needs_confirmation','revoked','rejected']){
    const token=`membership-${status}`,data=input(token);await seed(token);await db.doc(`providers/${token}`).set({dni:data.form.dni});
    await db.doc(`providerPortalUsers/other/memberships/${token}`).set({providerId:token,status,email:'other@example.test'});
    await denied(data,/acceso asociado/);pass(`protect ${status} membership`);
  }
  const missingField=input('old-membership');await seed('old-membership');await db.doc('providers/old-membership').set({dni:missingField.form.dni});
  await db.doc('providerPortalUsers/other/memberships/old-membership').set({email:'other@example.test',status:'active'});
  await denied(missingField,/acceso asociado/);pass('old membership without providerId still protects its document identity');
  for(const mode of ['two-records','crossed-index','stale-index','malformed-index']){
    const token=`conflict-${mode}`,data=input(token);await seed(token);
    if(mode!=='stale-index')await db.doc(`providers/${token}`).set({dni:data.form.dni});
    if(mode==='two-records')await db.doc(`providers/${token}-second`).set({cuit:data.form.cuit});
    else await db.doc(`providerIdentifiers/cuit_${data.form.cuit}`).set(mode==='malformed-index'?{}:{providerId:mode==='stale-index'?'missing':`${token}-other`});
    await denied(data);pass(`reject ${mode}`);
  }
  await seed('name-only');await db.doc('providers/same-name').set({name:'Persona',lastName:'Prueba'});
  assert.notEqual((await submit(input('name-only'))).providerId,'same-name');pass('same name alone never claims or merges');
  await seed('race',{mode:'multi_use',usageCount:0});const race=input('race');await db.doc('providers/race-old').set({dni:race.form.dni});
  const concurrent=await Promise.allSettled([submit(race),submit({...race,attemptId:'race-other',form:{...race.form,email:'other@example.test'}},'other')]);
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal((await db.doc('providerInvites/race').get()).data().usageCount,1);
  assert.equal((await db.doc(`providerIdentifiers/dni_${race.form.dni}`).get()).data().providerId,'race-old');pass('two accounts racing: one completion only');
  await seed('retry-race');const retry=input('retry-race');const both=await Promise.all([submit(retry),submit(retry)]);assert.equal(both[0].providerId,both[1].providerId);pass('concurrent exact retries create one provider');
  for(const [label,extra]of[['expired',{expiresAt:admin.firestore.Timestamp.fromMillis(0)}],['cancelled',{status:'cancelled'}],['used',{used:true,status:'used'}]]){
    await seed(label,extra);await denied(input(label));pass(`reject ${label} invite`);
  }
  for(const extra of [{providerId:'different'},{providerName:'Nombre sin ficha'},{paid:true},{paymentHistory:[{amount:1}]},{paymentLocked:true}]){
    const token=`target-denied-${sequence++}`;await seed(token,{projectId:'fictitious',collectionName:'areaExpenses',expenseId:token});await db.doc(`projects/fictitious/areaExpenses/${token}`).set(extra);await denied(input(token));
  }pass('ordinary link cannot replace assigned or paid expenses');
  await seed('wrong-provisional',{projectId:'fictitious',collectionName:'areaExpenses',expenseId:'wrong',provisionalProviderId:'wrong'});
  await db.doc('projects/fictitious/areaExpenses/wrong').set({providerId:'wrong'});await denied(input('wrong-provisional'),/ficha/);pass('provisional link is bound to exact provider/target');
  await seed('bad-form');const bad=input('bad-form');
  for(const changes of [{personalAccountAccepted:false},{ownAccountConfirmed:false},{form:{...bad.form,role:'admin'}},{form:{...bad.form,email:'other@example.test'}},{form:{...bad.form,bankAccount_alias:''}}])await denied({...bad,...changes});
  for(const auth of [null,{uid:'person',token:{email:'person@example.test',email_verified:false}},{uid:'person',token:{email:'person@example.test',email_verified:true,firebase:{sign_in_provider:'password'}}},{uid:'person',token:{email:'person@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'},auth_time:0}}])await assert.rejects(portal({...request(bad),auth}));
  pass('Google identity, recent session, consent, bank and server form validation');
  const sdk=env.authenticatedContext('person',{email:'person@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
  const legacyDirect=JSON.parse(JSON.stringify(saved));
  delete legacyDirect.registration;delete legacyDirect.bankAccount_holder;
  legacyDirect.createdAt=serverTimestamp();legacyDirect.updatedAt=serverTimestamp();legacyDirect.personalGoogleAccount.acceptedAt=serverTimestamp();
  await assertFails(setDoc(doc(sdk,'providers','direct-copy'),legacyDirect));
  await assertFails(updateDoc(doc(sdk,'providers',out.providerId),{bankAccount_alias:'changed'}));
  await assertFails(updateDoc(doc(sdk,'providers',out.providerId),{personalGoogleAccount:{uid:'other'}}));
  await assertFails(getDoc(doc(sdk,'providers',out.providerId)));await assertFails(getDocs(collection(sdk,'providers')));
  await assertFails(getDoc(doc(sdk,'providerRegistrationSubmissions','unknown')));
  await assertFails(setDoc(doc(sdk,'users','person'),{role:'admin',email:'person@example.test'}));pass('SDK bypass, identity/bank changes, catalog/receipt exposure and internal role escalation denied');
  await db.doc('users/staff').set({role:'colaborador',email:'staff@example.test'});
  const historicalRef=db.doc('providers/historical-supplier');
  const historical={name:'Persona ficticia',source:'manual',bankAccount_alias:'fictional.own'};
  await historicalRef.set(historical);
  const declaration={kind:'profile',status:'applied',proof:{complete:true,privateFile:'must-not-leave-server'},actor:{email:'private@example.test'},content:{confirmation:{version:'profile-confirmation-v1'}}};
  await db.doc('providerPortalDeclarations/historical-supplier').set({...declaration,providerId:'historical-supplier'});
  for(const [id,changes] of [['pending',{status:'pending_signature'}],['incomplete',{proof:{complete:false}}],['representation',{kind:'representation'}],['unsupported',{content:{confirmation:{version:'unknown'}}}]]){
    await db.doc(`providerPortalDeclarations/lookup-${id}`).set({...declaration,providerId:`lookup-${id}`,...changes});
  }
  await db.doc('providerPortalDeclarations/unrequested').set({...declaration,providerId:'unrequested'});
  const lookup={action:'registrationStatuses',providerIds:['historical-supplier','historical-supplier','lookup-pending','lookup-incomplete','lookup-representation','lookup-unsupported','missing']};
  const auditCount=(await db.collection('providerPortalAudit').get()).size;
  assert.deepEqual(await submit(lookup,'staff'),{registeredProviderIds:['historical-supplier'],administrativeProviderIds:[]});
  assert.deepEqual((await historicalRef.get()).data(),historical,'status lookup never rewrites the supplier or invents registration metadata');
  assert.equal((await db.collection('providerPortalAudit').get()).size,auditCount,'status lookup is read-only');
  pass('staff recognizes legacy applied signature immediately, with minimal ID-only output and no provider/audit writes');
  const bulk=Array.from({length:31},(_,i)=>`bulk-${i}`);
  await db.doc('providerPortalDeclarations/last-batch').set({...declaration,providerId:bulk[30]});
  assert.deepEqual(await submit({action:'registrationStatuses',providerIds:bulk},'staff'),{registeredProviderIds:[bulk[30]],administrativeProviderIds:[]});
  pass('legacy lookup batches beyond 30 identifiers without dropping the last supplier');
  await assert.rejects(submit(lookup),error=>error.code==='permission-denied');
  await db.doc('teamAccessEmails/staff@example.test').set({status:'pending'});
  await assert.rejects(submit(lookup,'staff'),error=>error.code==='permission-denied');
  await db.doc('teamAccessEmails/staff@example.test').set({status:'ready'});
  await assert.rejects(portal({...request(lookup,'staff'),auth:{...request(lookup,'staff').auth,token:{...request(lookup,'staff').auth.token,email_verified:false}}}));
  await assertFails(getDoc(doc(sdk,'providerPortalDeclarations','historical-supplier')));
  pass('external, unfinished and unverified identities cannot inspect history; SDK declarations remain private');
  const { testProviderAdministrativeRecords } = await import('./providerAdministrativeRecords.flow.mjs');
  await testProviderAdministrativeRecords({ db, admin, portal, env });
  console.log(`PASS ${passed} provider registration scenario groups; fictional data only.`);
}finally{await env.cleanup();await app.delete();}
