import { useEffect, useState } from 'react';
import { portalAdminRequest } from '../lib/providerPortal';

export type ProviderAdministrationState = { providerId: string; active: boolean; canEnable: boolean; contactEmail: string };

export function ProviderAdministrationControls({ state, email, onEmail, busy, onSave }: {
  state: ProviderAdministrationState; email: string; onEmail: (email: string) => void; busy: boolean; onSave: (enabled: boolean) => void;
}) {
  return <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm" aria-label="Gestión de la ficha">
    <div><h3 className="font-semibold text-slate-800">{state.active ? 'Ficha administrativa · no requiere alta' : 'Gestión de la ficha'}</h3>
      <p className="mt-1 text-slate-600">{state.active ? 'Administración mantiene los datos de esta empresa. No tiene acceso al portal ni necesita completar el alta.'
        : 'Para empresas institucionales que sólo se registran en gastos y documentos, como aseguradoras o servicios.'}</p></div>
    {(state.canEnable || state.active) ? <fieldset disabled={busy} className="space-y-3">
      <label className="block text-xs font-medium text-slate-600">Contacto interno (opcional)<input type="email" maxLength={300} value={email} onChange={event => onEmail(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 text-sm" /></label>
      <p className="text-xs text-slate-500">Este correo es de contacto; no habilita a representar a la empresa.</p>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className="portal-button" onClick={() => onSave(true)}>{busy ? 'Guardando…' : state.active ? 'Guardar contacto interno' : 'Usar ficha administrativa'}</button>
        {state.active && <button type="button" disabled={busy} className="portal-button" onClick={() => onSave(false)}>Volver a alta por proveedor</button>}</div>
      {state.active && <p className="text-xs text-slate-500">Volver al alta no asigna cuentas ni permisos de acceso.</p>}
    </fieldset> : <p className="text-xs text-slate-500">Esta empresa ya tiene un alta propia. Su acceso se gestiona desde Accesos de proveedores.</p>}
  </section>;
}

export function ProviderAdministrationPanel({ providerId, onState, onChanged }: {
  providerId: string; onState: (state: ProviderAdministrationState | null) => void; onChanged?: () => void;
}) {
  const [state, setState] = useState<ProviderAdministrationState | null>(null), [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true; setState(null); setError(''); setNotice(''); onState(null);
    portalAdminRequest({ action: 'administrativeProviderState', providerId }).then(result => {
      if (!active) return; setState(result); setEmail(result.contactEmail); onState(result);
    }).catch(() => { if (active) setError('No pudimos consultar la gestión de esta ficha. Cerrá y volvé a abrirla.'); });
    return () => { active = false; };
  }, [providerId, onState]);
  async function save(enabled: boolean) {
    if (busy || !state) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await portalAdminRequest({ action: 'setAdministrativeProvider', providerId, enabled, contactEmail: email });
      setState(result); setEmail(result.contactEmail); onState(result);
      setNotice(result.active ? 'Ficha administrativa guardada. No requiere alta.' : 'La ficha vuelve al alta por proveedor. No se habilitó ningún acceso.');
      window.dispatchEvent(new CustomEvent('provider-administration-changed', { detail: { providerId } })); onChanged?.();
    } catch (error: any) { setError(error.message || 'No pudimos guardar la gestión de la ficha.'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2">
    {state ? <ProviderAdministrationControls state={state} email={email} onEmail={setEmail} busy={busy} onSave={enabled => void save(enabled)} /> : !error && <p className="text-xs text-slate-500">Consultando gestión de la ficha…</p>}
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
  </div>;
}
