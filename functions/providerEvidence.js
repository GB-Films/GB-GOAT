const { createHash, randomUUID } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { fail, id, text, hash } = require('./providerPortalModel');
const LEGACY_COMPANY_EVIDENCE = ['company_registration', 'representation_authority', 'dni_front', 'dni_back'];
const COMPANY_EVIDENCE = { representation_support: { min: 1, max: 6 }, identity_document: { min: 1, max: 2 } };
const DECLARED_COMPANY_EVIDENCE = { representation_support: { min: 0, max: 6 }, identity_document: { min: 1, max: 2 } };
const EVIDENCE_LABELS = { representation_support: 'Documentación de representación', identity_document: 'DNI del representante', company_registration: 'Constitución o registro de la empresa', representation_authority: 'Designación vigente o poder de representación', dni_front: 'DNI del representante · frente', dni_back: 'DNI del representante · dorso' };
const maxFileMB = 6;
const maxFileBytes = maxFileMB * 1024 * 1024;
const maxEncodedLength = Math.ceil(maxFileBytes / 3) * 4;
const evidenceTypes = ['application/pdf', 'image/jpeg', 'image/png'];

const uploadErrors = {
  lookup: { reason: 'evidence_lookup_unavailable', message: 'GOAT no pudo consultar el adjunto en esta ficha.' },
  storage: { reason: 'evidence_storage_unavailable', message: 'GOAT no pudo guardar el archivo.' },
  confirmation: { reason: 'evidence_confirmation_unavailable', message: 'GOAT no pudo confirmar el adjunto en esta ficha.' },
};
function uploadUnavailable(error, stage) {
  if (error instanceof HttpsError) throw error;
  const reference = randomUUID();
  const { reason, message } = uploadErrors[stage];
  const code = /^\d{1,3}$/.test(String(error?.code)) ? Number(error.code) : undefined;
  logger.warn('provider_evidence_write_failed', { reference, stage, ...(code !== undefined ? { code } : {}) });
  throw new HttpsError('unavailable', message, { reason, reference });
}
function validateEvidenceGroups(records, policy = COMPANY_EVIDENCE) {
  const groups = Array.isArray(policy) ? Object.fromEntries(policy.map(kind => [kind, { min: 1, max: 1 }])) : policy;
  if (!Array.isArray(records) || records.length > Object.values(groups).reduce((sum, group) => sum + group.max, 0)
    || new Set(records.map(record => record.id)).size !== records.length || records.some(record => !Object.hasOwn(groups, record.kind))
    || Object.entries(groups).some(([kind, { min, max }]) => { const count = records.filter(record => record.kind === kind).length; return count < min || count > max; })) fail(groups.representation_support?.min === 0 ? 'Adjuntá uno o dos archivos de DNI. El poder o respaldo de representación es opcional.' : 'Adjuntá documentación de representación y uno o dos archivos de DNI.');
}
function evidenceBytes(file) {
  if (!file || typeof file.base64 !== 'string' || !file.base64.length) fail('El archivo llegó vacío. Volvé a elegirlo.');
  if (file.base64.length > maxEncodedLength) fail('El archivo supera ' + maxFileMB + ' MB. Elegí uno más liviano.');
  if (!evidenceTypes.includes(file.contentType)) fail('GOAT no admite ese formato. Elegí un PDF, JPG o PNG.');
  if (file.base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) fail('GOAT recibió un archivo incompleto. Volvé a elegirlo.');
  const bytes = Buffer.from(file.base64, 'base64');
  const valid = file.contentType === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
    : file.contentType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 255 && bytes[1] === 216;
  if (!bytes.length) fail('El archivo llegó vacío. Volvé a elegirlo.');
  if (bytes.length > maxFileBytes) fail('El archivo supera ' + maxFileMB + ' MB. Elegí uno más liviano.');
  if (!valid) fail('El contenido no coincide con el formato del archivo. Abrilo y volvé a guardarlo como PDF, JPG o PNG.');
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
      const path = `providerPortalUploads/privateEvidence/${providerId}/${actor.uid}/${evidenceId}/original`;
      const record = { id: evidenceId, providerId, uid: actor.uid, kind, sha256, path, contentType: input.file.contentType, fileName: text(input.file.fileName, 140), size: bytes.length };
      const previous = (await ref.get().catch(error => uploadUnavailable(error, 'lookup'))).data();
      if (previous && (previous.sha256 !== sha256 || previous.kind !== kind || previous.uid !== actor.uid)) fail('Ese intento corresponde a otro documento. Quitá la selección y volvé a elegir el archivo.');
      try {
        const object = bucket().file(path);
        try {
          await object.save(bytes, { resumable: false, contentType: record.contentType, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { metadata: { sha256, providerId, uploadedByUid: actor.uid } } });
        } catch (error) {
          if (Number(error.code) !== 412) throw error;
          const [prior] = await object.download();
          if (!prior.equals(bytes)) fail('La carga anterior corresponde a otro archivo. Quitá la selección y volvé a elegir el documento.');
        }
      } catch (error) {
        uploadUnavailable(error, 'storage');
      }
      try {
        await db.runTransaction(async tx => {
          const prior = (await tx.get(ref)).data();
          if (prior) {
            if (prior.sha256 !== sha256) fail('El documento cambió. Quitá la selección y volvé a elegir el archivo.');
          } else tx.create(ref, { ...record, createdAt: timestamp() });
        });
      } catch (error) {
        uploadUnavailable(error, 'confirmation');
      }
      const { path: _path, uid: _uid, ...visible } = record;
      return visible;
    },
    async manifest(providerId, actor, evidenceIds, kinds) {
      const maximum = Array.isArray(kinds) ? kinds.length : Object.values(kinds).reduce((sum, group) => sum + group.max, 0);
      if (!Array.isArray(evidenceIds) || evidenceIds.length > maximum || new Set(evidenceIds).size !== evidenceIds.length) fail('Revisá los respaldos requeridos.');
      const records = await Promise.all(evidenceIds.map(evidenceId => row(providerId, evidenceId)));
      if (records.some(r => r.uid !== actor.uid)) fail('Los respaldos deben pertenecer a tu cuenta y a esta ficha.');
      validateEvidenceGroups(records, kinds);
      for (const record of records) {
        if (record.path !== `providerPortalUploads/privateEvidence/${providerId}/${actor.uid}/${record.id}/original`) fail('El respaldo no pertenece al alcance de esta presentación.');
        const [bytes] = await bucket().file(record.path).download();
        if (createHash('sha256').update(bytes).digest('hex') !== record.sha256) fail('Un respaldo no coincide con el original guardado.');
      }
      return records.map(({ id, kind, sha256, fileName, contentType, size }) => ({ id, kind, sha256, fileName, contentType, size }));
    },
    async read(providerId, evidenceId, actor, internal = false) {
      const record = await row(providerId, evidenceId);
      if (!internal && record.uid !== actor.uid) fail('No tenés acceso a este documento.');
      const expected = `providerPortalUploads/privateEvidence/${providerId}/${record.uid}/${record.id}/original`;
      if (record.path !== expected) fail('Ruta de documento inválida.');
      const [bytes] = await bucket().file(expected).download();
      if (createHash('sha256').update(bytes).digest('hex') !== record.sha256) fail('El respaldo no coincide con su hash.');
      return { base64: bytes.toString('base64'), contentType: record.contentType, fileName: record.fileName, sha256: record.sha256 };
    },
  };
}
module.exports = { createEvidenceStore, evidenceBytes, COMPANY_EVIDENCE, DECLARED_COMPANY_EVIDENCE, LEGACY_COMPANY_EVIDENCE, EVIDENCE_LABELS, validateEvidenceGroups };
