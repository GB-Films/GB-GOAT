import test from 'node:test';
import assert from 'node:assert/strict';
import { parseControlTotalProjects } from './controlTotalProjects';

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
