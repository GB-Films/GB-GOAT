const test=require('node:test');
const assert=require('node:assert/strict');
const {createProviderPortalHandler}=require('./providerPortal');
const reference='11111111-2222-4333-8444-555555555555';
const request={auth:{uid:'person',token:{email:'person@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'},auth_time:Date.now()/1000}},data:{action:'registerProvider',inviteToken:'fictional-link',attemptId:reference,personalAccountAccepted:true,ownAccountConfirmed:true,form:{type:'persona',name:'Persona',lastName:'Prueba',dni:'12345678',cuit:'20123456786',email:'person@example.test',phone:'123',address:'Casa',category:'Sonido',bankAccount_alias:'fictional.own'}}};
test('registration failure returns a correlatable reference without disclosing internal errors or logging the form', async()=>{
  const logs=[];let transactions=0;
  const db={doc:path=>({path,get:async()=>({data:()=>({enabled:true})})}),collection:()=>({doc:()=>({id:'new-provider'})}),runTransaction:async()=>{transactions++;throw Object.assign(new Error('PRIVATE_BANK_DATA'),{code:14});}};
  const portal=createProviderPortalHandler({db,timestamp:()=>null,registrationLog:entry=>logs.push(entry)});
  await assert.rejects(portal(request),error=>{
    assert.equal(error.code,'internal');assert.equal(error.details.supportReference,reference);assert.doesNotMatch(error.message,/PRIVATE_BANK/);return true;
  });
  assert.equal(transactions,1);assert.equal(logs.length,1);
  const {frames,...metadata}=logs[0];assert.deepEqual(metadata,{supportReference:reference,code:'14',errorType:'Error'});assert(frames.length>0);
  assert.doesNotMatch(JSON.stringify(logs),/person@example|fictional.own|fictional-link|PRIVATE_BANK_DATA/);
  await assert.rejects(portal({...request,data:{...request.data,form:{...request.data.form,phone:'x'.repeat(61)}}}),error=>error.code==='failed-precondition'&&error.details.field==='phone'&&error.details.supportReference===reference);
  assert.equal(transactions,1,'validation failure never starts a write transaction');
  await assert.rejects(portal({...request,auth:{...request.auth,token:{...request.auth.token,auth_time:0}}}),error=>error.code==='unauthenticated'&&error.details.supportReference===reference);
  assert.equal(transactions,1,'an expired session never starts a write transaction');
});
