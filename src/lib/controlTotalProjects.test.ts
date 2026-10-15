import test from 'node:test';
import assert from 'node:assert/strict';
import { parseControlTotalProjects, controlTotalContractLabel, controlTotalArsBudget } from './controlTotalProjects';

const header = ['ProyectoID', 'Servicio', 'Marca', 'Empresa', 'Cliente', 'Unidad dueña', 'Unidad prestadora interna', 'Condición', 'Fecha confirmación', 'Fecha entrega', 'Moneda contrato', 'Contrato ARS', 'Contrato USD', 'TC confirmación', 'Contrato USD equiv.', 'Estado'];

test('imports only G projects with original code, name, client, brand and contract currency', () => {
  const projects = parseControlTotalProjects([
    header,
    ['G LO 0001 Garnier Fructis', 'Producción', 'Garnier', 'L’Oréal', 'Agencia Uno', 'GB', '', 'Externo', 46034, '', 'ARS', 1200000, '', '', '', 'Activo'],
    ['B LO 0001 Garnier Fructis', 'Post', 'Garnier', '', 'Gran Berta', 'BANI', '', 'Interno', '', '', 'USD', '', 1000, '', '', 'Activo'],
    ['G FC 0034 Mundo Conmebol 10', 'CB', 'Conmebol', '', 'FC Diez Media', 'GB', '', 'Externo', '', '', 'USD', '', 4800, 1, '', 'Migrado'],
  ]);

  assert.equal(projects.length, 2);
  assert.deepEqual([projects[0].projectCode, projects[0].name, projects[0].client, projects[0].brand],
    ['G LO 0001', 'Garnier Fructis', 'Agencia Uno', 'Garnier']);
  assert.deepEqual([projects[0].contractCurrency, projects[0].contractAmount, projects[0].sourceRow], ['ARS', 1200000, 5]);
  assert.equal(projects[0].confirmationDate, '2026-01-12');
  assert.deepEqual([projects[1].contractCurrency, projects[1].contractAmount, projects[1].sourceRow], ['USD', 4800, 7]);
});

test('stops import if the source schema or G codes are ambiguous', () => {
  assert.throws(() => parseControlTotalProjects([['Other'], ['G LO 0001 Garnier Fructis']]), /estructura/);
  assert.throws(() => parseControlTotalProjects([
    header,
    ['G LO 0001 Garnier Fructis'],
    ['G LO 0001 Otro nombre'],
  ]), /repetido/);
});

test('reads independent ARS/USD contracts without the obsolete currency column', () => {
  const modernHeader = header.filter(column => column !== 'Moneda contrato');
  const projects = parseControlTotalProjects([
    modernHeader,
    ['G EX 0001 Ejemplo mixto', 'Producción', '', '', '', 'GB', '', 'Interno', '', '', 200000, 300, '', '', 'Activo'],
    ['G GB 0555 Sólo pesos', '', '', '', '', '', '', '', '', '', 100000, '', '', '', 'Activo'],
    ['G GB 0556 Sólo dólares', '', '', '', '', '', '', '', '', '', '', 500, '', '', 'Activo'],
    ['G GB 0557 Sin contrato'],
  ]);
  assert.deepEqual([projects[0].contractArs, projects[0].contractUsd, projects[0].contractCurrency, projects[0].contractAmount], [200000, 300, '', null]);
  assert.equal(projects[0].status, 'Activo');
  assert.equal(controlTotalArsBudget(projects[0]), 200000);
  assert.equal(controlTotalContractLabel(projects[0]), 'ARS 200.000 + USD 300');
  assert.equal(projects[1].contractCurrency, 'ARS');
  assert.equal(projects[2].contractCurrency, 'USD');
  assert.equal(controlTotalArsBudget(projects[2]), 0);
  assert.equal(controlTotalContractLabel(projects[3]), 'Sin importe');
  assert.equal(projects[3].contractAmount, null);
  assert.throws(() => parseControlTotalProjects([modernHeader.filter(column => column !== 'Contrato ARS')]), /Contrato ARS/);
});

test('handles identifiable old-format rows under current headers without reading TC as contract', () => {
  const modernHeader = header.filter(column => column !== 'Moneda contrato');
  modernHeader.push('Facturado ARS (neto)');
  const projects = parseControlTotalProjects([
    modernHeader,
    ['G EX 0001 Ejemplo sin precio', '', '', '', '', 'GB', '', 'Externo', '', '', 'ARS', 0, '', 1550, 0, 'Activo'],
    ['G EX 0002 Ejemplo formato anterior', '', '', '', '', '', '', '', '', '', 'ARS', 1230000, '', 1550, 793, 'Activo'],
    ['G EX 0003 Ejemplo parcial', '', '', '', '', '', '', '', '', '', 2500000, '', '', 1550, 0, 'Activo'],
  ]);
  assert.deepEqual([projects[0].contractArs, projects[0].contractUsd, projects[0].contractAmount], [0, null, 0]);
  assert.deepEqual([projects[1].contractArs, projects[1].contractUsd, projects[1].contractAmount], [1230000, null, 1230000]);
  assert.equal(projects[2].contractArs, 2500000);
  assert.ok(projects.every(project => project.status === 'Activo' && project.sourceWarning));
  assert.throws(() => parseControlTotalProjects([modernHeader, ['G GB 0554 Error', '', '', '', '', '', '', '', '', '', 'revisar']]), /Importe/);
});
