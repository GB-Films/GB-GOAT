import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPdfForAssistant, hasExtractablePdfText, type AssistantPdf } from './assistantPdf';

const buildPdf = (overrides: Partial<AssistantPdf> = {}): AssistantPdf => ({
  fileName: 'factura.pdf',
  pageCount: 1,
  text: 'Página 1: Factura A 0001-00012345 Proveedor Rental Sur Total $12.000',
  truncated: false,
  file: new File(['pdf'], 'factura.pdf', { type: 'application/pdf' }),
  ...overrides,
});

test('formatea el PDF adjunto con su contenido', () => {
  const formatted = formatPdfForAssistant(buildPdf());

  assert.match(formatted, /PDF adjunto: factura\.pdf \(1 página\)/);
  assert.match(formatted, /Factura A 0001-00012345/);
  assert.match(formatted, /Contenido:/);
});

test('avisa cuando el PDF no tiene texto seleccionable', () => {
  const pdf = buildPdf({ text: '', pageCount: 2 });

  assert.equal(hasExtractablePdfText(pdf), false);
  assert.match(formatPdfForAssistant(pdf), /no tiene texto seleccionable/);
  assert.match(formatPdfForAssistant(pdf), /adjuntarlo a un gasto/);
});

test('avisa cuando se recortó el texto del PDF', () => {
  const formatted = formatPdfForAssistant(buildPdf({ truncated: true }));
  assert.match(formatted, /Se leyeron las primeras páginas/);
});
