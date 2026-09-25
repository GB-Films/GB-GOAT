import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const projectId = 'payment-receipt-project';
const expenseId = 'garnier-meira';
const testEnv = await initializeTestEnvironment({
  projectId: 'demo-gb-goat-storage-receipts',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  storage: { rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8') },
});

const admin = testEnv.authenticatedContext('global-admin', { email: 'admin@example.test' });
const owner = testEnv.authenticatedContext('project-owner', { email: 'owner@example.test' });
const projectAdmin = testEnv.authenticatedContext('project-admin', { email: 'project-admin@example.test' });
const editor = testEnv.authenticatedContext('area-editor', { email: 'editor@example.test' });
const outsider = testEnv.authenticatedContext('outsider', { email: 'outsider@example.test' });

const metadata = (scope, overrides = {}) => ({
  projectId,
  collectionName: 'areaExpenses',
  itemId: expenseId,
  paymentId: 'payment-1',
  uploadAccessScope: scope,
  originalFileName: 'comprobante.pdf',
  ...overrides,
});

let nextFile = 0;
const upload = (context, fields) => context.storage()
  .ref(`projects/${projectId}/areaExpenses/${expenseId}/comprobantes/test-${++nextFile}.pdf`)
  .put(new Uint8Array([37, 80, 68, 70]), {
    contentType: 'application/pdf',
    customMetadata: fields,
  });

try {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/global-admin'), { email: 'admin@example.test', role: 'admin' });
    await setDoc(doc(db, 'users/outsider'), { email: 'outsider@example.test', role: 'colaborador' });
    await setDoc(doc(db, `projects/${projectId}`), {
      createdBy: 'project-owner',
      collaboratorEmails: ['project-admin@example.test', 'editor@example.test'],
    });
    await setDoc(doc(db, `projects/${projectId}/collaborators/project-admin@example.test`), {
      role: 'admin',
    });
    await setDoc(doc(db, `projects/${projectId}/collaborators/editor@example.test`), {
      role: 'jefe_area',
      canEditBudgetAreas: true,
      allowedTabs: ['areas'],
      allowedCategories: ['Producción'],
      allowedSubcategories: [],
    });
    await setDoc(doc(db, `projects/${projectId}/areaExpenses/${expenseId}`), {
      area: 'Producción', subcategory: '', providerName: 'Meira', total: 173241,
    });
  });

  await assertSucceeds(upload(admin, metadata('global_admin')));
  await assertSucceeds(upload(owner, metadata('project_owner')));
  await assertSucceeds(upload(projectAdmin, metadata('project_admin')));
  await assertSucceeds(upload(editor, metadata('area_editor')));
  await assertFails(upload(outsider, metadata('global_admin')));
  await assertFails(upload(editor, metadata('area_editor', { itemId: 'different-expense' })));
  await assertFails(upload(editor, metadata('project_admin')));
  assert.equal(nextFile, 7);
  console.log('Storage payment receipt permissions passed');
} finally {
  await testEnv.cleanup();
}
