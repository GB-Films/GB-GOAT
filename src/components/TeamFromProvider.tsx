import { useRef, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { portalAdminRequest } from '../lib/providerPortal';
import { portalErrorMessage } from '../lib/providerPortalUi';
import { GLOBAL_ROLES, roleLabel } from '../lib/roles';

export type TeamProviderCandidate = { providerId: string; name: string; email: string; available: boolean; reason: string };
export type TeamProviderPreview = { providerId: string; name: string; email: string; role?: string; alreadyMember: boolean; fingerprint: string;
  projects: { id: string; name: string; owner: boolean; role: string; areas: string[] }[] };

export function teamProviderError(error: any, phase: 'search' | 'preview' | 'assign') {
  if (/network|unavailable|deadline-exceeded|internal|aborted/.test(error?.code || '')) {
    if (phase === 'assign') return 'No pudimos confirmar la incorporación. Volvé a intentar con la misma persona y rol: si ya se guardó, no se duplicará.';
    return phase === 'search' ? 'No pudimos buscar personas. Revisá la conexión y volvé a buscar.' : 'No pudimos comprobar la cuenta y sus permisos. Revisá la conexión y volvé a seleccionar a la persona.';
  }
  return portalErrorMessage(error);
}

export function TeamProviderSelection({ preview, isOwner, role, confirmProjects, busy, onRole, onConfirm, onAssign, onExisting }: {
  preview: TeamProviderPreview; isOwner: boolean; role: string; confirmProjects: boolean; busy: boolean;
  onRole: (role: string) => void; onConfirm: (checked: boolean) => void; onAssign: () => void; onExisting: () => void;
}) {
  return <section aria-label="Persona y rol a incorporar" className="mt-4 space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
    <div><h3 className="font-semibold text-slate-900">{preview.name}</h3><p className="break-all text-sm text-slate-600">{preview.email}</p></div>
    {preview.alreadyMember || preview.role === 'admin' && !isOwner ? <><p className="text-sm text-slate-600">{preview.alreadyMember ? `Ya está en el equipo como ${roleLabel(preview.role)}. Podés revisar su rol en la lista.` : 'Sólo la cuenta dueña puede modificar el acceso de un administrador general.'}</p><button type="button" className="rounded-lg border bg-white px-3 py-2 text-sm" onClick={onExisting}>Ver en equipo</button></> : <>
      <label className="block text-sm font-medium text-slate-700">Rol en GOAT
        <select className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2" value={role} disabled={busy} onChange={e => onRole(e.target.value)}>
          {GLOBAL_ROLES.map(value => <option key={value} value={value} disabled={value === 'admin' && !isOwner}>{roleLabel(value)}</option>)}
        </select>
      </label>
      {!!preview.projects.length && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <p className="font-medium">Ya tenía estas asignaciones:</p>
        <ul className="mt-2 space-y-1">{preview.projects.map(p => <li key={p.id}><strong>{p.name}</strong> · {p.owner ? 'Creador del proyecto' : ({ admin: 'Admin del proyecto', jefe_produccion: 'Jefe de Producción', jefe_area: 'Jefe de Área' }[p.role] || p.role)}{p.areas.length ? ` · ${p.areas.join(', ')}` : ''}</li>)}</ul>
        <label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={confirmProjects} disabled={busy} onChange={e => onConfirm(e.target.checked)} /><span>Revisé y quiero conservar estas asignaciones de proyecto.</span></label>
      </div>}
      <p className="text-xs text-slate-500">Entrará con este mismo correo Google, sin repetir el alta. {role === 'admin' ? 'Como administrador general tendrá acceso completo a la app y a todos los proyectos.' : 'Los nuevos proyectos se asignan por separado.'}</p>
      <button type="button" className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || !!preview.projects.length && !confirmProjects} onClick={onAssign}><UserPlus className="h-4 w-4" />{busy ? 'Incorporando…' : 'Incorporar al equipo'}</button>
    </>}
  </section>;
}

export function TeamFromProvider({ isOwner, onAssigned, request = portalAdminRequest }: {
  isOwner: boolean; onAssigned: (email: string) => Promise<void>; request?: typeof portalAdminRequest;
}) {
  const [search, setSearch] = useState(''), [candidates, setCandidates] = useState<TeamProviderCandidate[] | null>(null);
  const [preview, setPreview] = useState<TeamProviderPreview | null>(null), [role, setRole] = useState('colaborador'), [confirmProjects, setConfirmProjects] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const revision = useRef(0), requestId = useRef(''), locked = useRef(false);
  async function find() {
    if (locked.current || search.trim().length < 2) return;
    const version = ++revision.current; setBusy('search'); setError(''); setNotice(''); setPreview(null); setCandidates(null);
    try { const result = await request({ action: 'teamProviderCandidates', search: search.trim() });
      if (!Array.isArray(result.candidates)) throw Error('No recibimos la búsqueda. Volvé a intentar.');
      if (version === revision.current) setCandidates(result.candidates);
    } catch (error) { if (version === revision.current) setError(teamProviderError(error, 'search')); }
    finally { if (version === revision.current) setBusy(''); }
  }
  async function select(providerId: string) {
    if (locked.current) return;
    const version = ++revision.current; setBusy('preview'); setError(''); setNotice(''); setPreview(null); setConfirmProjects(false); setRole('colaborador');
    try { const result = await request({ action: 'teamProviderPreview', providerId });
      if (!result.fingerprint || !Array.isArray(result.projects)) throw Error('No pudimos comprobar la persona elegida. Volvé a seleccionarla.');
      if (version === revision.current) { setPreview(result); requestId.current = crypto.randomUUID(); }
    } catch (error) { if (version === revision.current) setError(teamProviderError(error, 'preview')); }
    finally { if (version === revision.current) setBusy(''); }
  }
  async function assign() {
    if (locked.current || !preview || preview.alreadyMember || preview.projects.length && !confirmProjects) return;
    locked.current = true; const version = ++revision.current; setBusy('assign'); setError(''); setNotice('');
    try {
      const result = await request({ action: 'teamAssignProvider', providerId: preview.providerId, role,
        fingerprint: preview.fingerprint, requestId: requestId.current, confirmExistingProjects: confirmProjects });
      if (!result.assigned && !result.alreadyMember) throw Error('No recibimos la confirmación. Actualizá Equipo antes de reintentar.');
      if (version !== revision.current) return;
      setNotice(`${preview.name} ya está en el equipo como ${roleLabel(result.role)}. Puede entrar con ${result.email}; si tiene GOAT abierto, debe actualizar la página.`);
      setPreview(null); setCandidates(null);
      try { await onAssigned(result.email); }
      catch { setError('La persona ya quedó incorporada, pero no pudimos actualizar la lista. Recargá Equipo.'); }
    } catch (error) { if (version === revision.current) setError(teamProviderError(error, 'assign')); }
    finally { locked.current = false; if (version === revision.current) setBusy(''); }
  }
  return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Incorporar proveedor al equipo">
    <h2 className="font-semibold text-slate-900">Incorporar una persona dada de alta</h2>
    <p className="mt-1 text-sm text-slate-500">Buscá su ficha de proveedor y asignale un rol en GOAT.</p>
    <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={e => { e.preventDefault(); void find(); }}>
      <label className="flex-1 text-sm text-slate-600"><span className="sr-only">Nombre, apellido o correo del proveedor</span><input type="search" maxLength={120} value={search} disabled={busy === 'assign'} onChange={e => { revision.current++; setSearch(e.target.value); setCandidates(null); setPreview(null); setBusy(''); setError(''); setNotice(''); }} placeholder="Nombre, apellido o correo" className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5" /></label>
      <button type="submit" disabled={!!busy || search.trim().length < 2} className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium disabled:opacity-40"><Search className="h-4 w-4" />{busy === 'search' ? 'Buscando…' : 'Buscar persona'}</button>
    </form>
    {candidates && !candidates.length && <p className="mt-3 text-sm text-slate-500">No encontramos personas con ese nombre o correo.</p>}
    {!!candidates?.length && <ul className="mt-3 max-h-72 divide-y overflow-y-auto rounded-lg border border-slate-200">{candidates.map(p => <li key={p.providerId}>
      <button type="button" disabled={!p.available || busy === 'assign'} onClick={() => void select(p.providerId)} className={`block w-full p-3 text-left text-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${preview?.providerId === p.providerId ? 'bg-blue-50' : ''}`}><span className="block font-medium text-slate-900">{p.name}</span><span className="block break-all text-xs text-slate-500">{p.email || 'Sin correo de acceso'}{p.reason ? ` · ${p.reason}` : ''}</span></button>
    </li>)}</ul>}
    {busy === 'preview' && <p role="status" className="mt-3 text-sm text-slate-500">Comprobando cuenta y permisos…</p>}
    {preview && <TeamProviderSelection preview={preview} isOwner={isOwner} role={role} confirmProjects={confirmProjects} busy={busy === 'assign'}
      onRole={value => { setRole(value); requestId.current = crypto.randomUUID(); }} onConfirm={setConfirmProjects} onAssign={() => void assign()}
      onExisting={() => { void onAssigned(preview.email).catch(() => setError('No pudimos actualizar la lista del equipo. Recargá la página.')); }} />}
    {error && <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
    {notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
  </section>;
}
