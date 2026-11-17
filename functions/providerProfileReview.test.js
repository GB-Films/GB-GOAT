const test = require('node:test'), assert = require('node:assert/strict');
const { profileReview } = require('./providerProfileReview');
test('revisión señala datos incompletos y banco inválido sin cambiar ficha ni completar alta', () => {
  const provider = { type: 'persona', name: 'Ficticio', bankAccount_cbu: 'invalid', bankAccount_alias: '', source: 'manual' }, before = structuredClone(provider);
  const review = profileReview(provider, { status: 'required' });
  assert.equal(review.required, true); assert.equal(review.registrationPending, true);
  assert(review.fields.some(field => field.field === 'bankAccount_cbu' && /22/.test(field.message)));
  assert(review.fields.some(field => field.field === 'dni')); assert(review.fields.some(field => field.field === 'cuit'));
  assert.deepEqual(provider, before); assert.equal(Object.hasOwn(provider, 'registration'), false);
});
test('avisos siguen datos reales: registro existente no tapa errores, persona completa confirmada no requiere aviso y empresa no se infiere', () => {
  const complete = { type: 'persona', name: 'Ficticio', dni: '12345678', cuit: '20123456789', email: 'own@example.test', phone: '123', address: 'Ficticio', bankAccount_alias: 'own.account', registration: { status: 'complete' } };
  assert.equal(profileReview(complete, { status: 'confirmed' }).required, false);
  const manualComplete = { ...complete, registration: undefined, source: 'manual' };
  const pending = profileReview(manualComplete, { status: 'required' });
  assert.equal(pending.fields.length, 0); assert.equal(pending.registrationPending, true); assert.equal(pending.required, true);
  assert.equal(profileReview(manualComplete, { status: 'confirmed' }, [{ kind: 'profile', status: 'applied', proof: { complete: true }, content: { confirmation: { version: 'profile-confirmation-v1' } } }]).registrationPending, false);
  assert.equal(profileReview({ ...complete, bankAccount_cbu: 'invalid' }, { status: 'confirmed' }).required, true);
  assert.equal(profileReview({ ...complete, type: 'empresa' }).required, false);
  const legacy = { ...complete }; delete legacy.type;
  assert.equal(profileReview(legacy, { status: 'confirmed' }).classificationPending, true);
});
