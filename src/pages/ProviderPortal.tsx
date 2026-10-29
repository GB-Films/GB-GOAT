import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  downloadPortalFile,
  portalRequest,
  signPortalDocument,
} from "../lib/providerPortal";
import PortalSignDialog from "../components/PortalSignDialog";
import { ThirdPartyAuthorizationForm } from "../components/ThirdPartyAuthorizationForm";
import { CompanyRepresentationForm } from "../components/CompanyRepresentationForm";
import { thirdPartyFormDefaults } from '../lib/thirdPartyDefaults';
import { ProviderProfileForm } from '../components/ProviderProfileForm';
import { ProviderConfirmationNotice } from '../components/ProviderConfirmationNotice';
import { switchProviderGoogleAccount, verifyProviderGoogleAccount } from '../lib/providerGoogleAccount';
import { ProviderDeclarationCard } from '../components/ProviderDeclarationCard';
import { declarationCompletionMessage, declarationDocument } from '../lib/providerDeclarationUi';

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
  birthDate: "Fecha de nacimiento",
  cuit: "CUIT",
  address: "Domicilio",
  phone: "Teléfono",
  email: "Correo personal de tu cuenta Google",
  bankAccount_cbu: "Tu CBU/CVU propio",
  bankAccount_alias: "Tu alias propio",
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
  const [searchParams] = useSearchParams();
  const [hasLoaded, setHasLoaded] = useState(false);
  const loadRevision = useRef(0),
    attempts = useRef(new Map<string, string>());
  const preparationRevision = useRef(0), documentRevision = useRef(0);
  const [documentsLoading, setDocumentsLoading] = useState(false), [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [profileNotice, setProfileNotice] = useState('');
  const [members, setMembers] = useState<any[]>([]),
    [providerId, setProviderId] = useState(() => searchParams.get("provider") || ""),
    [view, setView] = useState<any>(null),
    [docs, setDocs] = useState<any[]>([]),
    [tab, setTab] = useState(tabs[0]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [signing, setSigning] = useState<any>(null),
    [draft, setDraft] = useState<Record<string, string>>({}),
    [uploadWork, setUploadWork] = useState("");
  const [party, setParty] = useState<any>(() => thirdPartyFormDefaults(null));
  const selectedProviderRef = useRef(providerId);
  const selected = members.find((m) => m.providerId === providerId);
  const intakePrefilled = useRef("");
  useEffect(() => {
    const key = `${user?.uid}/${providerId}`;
    if (!view || intakePrefilled.current === key) return;
    intakePrefilled.current = key;
    setParty(thirdPartyFormDefaults(view));
    if (view.thirdPartyIntake && !view.declarations.some((d: any) => d.kind === 'third_party')) setTab('Mis datos');
  }, [view, providerId, user?.uid]);
  const load = useCallback(async () => {
    const revision = ++loadRevision.current;
    try {
      const b = await portalRequest({ action: "bootstrap", includeDocuments: false });
      if (revision !== loadRevision.current) return false;
      setHasLoaded(true);
      setMembers(b.memberships);
      const chosen =
        b.memberships.find((m: any) => m.providerId === selectedProviderRef.current) ||
        b.memberships[0];
      if (chosen?.providerId !== selectedProviderRef.current) { selectedProviderRef.current = chosen?.providerId || ''; setProviderId(chosen?.providerId || ''); }
      if (chosen?.status === "active") {
        const result = await portalRequest({
          action: "overview",
          providerId: chosen.providerId,
        });
        if (revision === loadRevision.current) setView(result); else return false;
      } else setView(null);
      return true;
    } catch (e: any) {
      if (revision === loadRevision.current) setError(e.message);
      return false;
    }
  }, []);
  const loadDocuments = useCallback(async () => {
    const revision = ++documentRevision.current;
    setDocumentsLoading(true);
    try { const result = await portalRequest({ action: 'myDocuments' }); if (revision === documentRevision.current) { setDocs(result.documents); setDocumentsLoaded(true); } }
    catch (error: any) { if (revision === documentRevision.current) setError(error.message); }
    finally { if (revision === documentRevision.current) setDocumentsLoading(false); }
  }, []);
  useEffect(() => {
    loadRevision.current++; documentRevision.current++; preparationRevision.current++;
    setHasLoaded(false); setMembers([]); setView(null); setDocs([]); setDocumentsLoaded(false); setDraft({}); setSigning(null); intakePrefilled.current = '';
    if (!user?.uid) return;
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => { window.clearInterval(timer); loadRevision.current++; };
  }, [load, user?.uid, user?.email]);
  useEffect(() => { if (tab !== 'Documentos' || !user?.uid) return; void loadDocuments(); const timer = window.setInterval(() => void loadDocuments(), 30000); return () => { window.clearInterval(timer); documentRevision.current++; }; }, [tab, loadDocuments, user?.uid]);
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
      { const result = await portalRequest({
        action: "completeDeclaration",
        providerId: signing.providerId,
        declarationId: signing.documentId,
      });
      if (signing.declarationKind === 'profile') { setTab('Mis datos'); setProfileNotice(result.confirmation
        ? 'Datos confirmados, firma guardada y cambios aplicados.' : 'Cambios firmados y aplicados.'); } }
    if (await load()) setDraft({});
    await loadDocuments();
  }
  async function prepare(action: string, input: any) {
    const revision = ++preparationRevision.current;
    const key = JSON.stringify([providerId, action, input]);
    if (!attempts.current.has(key))
      attempts.current.set(key, crypto.randomUUID());
    setSigning({ preparing: true, title: action === 'prepareProfile' ? input.confirmProfile ? 'Confirmación de mis datos' : 'Actualización de mis datos' : 'Preparando declaración' });
    await run(async () => {
      try {
      const result = await portalRequest({
        action,
        providerId,
        attemptId: attempts.current.get(key),
        ...input,
      });
      let d = result.signingDocument;
      if (!d) { const b = await portalRequest({ action: 'myDocuments' }); setDocs(b.documents); d = b.documents.find((d: any) => d.documentId === result.id); }
      if (!d)
        throw Error(
          "La declaración quedó preparada. Actualizá Documentos para firmarla.",
        );
      if (revision !== preparationRevision.current) return;
      setSigning({ ...d, originalFile: result.originalFile });
      setTab("Documentos");
      } catch (error) { if (revision === preparationRevision.current) setSigning(null); throw error; }
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
                intakePrefilled.current = "";
                loadRevision.current++;
                setView(null);
                setSigning(null);
                preparationRevision.current++;
                setProfileNotice('');
                setUploadWork("");
                setProviderId(e.target.value);
                selectedProviderRef.current = e.target.value;
                setDraft({});
                setParty(thirdPartyFormDefaults(null));
                void load();
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
      {hasLoaded && !members.length && !error && <section className={box + ' space-y-3'}>
        <h2 className="font-semibold">¿Te registraste con otro correo?</h2>
        <p className="text-sm text-slate-600">Ingresá con esa cuenta Google para encontrar tu ficha. Después, en Mis datos, podrás elegir qué correo usar.</p>
        <button type="button" disabled={busy} className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 disabled:opacity-40" onClick={() => run(switchProviderGoogleAccount)}>Ingresar con otra cuenta Google</button>
        <p className="text-xs text-slate-500">Si ya no tenés acceso a ese correo, pedí a administración que revise la vinculación de tu ficha.</p>
      </section>}
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
      {selected?.status === 'needs_confirmation' && selected?.type === 'empresa' && <div key={`${providerId}/${docs.filter(d => d.providerId === providerId && d.signed).length}`}><CompanyRepresentationForm providerId={providerId} email={user?.email || ''} busy={busy} onPrepare={input => prepare('prepareRepresentation', input)} /></div>}
      {selected?.status === 'needs_confirmation' && selected?.type !== 'empresa' && (
        <p role="status" className={box}>Administración debe revisar la clasificación de esta ficha para activar el acceso. No necesitás firmar una declaración de representación.</p>
      )}
      {view && <ProviderConfirmationNotice status={view.profileConfirmation?.status} onReview={() => setTab('Mis datos')} />}
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
              {!hasLoaded || (selected?.status === 'active' && !view) ? 'Cargando tus datos…' : 'No hay trabajos para mostrar con esta representación.'}
            </p>
          )}
        </section>
      )}
      {tab === "Facturas" && (
        <section className="space-y-3">
          {view && (
            <div className={box}>
              <h2 className="font-bold">Cargar factura</h2>
              {view.works.some((w: any) => w.thirdPartyPayoutRequired) && <p className="mt-2 text-sm text-slate-600">Las facturas de trabajos con un tercero autorizado se registran por administración contra el CUIT y la cuenta revisados, desde la ficha completa.</p>}
              <select
                aria-label="Trabajo de la factura"
                className="my-2 w-full rounded border p-2"
                value={uploadWork}
                onChange={(e) => setUploadWork(e.target.value)}
              >
                <option value="">Elegí un trabajo</option>
                {view.works.map((w: any) => (
                  <option key={w.key} value={w.key} disabled={w.thirdPartyPayoutRequired}>
                    {w.thirdPartyPayoutRequired ? 'Factura de tercero: gestión administrativa · ' : ''}{w.projectName} · {w.description}
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
                  {r.number || r.title || 'Factura'}{r.issuerName && ` · ${r.issuerName}`}
                  {r.totalCents != null && <> · {money(r.totalCents / 100, r.currency || "ARS")}</>}{" "}
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
                  {r.totalCents != null && money(r.totalCents / 100, r.currency || "ARS")}{" "}
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
          {documentsLoading && <p role="status" className={box}>Consultando documentos…</p>}
          {docs.filter(d => !view?.declarations.some((declaration: any) => declarationDocument(declaration, [d], providerId))).map((d) => (
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
          {!!view?.declarations.length && <div className="pt-3"><h2 className="font-bold">Declaraciones de esta ficha</h2><p className="text-sm text-slate-600">Cada constancia conserva su estado e historia. Los antecedentes no reemplazan los datos actuales de tu ficha.</p></div>}
          {view?.declarations.map((d: any) => {
            const document = declarationDocument(d, docs, providerId);
            return <ProviderDeclarationCard key={`${providerId}/${d.id}`} declaration={d} document={document} providerType={view.provider.type} busy={busy}
              onSign={() => { if (document) setSigning(document); }}
              onReviewData={() => setTab('Mis datos')}
              onDownload={async artifact => {
                if (!document) throw Error('El documento no está disponible para esta cuenta.');
                downloadPortalFile(await portalRequest({ action: 'signingFile', requestId: document.id, projectId: document.projectId, documentId: document.documentId, artifact }));
              }}
              onComplete={async recover => {
                setBusy(true);
                try {
                  if (recover && document) await signPortalDocument(document, { dni: '', typedName: '' });
                  const result = await portalRequest({ action: 'completeDeclaration', providerId, declarationId: d.id });
                  return declarationCompletionMessage(d.kind, result.status);
                } finally { await Promise.all([load(), loadDocuments()]); setBusy(false); }
              }}>
              {d.content.changes &&
                Object.entries(d.content.changes).map(([key, c]: any) => (
                  <p key={key} className="mt-1 text-sm">
                    {labels[key] || key}: {c.before || "Sin dato"} →{" "}
                    {c.after || "Sin dato"}{" "}
                    {d.kind !== 'profile' && (c.critical ? '· Requiere revisión' : '· Aplicación tras firma')}
                  </p>
                ))}
              {d.kind === "third_party" && (
                <>
                  <p className="text-sm">
                    {d.content.party.name} · CUIT {d.content.party.cuit} · {d.content.validity === 'until_revoked' ? 'Hasta revocación · sólo estos trabajos' : `Hasta ${d.content.expiresOn}`}
                  </p>
                  {d.content.party.relationship && <p className="text-sm">Relación con el prestador: {d.content.party.relationship}</p>}
                  {d.content.party.activity && <p className="text-sm">Actividad declarada del tercero: {d.content.party.activity}</p>}
                  <p className="text-sm">Cuenta del titular de la factura: {d.content.party.cbu || d.content.party.alias}</p>
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
            </ProviderDeclarationCard>;
          })}
          {documentsLoaded && !documentsLoading && !docs.length && !view?.declarations.length && (
            <p className={box}>No tenés documentos asignados.</p>
          )}
        </section>
      )}
      {tab === "Mis datos" && view && (
        <>
          {view.provider.type === 'empresa' && <div key={providerId}><CompanyRepresentationForm providerId={providerId} email={user?.email || ''} busy={busy} onPrepare={input => prepare('prepareRepresentation', input)} /></div>}
          <div key={providerId}><ProviderProfileForm provider={view.provider} declarations={view.declarations} labels={labels} draft={draft} onChange={setDraft} busy={busy} notice={profileNotice} confirmationRequired={view.profileConfirmation?.status === 'required'} accessEmail={user?.email || ''} onVerifyAccount={email => verifyProviderGoogleAccount(providerId, email)} onPrepare={input => prepare('prepareProfile', input)} onApplySigned={id => run(async () => { await portalRequest({ action: 'completeDeclaration', providerId, declarationId: id }); setProfileNotice('Datos firmados y aplicados.'); if (await load()) setDraft({}); })} /></div>
          {view.provider.type === 'persona' && <ThirdPartyAuthorizationForm provider={view.provider} works={view.works} party={party} onChange={setParty} busy={busy}
            recovered={!!view.thirdPartyDefaults || !!view.thirdPartyIntake}
            onSave={async input => { await portalRequest({ action: 'saveThirdPartyDetails', providerId, ...input }); await load(); }}
            onPrepare={input => prepare('prepareThirdParty', input)} />}

        </>
      )}
      {signing && (
        <PortalSignDialog
          document={signing}
          onClose={() => { preparationRevision.current++; setSigning(null); }}
          onSigned={finish}
        />
      )}
    </div>
  );
}
