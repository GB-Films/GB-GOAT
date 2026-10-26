import { useEffect, useState } from "react";
import {
  downloadPortalFile,
  portalAdminRequest,
} from "../../lib/providerPortal";
const declarationLabels: Record<string, string> = {
  pending_review: "Pendiente de aprobación",
  active: "Vigente",
  revoked: "Revocada",
  rejected: "Rechazada",
  pending_signature: "Pendiente de firma",
  preparing: "Preparando documento",
};
export function ProjectSigning({ projectId }: { projectId: string }) {
  const [state, setState] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setState(
        await portalAdminRequest({ action: "projectDocuments", projectId }),
      );
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(timer);
  }, [projectId]);
  return (
    <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="font-bold">Contratos y firmas · GB Sign</h2>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <p className="my-2 text-sm text-slate-600">
        Prepará contratos y cesiones con los campos de firma de GB Sign. Los
        firmantes también los encontrarán en su portal.
      </p>
      <button
        disabled={busy}
        className="rounded bg-slate-900 px-3 py-2 text-sm text-white"
        onClick={async () => {
          setBusy(true);
          try {
            await portalAdminRequest({ action: "connectProject", projectId });
            await load();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {state?.connected
          ? "Actualizar conexión"
          : "Conectar proyecto con GB Sign"}
      </button>
      {state?.connected && (
        <a
          className="ml-4 text-sm underline"
          href={state.url}
          target="_blank"
          rel="noreferrer"
        >
          Preparar documentos en GB Sign
        </a>
      )}
      <button onClick={() => void load()} className="ml-4 text-sm underline">
        Actualizar estados
      </button>
      {state?.documents.map((d: any) => (
        <div key={d.id} className="mt-3 border-t pt-3 text-sm">
          <strong>{d.title}</strong>
          {d.declarationStatus && (
            <span className="ml-2 text-xs text-slate-500">
              Declaración:{" "}
              {declarationLabels[d.declarationStatus] || d.declarationStatus}
            </span>
          )}
          <span className="ml-3">
            {d.status === "completed" && d.artifactsReady
              ? "Firmado completo"
              : d.status === "partially_signed"
                ? "Parcialmente firmado"
                : "Pendiente"}
          </span>
          <div className="mt-2 flex gap-3">
            {(d.fileAvailable === false
              ? []
              : [
                  "original",
                  ...(d.artifactsReady ? ["signed", "certificate"] : []),
                ]
            ).map((artifact) => (
              <button
                key={artifact}
                className="underline"
                onClick={async () => {
                  try {
                    downloadPortalFile(
                      await portalAdminRequest({
                        action: "projectFile",
                        projectId,
                        documentId: d.id,
                        source: d.source,
                        artifact,
                      }),
                    );
                  } catch (e: any) {
                    setError(e.message);
                  }
                }}
              >
                {artifact === "original"
                  ? "Original"
                  : artifact === "signed"
                    ? "PDF firmado"
                    : "Evidencia"}
              </button>
            ))}
          </div>
          <ul className="mt-1 text-slate-600">
            {d.signatures.map((s: any) => (
              <li key={s.email}>
                {s.email} · {s.status === "signed" ? "Firmó" : "Pendiente"}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
