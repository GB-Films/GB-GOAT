import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  downloadPortalFile,
  portalRequest,
  signPortalDocument,
} from "../lib/providerPortal";
import { ProviderInvoiceUpload } from "../components/ProviderInvoiceUpload";
import PortalSignDialog from "../components/PortalSignDialog";
import { ThirdPartyAuthorizationForm } from "../components/ThirdPartyAuthorizationForm";
import { CompanyRepresentationForm } from "../components/CompanyRepresentationForm";
import { thirdPartyFormDefaults } from '../lib/thirdPartyDefaults';
import { ProviderProfileForm } from '../components/ProviderProfileForm';
import { ProviderConfirmationNotice } from '../components/ProviderConfirmationNotice';
import { switchProviderGoogleAccount, verifyProviderGoogleAccount } from '../lib/providerGoogleAccount';
import { declarationCompletionMessage, portalDeclarationCompletionInput, type DeclarationDocument } from '../lib/providerDeclarationUi';
import { ProviderSigningGuide } from '../components/ProviderSigningGuide';
import { ProviderPortalDocuments } from '../components/ProviderPortalDocuments';
import { pendingPortalSignatureCount, portalErrorMessage, representsAnotherProvider } from '../lib/providerPortalUi';
import { BriefcaseBusiness, FileText, Wallet, FolderPen, UserRound } from 'lucide-react';

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
const money = (value: number, currency = "ARS") =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(
    value || 0,
  );
const box = 'portal-panel';
const tabIcons = [BriefcaseBusiness, FileText, Wallet, FolderPen, UserRound];
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
    [draft, setDraft] = useState<Record<string, string>>({});
  const [party, setParty] = useState<any>(() => thirdPartyFormDefaults(null));
  const selectedProviderRef = useRef(providerId);
  const selected = members.find((m) => m.providerId === providerId);
  const pendingCount = pendingPortalSignatureCount(docs);
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
      if (revision === loadRevision.current) setError(portalErrorMessage(e));
      return false;
    }
  }, []);
  const loadDocuments = useCallback(async () => {
    const revision = ++documentRevision.current;
    setDocumentsLoading(true);
    try { const result = await portalRequest({ action: 'myDocuments' }); if (revision === documentRevision.current) { setDocs(result.documents); setDocumentsLoaded(true); } }
    catch (error: any) { if (revision === documentRevision.current) setError(portalErrorMessage(error)); }
    finally { if (revision === documentRevision.current) setDocumentsLoading(false); }
  }, []);
  useEffect(() => {
    loadRevision.current++; documentRevision.current++; preparationRevision.current++;
    setHasLoaded(false); setMembers([]); setView(null); setDocs([]); setDocumentsLoaded(false); setDraft({}); setSigning(null); intakePrefilled.current = '';
    if (!user?.uid) return;
    void load(); void loadDocuments();
    const timer = window.setInterval(() => { if (!document.hidden) { void load(); void loadDocuments(); } }, 30000);
    return () => { window.clearInterval(timer); loadRevision.current++; };
  }, [load, loadDocuments, user?.uid, user?.email]);
  useEffect(() => { if (tab === 'Documentos' && user?.uid) void loadDocuments(); }, [tab, loadDocuments, user?.uid]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e: any) {
      setError(portalErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    const completion = portalDeclarationCompletionInput(signing);
    if (completion)
      { const result = await portalRequest(completion);
      if (signing.declarationKind === 'profile') { reviewProfileData(); setProfileNotice(result.confirmation
        ? 'Datos confirmados, firma guardada y cambios aplicados.' : 'Cambios firmados y aplicados.'); }
      if (signing.declarationKind === 'representation') { setTab('Documentos'); setProfileNotice(result.status === 'applied'
        ? 'Declaración firmada. Tu representación quedó habilitada; los contratos asignados aparecen en Documentos.'
        : 'La firma de esta presentación anterior quedó guardada. Completá la nueva declaración de representación para habilitarte sin esperar una revisión.'); }
      if (signing.declarationKind === 'third_party') { setTab('Documentos'); setProfileNotice(declarationCompletionMessage('third_party', result.status)); } }
    else { setTab('Documentos'); setProfileNotice('Tu firma quedó guardada. Consultá el estado del contrato y sus constancias aquí. Si faltan otras firmas, se indicará en el documento.'); }
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
  function reviewCompanyRepresentation() {
    setTab('Mis datos');
    window.requestAnimationFrame(() => { const form = document.getElementById('company-representation-form'); form?.closest('details')?.setAttribute('open', ''); form?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  }
  function reviewProfileData() {
    setTab('Mis datos');
    window.requestAnimationFrame(() => { const section = document.getElementById('provider-profile-details'); section?.setAttribute('open', ''); section?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  }
  async function applyDeclaration(id: string, kind: string, doc?: DeclarationDocument, recover = false) {
    setBusy(true);
    try {
      if (recover && doc) await signPortalDocument(doc, { dni: '', typedName: '' });
      const result = await portalRequest({ action: 'completeDeclaration', providerId: doc?.providerId || providerId, declarationId: id });
      const message = declarationCompletionMessage(kind, result.status);
      if (kind === 'profile') { setProfileNotice(message); if (result.status === 'applied') setDraft({}); }
      return message;
    } finally { await Promise.all([load(), loadDocuments()]); setBusy(false); }
  }
  return (
    <div className="provider-portal mx-auto max-w-6xl space-y-5 p-2 sm:p-5">
      <header className={box}>
        <h1 className="text-2xl font-bold tracking-tight">Mi proveedor</h1>
        <p className="mt-2 text-sm text-slate-600">
          {user?.displayName && <span className="mr-2 font-medium text-slate-800">{user.displayName}</span>}<span className="break-all">{user?.email}</span>
        </p>
        {members.length > 1 ? (
          <label className="mt-3 block text-sm">
            Ficha de proveedor
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
                setError('');
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
        ) : !members.length ? (
          <p className="mt-3 text-sm">
            {hasLoaded && !error
              ? "Tu cuenta no tiene una ficha de proveedor asociada. Podés consultar tus documentos asignados; para vincular una ficha, contactá a administración."
              : error
                ? "No pudimos comprobar tu representación."
                : "Consultando tu cuenta…"}
          </p>
        ) : representsAnotherProvider(selected) ? <p className="mt-3 text-sm text-slate-600">Representás a <strong className="text-slate-900">{selected.name}</strong></p> : null}
        {user?.email && <ProviderSigningGuide email={user.email} needsRepresentation={selected?.status === 'needs_confirmation' && selected?.type === 'empresa'} pendingCount={pendingCount} onDocuments={() => { setError(''); setTab('Documentos'); }} />}
      </header>
      {hasLoaded && !members.length && !error && <section className={box + ' space-y-3'}>
        <h2 className="font-semibold">¿Te registraste con otro correo?</h2>
        <p className="text-sm text-slate-600">Ingresá con esa cuenta Google para encontrar tu ficha. Después, en Mis datos, podrás elegir qué correo usar.</p>
        <button type="button" disabled={busy} className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 disabled:opacity-40" onClick={() => run(switchProviderGoogleAccount)}>Ingresar con otra cuenta Google</button>
        <p className="text-xs text-slate-500">Si ya no tenés acceso a ese correo, pedí a administración que revise la vinculación de tu ficha.</p>
      </section>}
      {error && (
        <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          {error}
          <button
            className="portal-button ml-3"
            onClick={() => {
              setError("");
              void load();
              void loadDocuments();
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
      {view && tab !== 'Mis datos' && <ProviderConfirmationNotice status={view.profileConfirmation?.status} onReview={reviewProfileData} />}
      <nav
        aria-label="Secciones del proveedor"
        className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm shadow-slate-200/20"
      >
        {tabs.map((t, index) => { const Icon = tabIcons[index]; const pending = t === 'Documentos' && pendingCount > 0; return (
          <button
            key={t}
            type="button"
            aria-current={tab === t ? 'page' : undefined}
            aria-label={pending ? `Documentos: ${pendingCount} pendientes de tu firma` : t}
            onClick={() => { setError(''); setTab(t); }}
            className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-colors sm:px-4 ${pending ? `bg-amber-100 text-amber-950 hover:bg-amber-200 ${tab === t ? 'ring-2 ring-inset ring-amber-400' : ''}` : tab === t ? 'bg-slate-900 text-white hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{t}{pending && <span className="flex min-w-5 items-center justify-center rounded-full bg-amber-400 px-1.5 text-xs font-bold leading-5 text-amber-950" aria-hidden="true">{pendingCount}</span>}
          </button>
        ); })}
      </nav>
      {tab === "Trabajos" && (
        <section className="space-y-3">
          <div><h2 className="text-lg font-semibold">Tus trabajos</h2><p className="mt-1 text-sm text-slate-500">Importes y pagos registrados de cada trabajo.</p></div>
          {view?.works.map((w: any) => (
            <article key={w.key} className={box}>
              <h2 className="font-bold">{w.projectName}</h2>
              <p className="text-sm text-slate-600">{w.description}</p>
              <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-2">
                <span><span className="mb-1 block text-xs text-slate-500">Importe del trabajo</span><strong className="text-lg">{money(w.total, w.currency)}</strong></span>
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
              {!hasLoaded || (selected?.status === 'active' && !view) ? 'Cargando tus datos…' : 'Todavía no tenés trabajos asignados.'}
            </p>
          )}
        </section>
      )}
      {tab === "Facturas" && (
        <section className="space-y-3">
          <div><h2 className="text-lg font-semibold">Tus facturas</h2><p className="mt-1 text-sm text-slate-500">Adjuntá tu factura al trabajo correspondiente.</p></div>
          {!view && <p className={box + ' text-sm text-slate-500'}>{!hasLoaded ? 'Cargando tus facturas…' : 'Tus facturas aparecerán al habilitar la ficha de proveedor.'}</p>}
          {view && <div key={`${user?.uid}/${providerId}`}><ProviderInvoiceUpload providerId={providerId} works={view.works} onUploaded={load} /></div>}
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
                      className="portal-button mr-2 mt-2"
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
                    className="portal-button mr-2 mt-2"
                    onClick={() => download({ recordId: r.id })}
                  >
                    Descargar original
                  </button>
                )}
              </div>
            ))}
          {view && !view.works.some((w: any) => w.invoiceCount > 0) && !view.financial.some((r: any) => r.kind === 'invoice') && <p className={box + ' text-sm text-slate-500'}>Todavía no hay facturas registradas.</p>}
        </section>
      )}
      {tab === "Pagos y retenciones" && (
        <section className="space-y-3">
          <div><h2 className="text-lg font-semibold">Pagos y retenciones</h2><p className="mt-1 text-sm text-slate-500">Consultá los movimientos y descargá sus comprobantes.</p></div>
          {!view && <p className={box + ' text-sm text-slate-500'}>{!hasLoaded ? 'Cargando tus pagos…' : 'Tus pagos aparecerán al habilitar la ficha de proveedor.'}</p>}
          {view?.works.filter((w: any) => w.payments.length || w.otherCount || w.markedPaidWithoutDetails).map((w: any) => (
            <div className={box} key={w.key}>
              <h2 className="font-semibold">
                {w.projectName} · {w.description}
              </h2>
              {w.markedPaidWithoutDetails && <p className="mt-2 text-sm text-slate-500">Marcado como pagado. Todavía no hay un comprobante cargado.</p>}
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
                      className="portal-button mr-2 mt-2"
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
                  className="portal-button mr-2 mt-2"
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
                    className="portal-button mr-2 mt-2"
                    onClick={() => download({ recordId: r.id })}
                  >
                    Descargar original de la operación
                  </button>
                )}
              </div>
            ))}
          {view && !view.works.some((w: any) => w.payments.length || w.otherCount || w.markedPaidWithoutDetails) && !view.financial.some((r: any) => r.kind !== 'invoice') && <p className={box + ' text-sm text-slate-500'}>Todavía no hay pagos ni retenciones registrados.</p>}
          {view?.works.some((w: any) => w.payments.some((p: any) => p.sharedRecordId)) && <p className="text-xs text-slate-500">Las aplicaciones de un pago distribuido forman parte del mismo pago.</p>}
        </section>
      )}
      {tab === "Documentos" && <ProviderPortalDocuments documents={docs} declarations={view?.declarations || []} providerId={providerId} providerType={selected?.type || ''} provider={view?.provider}
        busy={busy} loading={documentsLoading} loaded={documentsLoaded} notice={profileNotice} labels={labels}
        onRefresh={() => { void load(); void loadDocuments(); }} onSign={setSigning} onReviewData={reviewProfileData} onReviewCompany={reviewCompanyRepresentation}
        onDownload={(doc, artifact) => run(async () => { downloadPortalFile(await portalRequest({ action: 'signingFile', requestId: doc.id, projectId: doc.projectId, documentId: doc.documentId, artifact })); })}
        onRecover={doc => run(async () => { await signPortalDocument(doc, { dni: '', typedName: '' }); const completion = portalDeclarationCompletionInput(doc); if (completion) await portalRequest(completion); await load(); await loadDocuments(); })}
        onApply={applyDeclaration}
        onApplyDocument={doc => run(async () => { setProfileNotice(await applyDeclaration(doc.documentId, doc.declarationKind, doc)); })}
        onRevoke={id => { if (confirm('¿Revocar para operaciones futuras? Se conserva la historia.')) void run(async () => { await portalRequest({ action: 'revokeThirdParty', providerId, declarationId: id }); await load(); }); }}
      />}
      {tab === "Mis datos" && view && (
        <>
          <div key={providerId}><ProviderProfileForm provider={view.provider} declarations={view.declarations} labels={labels} draft={draft} onChange={setDraft} busy={busy} notice={profileNotice} confirmationRequired={view.profileConfirmation?.status === 'required'} accessEmail={user?.email || ''} onVerifyAccount={email => verifyProviderGoogleAccount(providerId, email)} onPrepare={input => prepare('prepareProfile', input)} onApplySigned={async id => { await applyDeclaration(id, 'profile'); }} /></div>
          {view.provider.type === 'empresa' && <details className="portal-details portal-panel" key={`company/${providerId}`}><summary>Tu representación de la empresa</summary><div className="mt-4"><CompanyRepresentationForm providerId={providerId} email={user?.email || ''} busy={busy} onPrepare={input => prepare('prepareRepresentation', input)} /></div></details>}
          {view.provider.type === 'persona' && <details className="portal-details portal-panel"><summary>Quién factura y cobra por mí</summary><div className="mt-4"><ThirdPartyAuthorizationForm embedded provider={view.provider} works={view.works} party={party} onChange={setParty} busy={busy}
            recovered={!!view.thirdPartyDefaults || !!view.thirdPartyIntake}
            onSave={async input => { await portalRequest({ action: 'saveThirdPartyDetails', providerId, ...input }); await load(); }}
            onPrepare={input => prepare('prepareThirdParty', input)} /></div></details>}

        </>
      )}
      {tab === 'Mis datos' && !view && <p className={box + ' text-sm text-slate-500'}>{!hasLoaded ? 'Cargando tus datos…' : 'Tus datos aparecerán al habilitar la ficha de proveedor.'}</p>}
      {signing && (
        <PortalSignDialog
          document={signing}
          onClose={() => { preparationRevision.current++; setSigning(null); void load(); void loadDocuments(); }}
          onSigned={finish}
        />
      )}
    </div>
  );
}
