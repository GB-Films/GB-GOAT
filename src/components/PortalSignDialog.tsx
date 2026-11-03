import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { downloadPortalFile, portalRequest, signPortalDocument } from "../lib/providerPortal";
import { PortalSigningRoom } from "./PortalSigningRoom";
import { portalErrorMessage } from '../lib/providerPortalUi';

export default function PortalSignDialog({ document: doc, onClose, onSigned }: {
  document: any;
  onClose: () => void;
  onSigned: () => Promise<void>;
}) {
  const { user } = useAuth();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState('');
  useEffect(() => {
    let active = true, objectUrl = "";
    setUrl(""); setError("");
    if (doc.preparing) return;
    if (doc.originalFile) {
      try { objectUrl = downloadPortalFile(doc.originalFile, true); setUrl(objectUrl); }
      catch { setError('No pudimos abrir el documento. Volvé a cargarlo.'); }
      return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }
    portalRequest({ action: "signingFile", requestId: doc.id, projectId: doc.projectId, documentId: doc.documentId, artifact: "original" })
      .then(file => {
        if (!active) return;
        objectUrl = downloadPortalFile(file, true);
        setUrl(objectUrl);
      })
      .catch(e => { if (active) setError(portalErrorMessage(e)); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [doc.id, doc.projectId, doc.documentId, doc.preparing, doc.originalFile, user?.uid, attempt]);

  return <PortalSigningRoom key={`${doc.projectId}/${doc.documentId}/${doc.id}/${user?.uid}/${attempt}`} document={doc}
    signer={{ email: user?.email || "", name: user?.displayName || "" }} url={url} loadError={error} progress={progress} preparing={!!doc.preparing}
    onRetry={() => setAttempt(value => value + 1)} onClose={onClose}
    onSubmit={async input => {
      try {
        await signPortalDocument(doc, input, setProgress);
        setProgress('Tu firma se guardó. Actualizando tus documentos…');
        try { await onSigned(); }
        catch { throw Object.assign(Error('Tu firma quedó guardada. Volvé a Documentos para consultar el estado.'), { code: 'portal/signature-saved' }); }
        onClose();
      } finally { setProgress(''); }
    }} />;
}
