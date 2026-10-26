import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { downloadPortalFile, portalAdminRequest } from "../lib/providerPortal";
export default function ProviderPortalAdmin() {
  const [accessEmail, setAccessEmail] = useState("");
  const [reviews, setReviews] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState<Record<string, string>>({}),
    [plan, setPlan] = useState<any>(null),
    [providers, setProviders] = useState<any[]>([]),
    [providerId, setProviderId] = useState(""),
    [files, setFiles] = useState<any[]>([]),
    [reviewedFiles, setReviewedFiles] = useState<Record<number, string>>({});
  async function load() {
    const r = await portalAdminRequest({ action: "reviews" });
    setReviews(r.reviews);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
    getDocs(collection(db, "providers"))
      .then((s) => setProviders(s.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch((e) => setError(e.message));
  }, []);
  async function run(f: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await f();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function review(d: any, decision: string, roles?: string[]) {
    await run(async () => {
      await portalAdminRequest({
        action: "review",
        declarationId: d.id,
        decision,
        reason: reason[d.id] || "",
        roles,
      });
      await load();
    });
  }
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4">
      <h1 className="text-2xl font-bold">Revisiones de proveedores</h1>
      {error && (
        <p role="alert" className="rounded bg-red-50 p-3 text-red-700">
          {error}
        </p>
      )}
      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <h2 className="font-semibold">
          Preparar acceso de proveedores existentes
        </h2>
        <p className="text-sm text-slate-600">
          La preparación identifica correos únicos y separa los casos faltantes
          o compartidos. No cambia roles ni habilita el portal en producción.
        </p>
        <button
          disabled={busy}
          className="rounded border px-3 py-2"
          onClick={() =>
            run(async () =>
              setPlan(await portalAdminRequest({ action: "prepareAccess" })),
            )
          }
        >
          Revisar coincidencias
        </button>
        {plan && (
          <>
            <p>
              {plan.unique} correos únicos · {plan.ambiguous.length} compartidos
              · {plan.missing.length} sin correo válido
            </p>
            <details>
              <summary>Ver casos por revisar</summary>
              <pre className="overflow-auto text-xs">
                {JSON.stringify(
                  { compartidos: plan.ambiguous, sinCorreo: plan.missing },
                  null,
                  2,
                )}
              </pre>
            </details>
            <button
              disabled={busy}
              className="rounded bg-slate-900 px-3 py-2 text-white"
              onClick={() =>
                run(async () => {
                  if (
                    !confirm(
                      "¿Preparar las asociaciones únicas? Los casos ambiguos no se habilitan.",
                    )
                  )
                    return;
                  setPlan(
                    await portalAdminRequest({
                      action: "prepareAccess",
                      apply: true,
                    }),
                  );
                })
              }
            >
              Preparar asociaciones únicas
            </button>
          </>
        )}
      </section>
      <h2 className="text-lg font-bold">Declaraciones firmadas para revisar</h2>
      {reviews.map((d) => (
        <section
          key={d.id}
          className="space-y-3 rounded-2xl border bg-white p-4"
        >
          <h3 className="font-semibold">
            {d.kind === "profile"
              ? "Cambios de datos"
              : "Autorización de tercero"}{" "}
            · {d.actor.email}
          </h3>
          <p className="text-xs text-slate-500">
            Proveedor {d.providerId} · Firma {d.proof.signedAt}
          </p>
          {d.kind === "profile" ? (
            Object.entries(d.content.changes).map(([key, c]: any) => (
              <p className="text-sm" key={key}>
                <strong>{key}:</strong> {c.before || "Sin dato"} →{" "}
                {c.after || "Sin dato"} ·{" "}
                {c.critical ? "Pendiente de aprobación" : "Aplicado al firmar"}
              </p>
            ))
          ) : (
            <>
              <p>
                {d.content.party.name} · CUIT {d.content.party.cuit} ·{" "}
                {d.content.party.holder} ·{" "}
                {d.content.party.cbu || d.content.party.alias}
              </p>
              <p className="text-sm">Hasta {d.content.expiresOn}</p>
              <ul className="text-sm">
                {d.content.workKeys.map((k: string) => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
            </>
          )}
          <label className="block text-sm">
            Motivo / respaldo de la revisión
            <textarea
              className="mt-1 w-full rounded border p-2"
              value={reason[d.id] || ""}
              onChange={(e) => setReason({ ...reason, [d.id]: e.target.value })}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {(d.kind === "profile"
              ? ["profile"]
              : d.content.roles.filter((r: string) => !d.decisions?.[r])
            ).map((role: string) => (
              <div key={role} className="flex gap-2">
                <button
                  disabled={busy || !reason[d.id]?.trim()}
                  className="rounded bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-40"
                  onClick={() =>
                    review(
                      d,
                      "approved",
                      role === "profile" ? undefined : [role],
                    )
                  }
                >
                  Aprobar{" "}
                  {role === "profile"
                    ? "datos críticos"
                    : role === "invoice"
                      ? "encuadre de facturación"
                      : "beneficiario y cuenta"}
                </button>
                <button
                  disabled={busy || !reason[d.id]?.trim()}
                  className="rounded border px-3 py-2 text-sm disabled:opacity-40"
                  onClick={() =>
                    review(
                      d,
                      "rejected",
                      role === "profile" ? undefined : [role],
                    )
                  }
                >
                  Rechazar
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
      {!reviews.length && (
        <p className="text-sm text-slate-600">
          No hay declaraciones pendientes de revisión.
        </p>
      )}
      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <h2 className="font-semibold">
          Asociaciones y publicación de comprobantes
        </h2>
        <select
          className="w-full rounded border p-2"
          aria-label="Proveedor del comprobante"
          value={providerId}
          onChange={(e) => {
            setProviderId(e.target.value);
            setFiles([]);
            setReviewedFiles({});
          }}
        >
          <option value="">Elegí proveedor</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.businessName || [p.name, p.lastName].filter(Boolean).join(" ")}
            </option>
          ))}
        </select>
        <div className="space-y-2 rounded-xl bg-slate-50 p-3">
          <label className="block text-sm">
            Cuenta verificada que representará a este proveedor
            <input
              type="email"
              className="mt-1 w-full rounded border p-2"
              value={accessEmail}
              onChange={(e) => setAccessEmail(e.target.value)}
            />
          </label>
          <p className="text-xs text-slate-500">
            La persona debe haber iniciado sesión y verificado ese correo. Esta
            asociación no cambia su correo de contacto ni concede permisos de
            producción.
          </p>
          <button
            disabled={busy || !providerId || !accessEmail}
            className="mr-3 text-sm underline"
            onClick={() =>
              run(async () => {
                await portalAdminRequest({
                  action: "setMembership",
                  providerId,
                  email: accessEmail,
                  status: "needs_confirmation",
                });
                alert(
                  "Asociación preparada; la persona confirmará y firmará su representación.",
                );
              })
            }
          >
            Asignar cuenta verificada
          </button>
          <button
            disabled={busy || !providerId || !accessEmail}
            className="text-sm underline"
            onClick={() =>
              run(async () => {
                if (
                  !confirm("¿Revocar esta representación para este proveedor?")
                )
                  return;
                await portalAdminRequest({
                  action: "setMembership",
                  providerId,
                  email: accessEmail,
                  status: "revoked",
                });
                alert("Representación revocada.");
              })
            }
          >
            Revocar representación
          </button>
        </div>
        <button
          disabled={busy || !providerId}
          className="rounded border px-3 py-2"
          onClick={() =>
            run(async () => {
              setFiles(
                (
                  await portalAdminRequest({
                    action: "providerFiles",
                    providerId,
                  })
                ).files,
              );
            })
          }
        >
          Revisar archivos
        </button>
        {files.map((f: any, index: number) => (
          <div
            key={index}
            className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm"
          >
            <span>
              {f.fileName} · {f.kind}
            </span>
            <div className="flex gap-3">
              <button
                disabled={busy}
                className="underline"
                onClick={() =>
                  run(async () => {
                    const original = await portalAdminRequest({
                      action: "reviewFile",
                      providerId,
                      ...f.source,
                    });
                    downloadPortalFile(original);
                    setReviewedFiles({
                      ...reviewedFiles,
                      [index]: original.sha256,
                    });
                  })
                }
              >
                Descargar para revisar
              </button>
              <button
                disabled={busy || !reviewedFiles[index]}
                className="underline disabled:opacity-40"
                onClick={() =>
                  run(async () => {
                    if (
                      !confirm(
                        "¿Confirmás que el archivo completo se puede entregar a este proveedor y no expone información de terceros?",
                      )
                    )
                      return;
                    await portalAdminRequest({
                      action: "approveFile",
                      providerId,
                      sha256: reviewedFiles[index],
                      ...f.source,
                    });
                  })
                }
              >
                Publicar para este proveedor
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
