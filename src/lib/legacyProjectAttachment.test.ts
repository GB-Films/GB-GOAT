import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legacyProjectAttachment } from './legacyProjectAttachment';

test('historical project links resolve to an authenticated request without copying the download token', () => {
  const path = 'projects/sample/areas/Arte/facturas/Factura de Arte.pdf';
  const make = (bucket: string, file: string) => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(file)}?alt=media&token=ficticio`;
  assert.deepEqual(legacyProjectAttachment(make('app.example', path), 'app.example'), { projectId: 'sample', path });
  assert.equal(legacyProjectAttachment(make('other.example', path), 'app.example'), null);
  assert.equal(legacyProjectAttachment(make('app.example', 'providerFinance/sample/a/b.pdf'), 'app.example'), null);
  assert.equal(legacyProjectAttachment(make('app.example', 'projects/sample/../other/doc.pdf'), 'app.example'), null);
  assert.equal(legacyProjectAttachment(make('app.example', path).replace('firebasestorage.googleapis.com', 'other.example'), 'app.example'), null);
});
