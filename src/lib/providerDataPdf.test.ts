import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { buildProviderDataPdf, wrapProviderPdfText } from './providerDataPdf';

test('PDF wraps long emails, explicit lines and accented names without crossing cell widths', () => {
  const measure = (value: string) => Array.from(value).length;
  for (const value of ['María de los Ángeles López', 'correo.muy.largo.sin.espacios@example.test', 'Una dirección\ncon otra línea']) {
    const lines = wrapProviderPdfText(value, 12, measure);
    assert.ok(lines.every(line => measure(line) <= 12));
    assert.equal(lines.join('').replace(/\s/g, ''), value.replace(/\s/g, ''));
  }
});

test('PDF downloads have landscape pages, branded metadata and pagination for long selected lists', async () => {
  const array = (buffer: Buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const [logo, font] = await Promise.all([readFile(new URL('../../public/gb-films-logo.png', import.meta.url)), readFile(new URL('../../public/fonts/DejaVuSans.ttf', import.meta.url))]);
  const assets = { logo: array(logo), font: array(font) };
  const row = { id: 'person', type: 'persona', name: 'Lucía', lastName: 'Fernández', dni: '00123456', birthDate: '1992-06-14', address: 'Calle de ejemplo', email: 'lucia@example.test' };
  const single = await PDFDocument.load(await buildProviderDataPdf([row, row, { id: 'company', type: 'empresa', name: 'Excluded' }], assets));
  assert.equal(single.getPageCount(), 1); assert.equal(single.getAuthor(), 'Gran Berta Films');
  assert.equal(single.getTitle(), 'Gran Berta Films - Datos de proveedores');
  const many = await PDFDocument.load(await buildProviderDataPdf(Array.from({ length: 40 }, (_, index) => ({ ...row, id: String(index), lastName: `Apellido ${index}`, address: index === 0 ? 'Dirección extensa '.repeat(320) : row.address })), assets));
  assert.ok(many.getPageCount() > 2);
  for (const page of many.getPages()) { assert.ok(Math.abs(page.getWidth() - 841.89) < 0.1); assert.ok(page.getHeight() < page.getWidth()); }
  assert.equal(many.getForm().getFields().length, 0);
  await assert.rejects(buildProviderDataPdf([], assets), /Seleccioná/);
});
