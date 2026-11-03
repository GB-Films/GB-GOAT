import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { downloadPortalFile, portalAdminRequest } from "../lib/providerPortal";
export default function ProviderPortalAdmin() {
  const [checks, setChecks] = useState<Record<string, Record<string, boolean>>>({});
  const [approvedScope, setApprovedScope] = useState<Record<string, string>>({});
  const [applicationIssues, setApplicationIssues] = useState<any[]>([]);
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
    setReviews(r.reviews.filter((d: any) => d.kind === 'representation'));
    setApplicationIssues(r.applicationIssues || []);
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
  async function review(d: any, decision: string) {
    await run(async () => {
      await portalAdminRequest({
        action: "review",
        declarationId: d.id,
        decision,
        reason: reason[d.id] || "",
        checks: checks[d.id] || {}, approvedScope: approvedScope[d.id] || "",
      });
      await load();
    });
  }
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4">
      <h1 className="text-2xl font-bold">Accesos de proveedores</h1>
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
      <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">Las declaraciones de quién factura y cobra se aplican automáticamente con la firma del proveedor. No requieren revisión ni aprobación.</p>
      {!!applicationIssues.length && <section className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><h2 className="font-semibold">Declaraciones anteriores por actualizar</h2><p>El proveedor debe revisar sus datos y preparar una nueva declaración desde Mi proveedor.</p>{applicationIssues.map(issue => <p key={issue.id} className="mt-2">{issue.email || issue.providerId}</p>)}</section>}
      {!!reviews.length && <h2 className="text-lg font-bold">Representaciones del circuito anterior</h2>}
      {reviews.map((d) => (
        <section
          key={d.id}
          className="space-y-3 rounded-2xl border bg-white p-4"
        >
          <h3 className="font-semibold">
            Representación de empresa{" "}
            · {d.actor.email}
          </h3>
          <p className="text-xs text-slate-500">
            Proveedor {d.providerId} · Firma {d.proof.signedAt}
          </p>
          <div className="flex flex-wrap gap-2">{(['signed', 'certificate'] as const).map(artifact => <button key={artifact} type="button" disabled={busy} className="rounded border px-3 py-2 text-xs text-blue-700" onClick={() => run(async () => { downloadPortalFile(await portalAdminRequest({ action: 'declarationFile', providerId: d.providerId, declarationId: d.id, artifact })); })}>{artifact === 'signed' ? 'Ver declaración firmada' : 'Ver certificado de firma'}</button>)}</div>
          <div className="space-y-2 text-sm">
            <p><strong>{d.content.provider.name}</strong> · CUIT {d.content.provider.cuit}</p>
            <p>Representante: {d.content.representative?.name || d.content.profile?.name} · DNI {d.content.representative?.dni || 'No informado en esta versión'}</p>
            <p>Cargo o carácter: {d.content.representative?.role || 'No informado'}</p><p>Cuenta de representación: {d.actor.email}</p>
            <label className="block">Alcance de las facultades revisadas<textarea className="mt-1 block w-full rounded border p-2" maxLength={500} value={approvedScope[d.id] || ''} onChange={event => setApprovedScope({ ...approvedScope, [d.id]: event.target.value })} /></label>
            {!['company-representation-v2', 'company-representation-v3'].includes(d.content.version) && <p className="text-amber-800">Antecedente anterior. La persona puede preparar una nueva declaración desde Mi proveedor, sin esperar aprobación.</p>}
          </div>
          {!!d.content.evidence?.length && <div className="flex flex-wrap gap-2">{d.content.evidence.map((file: any) => <button key={file.id} type="button" disabled={busy} className="rounded border px-3 py-2 text-xs text-blue-700" onClick={() => run(async () => { downloadPortalFile(await portalAdminRequest({ action: 'evidenceFile', providerId: d.providerId, evidenceId: file.id })); })}>Ver respaldo: {file.fileName}</button>)}</div>}
          <fieldset className="space-y-2 rounded-lg border p-3"><legend className="px-1 text-sm font-semibold">Comprobaciones de administración</legend>{Object.entries({
            companyVerified: 'Revisé la documentación y coincide la empresa y su CUIT.', identityVerified: 'Revisé el DNI y la identidad de quien firma, y confirmé el correo que usará para representar a esta empresa.', authorityVerified: 'La documentación acredita las facultades vigentes del representante.', scopeVerified: 'El alcance documentado permite las gestiones y firmas que se van a habilitar.',
          }).map(([key, label]) => <label key={key} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={!!checks[d.id]?.[key]} onChange={event => setChecks(current => ({ ...current, [d.id]: { ...current[d.id], [key]: event.target.checked } }))} /><span>{label}</span></label>)}</fieldset>
          <label className="block text-sm">
            Motivo / respaldo de la revisión
            <textarea
              className="mt-1 w-full rounded border p-2"
              value={reason[d.id] || ""}
              onChange={(e) => setReason({ ...reason, [d.id]: e.target.value })}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy || !reason[d.id]?.trim()} className="rounded bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-40" onClick={() => review(d, 'approved')}>Aprobar representación de empresa</button>
            <button disabled={busy || !reason[d.id]?.trim()} className="rounded border px-3 py-2 text-sm disabled:opacity-40" onClick={() => review(d, 'rejected')}>Rechazar</button>
          </div>
        </section>
      ))}
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
            Correo de la cuenta Google que representará a este proveedor
            <input
              type="email"
              className="mt-1 w-full rounded border p-2"
              value={accessEmail}
              onChange={(e) => setAccessEmail(e.target.value)}
            />
          </label>
          <p className="text-xs text-slate-500">
            La persona debe haber ingresado con Google usando ese correo
            verificado; no es necesario que termine en gmail.com. Esta asociación
            conserva el correo personal registrado y los permisos de producción.
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
