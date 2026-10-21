import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useAuth } from '../context/AuthContext';
import { db, storage } from '../lib/firebase';
import {
  administrativeDocumentContentType, administrativeDocumentPath,
  validateAdministrativeDocument, type AdministrativeDocument, type AdministrativeDocumentKind,
  type AdministrativeDocumentScope,
} from '../lib/administrativeDocuments';

export function useAdministrativeDocuments(scope: AdministrativeDocumentScope, scopeId: string) {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<AdministrativeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (!scopeId) { setDocuments([]); setLoading(false); return; }
    setLoading(true);
    setError('');
    setDocuments([]);
    try {
      const snapshot = await getDocs(collection(db, scope === 'project' ? 'projectAdministration' : 'clientAdministration', scopeId, 'documents'));
      if (currentRequest !== requestId.current) return;
      setDocuments(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as AdministrativeDocument))
        .sort((a, b) => {
          const timestamp = (value: unknown) => value && typeof value === 'object' && 'toMillis' in value
            ? (value as { toMillis: () => number }).toMillis()
            : value instanceof Date ? value.getTime() : 0;
          return timestamp(b.createdAt) - timestamp(a.createdAt);
        }));
    } catch {
      if (currentRequest === requestId.current) setError('No pudimos leer los documentos. Reintentá.');
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [scope, scopeId]);

  useEffect(() => {
    void reload();
    return () => { requestId.current += 1; };
  }, [reload]);

  const upload = async (file: File, kind: AdministrativeDocumentKind, title: string) => {
    const validation = validateAdministrativeDocument(file);
    if (validation) throw new Error(validation);
    if (!scopeId || !user?.email) throw new Error('Iniciá sesión para cargar documentos.');
    const cleanTitle = title.trim().slice(0, 200) || file.name.slice(0, 200);
    const documentRef = doc(collection(db, scope === 'project' ? 'projectAdministration' : 'clientAdministration', scopeId, 'documents'));
    const path = administrativeDocumentPath(scope, scopeId, documentRef.id, file.name);
    const fileRef = ref(storage, path);
    const payload = {
      scopeId, kind, title: cleanTitle,
      fileName: path.split('/').at(-1) || file.name,
      originalFileName: file.name.slice(0, 255), path,
      contentType: administrativeDocumentContentType(file), size: file.size,
      uploadedBy: user.email, createdAt: serverTimestamp(),
    };
    setUploading(true);
    setError('');
    try {
      await uploadBytes(fileRef, file, {
        contentType: payload.contentType,
        customMetadata: { scopeId, documentId: documentRef.id, uploadedBy: user.email },
      });
      try {
        await setDoc(documentRef, payload);
      } catch (cause) {
        await deleteObject(fileRef).catch(() => {});
        throw cause;
      }
      const added = { id: documentRef.id, ...payload, createdAt: new Date() } as AdministrativeDocument;
      setDocuments(current => [added, ...current]);
      return added;
    } catch {
      const message = 'No se pudo guardar el documento. Comprobá tu acceso e intentá nuevamente.';
      setError(message);
      throw new Error(message);
    } finally {
      setUploading(false);
    }
  };

  const open = async (document: AdministrativeDocument) => {
    if (!document.path) return;
    const destination = window.open('', '_blank');
    try {
      const url = await getDownloadURL(ref(storage, document.path));
      if (destination) destination.location.href = url;
      else window.location.href = url;
    } catch {
      destination?.close();
      setError('No se pudo abrir el archivo. Reintentá.');
    }
  };

  return { documents, loading, uploading, error, reload, upload, open };
}
