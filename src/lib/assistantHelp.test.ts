import assert from 'node:assert/strict';
import test from 'node:test';
import { ASSISTANT_HELP_SECTIONS, listAssistantHelpTopics, searchAssistantHelp } from './assistantHelp';

test('la ayuda cubre los flujos principales', () => {
  const ids = ASSISTANT_HELP_SECTIONS.map((section) => section.id);

  ['panorama', 'roles-permisos', 'presupuesto-principal', 'areas-activar', 'areas-cargar-gastos',
    'pagos', 'cajas', 'comprobantes-facturas', 'proveedores', 'errores-comunes'].forEach((id) => {
    assert.ok(ids.includes(id), `Falta la sección ${id}`);
  });
});

test('encuentra la ayuda de pagos', () => {
  const sections = searchAssistantHelp('¿cómo registro un pago parcial?');
  assert.equal(sections[0].id, 'pagos');
  assert.match(sections[0].content, /pago de tercero/i);
});

test('encuentra la ayuda del link de proveedores', () => {
  const sections = searchAssistantHelp('el link de alta de proveedor no funciona');
  assert.equal(sections[0].id, 'proveedores');
  assert.match(sections[0].content, /venció/);
});

test('encuentra la ayuda para cargar gastos en un área', () => {
  const sections = searchAssistantHelp('cargar un gasto en un area');
  assert.equal(sections[0].id, 'areas-cargar-gastos');
  assert.match(sections[0].content, /subcategor/i);
});

test('explica los permisos cuando preguntan por una pestaña que no ven', () => {
  const sections = searchAssistantHelp('no veo la pestaña de cajas');
  const ids = sections.map((section) => section.id);
  assert.ok(ids.includes('roles-permisos') || ids.includes('cajas'));
});

test('devuelve el panorama cuando no hay coincidencia', () => {
  const sections = searchAssistantHelp('xyzxyz');
  assert.equal(sections[0].id, 'panorama');
});

test('lista los temas disponibles', () => {
  const topics = listAssistantHelpTopics();
  assert.ok(topics.length >= 10);
  assert.ok(topics.some((topic) => topic.id === 'asistente'));
});
