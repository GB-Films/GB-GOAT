const { test } = require('node:test');
const assert = require('node:assert/strict');
const { identifiers, assertProvisional, validateRegistration } = require('./providerRegistration');
const actor = {uid:'person',email:'person@example.test'};
const form = {type:'persona',name:'Persona',lastName:'Prueba',dni:'12.345.678',cuit:'20-12345678-6',email:actor.email,phone:'123',address:'Casa',category:'Sonido',bankAccount_alias:'own.alias'};
test('legacy 7/8/9-digit DNIs and formatted CUITs resolve without name matching', () => {
  for (const value of ['1.234.567','12.345.678','123.456.789']) assert.equal(identifiers({dni_cuit:value}).dni,value.replace(/\D/g,''));
  assert.equal(identifiers({dni_cuit:'30-12345678-6'}).cuit,'30123456786');
  assert.equal(identifiers({name:'Persona'}).dni,'');
});
test('provisional identity must be compatible and existing accounts/associations cannot be reclaimed', () => {
  assertProvisional({dni_cuit:'12.345.678'},form);
  assertProvisional({type:'empresa',dni_cuit:'30-12345678-6'},{type:'empresa',cuit:'30123456786'});
  for (const row of [{type:'empresa'}, {dni:'12345679'}, {cuit:'30111111111'}, {source:'provider_invite'}, {source:'team_onboarding'}, {personalGoogleAccount:{uid:actor.uid}}, {registration:{status:'complete'}}, {portalAccessEmail:actor.email}, {accessPreparation:{generation:'old'}}]) assert.throws(()=>assertProvisional(row,form));
});
test('server validates form, Google email, own bank and no arbitrary fields', () => {
  assert.equal(validateRegistration(form,actor).cuit,form.cuit);
  for (const changes of [{role:'admin'}, {email:'someone@example.test'}, {bankAccount_alias:'',bankAccount_cbu:''}, {dni:'123'}, {cuit:'123'}, {birthDate:'2026-02-31'}, {phone:42}, {name:'x'.repeat(161)}]) assert.throws(()=>validateRegistration({...form,...changes},actor));
});

test('formatted CBU/CVU is normalized before its length is validated; invalid fields are actionable', () => {
  const cbu = '00000031 00123456 789012';
  assert.equal(validateRegistration({...form,bankAccount_cbu:cbu},actor).bankAccount_cbu,cbu.replace(/\D/g,''));
  for (const [field,value] of [['phone','1'.repeat(61)],['bankAccount_cbu','123'],['birthDate','2026-02-31'],['bankAccount_alias','x'.repeat(101)]]) {
    assert.throws(()=>validateRegistration({...form,[field]:value},actor), error=>error.code==='failed-precondition'&&error.details.field===field&&error.details.reason==='REGISTRATION_INVALID_FIELD');
  }
});
