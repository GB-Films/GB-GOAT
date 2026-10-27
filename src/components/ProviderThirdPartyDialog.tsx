import { useEffect, useRef, useState } from "react";
import { thirdPartyDraftErrors, type ThirdPartyDraft } from "../lib/providerThirdParty";

export function ProviderThirdPartyEntry({ providerType, enabled, name, error, disabled, onOpen, onOwn }: {
  providerType: string; enabled: boolean; name: string; error?: string; disabled?: boolean; onOpen: () => void; onOwn: () => void;
}) {
  if (providerType !== "persona") return null;
  return <div className="space-y-2">
    <button type="button" className="text-sm font-medium text-blue-700 underline underline-offset-2" disabled={disabled} onClick={onOpen}>{enabled ? "Editar quién va a facturar" : "No puedo emitir factura"}</button>
    {enabled && <><p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">Proponés a {name} para facturar y cobrar. La solicitud queda pendiente de tu firma y de revisión administrativa.</p><button type="button" disabled={disabled} className="block text-xs text-slate-500 underline" onClick={onOwn}>Voy a facturar y cobrar por mi cuenta</button></>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}

export function ProviderThirdPartyDialog({ draft, onChange, onClose, onSave }: {
  draft: ThirdPartyDraft;
  onChange: (draft: ThirdPartyDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const [showErrors, setShowErrors] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const errors = showErrors ? thirdPartyDraftErrors(draft) : {};
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <div className="fixed inset-0 z-[1100] grid place-items-center bg-slate-950/60 p-3" onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    if (event.key === "Tab") {
      const controls = Array.from(dialog.current?.querySelectorAll("button,input,textarea") || []) as HTMLElement[];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="third-party-intake-title" className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
      <div className="flex items-start justify-between gap-3"><h2 id="third-party-intake-title" className="text-lg font-bold">¿Quién va a emitir la factura?</h2><button type="button" className="rounded border px-3 py-2 text-sm" onClick={onClose}>Cerrar</button></div>
      <p className="my-3 text-sm text-slate-600">Vos seguís siendo el prestador del servicio. Identificá a quien proponés para facturar y recibir el pago. Después vas a firmar una declaración y administración revisará la solicitud.</p>
      <div className="grid gap-3 sm:grid-cols-2">{Object.entries({ name: "Nombre o razón social de quien factura", relationship: "Relación con vos", activity: "Servicio o actividad que realiza esa persona", cuit: "CUIT de quien factura", holder: "Titular de la cuenta del tercero", cbu: "CBU/CVU del tercero", alias: "Alias del tercero" }).map(([key, label]) => <label key={key} className={`block text-sm ${key === "activity" || key === "name" ? "sm:col-span-2" : ""}`}>{label}
        <input className={`mt-1 block w-full rounded-lg border p-3 text-base ${errors[key] ? "border-red-400 bg-red-50" : "border-slate-300"}`} aria-invalid={!!errors[key]} inputMode={["cuit", "cbu"].includes(key) ? "numeric" : "text"} value={draft[key]} onChange={e => onChange({ ...draft, [key]: e.target.value })} />
        {errors[key] && <span className="text-xs text-red-700">{errors[key]}</span>}
      </label>)}</div>
      <p className="mt-3 text-xs text-slate-500">Indicá la actividad de esta persona por separado del servicio que realizás vos, identificado en tu categoría y en el trabajo. Usá CBU/CVU o alias; no hace falta completar ambos.</p>
      <button type="button" className="mt-4 w-full rounded-xl bg-slate-950 px-4 py-3 font-semibold text-white" onClick={() => {
        setShowErrors(true);
        if (Object.keys(thirdPartyDraftErrors(draft)).length) { requestAnimationFrame(() => dialog.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()); return; }
        onSave();
      }}>Guardar y continuar el alta</button>
      <p className="mt-2 text-xs text-slate-500">Guardar estos datos todavía no autoriza facturación ni pagos.</p>
    </div>
  </div>;
}
