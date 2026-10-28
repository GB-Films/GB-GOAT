import test from 'node:test';
import assert from 'node:assert/strict';
import { missingProviderInsuranceData, providerBirthDate, providerDataRow, searchExportProviders, selectedExportProviders } from './providerDataExport';
const people = [
  { id: 'juan', type: 'persona', name: 'Juan Pablo', lastName: 'Pérez', nickname: 'Juampi', bankAccount_alias: 'BANCO.ALIAS', dni: '00123456', cuit: '20001234561', birthDate: '1990-02-14', address: 'Domicilio', category: 'Otra', categoryOther: 'Cámara', email: '=literal@example.test' },
  { id: 'sofia', type: 'persona', name: 'Sofía', lastName: 'Pérez', alias: 'Sofi', bankAccount_cbu: 'PRIVATE-CBU' },
  { id: 'legacy', fullName: 'María López', apodo: 'Maru', dni_cuit: '23456789' },
  { id: 'company', type: 'empresa', name: 'Pérez Producciones', nickname: 'Juampi' },
];
test('export search matches reversed names, accents and personal aliases, and excludes companies, selected people and bank aliases', () => {
  assert.deepEqual(searchExportProviders(people, 'perez juan').map(row => row.id), ['juan']);
  assert.deepEqual(searchExportProviders(people, 'SOFIA').map(row => row.id), ['sofia']);
  assert.deepEqual(searchExportProviders(people, 'juampi').map(row => row.id), ['juan']);
  assert.deepEqual(searchExportProviders(people, 'maru').map(row => row.id), ['legacy']);
  assert.equal(searchExportProviders(people, 'banco.alias').length, 0);
  assert.equal(searchExportProviders(people, 'juampi', ['juan']).length, 0);
  assert.deepEqual(selectedExportProviders(people, ['sofia', 'juan', 'juan', 'company', 'gone']).map(row => row.id), ['juan', 'sofia']);
});
test('export keeps identifiers as text, birth dates as dates and ignores banking and unrelated sensitive fields', () => {
  const before = JSON.stringify(people);
  const row = providerDataRow(people[0]);
  assert.equal(row[1], '00123456'); assert.equal(row[2], '20001234561'); assert.equal((row[3] as Date).toISOString(), '1990-02-14T00:00:00.000Z');
  assert.equal(row[5], 'Cámara'); assert.equal(row[7], '=literal@example.test');
  assert.doesNotMatch(JSON.stringify(row), /PRIVATE-CBU|BANCO.ALIAS/);
  assert.deepEqual(missingProviderInsuranceData(people[0]), []);
  assert.deepEqual(missingProviderInsuranceData(people[1]), ['DNI', 'nacimiento', 'domicilio']);
  assert.equal(JSON.stringify(people), before);
});
test('birth dates validate day and month without timezone shifts or guessed data', () => {
  for (const value of ['1990-02-14', '14/02/1990', new Date('1990-02-14T00:00:00Z'), { seconds: Date.parse('1990-02-14') / 1000 }]) assert.equal(providerBirthDate(value)?.toISOString(), '1990-02-14T00:00:00.000Z');
  for (const value of ['', '1990-02-31', '31/13/1990', '14/02/2990', 'unknown', {}, new Date(NaN)]) assert.equal(providerBirthDate(value), null);
  assert.match(String(providerDataRow({ ...people[0], dni: '123', dniNormalized: '', birthDate: '31/02/1990' })[1]), /Revisar/);
});
