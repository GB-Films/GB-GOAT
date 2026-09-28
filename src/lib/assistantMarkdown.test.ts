import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAssistantInline, parseAssistantMarkdown } from './assistantMarkdown';

test('separa negritas, código y cursivas', () => {
  assert.deepEqual(parseAssistantInline('El total es **$1.234** y el id `abc` queda igual'), [
    { type: 'text', value: 'El total es ' },
    { type: 'bold', value: '$1.234' },
    { type: 'text', value: ' y el id ' },
    { type: 'code', value: 'abc' },
    { type: 'text', value: ' queda igual' },
  ]);
  assert.deepEqual(parseAssistantInline('*nota*'), [{ type: 'italic', value: 'nota' }]);
});

test('arma listas con viñetas y numeradas', () => {
  const blocks = parseAssistantMarkdown([
    'Pagos pendientes:',
    '- Arte — $12.000',
    '- Vestuario — $3.500',
    '',
    '1. Revisar proveedor',
    '2. Cargar factura',
  ].join('\n'));

  assert.deepEqual(blocks, [
    { type: 'paragraph', text: 'Pagos pendientes:' },
    { type: 'list', ordered: false, items: ['Arte — $12.000', 'Vestuario — $3.500'] },
    { type: 'list', ordered: true, items: ['Revisar proveedor', 'Cargar factura'] },
  ]);
});

test('detecta encabezados, citas y separadores', () => {
  const blocks = parseAssistantMarkdown([
    '## Resumen',
    '> Ojo con el sobrecosto',
    '',
    '---',
    'Texto final',
  ].join('\n'));

  assert.deepEqual(blocks, [
    { type: 'heading', level: 2, text: 'Resumen' },
    { type: 'quote', text: 'Ojo con el sobrecosto' },
    { type: 'divider' },
    { type: 'paragraph', text: 'Texto final' },
  ]);
});

test('mantiene las tablas en un bloque propio', () => {
  const blocks = parseAssistantMarkdown([
    '| Área | Total |',
    '| --- | --- |',
    '| Arte | 1000 |',
  ].join('\n'));

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'table');
});

test('une líneas sueltas en un mismo párrafo', () => {
  const blocks = parseAssistantMarkdown('El proyecto viene bien.\nTodavía no hay pagos.');

  assert.deepEqual(blocks, [
    { type: 'paragraph', text: 'El proyecto viene bien. Todavía no hay pagos.' },
  ]);
});
