import assert from 'node:assert/strict';
import test from 'node:test';
import { administrativeDocumentContentType, administrativeDocumentPath, validateAdministrativeDocument } from './administrativeDocuments';

test('administrative files stay inside their own client or project folder', () => {
  assert.equal(administrativeDocumentPath('project', 'garnier', 'doc-1', 'OC 123.pdf'),
    'administration/projects/garnier/doc-1/OC-123.pdf');
  assert.equal(administrativeDocumentPath('client', 'loreal', 'doc-2', 'Requisitos.xlsx'),
    'administration/clients/loreal/doc-2/Requisitos.xlsx');
});

test('administrative uploads accept documents but reject mismatched or oversized files', () => {
  const pdf = new File(['%PDF-1.7'], 'factura.pdf', { type: 'application/pdf' });
  assert.equal(validateAdministrativeDocument(pdf), '');
  assert.equal(administrativeDocumentContentType(pdf), 'application/pdf');
  assert.match(validateAdministrativeDocument(new File(['x'], 'factura.pdf', { type: 'text/html' })), /no coincide/);
  assert.match(validateAdministrativeDocument(new File(['x'], 'programa.exe')), /PDF/);
  assert.match(validateAdministrativeDocument(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'enorme.pdf')), /10 MB/);
});
