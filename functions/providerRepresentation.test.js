const test = require('node:test');
const assert = require('node:assert/strict');
const { companyRepresentation, checkCompanyReview, assertCompanyAccount, assertDeclaredCompany, companySigningAuthority } = require('./providerRepresentation');
const { hash } = require('./providerPortalModel');
const { thirdPartyDeclaration, checkThirdPartyReview } = require('./providerThirdPartyDeclaration');
const { COMPANY_EVIDENCE } = require('./providerEvidence');
const company = { type: 'empresa', businessName: 'Empresa de Ejemplo SRL', cuit: '30111111112' };
const actor = { uid: 'person', email: 'administracion@example.test' };
const representative = { name: 'Persona Ejemplo', dni: '12.345.678', role: 'Apoderado' };
const evidence = Object.keys(COMPANY_EVIDENCE).map((kind, index) => ({ id: `evidence-${index}`, kind, sha256: 'a'.repeat(64), fileName: `${kind}.pdf` }));
const companyInput = { representative, accountConfirmed: true, identityConfirmed: true, authorityConfirmed: true, responsibilityConfirmed: true };
test('empresa, cuenta y responsabilidad quedan firmadas; poder opcional y DNI obligatorio', () => {
  const content = companyRepresentation(company, actor, companyInput, evidence);
  assert.equal(content.signerDni, '12345678');
  assert.equal(content.evidence.length, 2, 'un respaldo societario y un PDF con ambas caras son suficientes para presentar');
  assert.equal(companyRepresentation(company, actor, companyInput, [...evidence, { ...evidence[1], id: 'second-dni' }]).evidence.length, 3);
  assert.throws(() => companyRepresentation(company, actor, companyInput, [...evidence, { ...evidence[1], id: 'second-dni' }, { ...evidence[1], id: 'third-dni' }]));
  for (const value of [company.businessName, company.cuit, actor.email, representative.name, 'facultades vigentes', 'bajo mi responsabilidad', 'opcional', 'sin revisión administrativa']) assert.ok(content.terms.includes(value));
  for (const key of ['accountConfirmed', 'identityConfirmed', 'authorityConfirmed', 'responsibilityConfirmed']) assert.throws(() => companyRepresentation(company, actor, { ...companyInput, [key]: false }, evidence));
  assert.throws(() => companyRepresentation(company, actor, { ...companyInput, representative: { ...representative, dni: 'ABC12345678' } }, evidence));
  assert.equal(companyRepresentation(company, actor, companyInput, evidence.slice(1)).evidence.length, 1);
  assert.throws(() => companyRepresentation(company, actor, companyInput, evidence.slice(0, 1)), /DNI/);
});
test('aprobar representación exige documento actual, identidad y facultades; no revive accesos revocados ni empresas modificadas', () => {
  const declaration = { actor, content: { ...companyRepresentation(company, actor, companyInput, evidence), version: 'company-representation-v3' } };
  const membership = { status: 'needs_confirmation', email: actor.email };
  const review = { decision: 'approved', approvedScope: 'Gestión y contratos de servicios comprendidos en el poder adjunto', checks: { companyVerified: true, identityVerified: true, authorityVerified: true, scopeVerified: true } };
  checkCompanyReview(declaration, company, membership, review);
  for (const key of Object.keys(review.checks)) assert.throws(() => checkCompanyReview(declaration, company, membership, { ...review, checks: { ...review.checks, [key]: false } }));
  assert.throws(() => checkCompanyReview(declaration, company, { ...membership, status: 'revoked' }, review));
  assert.throws(() => checkCompanyReview(declaration, { ...company, cuit: '30111111113' }, membership, review));
  assert.throws(() => checkCompanyReview(declaration, company, { ...membership, email: 'other@example.test' }, review));
});

test('sólo la cuenta registrada vigente puede declarar representación, incluso con otra membresía existente', () => {
  const provider = { ...company, personalGoogleAccount: { uid: actor.uid, email: actor.email } };
  const member = { email: actor.email, status: 'needs_confirmation' };
  assertCompanyAccount(provider, actor, member);
  assertCompanyAccount({ ...company, portalAccessEmail: actor.email }, actor, member);
  assert.throws(() => assertCompanyAccount(company, actor, member), /registrada/);
  assert.throws(() => assertCompanyAccount(provider, { ...actor, uid: 'another' }, member), /registrada/);
  assert.throws(() => assertCompanyAccount(provider, actor, { ...member, status: 'revoked' }), /revocado/);
  assert.throws(() => assertCompanyAccount({ ...provider, portalAccessEmail: 'new@example.test' }, actor, member), /cuenta/);
  const content = companyRepresentation(provider, actor, companyInput, evidence.slice(1));
  assertDeclaredCompany(provider, actor, member, content);
  assert.throws(() => assertDeclaredCompany({ ...provider, cuit: '30999999999' }, actor, member, content), /cambiaron/);
  assert.throws(() => assertDeclaredCompany({ ...provider, businessName: 'Otra empresa' }, actor, member, content), /cambiaron/);
});

test('contratos exigen declaración aplicada y prueba íntegra de la cuenta registrada; no basta un estado active', () => {
  const provider = { ...company, portalAccessEmail: actor.email, personalGoogleAccount: { uid: actor.uid, email: actor.email } };
  const declaration = { actor, providerId: 'company', kind: 'representation', status: 'applied', content: companyRepresentation(provider, actor, companyInput, evidence.slice(1)), proof: { complete: true } };
  declaration.contentHash = hash({ kind: declaration.kind, providerId: declaration.providerId, actor, content: declaration.content });
  const approval = { uid: actor.uid, email: actor.email, company: declaration.content.provider, declarationId: 'declaration', version: declaration.content.version, contentHash: declaration.contentHash, method: 'signed_declaration' };
  const member = { status: 'active', email: actor.email, companyReviewVersion: approval.version, declarationId: approval.declarationId };
  assert.equal(companySigningAuthority(provider, approval, member, declaration).method, 'signed_declaration');
  for (const broken of [null, { ...declaration, status: 'pending_signature' }, { ...declaration, proof: { complete: false } }, { ...declaration, contentHash: 'changed' }, { ...declaration, content: { ...declaration.content, terms: 'changed' } }]) assert.throws(() => companySigningAuthority(provider, approval, member, broken));
  assert.throws(() => companySigningAuthority(provider, approval, { ...member, status: 'revoked' }, declaration));
  assert.throws(() => companySigningAuthority({ ...provider, personalGoogleAccount: { uid: 'other', email: actor.email } }, approval, member, declaration));
  assert.throws(() => companySigningAuthority(provider, { ...approval, method: 'administrative_review' }, member, declaration));
});

test('se conservan representaciones antiguas revisadas con su versión y asociación vigentes', () => {
  const provider = { ...company, portalAccessEmail: actor.email };
  const approval = { uid: actor.uid, email: actor.email, company: { name: company.businessName, cuit: company.cuit }, declarationId: 'legacy', contentHash: 'legacy-hash' };
  for (const version of ['company-representation-v2', 'company-representation-v3']) assert.deepEqual(companySigningAuthority(provider, { ...approval, version }, { status: 'active', email: actor.email, declarationId: 'legacy', companyReviewVersion: version }), { declarationId: 'legacy', contentHash: 'legacy-hash', scope: undefined, email: actor.email }, 'preserva el manifiesto anterior, sin agregar claves a contratos preparados');
  assert.equal(companySigningAuthority(provider, approval, { status: 'active', email: actor.email, declarationId: 'legacy', companyReviewVersion: 'company-representation-v2' }).method, undefined);
});
const person = { type: 'persona', name: 'Prestador', lastName: 'Ejemplo', dni: '12345678', bankAccount_alias: 'cuenta.propia' };
const thirdInput = { name: 'Emisor y beneficiario', cuit: '20333333334', alias: 'cuenta.emisor', responsibilityConfirmed: true, roles: ['invoice', 'payment'], workKeys: ['project/areaExpenses/work'], expiresOn: '2026-12-31' };
test('tercero sólo requiere nombre, CUIT y cuenta: no documentos, ni doble captura del titular, ni cambio del banco propio', () => {
  const before = JSON.stringify(person);
  const content = thirdPartyDeclaration(person, actor, thirdInput, thirdInput.workKeys);
  assert.equal(content.party.holder, thirdInput.name);
  assert.equal(content.party.holderCuit, thirdInput.cuit);
  assert.equal(content.party.alias, thirdInput.alias);
  assert.equal(content.ownAccount.alias, person.bankAccount_alias);
  assert.equal(content.evidence, undefined);
  assert.equal(content.party.relationship, undefined);
  assert.equal(content.expiresOn, undefined);
  assert.equal(content.validity, 'until_revoked');
  assert.equal(JSON.stringify(person), before);
  for (const value of [thirdInput.name, thirdInput.cuit, thirdInput.alias, 'bajo mi responsabilidad', 'no constituye una verificación bancaria automática']) assert.ok(content.terms.includes(value));
  assert.throws(() => thirdPartyDeclaration(person, actor, { ...thirdInput, alias: '', cbu: '' }, thirdInput.workKeys));
  assert.throws(() => thirdPartyDeclaration(person, actor, { ...thirdInput, holderCuit: '20333333335' }, thirdInput.workKeys));
  assert.throws(() => thirdPartyDeclaration(person, actor, { ...thirdInput, responsibilityConfirmed: false }, thirdInput.workKeys));
});
test('revisión del tercero no exige constancias; sí conserva la validación fiscal y el destinatario declarado', () => {
  const declaration = { content: thirdPartyDeclaration(person, actor, thirdInput, thirdInput.workKeys) };
  const input = { decision: 'approved', checks: { fiscalFrameVerified: true, declaredPayeeChecked: true } };
  checkThirdPartyReview(declaration, ['invoice', 'payment'], input);
  assert.throws(() => checkThirdPartyReview(declaration, ['payment'], { ...input, checks: {} }));
  assert.throws(() => checkThirdPartyReview({ content: { termsVersion: 'third-party-v2' } }, ['payment'], input));
});
