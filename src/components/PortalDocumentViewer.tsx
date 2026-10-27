import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PortalSignatureField } from "../lib/portalSigning";

type Props = {
  url: string;
  fields: PortalSignatureField[];
  selectedFieldId: string;
  signatureImage: string;
  signatureName: string;
  onSelectField: (id: string) => void;
  onPageCount: (count: number) => void;
  onReady: (ready: boolean) => void;
  onRetry: () => void;
};

export function PortalDocumentViewer({ url, fields, selectedFieldId, signatureImage, signatureName, onSelectField, onPageCount, onReady, onRetry }: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [pageSize, setPageSize] = useState({ width: 595, height: 842 });
  const [fit, setFit] = useState<"page" | "width">("page");
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  const [rendered, setRendered] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scale = Math.max(0.1, Math.min(
    Math.max(1, size.width - 32) / pageSize.width,
    fit === "page" ? Math.max(1, size.height - 32) / pageSize.height : Infinity,
  ) * zoom);
  const width = pageSize.width * scale, height = pageSize.height * scale;

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof import("pdfjs-dist")["getDocument"]> | undefined;
    setPdf(null); setError(""); setRendered(false); onReady(false); onPageCount(0); setPageNumber(1);
    if (url) void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        task = pdfjs.getDocument({ url });
        const loaded = await task.promise;
        if (cancelled) return;
        onPageCount(loaded.numPages); setPdf(loaded);
      } catch (e) {
        if (!cancelled) setError("No pudimos mostrar el PDF. Volvé a cargar el documento para revisarlo antes de firmar.");
      }
    })();
    return () => { cancelled = true; void task?.destroy(); };
  }, [url, onReady, onPageCount]);

  useEffect(() => {
    if (!pdf || !size.width || !size.height) return;
    let cancelled = false;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    setRendered(false); onReady(false);
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const original = page.getViewport({ scale: 1 });
        if (original.width !== pageSize.width || original.height !== pageSize.height) {
          setPageSize({ width: original.width, height: original.height });
          return;
        }
        const target = canvas.current;
        if (!target) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const renderViewport = page.getViewport({ scale: scale * ratio });
        target.width = Math.ceil(renderViewport.width); target.height = Math.ceil(renderViewport.height);
        render = page.render({ canvas: target, viewport: renderViewport });
        await render.promise;
        if (!cancelled) { setRendered(true); setError(""); onReady(true); }
      } catch (e: any) {
        if (!cancelled && e.name !== "RenderingCancelledException") {
          setError("No pudimos mostrar esta página. Volvé a cargar el documento antes de firmar.");
        }
      }
    })();
    return () => { cancelled = true; render?.cancel(); };
  }, [pdf, pageNumber, scale, pageSize.width, pageSize.height, size.width, size.height, onReady]);

  function goToPage(page: number) {
    setPageNumber(page);
    viewport.current?.scrollTo({ top: 0, left: 0 });
  }

  return <section className="portal-pdf" aria-label="Documento a firmar">
    <div className="portal-pdf-toolbar" aria-label="Controles del documento">
      <div className="portal-pdf-control-group">
        <button type="button" aria-label="Página anterior" disabled={!pdf || pageNumber === 1} onClick={() => goToPage(pageNumber - 1)}>‹</button>
        <span aria-live="polite">Página {pageNumber} de {pdf?.numPages || "…"}</span>
        <button type="button" aria-label="Página siguiente" disabled={!pdf || pageNumber === pdf.numPages} onClick={() => goToPage(pageNumber + 1)}>›</button>
      </div>
      <div className="portal-pdf-control-group">
        <button type="button" aria-label="Alejar documento" disabled={!pdf || zoom <= .5} onClick={() => setZoom(z => Math.max(.5, z - .25))}>−</button>
        <button type="button" aria-label="Acercar documento" disabled={!pdf || zoom >= 3} onClick={() => setZoom(z => Math.min(3, z + .25))}>+</button>
        <select aria-label="Ajuste del documento" value={fit} onChange={e => { setFit(e.target.value as "page" | "width"); setZoom(1); }}>
          <option value="page">Hoja completa</option><option value="width">Ajustar al ancho</option>
        </select>
      </div>
      <div className="portal-pdf-control-group">
        <select aria-label="Ir a mi recuadro de firma" value="" disabled={!pdf || !fields.length} onChange={e => { const field = fields.find(f => f.id === e.target.value); if (field) goToPage(field.page); }}>
          <option value="" disabled>Ir a mi recuadro</option>
          {fields.map((field, index) => <option key={field.id} value={field.id}>Recuadro {index + 1} · página {field.page}</option>)}
        </select>
        {url && <a href={url} target="_blank" rel="noreferrer">Abrir PDF</a>}
      </div>
    </div>
    <div ref={viewport} className="portal-pdf-viewport" data-testid="pdf-viewport" aria-busy={!rendered && !error}>
      {error ? <div className="portal-sign-error"><p role="alert">{error}</p><button type="button" onClick={onRetry}>Volver a cargar</button></div> : <>
        {!rendered && <p role="status" className="portal-pdf-loading">Cargando documento…</p>}
        <div className="portal-pdf-sheet" style={{ width, height, visibility: rendered ? "visible" : "hidden" }}>
          <canvas ref={canvas} role="img" aria-label={`Documento, página ${pageNumber}`} style={{ width, height }} />
          {fields.filter(f => f.page === pageNumber).map((field, index) => <button
            key={field.id} type="button" className={`portal-sign-field ${selectedFieldId === field.id ? "is-selected" : ""}`}
            aria-label={`Seleccionar mi recuadro de firma ${index + 1}, página ${field.page}`}
            aria-pressed={selectedFieldId === field.id} data-signature-field-id={field.id}
            style={{ left: `${field.x * 100}%`, top: `${field.y * 100}%`, width: `${field.w * 100}%`, height: `${field.h * 100}%` }}
            onClick={() => onSelectField(field.id)}>
            {selectedFieldId === field.id && (signatureImage || signatureName) ?
              <span className="portal-sign-visual">{signatureImage ? <img src={signatureImage} alt="Vista previa de tu firma" /> : <span>{signatureName}</span>}</span> :
              <span>{selectedFieldId === field.id ? "Recuadro seleccionado ✓" : "Tocá aquí para tu firma"}</span>}
          </button>)}
        </div>
      </>}
    </div>
    <p className="portal-pdf-hint">Revisá el documento y seleccioná tu recuadro de firma sobre la hoja. Usá + para ampliar el texto.</p>
  </section>;
}
