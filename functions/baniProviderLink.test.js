'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {providerProjection,searchKey,compare,createBaniProviderLinkHandler,syncLinkedProvider}=require('./baniProviderLink');

test('only provider name and category are projected; no banking, identity, contact or payment fields',()=>{
  const source={exists:true,data:()=>({type:'persona',name:'Ada',lastName:'Prueba',category:'Otra',categoryOther:'Sonido',
    email:'personal@example.invalid',phone:'123',cuit:'123',dni:'123',address:'Private',bankAccount_cbu:'123',paymentAmount:1})};
  assert.deepEqual(providerProjection(source),{status:'linked',displayName:'Ada Prueba',category:'Sonido'});
  assert.deepEqual(providerProjection({exists:true,data:()=>({type:'empresa',businessName:'Estudio Uno',category:'VFX'})}),
    {status:'linked',displayName:'Estudio Uno',category:'VFX'});
  assert.deepEqual(providerProjection({exists:false}),{status:'missing',displayName:'',category:''});
});
test('normalizes only user-driven search and rejects older snapshots',()=>{
  assert.equal(searchKey(' María  López '),'maria lopez');
  assert.ok(compare({seconds:30,nanoseconds:50},{seconds:30,nanoseconds:60})<0);
});
function store(entries={}){
  let now=1;
  const set=new Map(Object.entries(entries));
  const doc=path=>({path,id:path.split('/').at(-1),get:()=>Promise.resolve(snapshot(path)),collection:name=>collection(path+'/'+name)});
  const snapshot=path=>({ref:doc(path),id:path.split('/').at(-1),exists:set.has(path),data:()=>set.get(path),readTime:{seconds:now++,nanoseconds:0}});
  function collection(path){
    const api={doc:id=>doc(path+'/'+id),select:()=>api,orderBy:()=>api,limit:()=>api,startAfter:()=>api,
      get:async()=>{const docs=[...set.keys()].filter(p=>p.startsWith(path+'/')&&p.substring(path.length+1).indexOf('/')===-1).map(snapshot);return {docs,empty:!docs.length,size:docs.length}}};
    return api;
  }
  return {set,collection,getAll:async(ref,mask)=>{
    const s=snapshot(ref.path); const d=s.data(); return [{...s,data:()=>d&&Object.fromEntries(mask.fieldMask.filter(k=>k in d).map(k=>[k,d[k]]))}];
  },runTransaction:async fn=>{
    const queued=[];
    const out=await fn({get:r=>r.get(),create:(r,v)=>{assert(!set.has(r.path));queued.push([r.path,v]);},update:(r,v)=>queued.push([r.path,{...set.get(r.path),...v}])});
    for(const [p,v] of queued)set.set(p,v);
    return out;
  }};
}
test('checked admin makes an explicit one-to-one link; updates and deletion never change BANI contact or unlinked records',async()=>{
  const source=store({'users/admin1':{role:'admin'},'users/staff1':{role:'colaborador'},'providers/p1':{name:'Ada GOAT',category:'Sonido',cuit:'private'},'providers/p2':{name:'Otra',category:'Cámara'}});
  const target=store({'users/owner/team/b1':{name:'Ada Local',email:'local@example.invalid',role:'Montaje',notes:'Keep'},'users/owner/team/b2':{name:'Otra Persona'}});
  const args={sourceDb:source,targetDb:target,ownerUid:'owner'};
  const handle=createBaniProviderLinkHandler({sourceDb:source,getTargetDb:()=>target,getOwnerUid:()=>'owner'});
  const call=(data,uid='admin1',email_verified=true)=>handle({auth:{uid,token:{email_verified}},data});
  const linkPath='goatProviderLinks/owner/contacts/b1';
  assert.equal(await syncLinkedProvider({...args,providerId:'p1'}),false);
  assert.equal(target.set.has(linkPath),false);
  await assert.rejects(call({action:'find',providerId:'p1',query:'Ada'},'staff1'),{code:'permission-denied'});
  await assert.rejects(call({action:'find',providerId:'p1',query:'Ada'},'admin1',false),{code:'permission-denied'});
  assert.deepEqual(await call({action:'find',providerId:'p1',query:'ada'}),{linkedContact:null,candidates:[{id:'b1',name:'Ada Local'}]});
  await assert.rejects(call({action:'link',providerId:'unregistered',memberId:'b1'}),{code:'not-found'});
  await assert.rejects(call({action:'link',providerId:'p1',memberId:'unregistered'}),{code:'not-found'});
  assert.deepEqual(await call({action:'link',providerId:'p1',memberId:'b1'}),{linked:true});
  await assert.rejects(call({action:'link',providerId:'p2',memberId:'b1'}),{code:'already-exists'});
  await assert.rejects(call({action:'link',providerId:'p1',memberId:'b2'}),{code:'already-exists'});
  source.set.set('providers/p1',{name:'Ada Corregida',category:'Mezcla',bankAccount:'private'});
  assert.equal(await syncLinkedProvider({...args,providerId:'p1'}),true);
  assert.equal(target.set.get(linkPath).displayName,'Ada Corregida');
  assert.equal(target.set.get(linkPath).category,'Mezcla');
  assert.equal(target.set.get(linkPath).bankAccount,undefined);
  source.set.delete('providers/p1');
  assert.equal(await syncLinkedProvider({...args,providerId:'p1'}),true);
  assert.equal(target.set.get(linkPath).status,'missing');
  assert.equal(target.set.get(linkPath).displayName,'Ada Corregida');
  assert.deepEqual(target.set.get('users/owner/team/b1'),{name:'Ada Local',email:'local@example.invalid',role:'Montaje',notes:'Keep'});
  assert.equal(target.set.has('goatProviderLinks/owner/contacts/b2'),false);
});
