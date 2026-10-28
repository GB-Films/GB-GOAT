import { useState, type FormEvent } from 'react';
import { Upload } from 'lucide-react';
import { DOCUMENT_CATEGORIES, DOCUMENT_UPLOAD_TYPES, type DocumentCategory } from '../../lib/projectDocumentCatalog';
import { ProjectDialog } from './ProjectDialog';

export function ProjectDocumentUpload({ initialCategory, providers, areas, busy, onClose, onSubmit }: {
  initialCategory: DocumentCategory; providers: Array<{ id: string; label: string }>; areas: string[]; busy: boolean;
  onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [category, setCategory] = useState(initialCategory);
  const input = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-blue-500';
  const label = 'block space-y-1.5 text-xs font-semibold text-slate-600';
  return <ProjectDialog title="Subir documento" onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={onSubmit}><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
      <label className={label}>Categoría<select value={category} onChange={event => setCategory(event.target.value as DocumentCategory)} className={input}>
        {DOCUMENT_CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      <input type="hidden" name="family" value={category === 'comprobantes' ? 'finanzas' : category} />
      <label className={label}>Tipo<select name="subtype" key={category} className={input}>
        {DOCUMENT_UPLOAD_TYPES[category].map(item => <option key={item} value={item}>{item}</option>)}
      </select></label>
      <label className={`${label} sm:col-span-2`}>Título<input name="title" className={input} placeholder="Nombre del documento" /></label>
      <label className={label}>Proveedor<select name="providerId" className={input}>
        <option value="">Sin proveedor</option>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
      </select></label>
      <label className={label}>Área<select name="area" className={input}><option value="">General</option>{areas.map(area => <option key={area} value={area}>{area}</option>)}</select></label>
      <label className={`${label} sm:col-span-2`}>Archivo<input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" required className={input} /></label>
      <label className={label}>Vencimiento (opcional)<input name="expirationDate" type="date" className={input} /></label>
      <label className={label}>Notas (opcional)<input name="notes" className={input} /></label>
      <div className="mt-1 flex justify-end gap-2 sm:col-span-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
        <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><Upload className="h-4 w-4" />{busy ? 'Subiendo…' : 'Subir documento'}</button>
      </div>
    </fieldset></form>
  </ProjectDialog>;
}
