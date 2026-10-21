import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-gb-goat-admin-documents',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  storage: { rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8') },
});
const admin = env.authenticatedContext('admin', { email: 'admin@example.test' });
const teammate = env.authenticatedContext('teammate', { email: 'teammate@example.test' });
const projectPath = 'projectAdministration/project-1/documents/contract-1';
const clientPath = 'clientAdministration/client-1/documents/guide-1';
const documentData = (scopeId, folder, documentId, kind) => ({
  scopeId, kind, title: 'Documento verificado', fileName: 'archivo.pdf', originalFileName: 'archivo.pdf',
  path: `administration/${folder}/${scopeId}/${documentId}/archivo.pdf`,
  contentType: 'application/pdf', size: 7, uploadedBy: 'admin@example.test', createdAt: serverTimestamp(),
});
const upload = (context, folder, id, documentId, metadata = {}) => context.storage()
  .ref(`administration/${folder}/${id}/${documentId}/archivo.pdf`)
  .put(new Uint8Array([37, 80, 68, 70]), {
    contentType: 'application/pdf',
    customMetadata: { scopeId: id, documentId, uploadedBy: 'admin@example.test', ...metadata },
  });

try {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users/admin'), { email: 'admin@example.test', role: 'admin' });
    await setDoc(doc(context.firestore(), 'users/teammate'), { email: 'teammate@example.test', role: 'colaborador' });
    await setDoc(doc(context.firestore(), 'projects/project-1'), { name: 'Proyecto', createdBy: 'teammate', collaboratorEmails: ['teammate@example.test'] });
    await setDoc(doc(context.firestore(), 'clients/client-1'), { businessName: 'Cliente' });
  });

  await assertSucceeds(upload(admin, 'projects', 'project-1', 'contract-1'));
  await assertSucceeds(upload(admin, 'clients', 'client-1', 'guide-1'));
  await assertSucceeds(admin.storage().ref('administration/projects/project-1/contract-1/archivo.pdf').getDownloadURL());
  await assertFails(teammate.storage().ref('administration/projects/project-1/contract-1/archivo.pdf').getDownloadURL());
  await assertFails(teammate.storage().ref('administration/clients/client-1/guide-1/archivo.pdf').getDownloadURL());
  await assertFails(upload(teammate, 'projects', 'project-1', 'contract-2'));
  await assertFails(upload(admin, 'projects', 'project-1', 'contract-3', { scopeId: 'other-project' }));
  await assertFails(upload(admin, 'clients', 'missing-client', 'guide-2'));

  await assertSucceeds(setDoc(doc(admin.firestore(), projectPath), documentData('project-1', 'projects', 'contract-1', 'agreement')));
  await assertSucceeds(setDoc(doc(admin.firestore(), clientPath), documentData('client-1', 'clients', 'guide-1', 'billing_guide')));
  await assertSucceeds(getDoc(doc(admin.firestore(), projectPath)));
  await assertSucceeds(getDocs(collection(admin.firestore(), 'clientAdministration/client-1/documents')));
  await assertFails(getDoc(doc(teammate.firestore(), projectPath)));
  await assertFails(getDocs(collection(teammate.firestore(), 'clientAdministration/client-1/documents')));
  await assertFails(setDoc(doc(teammate.firestore(), projectPath), documentData('project-1', 'projects', 'contract-1', 'agreement')));
  await assertFails(setDoc(doc(admin.firestore(), 'projectAdministration/project-1/documents/bad-path'), documentData('project-1', 'clients', 'bad-path', 'agreement')));

  const clientRecord = revision => ({ schemaVersion: 1, clientId: 'client-1', fiscalAddress: '', billingContactName: '',
    billingContactEmail: '', supplierPortalUrl: '', billingInstructions: '', paymentInstructions: '', notes: '',
    revision, updatedBy: 'admin@example.test', updatedAt: serverTimestamp() });
  await assertSucceeds(setDoc(doc(admin.firestore(), 'clientAdministration/client-1'), clientRecord(1)));
  await assertFails(getDoc(doc(teammate.firestore(), 'clientAdministration/client-1')));
  await assertFails(setDoc(doc(teammate.firestore(), 'clientAdministration/client-1'), clientRecord(2)));
  await assertFails(setDoc(doc(admin.firestore(), 'clientAdministration/client-1'), clientRecord(1)));
  await assertSucceeds(setDoc(doc(admin.firestore(), 'clientAdministration/client-1'), clientRecord(2)));
  console.log('Administrative project and client documents are private to app admins and scoped to existing records.');
} finally {
  await env.cleanup();
}
