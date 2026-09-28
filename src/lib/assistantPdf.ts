import { getFileExtension } from './files';

export type AssistantPdf = {
  fileName: string;
  pageCount: number;
  text: string;
  truncated: boolean;
  file: File;
};

export const ASSISTANT_PDF_MAX_PAGES = 25;
export const ASSISTANT_PDF_MAX_CHARS = 60_000;
export const ASSISTANT_PDF_MAX_BYTES = 20 * 1024 * 1024;

// Lee el PDF en el navegador y extrae su texto. No se sube ni se guarda: sólo se
// usa para mandarle el contenido al modelo dentro de la conversación.
export const readAssistantPdf = async (file: File): Promise<AssistantPdf> => {
  const extension = getFileExtension(file.name);
  if (extension !== 'pdf' && file.type !== 'application/pdf') {
    throw new Error('El archivo tiene que ser un PDF.');
  }
  if (file.size > ASSISTANT_PDF_MAX_BYTES) {
    throw new Error('El PDF supera los 20 MB.');
  }

  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

  const bytes = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  const pagesToRead = Math.min(document.numPages, ASSISTANT_PDF_MAX_PAGES);
  const parts: string[] = [];
  let characters = 0;

  for (let index = 1; index <= pagesToRead; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => (typeof item?.str === 'string' ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (pageText) parts.push(`Página ${index}: ${pageText}`);
    characters += pageText.length;
    if (characters >= ASSISTANT_PDF_MAX_CHARS) break;
  }

  const text = parts.join('\n');
  return {
    fileName: file.name,
    pageCount: document.numPages,
    text,
    truncated: document.numPages > pagesToRead || characters >= ASSISTANT_PDF_MAX_CHARS,
    file,
  };
};

export const hasExtractablePdfText = (pdf: AssistantPdf) => pdf.text.replace(/\s+/g, '').length > 20;

export const formatPdfForAssistant = (pdf: AssistantPdf) => {
  const header = `PDF adjunto: ${pdf.fileName} (${pdf.pageCount} página${pdf.pageCount === 1 ? '' : 's'}).`;
  if (!hasExtractablePdfText(pdf)) {
    return `${header}\nEl PDF no tiene texto seleccionable (parece escaneado o una imagen), así que no puedo leer su contenido. Puedo usarlo igual como archivo para adjuntarlo a un gasto.`;
  }
  const body = pdf.text.length > ASSISTANT_PDF_MAX_CHARS
    ? `${pdf.text.slice(0, ASSISTANT_PDF_MAX_CHARS)}\n(El texto se cortó por tamaño.)`
    : pdf.text;
  return [
    header,
    pdf.truncated ? '(Se leyeron las primeras páginas por tamaño.)' : '',
    'Contenido:',
    body,
  ].filter(Boolean).join('\n');
};
