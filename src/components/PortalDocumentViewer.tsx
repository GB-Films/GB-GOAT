import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
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
  editor?: { disabled?: boolean; onPlace: (page: number, x: number, y: number) => void; onChange: (field: PortalSignatureField) => void };
};

type PageProps = Pick<Props, "fields" | "selectedFieldId" | "signatureImage" | "signatureName" | "onSelectField" | "editor"> & {
  key?: number;
  pdf: PDFDocumentProxy;
  pageNumber: number;
  root: HTMLDivElement;
  size: { width: number; height: number };
  fit: "page" | "width";
  zoom: number;
  onRendered: (page: number, ready: boolean) => void;
  onError: (message: string) => void;
};

function DocumentPage({ pdf, pageNumber, root, size, fit, zoom, fields, selectedFieldId, signatureImage, signatureName, onSelectField, onRendered, onError, editor }: PageProps) {
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [nearby, setNearby] = useState(false);
  const [rendered, setRendered] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ field: PortalSignatureField; x: number; y: number } | null>(null);
  const original = page?.getViewport({ scale: 1 });
  const pageWidth = original?.width || 595, pageHeight = original?.height || 842;
  const scale = Math.max(.1, Math.min(Math.max(1, size.width - 32) / pageWidth,
    fit === "page" ? Math.max(1, size.height - 32) / pageHeight : Infinity) * zoom);
  const width = pageWidth * scale, height = pageHeight * scale;

  useEffect(() => {
    let cancelled = false;
    void pdf.getPage(pageNumber).then(loaded => { if (!cancelled) setPage(loaded); }).catch(() => {
      if (!cancelled) onError("No pudimos cargar una página. Volvé a cargar el documento antes de firmar.");
    });
    return () => { cancelled = true; };
  }, [pdf, pageNumber, onError]);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setNearby(entry.isIntersecting), { root, rootMargin: "500px 0px" });
    if (sheet.current) observer.observe(sheet.current);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    setRendered(false); onRendered(pageNumber, false);
    const target = canvas.current;
    if (!nearby || !page || !target || !size.width || !size.height) return;
    let cancelled = false;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const renderViewport = page.getViewport({ scale: scale * ratio });
    target.width = Math.ceil(renderViewport.width); target.height = Math.ceil(renderViewport.height);
    const render = page.render({ canvas: target, viewport: renderViewport });
    void render.promise.then(() => {
      if (!cancelled) { setRendered(true); onRendered(pageNumber, true); }
    }).catch(error => {
      if (!cancelled && error.name !== "RenderingCancelledException") onError("No pudimos mostrar una página. Volvé a cargar el documento antes de firmar.");
    });
    return () => {
      cancelled = true; render.cancel(); onRendered(pageNumber, false);
      // Keep each page's space while releasing canvases far from the reading position.
      target.width = 0; target.height = 0;
    };
  }, [page, nearby, pageNumber, scale, size.width, size.height, onRendered, onError]);

  return <div ref={sheet} className="portal-pdf-sheet" data-pdf-page={pageNumber} style={{ width, height }} aria-busy={!rendered}
    onClick={event => {
      if (!editor || editor.disabled || !rendered || (event.target as HTMLElement).closest('button')) return;
      const rect = event.currentTarget.getBoundingClientRect();
      editor.onPlace(pageNumber, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
    }}>
    {!rendered && <p role="status" className="portal-pdf-loading">Cargando página {pageNumber}…</p>}
    <div style={{ visibility: rendered ? "visible" : "hidden" }}>
      <canvas ref={canvas} role="img" aria-label={`Documento, página ${pageNumber}`} style={{ width, height }} />
      {fields.filter(f => f.page === pageNumber).map((field, index) => <button
        key={field.id} type="button" className={`portal-sign-field ${selectedFieldId === field.id ? "is-selected" : ""}`}
        aria-label={editor ? `Recuadro de firma de ${field.signerEmail}, página ${field.page}` : `Seleccionar mi recuadro de firma ${index + 1}, página ${field.page}`}
        aria-pressed={selectedFieldId === field.id} data-signature-field-id={field.id}
        onPointerDown={event => {
          if (!editor || editor.disabled || event.button !== 0) return;
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); onSelectField(field.id);
          drag.current = { field: { ...field }, x: event.clientX, y: event.clientY };
        }}
        onPointerMove={event => {
          if (!editor || editor.disabled || !drag.current) return;
          const start = drag.current;
          editor.onChange({ ...start.field, x: Math.max(0, Math.min(1 - start.field.w, start.field.x + (event.clientX - start.x) / width)),
            y: Math.max(0, Math.min(1 - start.field.h, start.field.y + (event.clientY - start.y) / height)) });
        }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        style={{ left: `${field.x * 100}%`, top: `${field.y * 100}%`, width: `${field.w * 100}%`, height: `${field.h * 100}%`, ...(editor ? { touchAction: 'none' } : {}) }}
        onClick={() => onSelectField(field.id)}>
        {editor ? <span>Firma + DNI<br />{field.signerEmail}</span> : selectedFieldId === field.id && (signatureImage || signatureName) ?
          <span className="portal-sign-visual">{signatureImage ? <img src={signatureImage} alt="Vista previa de tu firma" /> : <span>{signatureName}</span>}</span> :
          <span>{selectedFieldId === field.id ? "Recuadro seleccionado ✓" : "Tocá aquí para tu firma"}</span>}
      </button>)}
    </div>
  </div>;
}

export function PortalDocumentViewer({ url, fields, selectedFieldId, signatureImage, signatureName, onSelectField, onPageCount, onReady, onRetry, editor }: Props) {
  const initialFit = editor ? "page" : "width";
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [fit, setFit] = useState<"page" | "width">(initialFit);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  const [renderedPages, setRenderedPages] = useState<Set<number>>(() => new Set());
  const viewport = useRef<HTMLDivElement>(null);
  const ready = !!pdf && !error && renderedPages.has(pageNumber);
  const onRendered = useCallback((page: number, rendered: boolean) => {
    setRenderedPages(previous => {
      if (previous.has(page) === rendered) return previous;
      const next = new Set<number>(previous);
      if (rendered) next.add(page); else next.delete(page);
      return next;
    });
  }, []);

  useEffect(() => { onReady(ready); }, [ready, onReady]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof import("pdfjs-dist")["getDocument"]> | undefined;
    setPdf(null); setError(""); setRenderedPages(new Set()); onPageCount(0); setPageNumber(1); setFit(initialFit); setZoom(1);
    viewport.current?.scrollTo({ top: 0, left: 0 });
    if (url) void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        task = pdfjs.getDocument({ url });
        const loaded = await task.promise;
        if (cancelled) return;
        onPageCount(loaded.numPages); setPdf(loaded);
      } catch {
        if (!cancelled) setError("No pudimos mostrar el PDF. Volvé a cargar el documento para revisarlo antes de firmar.");
      }
    })();
    return () => { cancelled = true; void task?.destroy(); };
  }, [url, onPageCount, initialFit]);

  function trackPage() {
    const element = viewport.current;
    if (!element) return;
    const top = element.getBoundingClientRect().top, bottom = top + element.clientHeight;
    let visiblePage = 1, largestArea = 0;
    element.querySelectorAll<HTMLElement>("[data-pdf-page]").forEach(sheet => {
      const rect = sheet.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(rect.bottom, bottom) - Math.max(rect.top, top));
      if (visibleHeight > largestArea) { largestArea = visibleHeight; visiblePage = Number(sheet.dataset.pdfPage); }
    });
    if (largestArea) setPageNumber(visiblePage);
  }

  function goToPage(page: number, fieldId?: string) {
    const element = viewport.current;
    const sheet = element?.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`);
    if (!element || !sheet) return;
    const field = fieldId ? Array.from(sheet.querySelectorAll<HTMLElement>("[data-signature-field-id]")).find((f: HTMLElement) => f.dataset.signatureFieldId === fieldId) as HTMLElement | undefined : undefined;
    const rect = (field || sheet).getBoundingClientRect(), root = element.getBoundingClientRect();
    element.scrollTo({ top: element.scrollTop + rect.top - root.top - (field ? (element.clientHeight - rect.height) / 2 : 16), left: field ? element.scrollLeft + rect.left - root.left - (element.clientWidth - rect.width) / 2 : 0 });
    setPageNumber(page);
  }

  return <section className="portal-pdf" aria-label={editor ? 'Preparación del documento' : 'Documento a firmar'}>
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
        <select aria-label={editor ? 'Ir a un recuadro de firma' : 'Ir a mi recuadro de firma'} value="" disabled={!pdf || !fields.length} onChange={e => { const field = fields.find(f => f.id === e.target.value); if (field) goToPage(field.page, field.id); }}>
          <option value="" disabled>{editor ? 'Ir a un recuadro' : 'Ir a mi recuadro'}</option>
          {fields.map((field, index) => <option key={field.id} value={field.id}>Recuadro {index + 1} · página {field.page}</option>)}
        </select>
        {url && <a href={url} target="_blank" rel="noreferrer">Abrir PDF</a>}
      </div>
    </div>
    <div ref={viewport} className="portal-pdf-viewport" data-testid="pdf-viewport" tabIndex={0} aria-label="Hojas del documento. Desplazate para leer todas las páginas." aria-busy={!ready && !error} onScroll={trackPage}>
      {error ? <div className="portal-sign-error"><p role="alert">{error}</p><button type="button" onClick={onRetry}>Volver a cargar</button></div> : pdf ?
        <div className="portal-pdf-pages">{Array.from({ length: pdf.numPages }, (_, index) => <DocumentPage key={index + 1} pdf={pdf} pageNumber={index + 1} root={viewport.current!} size={size} fit={fit} zoom={zoom} fields={fields} selectedFieldId={selectedFieldId} signatureImage={signatureImage} signatureName={signatureName} onSelectField={onSelectField} onRendered={onRendered} onError={setError} editor={editor} />)}</div> :
        <p role="status" className="portal-pdf-loading">Cargando documento…</p>}
    </div>
    <p className="portal-pdf-hint">{editor ? 'Elegí un firmante y tocá el PDF para ubicar su firma. Podés arrastrar el recuadro y desplazarte por todas las hojas.' : 'Desplazate por las hojas y seleccioná tu recuadro de firma. Usá + para ampliar el texto.'}</p>
  </section>;
}
