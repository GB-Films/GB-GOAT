'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {automaticPairs}=require('./baniProviderAutoLink');
const goat=(id,name,email,type='persona')=>({id,data:{type,fullName:name,businessName:name,email}});
const bani=(id,name,email)=>({id,data:{name,email}});
test('existing contact links when a GOAT provider arrives, or when BANI appears second',()=>{
 const p=goat('p','María Suárez','maria@prueba.invalid');
 const m=bani('m','MARIA SUAREZ','Maria@prueba.invalid ');
 assert.deepEqual(automaticPairs([], [m]),[]);
 assert.deepEqual(automaticPairs([p], []),[]);
 assert.deepEqual(automaticPairs([p], [m]),[{provider:p,member:m}]);
});
test('homonyms, partial names, missing or differing emails, shared addresses and companies never auto-link',()=>{
 const p=goat('p','María Suárez','maria@prueba.invalid');
 assert.deepEqual(automaticPairs([p],[bani('1','María Suárez','')]),[]);
 assert.deepEqual(automaticPairs([p],[bani('1','María Suárez','other@prueba.invalid')]),[]);
 assert.deepEqual(automaticPairs([p],[bani('1','Otra Persona','maria@prueba.invalid')]),[]);
 assert.deepEqual(automaticPairs([p],[bani('1','María','maria@prueba.invalid')]),[]);
 const m=bani('1','María Suárez','maria@prueba.invalid');
 assert.deepEqual(automaticPairs([p,goat('p2','Estudio','maria@prueba.invalid','empresa')],[m]),[]);
 assert.deepEqual(automaticPairs([p],[m,bani('2','Otra Persona','maria@prueba.invalid')]),[]);
 assert.deepEqual(automaticPairs([goat('p','María Suárez','maria@prueba.invalid','empresa')],[m]),[]);
});
