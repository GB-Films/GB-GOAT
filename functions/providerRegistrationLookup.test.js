const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createProviderRegistrationLookup}=require('./providerRegistrationLookup');
const actor={uid:'staff',email:'staff@example.test'};
const dbFor=(profile,gate)=>({doc:path=>({get:async()=>{const data=path.startsWith('users/')?profile:gate;return {exists:!!data,data:()=>data};}}),collection:()=>{throw Error('History must not be read');}});
test('external providers, missing users and unfinished/blocked team accounts cannot inspect registration evidence',async()=>{
  for(const [profile,gate] of [[undefined,undefined],[{role:'portal'},undefined],[{role:'colaborador',teamOnboarding:{version:1,status:'needs_profile'}},undefined],[{role:'admin'},{status:'pending'}],[{role:'admin'},{status:'revoked'}]]){
    await assert.rejects(createProviderRegistrationLookup({db:dbFor(profile,gate)})(actor,{providerIds:['legacy']}),error=>error.code==='permission-denied');
  }
});
test('unbounded and malformed supplier lookups fail before reading private history',async()=>{
  const lookup=createProviderRegistrationLookup({db:dbFor({role:'admin'})});
  for(const providerIds of [null,'legacy',Array(501).fill('legacy'),['../private'],[12],['x'.repeat(161)]]){
    await assert.rejects(lookup(actor,{providerIds}),error=>error.code==='invalid-argument');
  }
  assert.deepEqual(await lookup(actor,{providerIds:[]}),{registeredProviderIds:[],administrativeProviderIds:[]});
});
