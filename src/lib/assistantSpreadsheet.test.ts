import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  ASSISTANT_SPREADSHEET_MAX_ROWS,
  formatSpreadsheetForAssistant,
  parsePastedTable,
  readAssistantSpreadsheet,
} from './assistantSpreadsheet';

const buildFile = (rows: unknown[][], fileName = 'gastos.xlsx') => {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Gastos');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return new File([buffer], fileName);
};

test('lee encabezados y filas de una planilla', async () => {
  const file = buildFile([
    ['Área', 'Proveedor', 'Descripción', 'Cantidad', 'P. Unitario'],
    ['Arte', 'Ferretería', 'Pintura', 2, 1500],
  ]);

  const spreadsheet = await readAssistantSpreadsheet(file);

  assert.equal(spreadsheet.fileName, 'gastos.xlsx');
  assert.equal(spreadsheet.sheetName, 'Gastos');
  assert.deepEqual(spreadsheet.headers, ['Área', 'Proveedor', 'Descripción', 'Cantidad', 'P. Unitario']);
  assert.deepEqual(spreadsheet.rows, [['Arte', 'Ferretería', 'Pintura', '2', '1500']]);
  assert.equal(spreadsheet.totalRows, 2);
  assert.equal(spreadsheet.truncated, false);
});

test('arma el texto que se le manda al modelo', async () => {
  const spreadsheet = await readAssistantSpreadsheet(buildFile([
    ['Área', 'Descripción', 'Total'],
    ['Arte', 'Pintura', 3000],
  ]));
  const text = formatSpreadsheetForAssistant(spreadsheet);

  assert.match(text, /Planilla adjunta: gastos\.xlsx/);
  assert.match(text, /Área\tDescripción\tTotal/);
  assert.match(text, /Arte\tPintura\t3000/);
});

test('recorta las planillas muy largas', async () => {
  const rows: unknown[][] = [['Área', 'Descripción', 'Total']];
  for (let index = 0; index < ASSISTANT_SPREADSHEET_MAX_ROWS + 10; index += 1) {
    rows.push(['Arte', `Gasto ${index}`, 100]);
  }

  const spreadsheet = await readAssistantSpreadsheet(buildFile(rows));

  assert.equal(spreadsheet.truncated, true);
  assert.equal(spreadsheet.rows.length, ASSISTANT_SPREADSHEET_MAX_ROWS);
  assert.match(formatSpreadsheetForAssistant(spreadsheet), /se muestran las primeras/);
});

test('rechaza archivos que no son planillas', async () => {
  const file = new File(['hola'], 'notas.txt');
  await assert.rejects(() => readAssistantSpreadsheet(file), /CSV, XLSX o XLS/);
});

test('detecta una tabla pegada de Excel', () => {
  const pasted = [
    'Área\tProveedor\tDescripción\tCantidad\tPrecio',
    'Arte\tFerretería\tPintura\t2\t1500',
    'Vestuario\tZapatería\tBotas\t1\t50000',
  ].join('\n');

  const table = parsePastedTable(pasted);

  assert.ok(table);
  assert.equal(table?.source, 'paste');
  assert.equal(table?.fileName, 'Tabla pegada');
  assert.deepEqual(table?.headers, ['Área', 'Proveedor', 'Descripción', 'Cantidad', 'Precio']);
  assert.equal(table?.rows.length, 2);
  assert.deepEqual(table?.rows[0], ['Arte', 'Ferretería', 'Pintura', '2', '1500']);
});

test('acepta una sola fila con varias columnas', () => {
  const table = parsePastedTable('Arte\tFerretería\tPintura\t2\t1500');

  assert.ok(table);
  assert.deepEqual(table?.headers, ['Columna 1', 'Columna 2', 'Columna 3', 'Columna 4', 'Columna 5']);
  assert.deepEqual(table?.rows, [['Arte', 'Ferretería', 'Pintura', '2', '1500']]);
});

test('no confunde texto normal con una tabla', () => {
  assert.equal(parsePastedTable('hola, ¿cómo va?'), null);
  assert.equal(parsePastedTable('una linea sin tabs'), null);
  assert.equal(parsePastedTable(''), null);
});
