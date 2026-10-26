import { PortalSignatureCanvas } from "./PortalSignatureCanvas";
import { useEffect, useState } from "react";
import {
  downloadPortalFile,
  portalRequest,
  signPortalDocument,
} from "../lib/providerPortal";
export default function PortalSignDialog({
  document: doc,
  onClose,
  onSigned,
}: {
  document: any;
  onClose: () => void;
  onSigned: () => Promise<void>;
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [dni, setDni] = useState(""),
    [name, setName] = useState(""),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState<"typed" | "drawn">("typed"),
    [image, setImage] = useState("");
  useEffect(() => {
    let active = true,
      objectUrl = "";
    portalRequest({
      action: "signingFile",
      requestId: doc.id,
      projectId: doc.projectId,
      documentId: doc.documentId,
      artifact: "original",
    })
      .then((file) => {
        objectUrl = downloadPortalFile(file, true);
        if (active) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc.documentId]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Firmar documento"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/70 p-2 sm:p-5"
    >
      <div className="flex max-h-[95vh] w-full max-w-4xl flex-col rounded-2xl bg-white p-4 gap-3">
        <div className="flex justify-between">
          <h2 className="font-bold">{doc.title}</h2>
          <button disabled={busy} onClick={onClose}>
            Cerrar
          </button>
        </div>
        {url && (
          <>
            <iframe
              className="min-h-64 flex-1"
              style={{ height: "50vh" }}
              title="Documento a firmar"
              src={url}
            />
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline"
            >
              Abrir documento completo
            </a>
          </>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Nombre para la firma
            <input
              className="block w-full rounded border p-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="text-sm">
            DNI
            <input
              className="block w-full rounded border p-2"
              inputMode="numeric"
              value={dni}
              onChange={(e) => setDni(e.target.value)}
            />
          </label>
        </div>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
          />
          Leí el documento y acepto firmarlo electrónicamente con mi cuenta
          verificada y los datos declarados.
        </label>
        <div className="flex gap-3 text-sm">
          <button
            type="button"
            className={mode === "typed" ? "font-bold underline" : ""}
            onClick={() => setMode("typed")}
          >
            Firma con mi nombre
          </button>
          <button
            type="button"
            className={mode === "drawn" ? "font-bold underline" : ""}
            onClick={() => setMode("drawn")}
          >
            Dibujar firma
          </button>
        </div>
        {mode === "drawn" && <PortalSignatureCanvas onChange={setImage} />}{" "}
        {name && mode === "typed" && (
          <div className="text-3xl italic" style={{ fontFamily: "cursive" }}>
            {name}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          disabled={
            busy ||
            !url ||
            !accepted ||
            !name.trim() ||
            !/^\d{6,12}$/.test(dni) ||
            (mode === "drawn" && !image)
          }
          className="rounded-xl bg-slate-900 px-4 py-3 text-white disabled:opacity-40"
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await signPortalDocument(doc, {
                dni,
                typedName: name,
                signatureType: mode,
                signatureImage: image,
              });
              await onSigned();
              onClose();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Registrando firma…" : "Firmar y confirmar"}
        </button>
      </div>
    </div>
  );
}
