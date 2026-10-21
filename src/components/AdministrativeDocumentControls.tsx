import { useRef, useState } from 'react';
import { FileUp, ExternalLink } from 'lucide-react';
import { administrativeDocumentKinds, type AdministrativeDocument, type AdministrativeDocumentKind } from '../lib/administrativeDocuments';

type Upload = (file: File, kind: AdministrativeDocumentKind, title: string) => Promise<AdministrativeDocument>;

export function AdministrativeDocumentUpload({ kind, title, upload, uploading, onUploaded }: {
  kind: AdministrativeDocumentKind;
  title: string;
  upload: Upload;
  uploading: boolean;
  onUploaded?: (document: AdministrativeDocument) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  return <div>
    <button type="button" disabled={uploading} onClick={() => input.current?.click()}
      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800 transition-colors hover:bg-blue-100 disabled:opacity-50">
      <FileUp className="h-4 w-4" />{uploading ? 'Cargando…' : 'Adjuntar archivo'}
    </button>
    <input ref={input} className="hidden" type="file" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx"
      onChange={async event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        setError(''); setDone('');
        try {
          const document = await upload(file, kind, title || file.name);
          onUploaded?.(document);
          setDone(`${file.name} cargado`);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'No se pudo cargar el archivo.');
        }
      }} />
    {(error || done) && <p role="status" className={`mt-1 text-xs ${error ? 'text-rose-700' : 'text-emerald-700'}`}>{error || done}</p>}
  </div>;
}

export function AdministrativeDocumentList({ documents, loading, error, open }: {
  documents: AdministrativeDocument[];
  loading: boolean;
  error: string;
  open: (document: AdministrativeDocument) => Promise<void>;
}) {
  return <div className="space-y-2">
    {loading && <p className="text-xs text-slate-500">Cargando documentos…</p>}
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    {!loading && documents.length === 0 && <p className="text-xs text-slate-500">Todavía no hay archivos cargados.</p>}
    {documents.map(document => <div key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="min-w-0"><p className="truncate text-xs font-bold text-slate-800">{document.title || document.originalFileName}</p>
        <p className="text-[11px] text-slate-500">{administrativeDocumentKinds[document.kind] || 'Documento'} · {document.originalFileName}</p></div>
      <button type="button" onClick={() => void open(document)} className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:underline"><ExternalLink className="h-3.5 w-3.5" />Abrir</button>
    </div>)}
  </div>;
}
