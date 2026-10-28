const { createHash, randomUUID } = require('node:crypto');
const { PDFDocument } = require('pdf-lib');
const { fail, id, email, text, hash } = require('./providerPortalModel');

function contractFields(input, signers, pages) {
  if (!Array.isArray(input) || input.length !== signers.length || input.length > 10) fail('Marcá un recuadro de firma por persona.');
  const seen = new Set(), ids = new Set();
  const result = input.map(field => {
    if (!field || typeof field !== 'object' || Array.isArray(field)) fail('Recuadro de firma inválido.');
    const signerEmail = email(field.signerEmail);
    if (!signers.includes(signerEmail) || seen.has(signerEmail)) fail('Cada recuadro debe corresponder a un firmante distinto.');
    const fieldId = id(field.id);
    if (ids.has(fieldId)) fail('Los recuadros deben tener identificadores distintos.');
    if (!Number.isInteger(field.page) || field.page < 1 || field.page > pages) fail('Página de firma inválida.');
    for (const key of ['x', 'y', 'w', 'h']) if (typeof field[key] !== 'number' || !Number.isFinite(field[key])) fail('Posición de firma inválida.');
    if (field.x < 0 || field.y < 0 || field.w < .1 || field.h < .045 || field.x + field.w > 1.000001 || field.y + field.h > 1.000001) fail('El recuadro debe estar completo dentro de la hoja.');
    seen.add(signerEmail); ids.add(fieldId);
    return { id: fieldId, signerEmail, page: field.page, x: field.x, y: field.y, w: field.w, h: field.h };
  }).sort((a, b) => a.signerEmail.localeCompare(b.signerEmail));
  if (result.some((field, index) => result.slice(index + 1).some(other => field.page === other.page && field.x < other.x + other.w && field.x + field.w > other.x && field.y < other.y + other.h && field.y + field.h > other.y))) fail('Los recuadros de firma no deben superponerse.');
  return result;
}

function createProjectContractBridge({ db, store, bucket, readLocalFile, timestamp }) {
  async function source(projectId, documentId) {
    const snapshot = await db.doc(`projects/${id(projectId)}/projectDocuments/${id(documentId)}`).get();
    if (!snapshot.exists) fail('Contrato inexistente en este proyecto.');
    const document = snapshot.data();
    if (!['contratos', 'locaciones'].includes(document.family) || /seguro|p[oó]liza/i.test(document.type || '')) fail('Seleccioná un contrato del proyecto.');
    const prefix = `projects/${projectId}/documents/${documentId}/`;
    if (typeof document.path !== 'string' || !document.path.startsWith(prefix) || document.path.slice(prefix.length).includes('/') || document.path.includes('..')) fail('El archivo no pertenece a este contrato. Volvé a cargar el PDF.');
    const file = await readLocalFile({ path: document.path });
    const bytes = Buffer.from(file.base64, 'base64');
    if (file.contentType !== 'application/pdf' || bytes.subarray(0, 5).toString() !== '%PDF-') fail('Para solicitar firmas cargá un PDF sin contraseña.');
    let pdf;
    try { pdf = await PDFDocument.load(bytes, { ignoreEncryption: false }); }
    catch { fail('No pudimos leer el PDF. Usá un archivo sin contraseña.'); }
    const pages = pdf.getPageCount();
    if (!pages || pages > 200) fail('Usá un contrato de entre 1 y 200 páginas.');
    return { document, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), pages, file };
  }
  return {
    async projectContractSource(projectId, documentId) {
      const original = await source(projectId, documentId);
      const intent = (await db.doc(`providerPortalProjectLinks/${id(projectId)}/contracts/${id(documentId)}`).get()).data();
      return { base64: original.file.base64, contentType: 'application/pdf', fileName: original.document.originalFileName || original.document.fileName,
        title: original.document.title || original.document.originalFileName || 'Contrato', providerId: original.document.providerId || '', sha256: original.sha256, pages: original.pages,
        preparation: intent?.sha256 === original.sha256 ? { bindings: intent.bindings, fields: intent.signatureFields } : null };
    },
    async prepareProjectContract({ projectId, documentId, expectedSha256, providerIds, fields }, actor) {
      projectId = id(projectId); documentId = id(documentId);
      const project = (await db.doc(`projects/${projectId}`).get()).data();
      if (!project) fail('Proyecto inexistente.');
      if (!Array.isArray(providerIds) || !providerIds.length || providerIds.length > 10 || new Set(providerIds).size !== providerIds.length) fail('Elegí entre 1 y 10 proveedores distintos.');
      const original = await source(projectId, documentId);
      if (expectedSha256 !== original.sha256) fail('El PDF cambió. Volvé a abrirlo y revisar los recuadros.');
      const bindings = [];
      for (const providerId of providerIds) {
        const provider = (await db.doc(`providers/${id(providerId)}`).get()).data();
        if (!provider) fail('Proveedor inexistente.');
        const signerEmail = email(provider.portalAccessEmail || provider.email);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail)) fail('El proveedor necesita un correo personal para iniciar sesión con Google.');
        if (bindings.some(binding => binding.email === signerEmail)) fail('Dos proveedores comparten el correo. Elegí una sola ficha para esa cuenta.');
        let companyAuthority = null;
        if (provider.type === 'empresa') {
          const approval = (await db.doc(`providerPortalCompanyApprovals/${providerId}`).get()).data();
          const membership = approval?.uid ? (await db.doc(`providerPortalUsers/${approval.uid}/memberships/${providerId}`).get()).data() : null;
          if (!approval || approval.email !== signerEmail || membership?.status !== 'active' || membership.email !== signerEmail
            || membership.companyReviewVersion !== 'company-representation-v2' || membership.declarationId !== approval.declarationId
            || approval.company?.cuit !== String(provider.cuit || provider.cuitNormalized || '').replace(/\D/g, '') || approval.company?.name !== text(provider.businessName || provider.name)) fail('La empresa necesita una representación revisada con documentación antes de solicitar esta firma.');
          companyAuthority = { declarationId: approval.declarationId, contentHash: approval.contentHash, scope: approval.scope, email: approval.email };
        }
        bindings.push({ providerId, email: signerEmail, name: text(provider.businessName || [provider.name, provider.lastName].filter(Boolean).join(' ') || provider.fullName || signerEmail), ...(companyAuthority ? { companyAuthority } : {}) });
      }
      bindings.sort((a, b) => a.email.localeCompare(b.email));
      const signerEmails = bindings.map(binding => binding.email);
      const signatureFields = contractFields(fields, signerEmails, original.pages);
      const title = text(original.document.title || original.document.originalFileName || 'Contrato');
      const manifest = hash({ projectId, documentId, sha256: original.sha256, title, bindings, signatureFields });
      const remoteProjectId = `goat_project_${hash(projectId).slice(0, 32)}`;
      const parent = store().doc(`projects/${remoteProjectId}`);
      const priorParent = (await parent.get()).data();
      if (priorParent && (priorParent.goatProjectId !== projectId || priorParent.ownerUid !== 'goat_bridge_service' || !priorParent.portalManaged)) fail('El proyecto de firmas no corresponde a GOAT.');
      // Keep an unguessable remote ID and the frozen preparation in GOAT's private namespace.
      // An ordinary GB Sign document cannot impersonate the source association.
      const remoteDocumentId = await db.runTransaction(async tx => {
        const linkRef = db.doc(`providerPortalProjectLinks/${projectId}`);
        const intentRef = linkRef.collection('contracts').doc(documentId);
        const [link, intent] = await Promise.all([tx.get(linkRef), tx.get(intentRef)]);
        if (link.exists && link.data().signProjectId !== remoteProjectId) fail('La conexión existente del proyecto requiere revisión administrativa.');
        if (intent.exists) {
          if (intent.data().manifest !== manifest || intent.data().sha256 !== original.sha256) fail('Las firmas ya fueron solicitadas con otra preparación. Cargá una nueva versión del contrato.');
          return id(intent.data().documentId);
        }
        const documentIdInSign = `goat_contract_${randomUUID().replace(/-/g, '')}`;
        tx.set(linkRef, { signProjectId: remoteProjectId, connectedBy: actor, at: timestamp() }, { merge: true });
        tx.create(intentRef, { documentId: documentIdInSign, signProjectId: remoteProjectId, sourceDocumentId: documentId,
          manifest, sha256: original.sha256, title, bindings, signatureFields, preparedBy: actor, at: timestamp() });
        return documentIdInSign;
      });
      const target = parent.collection('documents').doc(remoteDocumentId);
      const storagePath = `projects/${remoteProjectId}/documents/${remoteDocumentId}/original.pdf`;
      try {
        await bucket().file(storagePath).save(original.bytes, { resumable: false, contentType: 'application/pdf', preconditionOpts: { ifGenerationMatch: 0 }, metadata: { metadata: { sha256: original.sha256 } } });
      } catch (error) {
        if (Number(error.code) !== 412) throw error;
        const [existing] = await bucket().file(storagePath).download();
        if (createHash('sha256').update(existing).digest('hex') !== original.sha256) fail('Este contrato ya tiene una versión preparada. Cargá un nuevo documento para cambiarla.');
      }
      await store().runTransaction(async tx => {
        const [parentSnap, current] = await Promise.all([tx.get(parent), tx.get(target)]);
        const previous = parentSnap.data();
        if (previous && (previous.goatProjectId !== projectId || previous.ownerUid !== 'goat_bridge_service' || !previous.portalManaged)) fail('Proyecto de firmas incorrecto.');
        if (current.exists) {
          const saved = current.data();
          if (saved.goatPreparationHash !== manifest || saved.sha256 !== original.sha256 || !saved.portalManaged || saved.goatSourceDocumentId !== documentId
            || saved.goatSourceProjectId !== projectId || saved.storagePath !== storagePath || hash(saved.signerEmails) !== hash(signerEmails)
            || hash(saved.signatureFields) !== hash(signatureFields) || hash(saved.providerBindings) !== hash(bindings)) fail('Las firmas ya fueron solicitadas con otra preparación. Cargá una nueva versión del contrato.');
          return;
        }
        tx.set(parent, { name: text(project.name), goatProjectId: projectId, portalManaged: true, ownerUid: 'goat_bridge_service', ownerEmail: '', ...(previous ? {} : { collaboratorEmails: [] }) }, { merge: true });
        tx.create(target, { title, fileName: text(original.document.originalFileName || original.document.fileName), storagePath,
          contentType: 'application/pdf', sha256: original.sha256, signerEmails, signatureFields,
          signatureStatus: signerEmails.map(email => ({ email, status: 'pending' })), status: 'pending', portalManaged: true,
          goatSourceProjectId: projectId, goatSourceDocumentId: documentId, goatProviderIds: bindings.map(binding => binding.providerId),
          goatProviderId: bindings[0].providerId, providerBindings: bindings, goatPreparationHash: manifest, portalContentHash: manifest,
          preparedBy: actor, createdAt: timestamp(), updatedAt: timestamp() });
        for (const binding of bindings) {
          const requestId = `goat_contract_${hash({ remoteProjectId, remoteDocumentId, email: binding.email })}`;
          tx.create(store().doc(`signatureRequests/${requestId}`), { projectId: remoteProjectId, docId: remoteDocumentId, projectName: text(project.name),
            title, fileName: text(original.document.originalFileName || original.document.fileName), storagePath, contentType: 'application/pdf', sha256: original.sha256,
            signerEmail: binding.email, allSignerEmails: signerEmails, signatureFields: signatureFields.filter(field => field.signerEmail === binding.email),
            status: 'pending', portalManaged: true, requestedByUid: actor.uid, requestedByEmail: actor.email, createdAt: timestamp(), updatedAt: timestamp() });
        }
      });
      return { projectId: remoteProjectId, documentId: remoteDocumentId, sourceDocumentId: documentId, sha256: original.sha256, requested: true };
    },
  };
}
module.exports = { createProjectContractBridge, contractFields };
