import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PROVIDER_DATA_HEADERS, providerDataRow, selectedExportProviders } from './providerDataExport';

// Split long words too, so emails and identifiers never cross a column edge.
export function wrapProviderPdfText(value: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.replace(/\r/g, '').split('\n')) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (line && measure(`${line} ${word}`) <= width) { line += ` ${word}`; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const character of Array.from(word)) {
        if (line && measure(line + character) > width) { lines.push(line); line = ''; }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

export async function buildProviderDataPdf(providers: any[], assets: { logo: ArrayBuffer; font: ArrayBuffer }, exportedAt = new Date()) {
  const selected = selectedExportProviders(providers, providers.map(provider => provider.id));
  if (!selected.length) throw Error('Seleccioná al menos una persona.');
  const document = await PDFDocument.create(); document.registerFontkit(fontkit);
  document.setTitle('Gran Berta Films - Datos de proveedores'); document.setAuthor('Gran Berta Films'); document.setCreator('GB GOAT'); document.setCreationDate(exportedAt); document.setModificationDate(exportedAt);
  const regular = await document.embedFont(assets.font, { subset: true });
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const logo = await document.embedPng(assets.logo);
  const width = 841.89, height = 595.28, margin = 24, bottom = 36, size = 8.5, lineHeight = 11.5;
  const columns = [133, 62, 77, 78, 135, 90, 83, width - margin * 2 - 658];
  const ink = rgb(0.12, 0.16, 0.22), muted = rgb(0.39, 0.45, 0.54), amber = rgb(0.57, 0.25, 0.06);
  let page: PDFPage, y: number;
  const wrap = (value: string, column: number, font: PDFFont = regular) => wrapProviderPdfText(value, columns[column] - 12, text => font.widthOfTextAtSize(text, size));
  const newPage = () => {
    page = document.addPage([width, height]);
    page.drawImage(logo, { x: margin, y: height - 78, width: 48, height: 48 });
    page.drawText('GRAN BERTA FILMS', { x: 86, y: height - 40, font: bold, size: 15, color: ink });
    page.drawText('Gran Berta S.R.L. - Datos de proveedores', { x: 86, y: height - 56, font: regular, size: 9, color: ink });
    page.drawText(`Exportado el ${exportedAt.toLocaleDateString('es-AR')} - ${selected.length} ${selected.length === 1 ? 'persona' : 'personas'}`, { x: 86, y: height - 72, font: regular, size: 8.5, color: muted });
    page.drawText('Fuente: GOAT. Celdas ámbar: datos para completar o revisar.', { x: margin, y: height - 99, font: regular, size: 8, color: muted });
    y = height - 111;
    page.drawRectangle({ x: margin, y: y - 34, width: width - margin * 2, height: 34, color: rgb(0.06, 0.09, 0.16) });
    let x = margin;
    PROVIDER_DATA_HEADERS.forEach((header, column) => {
      const lines = wrap(header, column, bold);
      lines.forEach((line, index) => page.drawText(line, { x: x + (columns[column] - bold.widthOfTextAtSize(line, size)) / 2, y: y - 13 - index * lineHeight, font: bold, size, color: rgb(1, 1, 1) }));
      x += columns[column];
    });
    y -= 34;
  };
  newPage();
  selected.forEach((provider, rowIndex) => {
    const values = providerDataRow(provider).map(value => value instanceof Date ? value.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) : value);
    const lines = values.map((value, column) => wrap(value, column));
    const count = Math.max(...lines.map(value => value.length));
    const wholeRowHeight = Math.max(28, count * lineHeight + 10);
    if (wholeRowHeight <= height - 111 - 34 - bottom && wholeRowHeight > y - bottom) newPage();
    let offset = 0;
    while (offset < count) {
      if (y - bottom < 28) newPage();
      const available = Math.max(1, Math.floor((y - bottom - 10) / lineHeight));
      const chunk = Math.min(count - offset, available);
      const rowHeight = Math.max(28, chunk * lineHeight + 10);
      let x = margin;
      values.forEach((value, column) => {
        const missing = /^No informad[oa]$/.test(value) || value.startsWith('Revisar:');
        page.drawRectangle({ x, y: y - rowHeight, width: columns[column], height: rowHeight, color: missing ? rgb(1, 0.953, 0.804) : rowIndex % 2 ? rgb(0.945, 0.961, 0.976) : rgb(1, 1, 1) });
        const content = lines[column].slice(offset, offset + chunk);
        if (column === 0 && offset > 0 && !content.length) content.push(...wrap(`${values[0]} (continúa)`, 0).slice(0, chunk));
        content.forEach((line, index) => page.drawText(line, { x: x + 6, y: y - 14 - index * lineHeight, font: regular, size, color: missing ? amber : ink }));
        x += columns[column];
      });
      page.drawLine({ start: { x: margin, y: y - rowHeight }, end: { x: width - margin, y: y - rowHeight }, thickness: 0.3, color: rgb(0.88, 0.91, 0.94) });
      y -= rowHeight; offset += chunk;
      if (offset < count) newPage();
    }
  });
  const pages = document.getPages();
  pages.forEach((page, index) => {
    page.drawText('Gran Berta Films', { x: margin, y: 18, font: regular, size: 8, color: muted });
    const number = `${index + 1} / ${pages.length}`;
    page.drawText(number, { x: width - margin - regular.widthOfTextAtSize(number, 8), y: 18, font: regular, size: 8, color: muted });
  });
  return document.save();
}
