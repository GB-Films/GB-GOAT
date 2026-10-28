const { createHash } = require('node:crypto');
const { fail, id, text, hash } = require('./providerPortalModel');
const COMPANY_EVIDENCE = ['company_registration', 'representation_authority', 'dni_front', 'dni_back'];
const EVIDENCE_LABELS = { company_registration: 'Constitución o registro de la empresa', representation_authority: 'Designación vigente o poder de representación', dni_front: 'DNI del representante · frente', dni_back: 'DNI del representante · dorso' };
function evidenceBytes(file) {
  if (!file || typeof file.base64 !== 'string' || file.base64.length > 3e6 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)
    || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.contentType)) fail('Adjuntá un PDF, JPG o PNG de hasta 2 MB.');
  const bytes = Buffer.from(file.base64, 'base64');
  const valid = file.contentType === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
    : file.contentType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 255 && bytes[1] === 216;
  if (!valid || !bytes.length || bytes.length > 2 * 1024 * 1024) fail('El archivo no coincide con el formato o supera 2 MB.');
  return bytes;
}
function createEvidenceStore({ db, bucket, timestamp }) {
  async function row(providerId, evidenceId) {
    const record = (await db.doc(`providerPortalEvidence/${id(evidenceId)}`).get()).data();
    if (!record || record.providerId !== providerId) fail('Documento fuera de esta ficha.');
    return record;
  }
  return {
    async list(providerId, actor) {
      const rows = await db.collection('providerPortalEvidence').where('providerId', '==', providerId).where('uid', '==', actor.uid).limit(101).get();
      if (rows.size > 100) fail('Administración debe revisar el historial de respaldos antes de otra presentación.');
      return rows.docs.map(doc => { const { path: _path, uid: _uid, ...record } = doc.data(); return { ...record, createdAt: record.createdAt?.toMillis?.() || 0 }; });
    },
    async upload(providerId, actor, input, providerType) {
      const kind = text(input.kind);
      if (!Object.hasOwn(EVIDENCE_LABELS, kind) || providerType !== 'empresa') fail('Tipo de documento no permitido para esta ficha.');
      const bytes = evidenceBytes(input.file), sha256 = createHash('sha256').update(bytes).digest('hex');
      const evidenceId = hash({ providerId, uid: actor.uid, kind, attempt: id(input.attemptId) });
      const ref = db.doc(`providerPortalEvidence/${evidenceId}`);
      const path = `providerPortalPrivateEvidence/${providerId}/${actor.uid}/${evidenceId}/original`;
      const record = { id: evidenceId, providerId, uid: actor.uid, kind, sha256, path, contentType: input.file.contentType, fileName: text(input.file.fileName, 140), size: bytes.length };
      const previous = (await ref.get()).data();
      if (previous && (previous.sha256 !== sha256 || previous.kind !== kind || previous.uid !== actor.uid)) fail('Ese intento corresponde a otro documento.');
      try { await bucket().file(path).save(bytes, { resumable: false, contentType: record.contentType, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { metadata: { sha256, providerId, uploadedByUid: actor.uid } } }); }
      catch (error) { if (Number(error.code) !== 412) throw error; const [prior] = await bucket().file(path).download(); if (!prior.equals(bytes)) fail('El original no coincide con el archivo guardado.'); }
      await db.runTransaction(async tx => { const prior = (await tx.get(ref)).data(); if (prior) { if (prior.sha256 !== sha256) fail('El documento cambió.'); } else tx.create(ref, { ...record, createdAt: timestamp() }); });
      const { path: _path, uid: _uid, ...visible } = record;
      return visible;
    },
    async manifest(providerId, actor, evidenceIds, kinds) {
      if (!Array.isArray(evidenceIds) || evidenceIds.length !== kinds.length || new Set(evidenceIds).size !== kinds.length) fail('Adjuntá todos los respaldos requeridos.');
      const records = await Promise.all(evidenceIds.map(evidenceId => row(providerId, evidenceId)));
      if (records.some(r => r.uid !== actor.uid) || kinds.some(kind => records.filter(r => r.kind === kind).length !== 1)) fail('Los respaldos deben pertenecer a tu cuenta y a esta ficha.');
      for (const record of records) {
        if (record.path !== `providerPortalPrivateEvidence/${providerId}/${actor.uid}/${record.id}/original`) fail('El respaldo no pertenece al alcance de esta presentación.');
        const [bytes] = await bucket().file(record.path).download();
        if (createHash('sha256').update(bytes).digest('hex') !== record.sha256) fail('Un respaldo no coincide con el original guardado.');
      }
      return records.map(({ id, kind, sha256, fileName, contentType, size }) => ({ id, kind, sha256, fileName, contentType, size }));
    },
    async read(providerId, evidenceId, actor, internal = false) {
      const record = await row(providerId, evidenceId);
      if (!internal && record.uid !== actor.uid) fail('No tenés acceso a este documento.');
      const expected = `providerPortalPrivateEvidence/${providerId}/${record.uid}/${record.id}/original`;
      if (record.path !== expected) fail('Ruta de documento inválida.');
      const [bytes] = await bucket().file(expected).download();
      if (createHash('sha256').update(bytes).digest('hex') !== record.sha256) fail('El respaldo no coincide con su hash.');
      return { base64: bytes.toString('base64'), contentType: record.contentType, fileName: record.fileName, sha256: record.sha256 };
    },
  };
}
module.exports = { createEvidenceStore, evidenceBytes, COMPANY_EVIDENCE, EVIDENCE_LABELS };
