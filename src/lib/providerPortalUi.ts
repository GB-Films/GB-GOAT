type SigningDocument = {
  id: string; documentId?: string; projectId?: string; projectName?: string; providerId?: string;
  signed?: boolean; status?: string; declarationKind?: string; declarationVersion?: string;
};
const inactive = new Set(['cancelled', 'revoked', 'replaced', 'rejected', 'applied', 'active', 'completed', 'signed']);
export function groupPortalDocumentsByProject<T extends SigningDocument>(documents: T[]) {
  const groups = new Map<string, { key: string; name: string; documents: T[] }>();
  for (const doc of documents) {
    const key = doc.declarationKind ? 'declarations' : doc.projectId ? `project:${doc.projectId}` : `unassigned:${doc.id}`;
    const name = doc.declarationKind ? 'Datos y autorizaciones' : doc.projectName?.trim() || '';
    if (!groups.has(key)) groups.set(key, { key, name, documents: [] });
    const group = groups.get(key)!;
    if (!group.name && name) group.name = name;
    group.documents.push(doc);
  }
  return [...groups.values()].map(group => ({ ...group, name: group.name || 'Proyecto sin informar' }));
}
export function needsPortalSignature(doc: SigningDocument) {
  return !doc.signed && !inactive.has(doc.status || '')
    && !(doc.declarationKind === 'representation' && doc.declarationVersion !== 'company-representation-v4');
}
export function pendingPortalSignatureCount(documents: SigningDocument[]) {
  return new Set(documents.filter(needsPortalSignature).map(d => JSON.stringify([d.projectId, d.documentId || d.id]))).size;
}
export function representsAnotherProvider(member?: { type?: string; capacity?: string }) {
  return !!member && (member.type === 'empresa' || (!!member.capacity && member.capacity !== 'own'));
}
export function profileApplicationConflict(error: { message?: string }) {
  return /datos cambiaron|ficha cambi[oó]|datos.*modificaron|datos.*cambiado/i.test(error?.message || '');
}
export function portalErrorMessage(error: { message?: string; code?: string }) {
  if (profileApplicationConflict(error)) return 'Tu ficha cambió. Revisá tus datos y firmá nuevamente.';
  if (/unavailable|deadline-exceeded|network|internal/.test(error?.code || '') || /failed to fetch|network request failed|CORS/i.test(error?.message || '')) return 'No pudimos completar la acción. Intentá nuevamente.';
  return (error?.message || 'No pudimos completar la acción. Intentá nuevamente.').replace(/^Firebase:\s*/i, '').replace(/\s*\(functions\/[^)]+\)\.?$/, '');
}
