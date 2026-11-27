'use strict';
const {FieldPath}=require('firebase-admin/firestore');
const {searchKey,providerProjection,linkProvider,readProvider,syncLinkedProvider}=require('./baniProviderLink');
const normalizeEmail=v=>{
  const email=typeof v==='string'?v.trim().toLowerCase():'';
  return email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:'';
};
const pick=(rows,key)=>rows.reduce((map,row)=>{
  const val=key(row);
  if(val){const bucket=map.get(val)||[];bucket.push(row);map.set(val,bucket);}
  return map;
},new Map());
const parts=(a,b)=>[a,b].filter(x=>typeof x==='string'&&x.trim()).join(' ');
const memberName=d=>d.name||parts(d.firstName,d.lastName);
const providerName=d=>providerProjection({exists:true,data:()=>d}).displayName;

function identity(s){ return searchKey(s).replace(/[^\p{L}\p{N} ]/gu,' ').replace(/\s+/g,' ').trim(); }
function automaticPairs(providerRows,memberRows){
  // All records count towards email uniqueness, even businesses. Shared inboxes
  // or duplicates never become automatic links.
  const providers=pick(providerRows,row=>normalizeEmail(row.data.email));
  const members=pick(memberRows,row=>normalizeEmail(row.data.email));
  const out=[];
  for(const [email, source] of providers){
    const target=members.get(email);
    if(source.length!==1 || target?.length!==1)continue;
    const [p]=source,[m]=target;
    if(p.data.type!=='persona')continue;
    const src=identity(providerName(p.data)),dst=identity(memberName(m.data));
    if(src&&src===dst&&src.includes(' '))out.push({provider:p,member:m});
  }
  return out.sort((a,b)=>a.provider.id.localeCompare(b.provider.id));
}

async function readDirectory(collection,fields,limit=2000){
  const docs=[];let last;
  for(;;){
    const page=collection.select(...fields).orderBy(FieldPath.documentId()).limit(Math.min(200,limit+1-docs.length));
    const snap=await (last?page.startAfter(last):page).get();
    if(snap.empty)break;
    for(const d of snap.docs)docs.push({id:d.id,data:d.data(),snapshot:d});
    if(docs.length>limit)throw new Error('Directory limit exceeded; no automatic links evaluated.');
    last=snap.docs.at(-1);
  }
  return docs;
}
async function reconcileBaniProviders({sourceDb,targetDb,ownerUid}){
  const [goat,bani]=await Promise.all([
    readDirectory(sourceDb.collection('providers'),['type','firstName','name','lastName','fullName','businessName','category','categoryOther','email']),
    readDirectory(targetDb.collection('users').doc(ownerUid).collection('team'),['firstName','lastName','name','email']),
  ]);
  const pairs=automaticPairs(goat,bani);
  let linked=0,alreadyLinked=0,skipped=0;
  for(const {provider,member} of pairs){
    try{
      const current=await readProvider(sourceDb,provider.id,true), expected=normalizeEmail(member.data.email);
      if(!current.exists||current.data().type!=='persona'||normalizeEmail(current.data().email)!==expected||
        identity(providerName(current.data()))!==identity(memberName(member.data))){skipped++;continue;}
      const result=await linkProvider({targetDb,ownerUid,providerId:provider.id,memberId:member.id,source:current,newMatch:{
        email:normalizeEmail(member.data.email),name:identity(memberName(member.data)),
        identity,normalizeEmail,
      }});
      if(result==='created')linked++;else alreadyLinked++;
    }catch(error){
      if(!['already-exists','failed-precondition','not-found'].includes(error.code))throw error;
      skipped++;
    }
  }
  // Recover from a transient event failure and continue existing links even if their email changed.
  const sources=await readDirectory(targetDb.collection('goatProviderLinks').doc(ownerUid).collection('providers'),['memberId']);
  let refreshed=0;
  for(const {id} of sources)if(await syncLinkedProvider({sourceDb,targetDb,ownerUid,providerId:id}))refreshed++;
  return {matched:pairs.length,linked,alreadyLinked,skipped,refreshed};
}
module.exports={automaticPairs,normalizeEmail,readDirectory,reconcileBaniProviders};
