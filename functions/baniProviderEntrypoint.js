'use strict';
const {getApps,initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {defineString}=require('firebase-functions/params');
const {onCall}=require('firebase-functions/v2/https');
const {onDocumentWritten}=require('firebase-functions/v2/firestore');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {createBaniProviderLinkHandler,syncLinkedProvider}=require('./baniProviderLink');
const {reconcileBaniProviders}=require('./baniProviderAutoLink');

const project=defineString('BANI_PROJECT_ID',{default:'gran-berta-films'});
const database=defineString('BANI_DATABASE_ID',{default:'ai-studio-1ef504c9-77ed-4378-b361-4b3659b5d837'});
const owner=defineString('BANI_OWNER_UID');
const sourceDb=getFirestore(getApps().find(app=>app.name==='[DEFAULT]')||initializeApp());
const getTargetDb=()=>getFirestore(getApps().find(app=>app.name==='bani-provider-link')||initializeApp({projectId:project.value()},'bani-provider-link'),database.value());
const serviceAccount='bani-project-sync@gb-goat.iam.gserviceaccount.com';
const region='us-central1';
const opts={region,serviceAccount,maxInstances:2};
exports.manageBaniProviderLink=onCall(opts,createBaniProviderLinkHandler({sourceDb,getTargetDb,getOwnerUid:()=>owner.value()}));
exports.syncBaniProviderLink=onDocumentWritten({...opts,document:'providers/{providerId}',database:'(default)',retry:false},
  event=>syncLinkedProvider({sourceDb,targetDb:getTargetDb(),ownerUid:owner.value(),providerId:event.params.providerId}));
exports.reconcileBaniProviderLinks=onSchedule({...opts,schedule:'every 60 minutes',timeZone:'America/Argentina/Buenos_Aires',maxInstances:1,concurrency:1,timeoutSeconds:180,retryCount:0},async()=>{
  const counts=await reconcileBaniProviders({sourceDb,targetDb:getTargetDb(),ownerUid:owner.value()});
  console.info('BANI provider reconciliation counts',counts);
});
