const {test}=require('node:test');
const assert=require('node:assert/strict');
const {signedProfileRegistration}=require('./providerRegistrationEvidence');
test('only applied profile confirmations with complete evidence count; actor and signed account transfer are checked',()=>{
  const actor={uid:'person',email:'person@example.test'};
  const row={kind:'profile',status:'applied',proof:{complete:true},actor,content:{confirmation:{version:'profile-confirmation-v1'}}};
  assert.equal(signedProfileRegistration(row,actor),true);
  for(const overrides of [{status:'pending_signature'},{status:'pending_review'},{proof:{complete:false}},{kind:'representation'},{content:{}},{actor:{...actor,uid:'other'}}])assert.equal(signedProfileRegistration({...row,...overrides},actor),false);
  assert.equal(signedProfileRegistration({...row,actor:{uid:'old'},accountChoiceApplied:{authority:'signed_verified_accounts',selected:actor}},actor),true);
});
