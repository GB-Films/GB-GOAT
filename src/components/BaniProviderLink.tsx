import { useEffect, useRef, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth } from '../lib/firebase';

type Person = { id: string; name: string };
type Lookup = { linkedContact: Person | null; candidates: Person[] };
const endpoint = () => httpsCallable(getFunctions(auth.app, 'us-central1'), 'manageBaniProviderLink');
const problem = (error: unknown) => error instanceof Error ? error.message : 'No se pudo consultar el vínculo.';

export default function BaniProviderLink({ providerId, providerName, onClose }: { providerId: string; providerName: string; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [matched, setMatched] = useState<Lookup>({linkedContact:null,candidates:[]});
  const [selected, setSelected] = useState<Person|null>(null);
  const [busy, setBusy] = useState(true);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  async function find(queryValue = '') {
    const run = ++sequence.current;
    setBusy(true); setError(''); setSelected(null);
    try {
      const response = await endpoint()({action:'find',providerId,query:queryValue});
      if (run === sequence.current) { setMatched(response.data as Lookup); setSearched(Boolean(queryValue)); }
    } catch (err) {
      if (run === sequence.current) {setMatched({linkedContact:null,candidates:[]});setError(problem(err));}
    } finally { if (run === sequence.current) setBusy(false); }
  }
  useEffect(() => { void find(); return () => { sequence.current++; }; }, [providerId]);
  async function link() {
    if (!selected || busy) return;
    setBusy(true); setError('');
    try {
      await endpoint()({action:'link',providerId,memberId:selected.id});
      await find();
    } catch (err) { setError(problem(err)); setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="bani-provider-heading" className="w-full max-w-lg space-y-4 rounded-xl border bg-white p-5 shadow-xl">
        <div className="flex justify-between gap-2">
          <div><h2 id="bani-provider-heading" className="text-lg font-bold">Vincular con BANI LAB</h2><p className="text-sm text-slate-600">{providerName}</p></div>
          <button type="button" className="rounded border px-3 text-sm" onClick={onClose}>Cerrar</button>
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {matched.linkedContact ? <p role="status" className="rounded bg-emerald-50 p-3 text-sm">Vinculado a {matched.linkedContact.name}.</p> : <>
          <p className="text-sm text-slate-600">Elegí un contacto existente de BANI LAB. Se sincronizan el nombre y el rubro; los datos fiscales, bancarios y de pagos quedan en GOAT.</p>
          <form className="flex gap-2" onSubmit={event => {event.preventDefault();void find(query.trim());}}>
            <input aria-label="Buscar contacto de BANI LAB" disabled={busy} value={query} onChange={event=>{setQuery(event.target.value);setSelected(null);setMatched({linkedContact:null,candidates:[]});setSearched(false);}} className="min-w-0 flex-1 rounded border p-2" />
            <button disabled={busy||query.trim().length<3} type="submit" className="rounded border px-3 disabled:opacity-50">Buscar</button>
          </form>
          {busy && <p role="status" className="text-sm">Consultando…</p>}
          {!busy&&searched&&!error&&matched.candidates.length===0&&<p className="text-sm">No se encontraron contactos. No se creó ni vinculó ninguna ficha.</p>}
          {matched.candidates.length>0&&<fieldset className="max-h-56 space-y-2 overflow-auto">
            <legend className="text-sm font-semibold">Contacto de BANI LAB</legend>
            {matched.candidates.map(p=><label key={p.id} className="flex items-center gap-2 rounded border p-2 text-sm"><input type="radio" name="baniLinkContact" checked={selected?.id===p.id} onChange={()=>setSelected(p)}/>{p.name} <code className="text-xs text-slate-500">{p.id.slice(-8)}</code></label>)}
          </fieldset>}
          <button type="button" disabled={!selected||busy} onClick={()=>void link()} className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">Confirmar vínculo</button>
        </>}
      </section>
    </div>
  );
}
