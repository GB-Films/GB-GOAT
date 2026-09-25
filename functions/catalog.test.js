const test = require('node:test');
const assert = require('node:assert/strict');
const { parseProjects, fetchProjects, canRefresh } = require('./catalog');

const header = ['ProyectoID', 'Servicio', 'Marca', 'Empresa', 'Cliente', 'Unidad dueña',
  'Unidad prestadora interna', 'Condición', 'Fecha confirmación', 'Fecha entrega',
  'Moneda contrato', 'Contrato ARS', 'Contrato USD', 'TC confirmación', 'Contrato USD equiv.', 'Estado'];
const g = ['G LO 0001 Garnier Fructis', 'Producción', 'Garnier', 'Gran Berta SRL', 'Cliente',
  'GB Films', '', 'Aprobado', 46200, 46210, 'USD', '', 4800, '', '', 'Activo'];
const b = ['B LO 0001 Garnier Post', 'Post', 'Garnier', 'BANI', 'Cliente'];

test('publica sólo proyectos G y conserva moneda e importe originales', () => {
  const projects = parseProjects([header, g, b]);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].projectCode, 'G LO 0001');
  assert.equal(projects[0].name, 'Garnier Fructis');
  assert.equal(projects[0].sourceRow, 5);
  assert.equal(projects[0].contractCurrency, 'USD');
  assert.equal(projects[0].contractAmount, 4800);
});

test('rechaza duplicados y cambios de estructura sin reemplazar el catálogo', () => {
  assert.throws(() => parseProjects([header, g, g]), /repetido/);
  assert.throws(() => parseProjects([['ProyectoID'], g]), /Faltan columnas/);
});

test('consulta detalles sólo de filas G y detecta cambios concurrentes', async () => {
  const urls = [];
  const getJson = async url => {
    urls.push(url);
    if (url.includes('/values/')) return { values: [['ProyectoID'], [g[0]], [b[0]]] };
    return { valueRanges: [{ values: [header] }, { values: [g] }] };
  };
  assert.equal((await fetchProjects(getJson)).length, 1);
  assert.match(urls[1], /A5%3AP5/);
  assert.doesNotMatch(urls[1], /A6%3AP6/);
  await assert.rejects(fetchProjects(async url => url.includes('/values/')
    ? { values: [['ProyectoID'], [g[0]]] }
    : { valueRanges: [{ values: [header] }, { values: [[...g].fill('changed', 0, 1)] }] }), /cambió/);
});

test('sólo las dos cuentas curadoras verificadas pueden leer la fuente', () => {
  const auth = { uid: 'user-1', token: { email: 'tomas@granberta.com', email_verified: true } };
  assert.equal(canRefresh(auth), true);
  assert.equal(canRefresh({ ...auth, token: { email: auth.token.email, email_verified: false } }), false);
  assert.equal(canRefresh({ ...auth, token: { email: 'otra@granberta.com', email_verified: true } }), false);
  assert.equal(canRefresh({ uid: 'user-2', token: { email: 'guido@bani-vfx.com', email_verified: true } }), false);
});
