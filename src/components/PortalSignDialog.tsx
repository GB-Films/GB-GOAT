import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { downloadPortalFile, portalRequest, signPortalDocument } from "../lib/providerPortal";
import { PortalSigningRoom } from "./PortalSigningRoom";

export default function PortalSignDialog({ document: doc, onClose, onSigned }: {
  document: any;
  onClose: () => void;
  onSigned: () => Promise<void>;
}) {
  const { user } = useAuth();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true, objectUrl = "";
    setUrl(""); setError("");
    portalRequest({ action: "signingFile", requestId: doc.id, projectId: doc.projectId, documentId: doc.documentId, artifact: "original" })
      .then(file => {
        if (!active) return;
        objectUrl = downloadPortalFile(file, true);
        setUrl(objectUrl);
      })
      .catch(e => { if (active) setError(e.message || "No pudimos cargar el documento."); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [doc.id, doc.projectId, doc.documentId, user?.uid, attempt]);

  return <PortalSigningRoom key={`${doc.projectId}/${doc.documentId}/${doc.id}/${user?.uid}/${attempt}`} document={doc}
    signer={{ email: user?.email || "", name: user?.displayName || "" }} url={url} loadError={error}
    onRetry={() => setAttempt(value => value + 1)} onClose={onClose}
    onSubmit={async input => { await signPortalDocument(doc, input); await onSigned(); onClose(); }} />;
}
