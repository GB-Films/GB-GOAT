const { test } = require('node:test');
const assert = require('node:assert/strict');

// Inspect the real SDK deployment manifest, not a copied options fixture.
// No handler is invoked and no production credentials or database are used.
process.env.GCLOUD_PROJECT = 'demo-gb-goat-import-config';
const { importCrmProject } = require('./index');

test('every deployment grants only the dedicated CRM identity access to its importer', () => {
  assert.deepEqual(importCrmProject.__endpoint.httpsTrigger.invoker, [
    'crm-goat-caller@gb-goat.iam.gserviceaccount.com',
  ]);
});

test('the importer retains its create-only runtime identity and bounded on-demand resources', () => {
  const endpoint = importCrmProject.__endpoint;
  assert.equal(endpoint.serviceAccountEmail, 'crm-project-import@gb-goat.iam.gserviceaccount.com');
  assert.equal(endpoint.minInstances, 0);
  assert.equal(endpoint.maxInstances, 2);
  assert.equal(endpoint.timeoutSeconds, 30);
});
