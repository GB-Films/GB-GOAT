import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildProviderDataWorkbook } from './providerDataWorkbook';
test('exported XLSX preserves logo, selected people, dates, text identifiers, filters and printable letterhead', async () => {
  const template = await readFile(new URL('../../public/templates/proveedores-datos.xlsx', import.meta.url));
  const rows = [{ id: 'first', type: 'persona', name: 'Lucía', lastName: 'Fernández', dni: '00123456', cuit: '20001234561', birthDate: '1992-06-14', address: 'Dirección', email: '=literal@example.test', bankAccount_cbu: 'DO-NOT-EXPORT' },
    { id: 'second', type: 'persona', name: 'Martín', lastName: 'Pérez' }, { id: 'company', type: 'empresa', name: 'No incluir' }];
  const workbook = await buildProviderDataWorkbook(rows, template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength), new Date('2026-10-28T15:00:00Z'));
  const bytes = await workbook.xlsx.writeBuffer();
  const { default: ExcelJS } = await import('exceljs'); const restored = new ExcelJS.Workbook(); await restored.xlsx.load(bytes);
  const sheet = restored.getWorksheet('Personas')!;
  assert.equal(restored.worksheets.length, 1); assert.equal(sheet.getImages().length, 1); assert.equal(sheet.rowCount, 9);
  assert.equal(sheet.getCell('A8').value, 'Fernández, Lucía'); assert.equal(sheet.getCell('B8').value, '00123456');
  assert.equal(sheet.getCell('D8').numFmt, 'dd/mm/yyyy'); assert.equal((sheet.getCell('D8').value as Date).toISOString(), '1992-06-14T00:00:00.000Z');
  assert.equal(sheet.getCell('H8').value, '=literal@example.test'); assert.equal(sheet.getCell('B9').value, 'No informado');
  assert.match(String(sheet.getCell('B4').value), /2 personas/);
  assert.equal(sheet.autoFilter, 'A7:H9'); assert.equal((sheet.views[0] as { ySplit?: number }).ySplit, 7); assert.equal(sheet.pageSetup.orientation, 'landscape');
  assert.doesNotMatch(JSON.stringify(sheet.getSheetValues()), /DO-NOT-EXPORT|No incluir/);
});
