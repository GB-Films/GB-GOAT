const admin = require("firebase-admin");
const { declarationPdf } = require("./providerDeclarationPdf");
const { createHash } = require("node:crypto");
const { createProjectContractBridge } = require('./providerProjectContracts');
const { createEvidenceStore } = require('./providerEvidence');
const {
  fail,
  hash,
  email,
  text,
  list,
  id,
  requestKey,
  signingPath,
} = require("./providerPortalModel");
const projectId = "gb-sign-e1776";
function createSignBridge(db) {
  let remote;
  const app = () =>
    remote ||
    (remote = admin.initializeApp(
      { projectId, storageBucket: `${projectId}.firebasestorage.app` },
      "provider-portal-sign",
    ));
  const store = () => app().firestore();
  const bucket = () => app().storage().bucket();
  const config = () => ({
    projectId,
    apiKey: process.env.GB_SIGN_WEB_API_KEY || "",
    authDomain: `${projectId}.firebaseapp.com`,
  });
  async function assigned(actor, documentId, scope) {
    let req;
    if (scope) {
      req = await store()
        .doc(`signatureRequests/${requestKey(scope.requestId)}`)
        .get();
      if (!req.exists) fail("Solicitud inexistente.");
    } else {
      const requests = await store()
        .collection("signatureRequests")
        .where("signerEmail", "==", actor.email)
        .limit(501)
        .get();
      if (requests.size > 500) fail("Paginar firmas.");
      req = requests.docs.find((s) => s.data().docId === documentId);
    }
    if (!req) fail("No tenés este documento asignado.");
    const r = req.data();
    if (
      email(r.signerEmail) !== actor.email ||
      r.docId !== documentId ||
      (scope && r.projectId !== scope.projectId)
    )
      fail("La solicitud no corresponde a este documento o cuenta.");
    const doc = await store()
      .doc(`projects/${id(r.projectId)}/documents/${id(r.docId)}`)
      .get();
    if (
      !doc.exists ||
      !list(doc.data().signerEmails).map(email).includes(actor.email)
    )
      fail("La asignación fue retirada.");
    return { requestId: req.id, ...r, doc: doc.data() };
  }
  async function fileBytes(file, sourceBucket) {
    let path = file?.path;
    if (!path && file?.url) {
      try {
        const u = new URL(file.url);
        const match = u.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
        if (
          u.protocol === "https:" &&
          u.hostname === "firebasestorage.googleapis.com" &&
          match &&
          decodeURIComponent(match[1]) === sourceBucket.name
        )
          path = decodeURIComponent(match[2]);
      } catch {}
    }
    if (!path || path.split("/").includes(".."))
      fail(
        "El original histórico no tiene ruta verificable; administración debe vincularlo.",
      );
    const source = sourceBucket.file(path);
    const [m] = await source.getMetadata();
    if (
      Number(m.size) > 10 * 1024 * 1024 ||
      !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(
        m.contentType,
      )
    )
      fail("Archivo fuera del formato o tamaño permitido.");
    const [bytes] = await source.download();
    return {
      base64: bytes.toString("base64"),
      contentType: m.contentType,
      fileName: file.fileName || path.split("/").pop(),
      path,
      metadata: m,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
  async function listDocuments(actor) {
    const requests = await store()
      .collection("signatureRequests")
      .where("signerEmail", "==", actor.email)
      .limit(501)
      .get();
    if (requests.size > 500) fail("Paginar documentos.");
    const result = [];
    for (let offset = 0; offset < requests.docs.length; offset += 8) {
      const batch = await Promise.all(requests.docs.slice(offset, offset + 8).map(async s => {
      const r = s.data();
      const snap = await store()
        .doc(`projects/${id(r.projectId)}/documents/${id(r.docId)}`)
        .get();
      if (!snap.exists) return null;
      const d = snap.data();
      if (!list(d.signerEmails).map(email).includes(actor.email)) return null;
      let requiredDni = '', declarationKind = '';
      // Keep signed originals as history, but stop requesting the obsolete
      // representation signature from people who act on their own behalf.
      if (d.portalManaged && d.goatDeclarationId) {
        const declaration = (await db.doc(`providerPortalDeclarations/${id(d.goatDeclarationId)}`).get()).data();
        requiredDni = declaration?.content?.signerDni || '';
        declarationKind = declaration?.kind || '';
        if (declaration?.kind === 'representation' && !declaration.proof?.complete) {
          const provider = (await db.doc(`providers/${id(declaration.providerId)}`).get()).data();
          if (provider?.type === 'persona') return null;
        }
      }
      return {
        id: s.id,
        documentId: r.docId,
        projectId: r.projectId,
        title: d.title || d.fileName,
        status: d.status || r.status,
        contentHash: d.portalContentHash || "",
        sha256: d.sha256,
        signatureFields: list(d.signatureFields).filter(
          (f) => email(f.signerEmail) === actor.email,
        ),
        signed: list(d.signatureStatus).some(
          (v) => email(v.email) === actor.email && v.status === "signed",
        ),
        artifactsReady: Boolean(d.serverArtifacts?.signedPdfPath),
        portalManaged: d.portalManaged === true,
        providerId: d.goatProviderId || null,
        requiredDni,
        declarationKind,
      };
      }));
      result.push(...batch.filter(Boolean));
    }
    return result;
  }
  return {
    evidence: createEvidenceStore({ db, bucket: () => admin.storage().bucket(), timestamp: () => admin.firestore.FieldValue.serverTimestamp() }),
    ...createProjectContractBridge({ db, store, bucket, readLocalFile: file => fileBytes(file, admin.storage().bucket()), timestamp: () => admin.firestore.FieldValue.serverTimestamp() }),
    list: listDocuments,
    session: async (actor) => {
      if (!config().apiKey)
        fail("Falta configurar la integración con GB Sign.");
      return { config: config(), actor };
    },
    async file(actor, documentId, artifact, scope) {
      const r = await assigned(actor, documentId, scope);
      const path =
        artifact === "original"
          ? r.doc.storagePath
          : artifact === "signed"
            ? r.doc.serverArtifacts?.signedPdfPath
            : artifact === "certificate"
              ? r.doc.serverArtifacts?.certificatePdfPath
              : null;
      if (!path) fail("El archivo todavía no está listo.");
      signingPath(path, r.projectId, r.docId, artifact);
      const {
        metadata: _metadata,
        path: _path,
        ...result
      } = await fileBytes(
        {
          path,
          fileName: artifact === "original" ? r.doc.fileName : undefined,
        },
        bucket(),
      );
      return result;
    },
    async prepare(declaration, includePreview = false) {
      const project = "goat_portal_declarations",
        documentId = declaration.id;
      const ref = store().doc(`projects/${project}/documents/${documentId}`);
      const [parentBefore, existing, pdf] = await Promise.all([store().doc(`projects/${project}`).get(), ref.get(), declarationPdf(declaration)]);
      if (
        parentBefore.exists &&
        (!parentBefore.data().portalManaged ||
          parentBefore.data().ownerUid !== "goat_portal_service")
      )
        fail("El proyecto de declaraciones no pertenece a esta integración.");
      const { bytes, field } = pdf;
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const storagePath = `projects/${project}/documents/${documentId}/original.pdf`;
      const requestId = `${project}_${documentId}_${declaration.actor.email.replace(/[^a-z0-9]/g, "_")}`;
      const preview = includePreview ? { signingDocument: { id: requestId, documentId, projectId: project,
        title: declaration.kind === 'representation' ? 'Representación de empresa' : declaration.kind === 'profile' ? 'Actualización de mis datos' : 'Autorización de facturación y cobro',
        signatureFields: [field], sha256, contentHash: declaration.contentHash, status: 'pending', signed: false, portalManaged: true,
        providerId: declaration.providerId, declarationKind: declaration.kind, requiredDni: declaration.content.signerDni || '' },
        originalFile: { base64: bytes.toString('base64'), contentType: 'application/pdf', fileName: 'declaracion.pdf', sha256 } } : {};
      if (existing.exists) {
        const prior = existing.data();
        if (
          prior.portalContentHash !== declaration.contentHash ||
          prior.sha256 !== sha256 ||
          prior.storagePath !== storagePath ||
          !prior.portalManaged ||
          prior.goatDeclarationId !== documentId ||
          JSON.stringify(prior.signerEmails) !==
            JSON.stringify([declaration.actor.email])
        )
          fail(
            "La declaración existente no coincide con el original canónico.",
          );
        if (includePreview) Object.assign(preview.signingDocument, { status: prior.status,
          signed: list(prior.signatureStatus).some(value => email(value.email) === declaration.actor.email && value.status === 'signed'),
          artifactsReady: Boolean(prior.serverArtifacts?.signedPdfPath) });
        return {
          ...preview,
          projectId: project,
          docId: documentId,
          contentHash: declaration.contentHash,
        };
      }
      try {
        await bucket()
          .file(storagePath)
          .save(bytes, {
            resumable: false,
            contentType: "application/pdf",
            preconditionOpts: { ifGenerationMatch: 0 },
            metadata: { metadata: { sha256 } },
          });
      } catch (e) {
        if (Number(e.code) !== 412) throw e;
        const [prior] = await bucket().file(storagePath).download();
        if (createHash("sha256").update(prior).digest("hex") !== sha256)
          fail("El original existente es distinto.");
      }
      await store().runTransaction(async (tx) => {
        const current = await tx.get(ref);
        const parent = await tx.get(store().doc(`projects/${project}`));
        if (
          parent.exists &&
          (!parent.data().portalManaged ||
            parent.data().ownerUid !== "goat_portal_service")
        )
          fail(
            "El identificador del proyecto de declaraciones ya está ocupado.",
          );
        if (current.exists) {
          if (
            current.data().portalContentHash !== declaration.contentHash ||
            current.data().sha256 !== sha256 ||
            current.data().storagePath !== storagePath ||
            !current.data().portalManaged
          )
            fail("Contenido distinto.");
          return;
        }
        tx.set(
          store().doc(`projects/${project}`),
          {
            name: "Declaraciones del portal de proveedores",
            ownerUid: "goat_portal_service",
            ownerEmail: "",
            collaboratorEmails: [],
            portalManaged: true,
          },
          { merge: true },
        );
        tx.create(ref, {
          title:
            declaration.kind === "profile"
              ? "Declaración de datos"
              : declaration.kind === "representation"
                ? "Confirmación de representación"
                : "Autorización de tercero",
          fileName: "declaracion.pdf",
          storagePath,
          contentType: "application/pdf",
          sha256,
          signerEmails: [declaration.actor.email],
          signatureFields: [field],
          signatureStatus: [
            { email: declaration.actor.email, status: "pending" },
          ],
          status: "pending",
          portalManaged: true,
          portalContentHash: declaration.contentHash,
          goatDeclarationId: documentId,
          goatProviderId: declaration.providerId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        tx.create(store().doc(`signatureRequests/${requestId}`), {
          projectId: project,
          docId: documentId,
          signerEmail: declaration.actor.email,
          title: "Declaración de proveedor",
          fileName: "declaracion.pdf",
          contentType: "application/pdf",
          storagePath,
          sha256,
          signatureFields: [field],
          status: "pending",
          portalManaged: true,
        });
      });
      return {
        ...preview,
        projectId: project,
        docId: documentId,
        contentHash: declaration.contentHash,
      };
    },
    async verify(link, actor, contentHash) {
      const d = (
        await store()
          .doc(`projects/${id(link.projectId)}/documents/${id(link.docId)}`)
          .get()
      ).data();
      if (!d || d.portalContentHash !== contentHash || !d.portalManaged)
        fail("Evidencia no corresponde a la declaración.");
      const signatures = await store()
        .doc(`projects/${link.projectId}/documents/${link.docId}`)
        .collection("signatures")
        .get();
      const sig = signatures.docs
        .map((s) => s.data())
        .find(
          (s) =>
            email(s.email) === actor.email &&
            s.authEmailVerified === true &&
            s.documentSha256 === d.sha256,
        );
      const artifacts = d.serverArtifacts;
      if (
        !sig ||
        d.status !== "completed" ||
        !artifacts?.signedPdfPath ||
        !artifacts?.certificatePdfPath
      )
        return { complete: false };
      const [bytes] = await bucket().file(artifacts.signedPdfPath).download();
      if (
        createHash("sha256").update(bytes).digest("hex") !==
        artifacts.signedPdfSha256
      )
        fail("El PDF firmado no coincide con su hash.");
      return {
        complete: true,
        signedAt: sig.signedAtIso,
        signatureUid: sig.uid,
        contentHash,
        originalSha256: d.sha256,
        signedPdfSha256: artifacts.signedPdfSha256,
        certificateSha256: artifacts.certificateSha256,
        signerDni: String(sig.dni || '').replace(/\D/g, ''),
      };
    },
    async connectProject(goatProjectId, p, actor) {
      const signProjectId = `goat_project_${hash(goatProjectId).slice(0, 32)}`;
      const ref = store().doc(`projects/${signProjectId}`);
      await store().runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        if (
          existing.exists &&
          (existing.data().goatProjectId !== goatProjectId ||
            existing.data().ownerUid !== "goat_bridge_service")
        )
          fail("La carpeta existente no corresponde a este proyecto GOAT.");
        tx.set(
          ref,
          {
            name: text(p.name),
            goatProjectId,
            portalManaged: true,
            ownerUid: "goat_bridge_service",
            ownerEmail: "",
            collaboratorEmails: admin.firestore.FieldValue.arrayUnion(
              actor.email,
            ),
          },
          { merge: true },
        );
      });
      await db.doc(`providerPortalProjectLinks/${goatProjectId}`).set(
        {
          signProjectId,
          connectedBy: actor,
          at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return {
        signProjectId,
        url: `https://gb-films.github.io/GB-Sign/?project=${signProjectId}`,
      };
    },
    async declarationFile(link, artifact) {
      const d = (
        await store()
          .doc(`projects/${id(link.projectId)}/documents/${id(link.docId)}`)
          .get()
      ).data();
      if (!d || d.portalContentHash !== link.contentHash)
        fail("Declaración incorrecta.");
      const path =
        artifact === "original"
          ? d.storagePath
          : artifact === "signed"
            ? d.serverArtifacts?.signedPdfPath
            : artifact === "certificate"
              ? d.serverArtifacts?.certificatePdfPath
              : null;
      if (!path) fail("Archivo pendiente.");
      signingPath(path, link.projectId, link.docId, artifact);
      const {
        metadata: _metadata,
        path: _path,
        ...result
      } = await fileBytes({ path }, bucket());
      return result;
    },
    async projectFile(goatProjectId, documentId, artifact) {
      const link = (
        await db.doc(`providerPortalProjectLinks/${goatProjectId}`).get()
      ).data();
      if (!link) fail("Proyecto sin conexión.");
      const d = (
        await store()
          .doc(`projects/${id(link.signProjectId)}/documents/${id(documentId)}`)
          .get()
      ).data();
      if (!d) fail("Documento inexistente.");
      const path =
        artifact === "original"
          ? d.storagePath
          : artifact === "signed"
            ? d.serverArtifacts?.signedPdfPath
            : artifact === "certificate"
              ? d.serverArtifacts?.certificatePdfPath
              : null;
      if (!path) fail("Archivo pendiente.");
      signingPath(path, link.signProjectId, documentId, artifact);
      const {
        metadata: _metadata,
        path: _path,
        ...result
      } = await fileBytes(
        { path, fileName: artifact === "original" ? d.fileName : undefined },
        bucket(),
      );
      return result;
    },
    async projectDocuments(goatProjectId) {
      const declarations = await db
        .collection("providerPortalDeclarations")
        .where("content.projectIds", "array-contains", goatProjectId)
        .limit(501)
        .get();
      if (declarations.size > 500) fail("Paginar declaraciones.");
      const statementRows = declarations.docs.map((s) => {
        const d = s.data();
        return {
          id: s.id,
          source: "portal_declaration",
          title: `Autorización de tercero · ${d.content.provider.name}`,
          providerId: d.providerId,
          status: d.proof?.complete ? "completed" : "pending",
          declarationStatus: d.status,
          artifactsReady: Boolean(d.proof?.complete),
          multiProject: d.content.projectIds.length > 1,
          signatures: [
            {
              email: d.actor.email,
              status: d.proof?.complete ? "signed" : "pending",
            },
          ],
        };
      });
      const link = (
        await db.doc(`providerPortalProjectLinks/${goatProjectId}`).get()
      ).data();
      if (!link) return { connected: false, documents: statementRows };
      const rows = await store()
        .collection(`projects/${id(link.signProjectId)}/documents`)
        .limit(501)
        .get();
      if (rows.size > 500) fail("Paginar documentos del proyecto.");
      const preparations = await db.collection(`providerPortalProjectLinks/${goatProjectId}/contracts`).limit(501).get();
      if (preparations.size > 500) fail('Paginar preparaciones del proyecto.');
      const byDocument = new Map(preparations.docs.map(snapshot => [snapshot.data().documentId, snapshot.data()]));
      return {
        connected: true,
        signProjectId: link.signProjectId,
        url: `https://gb-films.github.io/GB-Sign/?project=${link.signProjectId}`,
        documents: [
          ...statementRows,
          ...rows.docs.map((s) => {
            const d = s.data();
            const preparation = byDocument.get(s.id);
            const sourceVerified = Boolean(preparation && d.portalManaged && d.goatSourceProjectId === goatProjectId
              && preparation.manifest === d.goatPreparationHash && preparation.sha256 === d.sha256 && preparation.sourceDocumentId === d.goatSourceDocumentId);
            return {
              id: s.id,
              source: "sign_project",
              sourceDocumentId: sourceVerified ? preparation.sourceDocumentId : null,
              providerBindings: sourceVerified ? preparation.bindings : [],
              signatureFields: d.signatureFields || [],
              title: d.title,
              status: d.status || "pending",
              signatures: d.signatureStatus || [],
              artifactsReady: Boolean(d.serverArtifacts?.signedPdfPath),
            };
          }),
        ],
      };
    },
    async storeInvoice({ providerId, actor, attemptId, file, workKey }) {
      if (
        !file ||
        typeof file.base64 !== "string" ||
        file.base64.length > 3e6 ||
        !["application/pdf", "image/jpeg", "image/png"].includes(
          file.contentType,
        )
      )
        fail("Usá PDF, JPG o PNG de hasta2MB.");
      const bytes = Buffer.from(file.base64, "base64");
      if (!bytes.length || bytes.length > 2 * 1024 * 1024)
        fail("El archivo supera2MB.");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const magic =
        file.contentType === "application/pdf"
          ? bytes.subarray(0, 5).toString() === "%PDF-"
          : file.contentType === "image/png"
            ? bytes
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : bytes[0] === 255 && bytes[1] === 216;
      if (!magic) fail("El contenido no coincide con el tipo de archivo.");
      const path = `providerPortalUploads/${providerId}/${sha256}/invoice`;
      try {
        await admin
          .storage()
          .bucket()
          .file(path)
          .save(bytes, {
            resumable: false,
            contentType: file.contentType,
            preconditionOpts: { ifGenerationMatch: 0 },
            metadata: { metadata: { providerId, uploadedBy: actor.uid } },
          });
      } catch (e) {
        if (Number(e.code) !== 412) throw e;
        const [prior] = await admin.storage().bucket().file(path).download();
        if (!prior.equals(bytes))
          fail("El intento anterior tenía otro archivo.");
      }
      return {
        portalUploadId: hash({ providerId, workKey, sha256 }),
        sha256,
        fileName: text(file.fileName, 140),
        path,
        contentType: file.contentType,
        size: bytes.length,
        uploadedBy: actor.email,
        portalSafe: true,
      };
    },
    readLocalFile: (file) => fileBytes(file, admin.storage().bucket()),
  };
}
module.exports = { createSignBridge };
