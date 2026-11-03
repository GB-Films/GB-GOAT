const {test}=require('node:test');
const assert=require('node:assert/strict');
const {signedProfileRegistration}=require('./providerRegistrationEvidence');
test('only applied profile confirmations with complete evidence count; actor and signed account transfer are checked',()=>{
  const actor={uid:'person',email:'person@example.test'};
  const row={kind:'profile',status:'applied',proof:{complete:true},actor,content:{confirmation:{version:'profile-confirmation-v1',accessEmail:actor.email}}};
  assert.equal(signedProfileRegistration(row,actor),true);
  for(const overrides of [{status:'pending_signature'},{status:'pending_review'},{proof:{complete:false}},{kind:'representation'},{content:{}},{actor:{...actor,uid:'other'}}])assert.equal(signedProfileRegistration({...row,...overrides},actor),false);
  const transfer={...row,actor:{uid:'old'},content:{...row.content,accountChoice:{selected:actor}},accountChoiceApplied:{authority:'signed_verified_accounts',selected:actor}};
  assert.equal(signedProfileRegistration(transfer,actor),true);
  assert.equal(signedProfileRegistration({...transfer,accountChoiceApplied:{selected:actor},review:{decision:'approved'}},actor),true);
  assert.equal(signedProfileRegistration({...transfer,content:row.content},actor),false);
});
