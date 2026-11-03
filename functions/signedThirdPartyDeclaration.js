const M = require('./providerPortalModel');
const { thirdPartyDetails, thirdPartyIsCurrent, THIRD_PARTY_VERSIONS } = require('./providerThirdPartyDeclaration');

function needsThirdPartyApplication(d) {
  return d?.kind === 'third_party' && ['pending_signature', 'pending_review', 'active'].includes(d.status)
    && !(d.status === 'active' && ['invoice', 'payment'].every(role => d.effectiveRoles?.includes(role)))
    && !Object.values(d.decisions || {}).some(decision => decision.decision === 'rejected');
}

function checkSignedThirdParty(d, provider, membership, proof, now) {
  const actor = d.actor, content = d.content;
  if (!actor?.uid || !actor.email || membership?.status !== 'active' || membership.email !== actor.email)
    M.fail('La cuenta registrada ya no está habilitada para esta declaración.');
  if (provider?.type !== 'persona') M.fail('Esta declaración requiere una ficha de persona física.');
  if ((provider.personalGoogleAccount?.uid && provider.personalGoogleAccount.uid !== actor.uid)
    || (provider.personalGoogleAccount?.email && M.email(provider.personalGoogleAccount.email) !== actor.email)
    || (provider.portalAccessEmail && M.email(provider.portalAccessEmail) !== actor.email))
    M.fail('La cuenta registrada cambió. Prepará una declaración desde tu cuenta actual.');
  if (M.hash({ kind: d.kind, providerId: d.providerId, actor, content }) !== d.contentHash
    || !proof.complete || proof.contentHash !== d.contentHash || !proof.signedPdfSha256
    || !Number.isFinite(Date.parse(proof.signedAt)))
    M.fail('No pudimos comprobar la declaración firmada.');
  if (!THIRD_PARTY_VERSIONS.includes(content.termsVersion) || !thirdPartyIsCurrent(content, now)
    || !Array.isArray(content.roles) || [...content.roles].sort().join(',') !== 'invoice,payment')
    M.fail('Prepará una nueva declaración de quién factura y cobra por vos.');
  const dni = String(provider.dni || provider.dniNormalized || '').replace(/\D/g, '');
  if (!/^\d{7,9}$/.test(dni) || content.signerDni !== dni || proof.signerDni !== dni)
    M.fail('El DNI cambió. Prepará una nueva declaración con tus datos actuales.');
  const party = thirdPartyDetails(content.party);
  if (party.holderCuit !== content.party.holderCuit || content.party.holder !== party.holder)
    M.fail('Prepará una nueva declaración con el titular de la factura y su cuenta.');
  if (!Array.isArray(content.workKeys) || !content.workKeys.length || content.workKeys.length > 50
    || new Set(content.workKeys).size !== content.workKeys.length
    || content.workKeys.some(key => typeof key !== 'string' || !/^[^/]+\/(areaExpenses|budgetItems)\/[^/]+$/.test(key)))
    M.fail('Prepará una nueva declaración con los trabajos que te corresponden.');
}

function createSignedThirdPartyService({ db, sign, timestamp, clock = () => new Date() }) {
  async function apply(ref, { requireSignature = true } = {}) {
    const d = (await ref.get()).data();
    if (!needsThirdPartyApplication(d)) return d;
    const proof = await sign.verify(d.signing, d.actor, d.contentHash);
    if (!proof.complete) {
      if (requireSignature) M.fail('Falta completar la firma y el PDF de evidencia.');
      return d;
    }
    return db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (!needsThirdPartyApplication(current)) return current;
      if (current.contentHash !== d.contentHash) M.fail('La declaración cambió. Volvé a intentarlo.');
      const provider = (await tx.get(db.doc(`providers/${current.providerId}`))).data();
      const membership = (await tx.get(db.doc(`providerPortalUsers/${current.actor.uid}/memberships/${current.providerId}`))).data();
      checkSignedThirdParty(current, provider, membership, proof, clock());
      const refs = current.content.workKeys.map(key => db.doc(`projects/${key}`));
      const rows = await Promise.all(refs.map(workRef => tx.get(workRef)));
      const projects = new Map();
      for (const key of current.content.workKeys) {
        const projectId = key.split('/')[0];
        if (!projects.has(projectId)) projects.set(projectId, (await tx.get(db.doc(`projects/${projectId}`))).data());
      }
      if (rows.some(row => !row.exists || row.data().providerId !== current.providerId
        || !projects.get(row.ref.path.split('/')[1])
        || !M.ownExpense(row.data(), projects.get(row.ref.path.split('/')[1]), row.ref.path)))
        M.fail('Un trabajo cambió. Prepará una nueva declaración con tus trabajos actuales.');
      const updates = { status: 'active', effectiveRoles: ['invoice', 'payment'], proof,
        signedAt: current.signedAt || timestamp(),
        activation: { method: 'signed_declaration', actor: current.actor, at: timestamp() } };
      tx.update(ref, updates);
      refs.forEach(workRef => tx.update(workRef, { thirdPartyPayoutRequired: true }));
      tx.create(db.collection('providerPortalAudit').doc(), { action: 'signed_third_party_applied',
        providerId: current.providerId, declarationId: ref.id, actor: current.actor,
        contentHash: current.contentHash, workKeys: current.content.workKeys, at: timestamp() });
      return { ...current, ...updates };
    });
  }
  async function recover(rows) {
    const result = [];
    // A failed legacy declaration must not prevent loading the other documents.
    for (const row of rows) {
      const d = { id: row.id, ...row.data() };
      if (!needsThirdPartyApplication(d)) { result.push(d); continue; }
      try { result.push({ id: row.id, ...await apply(row.ref, { requireSignature: false }) }); }
      catch (error) { result.push({ ...d, applicationIssue: error.code === 'failed-precondition'
        ? 'No se pudo aplicar. Revisá tus datos y prepará una nueva declaración.'
        : 'No pudimos comprobar la aplicación. Volvé a actualizar Documentos.' }); }
    }
    return result;
  }
  return { apply, recover };
}

module.exports = { createSignedThirdPartyService, checkSignedThirdParty, needsThirdPartyApplication };
