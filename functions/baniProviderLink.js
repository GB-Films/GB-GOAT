'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { FieldPath } = require('firebase-admin/firestore');
const { hasTeamWorkAccess } = require('./teamWorkAccess');

const bounded = (v, max=180) => typeof v === 'string' ? v.trim().slice(0,max) : '';
const searchKey = v => bounded(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');
const key = v => {
  if(typeof v!=='string' || !v || v.includes('/') || v==='.' || v==='..' || /^__.*__$/.test(v) || Buffer.byteLength(v)>1024)
    throw new HttpsError('invalid-argument','Identificador inválido.');
  return v;
};
const providerFields=['type','firstName','name','lastName','fullName','businessName','category','categoryOther'];
const memberFields=['firstName','lastName','name'];
const joinName=(first,last)=>[bounded(first),bounded(last)].filter(Boolean).join(' ').slice(0,180);
const memberName=data=>bounded(data.name)||joinName(data.firstName,data.lastName);
function providerProjection(source){
  if(!source.exists) return {status:'missing',displayName:'',category:''};
  const d=source.data()||{};
  const displayName=d.type==='empresa' ? bounded(d.businessName)||bounded(d.name)||bounded(d.fullName)
    : bounded(d.fullName)||joinName(d.firstName||d.name,d.lastName)||bounded(d.businessName);
  if(!displayName) return {status:'missing',displayName:'',category:''};
  return {status:'linked',displayName,category:bounded(d.category==='Otra'?d.categoryOther||d.category:d.category,100)};
}
const timeOf=s=>({seconds:Number(s.readTime?.seconds||0),nanoseconds:Number(s.readTime?.nanoseconds||0)});
const compare=(a,b)=>Number(a?.seconds||0)-Number(b?.seconds||0)||Number(a?.nanoseconds||0)-Number(b?.nanoseconds||0);
const paths=(db,owner)=>({
  team:db.collection('users').doc(key(owner)).collection('team'),
  links:db.collection('goatProviderLinks').doc(key(owner)).collection('contacts'),
  providers:db.collection('goatProviderLinks').doc(key(owner)).collection('providers'),
});
const readProvider=async (db,providerId)=>(await db.getAll(db.collection('providers').doc(key(providerId)),{fieldMask:providerFields}))[0];
const memberResult=doc=>({id:doc.id,name:memberName(doc.data()||{})});

async function assertAdmin(db,request){
  if(!request.auth?.uid || request.auth.token?.email_verified!==true) throw new HttpsError('permission-denied','Iniciá sesión con una cuenta verificada de GOAT.');
  const user=(await db.collection('users').doc(key(request.auth.uid)).get()).data();
  if(user?.role!=='admin'||!hasTeamWorkAccess(user))throw new HttpsError('permission-denied','Solo administración de GOAT puede vincular proveedores.');
}

async function syncLinkedProvider({sourceDb,targetDb,ownerUid,providerId}){
  providerId=key(providerId);
  const {links,providers}=paths(targetDb,ownerUid);
  const indexed=await providers.doc(providerId).get();
  if(!indexed.exists)return false;
  const source=await readProvider(sourceDb,providerId), observed=timeOf(source);
  const ref=links.doc(key(indexed.data().memberId));
  return targetDb.runTransaction(async tx=>{
    const current=(await tx.get(ref)).data();
    if(current?.providerId!==providerId||compare(observed,current.observed)<=0)return false;
    const patch=providerProjection(source);
    if(patch.status==='missing'){patch.displayName=current.displayName||'';patch.category=current.category||'';}
    tx.update(ref,{...patch,observed});
    return true;
  });
}

function createBaniProviderLinkHandler({sourceDb,getTargetDb,getOwnerUid}){
  return async request=>{
    await assertAdmin(sourceDb,request);
    const input=request.data||{}, providerId=key(input.providerId);
    const source=await readProvider(sourceDb,providerId);
    if(!source.exists)throw new HttpsError('not-found','El proveedor ya no existe en GOAT.');
    const targetDb=getTargetDb(),ownerUid=getOwnerUid();
    const {links,providers,team}=paths(targetDb,ownerUid);
    const providerRef=providers.doc(providerId);
    if(input.action==='find'){
      const q=searchKey(input.query);
      if(q&&q.length<3)throw new HttpsError('invalid-argument','Ingresá al menos tres letras.');
      const existing=await providerRef.get();
      if(existing.exists){
        const memberId=key(existing.data().memberId);
        const [contact]=await targetDb.getAll(team.doc(memberId),{fieldMask:memberFields});
        return {linkedContact:contact.exists?memberResult(contact):{id:memberId,name:'Contacto no disponible'},candidates:[]};
      }
      if(!q)return {linkedContact:null,candidates:[]};
      const matches=[];
      let last;
      for(let i=0;i<10&&matches.length<20;i++){
        const query=team.select(...memberFields).orderBy(FieldPath.documentId()).limit(200);
        const batch=await (last?query.startAfter(last):query).get();
        if(batch.empty)break;
        for(const doc of batch.docs){
          const row=memberResult(doc); if(row.name&&searchKey(row.name).includes(q))matches.push(row);
          if(matches.length===20)break;
        }
        if(batch.size<200)break;
        last=batch.docs.at(-1);
      }
      return {linkedContact:null,candidates:matches};
    }
    if(input.action!=='link')throw new HttpsError('invalid-argument','Acción inválida.');
    const projection=providerProjection(source);
    if(projection.status!=='linked')throw new HttpsError('failed-precondition','El proveedor no tiene nombre para mostrar.');
    const memberId=key(input.memberId);
    const ref=links.doc(memberId);
    await targetDb.runTransaction(async tx=>{
      const [candidate,contact,other]=await Promise.all([tx.get(ref),tx.get(team.doc(memberId)),tx.get(providerRef)]);
      if(!contact.exists)throw new HttpsError('not-found','El contacto ya no existe en BANI LAB.');
      if(candidate.exists&&candidate.data().providerId!==providerId)
        throw new HttpsError('already-exists','El contacto ya está vinculado a otro proveedor.');
      if(other.exists&&other.data().memberId!==memberId)throw new HttpsError('already-exists','Este proveedor ya está vinculado a otro contacto.');
      if(!candidate.exists)tx.create(ref,{providerId,...projection,observed:timeOf(source)});
      if(!other.exists)tx.create(providerRef,{memberId});
    });
    await syncLinkedProvider({sourceDb,targetDb,ownerUid,providerId});
    return {linked:true};
  };
}
module.exports={providerProjection,searchKey,compare,createBaniProviderLinkHandler,syncLinkedProvider};
