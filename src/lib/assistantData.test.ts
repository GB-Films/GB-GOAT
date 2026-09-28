import assert from 'node:assert/strict';
import test from 'node:test';
import { findProjectByReference } from './assistantData';

const projects = [
  { id: 'p1', name: 'Garnier Fructis', clientName: 'Garnier' },
  { id: 'p2', name: 'Spot Verano', clientName: 'Cliente B' },
  { id: 'p3', name: 'Largometraje', clientName: '' },
];

test('encuentra un proyecto por id', () => {
  assert.equal(findProjectByReference(projects, 'p2')?.id, 'p2');
});

test('encuentra un proyecto por nombre completo, sin importar mayúsculas', () => {
  assert.equal(findProjectByReference(projects, 'garnier fructis')?.id, 'p1');
  assert.equal(findProjectByReference(projects, 'GARNIER FRUCTIS')?.id, 'p1');
});

test('encuentra un proyecto por una parte del nombre', () => {
  assert.equal(findProjectByReference(projects, 'garnier')?.id, 'p1');
  assert.equal(findProjectByReference(projects, 'verano')?.id, 'p2');
});

test('encuentra un proyecto por cliente cuando el texto es suficientemente largo', () => {
  assert.equal(findProjectByReference(projects, 'Garnier')?.id, 'p1');
});

test('devuelve null cuando no hay coincidencias', () => {
  assert.equal(findProjectByReference(projects, 'Proyecto inexistente'), null);
  assert.equal(findProjectByReference(projects, ''), null);
});
