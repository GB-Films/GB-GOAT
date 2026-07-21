import React, { useEffect, useState } from 'react';
import { arrayUnion, doc, getDoc, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileText, Loader2, Upload } from 'lucide-react';
import { db, storage } from '../lib/firebase';
import { MAX_UPLOAD_SIZE_LABEL, validateMaxUploadSize } from '../lib/uploadLimits';
import { getFileExtension, sanitizeFileName } from '../lib/files';

const buildInvoiceFileName = (token: string, file: File) => {
  const cleanBase = sanitizeFileName(file.name.replace(/\.[^.]+$/, '') || 'factura').slice(0, 70) || 'factura';
  const extension = getFileExtension(file.name);
  const safeExtension = extension === 'jpg' || extension === 'jpeg' || extension === 'png' || extension === 'pdf'
    ? extension
    : file.type === 'image/jpeg'
      ? 'jpg'
      : file.type === 'image/png'
        ? 'png'
        : 'pdf';
  return `factura-proveedor-${token.slice(0, 8)}-${cleanBase}.${safeExtension}`;
};

const ALLOWED_INVOICE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const INVOICE_ACCEPT = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';
const INVOICE_LABEL = 'PDF, JPG o PNG';

const getInvoiceContentType = (file: File) => {
  if (ALLOWED_INVOICE_TYPES.includes(file.type)) return file.type;
  const extension = getFileExtension(file.name);
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  return 'application/pdf';
};

export default function InvoiceUploadInvite() {
  const { token = '' } = useParams();
  const [invite, setInvite] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    const loadInvite = async () => {
      try {
        const snap = await getDoc(doc(db, 'invoiceUploadInvites', token));
        if (!snap.exists()) {
          setError('Este link no existe o fue eliminado.');
          return;
        }

        const data = snap.data();
        if (data.used || data.status === 'used') {
          setSubmitted(true);
          return;
        }
        if (data.status !== 'pending') {
          setError('Este link no esta disponible.');
          return;
        }
        setInvite({ id: snap.id, ...data });
      } catch (err) {
        console.error('Error loading invoice upload invite:', err);
        setError('No se pudo validar el link. Revisa tu conexion e intenta de nuevo.');
      } finally {
        setLoading(false);
      }
    };

    if (token) loadInvite();
  }, [token]);

  const validateFile = (file?: File | null) => {
    if (!file) return `Selecciona una factura en ${INVOICE_LABEL}.`;
    const isAllowedByType = ALLOWED_INVOICE_TYPES.includes(file.type);
    const isAllowedByName = /\.(pdf|jpe?g|png)$/i.test(file.name);
    if (!isAllowedByType && !isAllowedByName) {
      return `La factura debe ser ${INVOICE_LABEL}.`;
    }
    return validateMaxUploadSize(file, 'factura');
  };

  const submitInvoice = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!invite || uploading) return;
    const file = selectedFile;
    const fileError = validateFile(file);
    if (fileError) {
      alert(fileError);
      return;
    }

    setUploading(true);
    try {
      const collectionName = invite.collectionName === 'budgetItems' ? 'budgetItems' : 'areaExpenses';
      const fileName = buildInvoiceFileName(token, file!);
      const areaFolder = sanitizeFileName(invite.area || 'sin-area') || 'sin-area';
      const path = `projects/${invite.projectId}/areas/${areaFolder}/facturas/${fileName}`;
      const storageRef = ref(storage, path);
      const contentType = getInvoiceContentType(file!);

      await uploadBytes(storageRef, file!, {
        contentType,
        customMetadata: {
          token,
          projectId: invite.projectId,
          expenseId: invite.expenseId,
          collectionName,
          area: invite.area || '',
          areaFolder,
          providerId: invite.providerId || '',
          providerName: invite.providerName || '',
          originalFileName: file!.name,
          uploadedBy: 'provider_public_link',
        },
      });

      const url = await getDownloadURL(storageRef);
      const invoice = {
        id: token,
        fileName,
        originalFileName: file!.name,
        url,
        path,
        contentType,
        size: file!.size,
        uploadedAt: Timestamp.now(),
        uploadedBy: 'provider_public_link',
      };

      const batch = writeBatch(db);
      batch.update(doc(db, 'projects', invite.projectId, collectionName, invite.expenseId), {
        invoices: arrayUnion(invoice),
        invoiceStatus: 'pendiente',
        publicInvoiceUpload: {
          token,
          uploadedAt: serverTimestamp(),
          providerId: invite.providerId || '',
          providerName: invite.providerName || '',
        },
        updatedAt: serverTimestamp(),
      });

      batch.update(doc(db, 'invoiceUploadInvites', token), {
        used: true,
        status: 'used',
        usedAt: serverTimestamp(),
        invoiceFileName: fileName,
        invoicePath: path,
        invoiceUrl: url,
        originalFileName: file!.name,
      });
      await batch.commit();

      setSubmitted(true);
    } catch (err) {
      console.error('Error uploading public invoice:', err);
      alert('No se pudo cargar la factura. Verifica que el link siga vigente y que el archivo no supere el limite.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-3 border-b border-slate-100 pb-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Carga de factura</div>
            <h1 className="text-xl font-black text-slate-900">Gran Berta Films</h1>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-400">
            <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin" />
            <div className="text-[10px] font-black uppercase tracking-widest">Validando link...</div>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-100 bg-red-50 p-5 text-red-700">
            <AlertTriangle className="mb-3 h-5 w-5" />
            <div className="text-sm font-bold">{error}</div>
          </div>
        ) : submitted ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-6 text-center text-emerald-700">
            <CheckCircle2 className="mx-auto mb-3 h-8 w-8" />
            <div className="text-sm font-black uppercase tracking-widest">Factura cargada con exito</div>
            <p className="mt-2 text-xs font-medium text-emerald-700/80">Ya quedo asociada al gasto correspondiente.</p>
          </div>
        ) : (
          <form onSubmit={submitInvoice} className="space-y-5">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Factura a nombre de</div>
              <div className="mt-1 text-lg font-black text-slate-900">{invite.providerName || 'Proveedor asignado'}</div>
              <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-500 sm:grid-cols-2">
                <div><b className="text-slate-700">Proyecto:</b> {invite.projectName || '-'}</div>
                <div><b className="text-slate-700">Area:</b> {invite.area || '-'}</div>
                <div className="sm:col-span-2"><b className="text-slate-700">Concepto:</b> {invite.description || '-'}</div>
              </div>
            </div>

            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center hover:border-black">
              <Upload className="mb-3 h-8 w-8 text-slate-300" />
              <span className="text-sm font-black text-slate-900">{selectedFile ? selectedFile.name : `Seleccionar factura ${INVOICE_LABEL}`}</span>
              <span className="mt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Maximo {MAX_UPLOAD_SIZE_LABEL}</span>
              <input
                type="file"
                accept={INVOICE_ACCEPT}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  const fileError = validateFile(file);
                  if (fileError) {
                    alert(fileError);
                    event.target.value = '';
                    setSelectedFile(null);
                    return;
                  }
                  setSelectedFile(file);
                }}
              />
            </label>

            <button
              type="submit"
              disabled={!selectedFile || uploading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-black px-4 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-slate-800 disabled:bg-slate-300"
            >
              {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
              {uploading ? 'Cargando...' : 'Cargar factura'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
