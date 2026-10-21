import { getFunctions, httpsCallable } from 'firebase/functions';
import { deleteObject, getBlob, getMetadata, ref, uploadBytes } from 'firebase/storage';
import { auth, storage } from './firebase';
import { sanitizeFileName } from './files';

export const expenseAllocationKey = (line: any) => `${line.projectId}/${line.collectionName}/${line.expenseId || line.itemId}`;
import { moneyCents } from './sharedAllocations';
export { moneyCents, validateSharedAllocations } from './sharedAllocations';
export const sharedInvoiceCapacity = (line: any) => Math.max(0, moneyCents(line.total)
  - (line.item?.sharedInvoices || []).reduce((sum: number, record: any) => sum + record.amountCents, 0)) / 100;

export function validateProviderFile(file: File) {
  if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    || file.size <= 0 || file.size > 2 * 1024 * 1024) throw Error('Usá PDF, JPG, PNG o WEBP de hasta 2 MB.');
}
export async function uploadProviderFile(providerId: string, id: string, file: File) {
  validateProviderFile(file);
  const path = `providerFinance/${providerId}/${id}/${sanitizeFileName(file.name).slice(0, 120)}`;
  const fileRef = ref(storage, path);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
  try {
    const metadata = await getMetadata(fileRef);
    if (metadata.customMetadata?.sha256 !== hash) throw Error('El archivo del intento anterior es distinto. Cerrá la carga y volvé a empezar.');
    return { path };
  } catch (error) { if ((error as { code?: string }).code !== 'storage/object-not-found') throw error; }
  await uploadBytes(fileRef, file, { contentType: file.type, customMetadata: { providerId, recordId: id, uploadedBy: auth.currentUser?.email || '', sha256: hash } });
  return { path };
}
export async function discardStagedProviderFile(file?: { path: string }) {
  if (file) await deleteObject(ref(storage, file.path)).catch(() => {});
}
export async function openProviderFile(file: { path: string; fileName: string }) {
  const blob = await getBlob(ref(storage, file.path), 2 * 1024 * 1024);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = file.fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
const callable = httpsCallable(getFunctions(auth.app, 'us-central1'), 'manageProviderFinance');
export async function providerFinanceRequest(input: Record<string, unknown>) {
  try { return (await callable(input)).data; }
  catch (error) {
    if ((error as { code: string }).code === 'functions/not-found') throw Error('La carga compartida todavía no está publicada.');
    throw error;
  }
}
