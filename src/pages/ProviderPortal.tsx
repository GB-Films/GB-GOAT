import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  downloadPortalFile,
  portalRequest,
  signPortalDocument,
} from "../lib/providerPortal";
import PortalSignDialog from "../components/PortalSignDialog";

const tabs = [
  "Trabajos",
  "Facturas",
  "Pagos y retenciones",
  "Documentos",
  "Mis datos",
];
const labels: Record<string, string> = {
  name: "Nombre",
  lastName: "Apellido",
  businessName: "Razón social",
  dni: "DNI",
  cuit: "CUIT",
  address: "Domicilio",
  phone: "Teléfono",
  email: "Correo personal de tu cuenta Google",
  bankAccount_cbu: "CBU/CVU",
  bankAccount_alias: "Alias",
  bankAccount_holder: "Titular de la cuenta",
};
const status: Record<string, string> = {
  pending_signature: "Pendiente de firma",
  pending_review: "Pendiente de revisión",
  applied: "Aplicado",
  active: "Vigente",
  revoked: "Revocada",
  rejected: "Rechazada",
  preparing: "Preparando documento",
  pending: "Pendiente de firma",
  signed: "Firmado",
  completed: "Firmado completo",
  partially_signed: "Parcialmente firmado",
  cancelled: "Anulado",
};
const money = (value: number, currency = "ARS") =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(
    value || 0,
  );
const box = "rounded-2xl border border-slate-200 bg-white p-4";
export default function ProviderPortal() {
  const { user } = useAuth();
  const [hasLoaded, setHasLoaded] = useState(false);
  const loadRevision = useRef(0),
    attempts = useRef(new Map<string, string>());
  const [members, setMembers] = useState<any[]>([]),
    [providerId, setProviderId] = useState(""),
    [view, setView] = useState<any>(null),
    [docs, setDocs] = useState<any[]>([]),
    [tab, setTab] = useState(tabs[0]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [signing, setSigning] = useState<any>(null),
    [draft, setDraft] = useState<Record<string, string>>({}),
    [capacity, setCapacity] = useState("own"),
    [uploadWork, setUploadWork] = useState("");
  const [party, setParty] = useState<any>({
    name: "",
    cuit: "",
    email: "",
    holder: "",
    cbu: "",
    alias: "",
    roles: [],
    workKeys: [],
    expiresOn: "",
  });
  const selected = members.find((m) => m.providerId === providerId);
  useEffect(() => {
    if (selected?.type === "empresa") setCapacity("authorized_representative");
  }, [selected?.type]);
  const load = useCallback(async () => {
    const revision = ++loadRevision.current;
    try {
      const b = await portalRequest({ action: "bootstrap" });
      if (revision !== loadRevision.current) return;
      setHasLoaded(true);
      setMembers(b.memberships);
      setDocs(b.signing);
      const chosen =
        b.memberships.find((m: any) => m.providerId === providerId) ||
        b.memberships[0];
      if (chosen?.providerId !== providerId)
        setProviderId(chosen?.providerId || "");
      if (chosen?.status === "active") {
        const result = await portalRequest({
          action: "overview",
          providerId: chosen.providerId,
        });
        if (revision === loadRevision.current) setView(result);
      } else setView(null);
    } catch (e: any) {
      if (revision === loadRevision.current) setError(e.message);
    }
  }, [providerId]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(timer);
  }, [load]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    if (signing?.portalManaged && signing.providerId)
      await portalRequest({
        action: "completeDeclaration",
        providerId: signing.providerId,
        declarationId: signing.documentId,
      });
    setDraft({});
    await load();
  }
  async function prepare(action: string, input: any) {
    const key = JSON.stringify([providerId, action, input]);
    if (!attempts.current.has(key))
      attempts.current.set(key, crypto.randomUUID());
    await run(async () => {
      const result = await portalRequest({
        action,
        providerId,
        attemptId: attempts.current.get(key),
        ...input,
      });
      const b = await portalRequest({ action: "myDocuments" });
      setDocs(b.documents);
      const d = b.documents.find((d: any) => d.documentId === result.id);
      if (!d)
        throw Error(
          "La declaración quedó preparada. Actualizá Documentos para firmarla.",
        );
      setSigning(d);
      setTab("Documentos");
    });
  }
  async function download(input: any) {
    await run(async () => {
      downloadPortalFile(
        await portalRequest({ action: "download", providerId, ...input }),
      );
    });
  }
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-2 sm:p-5">
      <header className={box}>
        <h1 className="text-2xl font-bold">Mi proveedor</h1>
        <p className="mt-2 text-sm text-slate-600">
          Ingresaste como {user?.displayName || user?.email} · {user?.email}
        </p>
        {members.length > 0 ? (
          <label className="mt-3 block text-sm">
            Representás a
            <select
              className="mt-1 block w-full rounded-lg border p-2 font-semibold"
              disabled={busy}
              value={providerId}
              onChange={(e) => {
                loadRevision.current++;
                setView(null);
                setSigning(null);
                setUploadWork("");
                setProviderId(e.target.value);
                setDraft({});
                setParty({
                  name: "",
                  cuit: "",
                  email: "",
                  holder: "",
                  cbu: "",
                  alias: "",
                  roles: [],
                  workKeys: [],
                  expiresOn: "",
                });
              }}
            >
              {members.map((m) => (
                <option key={m.providerId} value={m.providerId}>
                  {m.name} · CUIT {m.cuit || "pendiente"}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="mt-3 text-sm">
            {hasLoaded && !error
              ? "Tu cuenta no tiene una ficha de proveedor asociada. Podés consultar tus documentos asignados; para vincular una ficha, contactá a administración."
              : error
                ? "No pudimos comprobar tu representación."
                : "Consultando tu cuenta…"}
          </p>
        )}
      </header>
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">
          {error}
          <button
            className="ml-3 underline"
            onClick={() => {
              setError("");
              void load();
            }}
          >
            Actualizar
          </button>
        </div>
      )}
      {selected?.status === "needs_confirmation" && (
        <section className={box}>
          <h2 className="font-bold">Confirmá a quién representás</h2>
          <p className="my-2 text-sm">
            Revisá la ficha y firmá la declaración para activar tu vista de
            proveedor.
          </p>
          <select
            className="rounded border p-2"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          >
            <option value="own" disabled={selected?.type === "empresa"}>
              Actúo por cuenta propia
            </option>
            <option value="authorized_representative">
              Soy representante autorizado
            </option>
          </select>
          <button
            disabled={busy}
            className="ml-3 rounded bg-slate-900 p-2 text-white"
            onClick={() => prepare("prepareRepresentation", { capacity })}
          >
            Revisar y firmar
          </button>
        </section>
      )}
      <nav
        aria-label="Secciones del proveedor"
        className="flex gap-2 overflow-x-auto"
      >
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm ${tab === t ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === "Trabajos" && (
        <section className="space-y-3">
          {view?.works.map((w: any) => (
            <article key={w.key} className={box}>
              <h2 className="font-bold">{w.projectName}</h2>
              <p className="text-sm text-slate-600">{w.description}</p>
              <div className="mt-3 flex flex-wrap gap-5 text-sm">
                <span>Trabajo: {money(w.total, w.currency)}</span>
                <span>
                  {w.markedPaidWithoutDetails ? (
                    "Marcado pagado; sin detalle cargado"
                  ) : (
                    <>Pagos registrados: {money(w.paid, w.currency)}</>
                  )}
                </span>
              </div>
            </article>
          ))}
          {!view?.works.length && (
            <p className={box}>
              No hay trabajos para mostrar con esta representación.
            </p>
          )}
        </section>
      )}
      {tab === "Facturas" && (
        <section className="space-y-3">
          {view && (
            <div className={box}>
              <h2 className="font-bold">Cargar factura</h2>
              <select
                aria-label="Trabajo de la factura"
                className="my-2 w-full rounded border p-2"
                value={uploadWork}
                onChange={(e) => setUploadWork(e.target.value)}
              >
                <option value="">Elegí un trabajo</option>
                {view.works.map((w: any) => (
                  <option key={w.key} value={w.key}>
                    {w.projectName} · {w.description}
                  </option>
                ))}
              </select>
              <input
                aria-label="Adjuntar factura"
                disabled={busy || !uploadWork}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  void run(async () => {
                    if (file.size > 2 * 1024 * 1024)
                      throw Error("Usá un archivo de hasta2MB.");
                    const reader = new FileReader();
                    const base64 = await new Promise<string>(
                      (resolve, reject) => {
                        reader.onload = () =>
                          resolve(String(reader.result).split(",")[1]);
                        reader.onerror = reject;
                        reader.readAsDataURL(file);
                      },
                    );
                    await portalRequest({
                      action: "uploadInvoice",
                      providerId,
                      workKey: uploadWork,
                      attemptId: crypto.randomUUID(),
                      file: {
                        base64,
                        contentType: file.type,
                        fileName: file.name,
                      },
                    });
                    await load();
                  });
                  e.target.value = "";
                }}
              />
              <p className="mt-2 text-xs text-slate-500">
                La carga agrega el documento al trabajo. No registra otro costo
                ni un pago.
              </p>
            </div>
          )}
          {view?.works.map(
            (w: any) =>
              w.invoiceCount > 0 && (
                <div key={w.key} className={box}>
                  <h2 className="font-semibold">
                    {w.projectName} · {w.description}
                  </h2>
                  {Array.from({ length: w.invoiceCount }, (_, index) => (
                    <button
                      disabled={busy}
                      className="mr-3 mt-2 text-sm underline"
                      key={index}
                      onClick={() =>
                        download({ workKey: w.key, kind: "invoice", index })
                      }
                    >
                      Factura {index + 1}
                    </button>
                  ))}
                </div>
              ),
          )}
          {view?.financial
            .filter((r: any) => r.kind === "invoice")
            .map((r: any) => (
              <div className={box} key={r.id}>
                <p>
                  {r.number} · {r.issuerName} ·{" "}
                  {money(r.totalCents / 100, r.currency || "ARS")} ·{" "}
                  {r.status === "cancelled" ? "Anulada" : ""}
                </p>
                {r.hasFile && (
                  <button
                    disabled={busy}
                    className="mt-2 underline"
                    onClick={() => download({ recordId: r.id })}
                  >
                    Descargar original
                  </button>
                )}
              </div>
            ))}
        </section>
      )}
      {tab === "Pagos y retenciones" && (
        <section className="space-y-3">
          {view?.works.map((w: any) => (
            <div className={box} key={w.key}>
              <h2 className="font-semibold">
                {w.projectName} · {w.description}
              </h2>
              {w.payments.map((p: any, index: number) => (
                <div
                  key={p.id}
                  className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm"
                >
                  <span>
                    {p.date?.slice(0, 10)} · {money(p.amount, w.currency)}{" "}
                    {p.sharedRecordId ? "· Aplicación de pago distribuido" : ""}
                  </span>
                  {p.hasReceipt && (
                    <button
                      disabled={busy}
                      className="underline"
                      onClick={() =>
                        download({ workKey: w.key, kind: "payment", index })
                      }
                    >
                      Comprobante
                    </button>
                  )}
                </div>
              ))}
              {Array.from({ length: w.otherCount }, (_, index) => (
                <button
                  key={index}
                  disabled={busy}
                  className="mr-3 mt-2 text-sm underline"
                  onClick={() =>
                    download({ workKey: w.key, kind: "other", index })
                  }
                >
                  Retención / comprobante {index + 1}
                </button>
              ))}
            </div>
          ))}
          {view?.financial
            .filter((r: any) => r.kind !== "invoice")
            .map((r: any) => (
              <div key={r.id} className={box}>
                <p>
                  {r.date} · {r.title || "Comprobante de operación"} ·{" "}
                  {money(r.totalCents / 100, r.currency || "ARS")}{" "}
                  {r.status === "cancelled" ? "· Anulado" : ""}
                </p>
                {r.hasFile && (
                  <button
                    disabled={busy}
                    className="mt-2 underline"
                    onClick={() => download({ recordId: r.id })}
                  >
                    Descargar original de la operación
                  </button>
                )}
              </div>
            ))}
          <p className="text-xs text-slate-500">
            Una aplicación distribuida y su comprobante corresponden al mismo
            pago. Los registros mostrados no sustituyen la conciliación
            administrativa.
          </p>
        </section>
      )}
      {tab === "Documentos" && (
        <section className="space-y-3">
          {docs.map((d) => (
            <div className={box} key={d.id}>
              <div className="flex flex-wrap justify-between gap-2">
                <h2 className="font-semibold">{d.title}</h2>
                <span className="text-sm">
                  {d.signed
                    ? "Firmado por vos"
                    : status[d.status] || "Pendiente"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <button
                  disabled={busy}
                  className="underline"
                  onClick={() =>
                    run(async () => {
                      downloadPortalFile(
                        await portalRequest({
                          action: "signingFile",
                          requestId: d.id,
                          projectId: d.projectId,
                          documentId: d.documentId,
                          artifact: "original",
                        }),
                      );
                    })
                  }
                >
                  Original
                </button>
                {d.signed && !d.artifactsReady && (
                  <button
                    disabled={busy}
                    className="underline"
                    onClick={() =>
                      run(async () => {
                        await signPortalDocument(d, { dni: "", typedName: "" });
                        if (d.portalManaged && d.providerId)
                          await portalRequest({
                            action: "completeDeclaration",
                            providerId: d.providerId,
                            declarationId: d.documentId,
                          });
                        await load();
                      })
                    }
                  >
                    Completar PDF de firma
                  </button>
                )}
                {!d.signed && (
                  <button
                    className="rounded bg-slate-900 px-3 py-2 text-white"
                    onClick={() => setSigning(d)}
                  >
                    Revisar y firmar
                  </button>
                )}
                {d.signed && d.portalManaged && providerId && (
                  <button
                    disabled={busy}
                    className="underline"
                    onClick={() =>
                      run(async () => {
                        await portalRequest({
                          action: "completeDeclaration",
                          providerId: d.providerId || providerId,
                          declarationId: d.documentId,
                        });
                        await load();
                      })
                    }
                  >
                    Aplicar declaración firmada
                  </button>
                )}
                {d.artifactsReady &&
                  ["signed", "certificate"].map((a) => (
                    <button
                      disabled={busy}
                      key={a}
                      className="underline"
                      onClick={() =>
                        run(async () => {
                          downloadPortalFile(
                            await portalRequest({
                              action: "signingFile",
                              requestId: d.id,
                              projectId: d.projectId,
                              documentId: d.documentId,
                              artifact: a,
                            }),
                          );
                        })
                      }
                    >
                      {a === "signed"
                        ? "PDF firmado"
                        : "Certificado de evidencia"}
                    </button>
                  ))}
              </div>
            </div>
          ))}
          {view?.declarations.map((d: any) => (
            <div className={box} key={d.id}>
              <p className="font-semibold">
                {d.kind === "profile"
                  ? "Cambios de datos"
                  : d.kind === "third_party"
                    ? "Quién factura y cobra por mí"
                    : "Representación"}{" "}
                · {status[d.status] || d.status}
              </p>
              {d.content.changes &&
                Object.entries(d.content.changes).map(([key, c]: any) => (
                  <p key={key} className="mt-1 text-sm">
                    {labels[key] || key}: {c.before || "Sin dato"} →{" "}
                    {c.after || "Sin dato"}{" "}
                    {c.critical
                      ? "· Requiere revisión"
                      : "· Aplicación tras firma"}
                  </p>
                ))}
              {d.kind === "third_party" && (
                <>
                  <p className="text-sm">
                    {d.content.party.name} · CUIT {d.content.party.cuit} · Hasta{" "}
                    {d.content.expiresOn}
                  </p>
                  {["active", "pending_review"].includes(d.status) && (
                    <button
                      disabled={busy}
                      className="mt-2 text-sm underline"
                      onClick={() =>
                        run(async () => {
                          if (
                            !confirm(
                              "¿Revocar para operaciones futuras? Se conserva la historia.",
                            )
                          )
                            return;
                          await portalRequest({
                            action: "revokeThirdParty",
                            providerId,
                            declarationId: d.id,
                          });
                          await load();
                        })
                      }
                    >
                      Revocar autorización
                    </button>
                  )}
                </>
              )}
              {d.owned && d.status === "pending_signature" && (
                <button
                  disabled={busy}
                  className="mt-2 text-sm underline"
                  onClick={() =>
                    run(async () => {
                      await portalRequest({
                        action: "completeDeclaration",
                        providerId,
                        declarationId: d.id,
                      });
                      await load();
                    })
                  }
                >
                  Comprobar firma y aplicar
                </button>
              )}
            </div>
          ))}
          {!docs.length && !view?.declarations.length && (
            <p className={box}>No tenés documentos asignados.</p>
          )}
        </section>
      )}
      {tab === "Mis datos" && view && (
        <>
          <section className={box + " mb-4 space-y-2"}>
            <h2 className="font-bold">Mi cuenta de acceso</h2>
            <p className="text-sm">
              {user?.email}. Usá tu cuenta personal de Google para ingresar y
              firmar documentos.
            </p>
            <p className="text-xs text-slate-500">
              Si el correo registrado es anterior o no coincide, solicitá su
              revisión a administración. El cambio de cuenta requiere verificar
              nuevamente a quién pertenece.
            </p>
          </section>
          <form
            className={box + " space-y-4"}
            onSubmit={(e) => {
              e.preventDefault();
              void prepare("prepareProfile", { changes: draft });
            }}
          >
            <h2 className="font-bold">Datos vigentes</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(labels)
                .filter(([key]) =>
                  view.provider.type === "empresa"
                    ? !["name", "lastName", "dni"].includes(key)
                    : key !== "businessName",
                )
                .map(([key, label]) => (
                  <label key={key} className="text-sm">
                    {label}
                    <input
                      className="mt-1 block w-full rounded border p-2"
                      value={draft[key] ?? view.provider[key] ?? ""}
                      readOnly={key === "email"}
                      onChange={(e) =>
                        setDraft({ ...draft, [key]: e.target.value })
                      }
                    />
                  </label>
                ))}
            </div>
            <p className="text-sm text-slate-500">
              El correo personal requiere una revisión para cambiar de cuenta. CUIT,
              identidad y cuenta bancaria conservan sus valores vigentes hasta
              la aprobación administrativa.
            </p>
            <button
              disabled={busy || !Object.keys(draft).length}
              className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-40"
            >
              Revisar cambios y firmar
            </button>
          </form>
          <form
            className={box + " space-y-3"}
            onSubmit={(e) => {
              e.preventDefault();
              void prepare("prepareThirdParty", party);
            }}
          >
            <h2 className="font-bold">Quién factura y cobra por mí</h2>
            <p className="text-sm text-slate-600">
              Si interviene otra persona, identificála y elegí los trabajos. La
              autorización de cobro y el encuadre de facturación se revisan por
              separado.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries({
                name: "Nombre o razón social del tercero",
                cuit: "CUIT del tercero",
                email: "Correo del tercero",
                holder: "Titular de la cuenta",
                cbu: "CBU/CVU",
                alias: "Alias",
                expiresOn: "Vigente hasta",
              }).map(([key, label]) => (
                <label key={key} className="text-sm">
                  {label}
                  <input
                    required={["name", "cuit", "expiresOn"].includes(key)}
                    type={key === "expiresOn" ? "date" : "text"}
                    className="mt-1 block w-full rounded border p-2"
                    value={party[key]}
                    onChange={(e) =>
                      setParty({ ...party, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
            <div className="flex gap-4">
              {[
                ["invoice", "Propongo que facture"],
                ["payment", "Autorizo que cobre"],
              ].map(([role, label]) => (
                <label className="text-sm" key={role}>
                  <input
                    type="checkbox"
                    checked={party.roles.includes(role)}
                    onChange={(e) =>
                      setParty({
                        ...party,
                        roles: e.target.checked
                          ? [...party.roles, role]
                          : party.roles.filter((r: string) => r !== role),
                      })
                    }
                  />{" "}
                  {label}
                </label>
              ))}
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-semibold">
                Trabajos alcanzados
              </legend>
              {view.works.map((w: any) => (
                <label className="block text-sm" key={w.key}>
                  <input
                    type="checkbox"
                    checked={party.workKeys.includes(w.key)}
                    onChange={(e) =>
                      setParty({
                        ...party,
                        workKeys: e.target.checked
                          ? [...party.workKeys, w.key]
                          : party.workKeys.filter((k: string) => k !== w.key),
                      })
                    }
                  />{" "}
                  {w.projectName} · {w.description}
                </label>
              ))}
            </fieldset>
            <button
              disabled={busy || !party.roles.length || !party.workKeys.length}
              className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-40"
            >
              Revisar autorización y firmar
            </button>
          </form>
        </>
      )}
      {signing && (
        <PortalSignDialog
          document={signing}
          onClose={() => setSigning(null)}
          onSigned={finish}
        />
      )}
    </div>
  );
}
