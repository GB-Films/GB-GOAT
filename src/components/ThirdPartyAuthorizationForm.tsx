import { useId, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { groupPortalWorks, type PortalWork } from './ProviderWorkList';
import { portalErrorMessage } from '../lib/providerPortalUi';
import { thirdPartyPartyFields, type ThirdPartyChoice } from '../lib/thirdPartyDefaults';

type RevocableAuthorization = { id: string; name: string; workCount: number; scope: string };
type FormParty = { name: string; cuit: string; account: string; workKeys: string[]; responsibilityConfirmed: boolean };
const maxWorks = 50;
const fields = [
  { key: 'name', label: 'Nombre o razón social', maxLength: 160 },
  { key: 'cuit', label: 'CUIT', maxLength: 30, inputMode: 'numeric' },
  { key: 'account', label: 'CBU/CVU o alias', maxLength: 100 },
] as const;

export function ThirdPartyAuthorizationForm({ works, party, onChange, onPrepare, onSave, busy, embedded = false,
  choices = [], authorizations = [], onRevoke, revocationNotice }: {
  works: PortalWork[]; party: FormParty; onChange: (party: FormParty) => void; onPrepare: (input: any) => Promise<void>;
  onSave?: (input: any) => Promise<void>; busy: boolean; embedded?: boolean;
  choices?: ThirdPartyChoice[]; authorizations?: RevocableAuthorization[];
  onRevoke?: (id: string) => void; revocationNotice?: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const feedbackId = useId();
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const projects = groupPortalWorks(works);
  const visible = new Set(works.map(work => work.key));
  const selected = new Set(party.workKeys.filter(key => visible.has(key)));
  const selectionChanged = selected.size !== party.workKeys.length;
  const choiceIndex = choices.findIndex(choice => {
    const fields = thirdPartyPartyFields(choice.party);
    return fields.name === party.name && fields.cuit === party.cuit && fields.account === party.account;
  });
  const details = () => {
    const account = party.account.trim();
    return { name: party.name.trim(), cuit: party.cuit.trim(), holder: party.name.trim(), holderCuit: party.cuit.trim(),
      cbu: /^\d+$/.test(account) ? account : '', alias: /^\d+$/.test(account) ? '' : account };
  };
  const selectWorks = (keys: string[], checked: boolean) => {
    const next = new Set(selected);
    for (const key of keys) {
      if (checked) next.add(key);
      else next.delete(key);
    }
    if (next.size > maxWorks) { setError('Podés incluir hasta 50 trabajos por permiso. Elegí menos trabajos y prepará otro permiso para los demás.'); return; }
    setError('');
    onChange({ ...party, workKeys: [...next], responsibilityConfirmed: false });
  };
  const workLabel = `${selected.size} ${selected.size === 1 ? 'trabajo seleccionado' : 'trabajos seleccionados'}`;
  return <form ref={form} className="space-y-3 sm:space-y-4" onSubmit={async event => {
    event.preventDefault();
    if (busy || saving || selectionChanged || !selected.size || !party.responsibilityConfirmed) return;
    setError(''); setNotice('');
    try { await onPrepare({ ...details(), responsibilityConfirmed: true, roles: ['invoice', 'payment'], workKeys: [...selected].sort() }); }
    catch (error) { setError(portalErrorMessage(error as Error)); }
  }}>
    {!embedded && <h2 className="font-bold">Quién factura y cobra por mí</h2>}
    <p className="text-sm text-slate-600">Elegí quién emitirá la factura y recibirá la transferencia en su cuenta. El permiso se aplica al firmar y cubre únicamente los trabajos que marques.</p>
    {revocationNotice && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{revocationNotice}</p>}
    {onRevoke && authorizations.length > 0 && <section aria-label="Permisos vigentes" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <h3 className="text-sm font-semibold text-slate-900">Permisos vigentes o por aplicar</h3>
      <ul className="mt-1 divide-y divide-slate-200">{authorizations.map(({ id, name, workCount, scope }) => <li key={id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
        <div className="min-w-0"><p className="break-words font-medium">{name}</p><p className="text-xs text-slate-600">{workCount} {workCount === 1 ? 'trabajo' : 'trabajos'}{scope && ` · ${scope}`}</p></div>
        <button type="button" disabled={busy || saving} onClick={() => onRevoke(id)} className="portal-button">Revocar permiso</button>
      </li>)}</ul>
    </section>}
    <fieldset disabled={busy || saving} className="min-w-0 space-y-2 rounded-xl border border-slate-200 p-3 sm:p-4">
      <legend className="px-1.5 text-sm font-semibold">Elegí el tercero</legend>
      {!!choices.length && <label className="grid min-w-0 gap-1 text-sm">
        Terceros que ya cargaste
        <select className="h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-base sm:text-sm" value={choiceIndex === -1 ? '' : String(choiceIndex)}
          onChange={event => {
            const choice = event.target.value === '' ? undefined : choices[Number(event.target.value)];
            setError(''); setSaveError(''); setNotice('');
            onChange({ ...party, ...thirdPartyPartyFields(choice?.party), responsibilityConfirmed: false });
          }}>
          <option value="">Cargar otro tercero</option>
          {choices.map(({ party, source }, index) => <option key={index} value={index}>{party.name} · {party.cbu ? `Cuenta terminada en ${party.cbu.slice(-4)}` : party.alias} · {source === 'signed' ? 'Usado en un permiso firmado' : 'Datos cargados'}</option>)}
        </select>
        <span className="text-xs text-slate-600">Al elegirlo se completan su nombre, CUIT y cuenta. Revisalos antes de seguir.</span>
      </label>}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.35fr_.85fr_1.15fr]">
        {fields.map(field => <label key={field.key} className="grid min-w-0 content-start gap-1 text-sm">
          <span>{field.label}</span>
          <input required type="text" maxLength={field.maxLength} inputMode={'inputMode' in field ? field.inputMode : undefined}
            className="h-10 w-full rounded-lg border border-slate-300 px-2.5 text-base sm:text-sm" value={party[field.key] || ''}
            onChange={event => { setNotice(''); setError(''); setSaveError(''); onChange({ ...party, [field.key]: event.target.value, responsibilityConfirmed: false }); }} />
        </label>)}
      </div>
      <p className="text-xs text-slate-600">La cuenta debe corresponder al titular de la factura. Tu cuenta propia se conserva en Mis datos.</p>
      {onSave && <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || saving} className="portal-button"
          onClick={async () => {
            if (!form.current?.reportValidity()) return;
            setSaveError(''); setNotice(''); setSaving(true);
            try { await onSave(details()); setNotice('Datos guardados. Podés elegir este tercero en un próximo permiso.'); }
            catch (error) { setSaveError(portalErrorMessage(error as Error)); }
            finally { setSaving(false); }
          }}>{saving ? 'Guardando…' : 'Guardar datos del tercero'}</button>
        <span className="text-xs text-slate-600">Para reutilizarlos más adelante. El permiso se otorga con la firma.</span>
      </div>}
      {notice && <p role="status" className="text-sm text-emerald-800">{notice}</p>}
      {saveError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{saveError}</p>}
    </fieldset>
    <fieldset disabled={busy || saving} className="min-w-0 space-y-2 rounded-xl border border-slate-200 p-3 sm:p-4">
      <legend className="px-1.5 text-sm font-semibold">Elegí los trabajos</legend>
      {selectionChanged && <div role="status" className="space-y-1 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
        <p>Algún trabajo seleccionado ya no está disponible. Revisá la lista para continuar.</p>
        <button type="button" className="portal-button" onClick={() => selectWorks([], false)}>Actualizar selección</button>
      </div>}
      {projects.length ? <>
        <p className="text-xs text-slate-600">Abrí un proyecto y marcá los trabajos. Podés incluir todos los que aparecen en ese proyecto.</p>
        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
          {projects.map(project => {
            const keys = project.works.map(work => work.key);
            const count = keys.filter(key => selected.has(key)).length;
            return <details key={project.id} open={projects.length === 1 || undefined} className="group/work">
              <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-sm hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-slate-500 group-open/work:rotate-90" />
                <span className="min-w-0 flex-1 break-words font-medium">{project.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-slate-600">{count} de {keys.length}</span>
              </summary>
              <ul className="divide-y divide-slate-100 border-t border-slate-200 px-2.5">
                {keys.length > 1 && <li><label className="flex min-h-10 cursor-pointer items-center gap-2 py-2 text-xs font-medium text-slate-700">
                  <input type="checkbox" className="size-4 shrink-0" checked={count === keys.length}
                    ref={input => { if (input) input.indeterminate = count > 0 && count < keys.length; }}
                    onChange={event => selectWorks(keys, event.target.checked)} />
                  Todos los trabajos de {project.name}
                </label></li>}
                {project.works.map(work => <li key={work.key}><label className="flex min-h-10 cursor-pointer items-center gap-2 py-2 text-sm">
                  <input type="checkbox" className="size-4 shrink-0" checked={selected.has(work.key)}
                    onChange={event => selectWorks([work.key], event.target.checked)} />
                  <span className="min-w-0 break-words">{work.description || 'Trabajo sin descripción'}{work.area && <span className="block text-xs text-slate-600">{work.area}</span>}</span>
                </label></li>)}
              </ul>
            </details>;
          })}
        </div>
        <p aria-live="polite" className="text-sm font-medium">{workLabel}</p>
      </> : <p className="text-sm text-slate-600">Cuando producción cargue un trabajo a tu nombre, va a aparecer en Trabajos y vas a poder elegirlo acá. Ya podés guardar los datos del tercero.</p>}
    </fieldset>
    {!!projects.length && <fieldset disabled={busy || saving} className="min-w-0 space-y-2 rounded-xl border border-slate-200 p-3 sm:p-4">
      <legend className="px-1.5 text-sm font-semibold">Revisá y firmá</legend>
      <p className="text-xs text-slate-600">La firma aplica el permiso sin revisión administrativa. Para sumar otros trabajos del mismo proyecto o de otro, creá un nuevo permiso. Podés revocarlo desde acá o en Documentos.</p>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 shrink-0" disabled={!selected.size} checked={!!party.responsibilityConfirmed && !!selected.size}
          onChange={event => onChange({ ...party, responsibilityConfirmed: event.target.checked })} />
        <span>Autorizo, bajo mi responsabilidad, que este tercero facture y cobre los trabajos seleccionados en su cuenta.</span>
      </label>
      <button type="submit" aria-describedby={feedbackId} disabled={selectionChanged || !party.responsibilityConfirmed || !selected.size} className="portal-button portal-button-primary max-sm:w-full">Revisar y firmar</button>
      <p id={feedbackId} className="text-xs text-slate-600">{!selected.size ? 'Elegí al menos un trabajo.' : !party.responsibilityConfirmed ? 'Marcá la casilla para seguir.' : 'Se abrirá la declaración con los datos y los trabajos elegidos.'}</p>
    </fieldset>}
    {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
  </form>;
}
