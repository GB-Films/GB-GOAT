import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderWorkList, groupPortalWorks, type PortalWork } from './ProviderWorkList';
const work = (id: string, changes: Partial<PortalWork> = {}): PortalWork => ({ key: `p/areaExpenses/${id}`, projectId: 'p', projectName: 'Proyecto de prueba', description: 'Servicio', currency: 'ARS', total: 100, paid: 40, ...changes });

test('agrupa por identidad del proyecto y moneda; un excedente de pago no esconde la deuda de otro trabajo', () => {
  const projects = groupPortalWorks([work('overpaid', { total: 100, paid: 150 }), work('pending', { total: 100, paid: 0 }), work('usd', { currency: 'USD', total: 20, paid: 5 }), work('other', { projectId: 'other', projectName: 'Proyecto de prueba' })]);
  assert.equal(projects.length, 2);
  assert.deepEqual(projects[0].amounts, [
    { currency: 'ARS', total: 200, paid: 150, balance: 100, withoutDetails: false },
    { currency: 'USD', total: 20, paid: 5, balance: 15, withoutDetails: false },
  ]);
  assert.equal(groupPortalWorks([work('cents', { total: 0.3, paid: 0.1 + 0.2 })])[0].amounts[0].balance, 0);
});
test('proyectos y pagos empiezan colapsados, con texto legible y colores para distinguir los importes', () => {
  const html = renderToStaticMarkup(createElement(ProviderWorkList, { works: [work('paid', { paid: 100, area: 'Arte', payments: [{ id: 'pay', amount: 100, date: '2026-11-06', detail: 'Pago de prueba' }] }), work('pending')] }));
  for (const value of ['Proyecto de prueba', '2 trabajos', 'Trabajado', 'Pagado', 'Saldo', 'text-emerald-700', 'text-rose-600', 'Ver pago', '06/11/2026', 'Pago de prueba', 'Arte']) assert(html.includes(value), value);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:=|\s|>)/);
  assert.doesNotMatch(html, /min-w-\[\d+px\]|<table/);
});
test('un trabajo marcado pagado sin detalle no se presenta como deuda ni como un pago de cero', () => {
  const legacy = work('legacy', { markedPaidWithoutDetails: true, total: 9000, paid: 0 });
  assert.equal(groupPortalWorks([legacy])[0].amounts[0].withoutDetails, true);
  const html = renderToStaticMarkup(createElement(ProviderWorkList, { works: [legacy] }));
  assert.match(html, /Marcado pagado; sin detalle cargado/);
  assert.match(html, /Sin detalle/);
  assert.doesNotMatch(html, /text-rose-600|text-emerald-700/);
});
test('la vista vacía distingue la carga inicial y los nombres se escapan como texto', () => {
  assert.match(renderToStaticMarkup(createElement(ProviderWorkList, { works: [], emptyMessage: 'Cargando tus datos…' })), /Cargando tus datos/);
  assert.match(renderToStaticMarkup(createElement(ProviderWorkList, { works: [] })), /Todavía no tenés trabajos asignados/);
  const html = renderToStaticMarkup(createElement(ProviderWorkList, { works: [work('escaped', { projectName: '<img src=x>', description: '<script>malicioso</script>' })] }));
  assert.match(html, /&lt;img src=x&gt;/); assert.doesNotMatch(html, /<script>|<img/);
});
