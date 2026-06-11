import React, { useEffect, useState } from 'react';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileText, Loader2, Upload } from 'lucide-react';
import { db, storage } from '../lib/firebase';
import { MAX_UPLOAD_SIZE_LABEL, validateMaxUploadSize } from '../lib/uploadLimits';

const sanitizeFileName = (fileName: string) => (
  fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)
);

const buildInvoiceFileName = (token: string, file: File) => {
  const cleanBase = sanitizeFileName(file.name.replace(/\.[^.]+$/, '') || 'factura').slice(0, 70) || 'factura';
  return `factura-proveedor-${token.slice(0, 8)}-${cleanBase}.pdf`;
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
    if (!file) return 'Selecciona una factura en PDF.';
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return 'La factura debe ser un archivo PDF.';
    }
    return validateMaxUploadSize(file, 'PDF');
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
      const fileName = buildInvoiceFileName(token, file!);
      const areaFolder = sanitizeFileName(invite.area || 'sin-area') || 'sin-area';
      const path = `projects/${invite.projectId}/areas/${areaFolder}/facturas/${fileName}`;
      const storageRef = ref(storage, path);

      await uploadBytes(storageRef, file!, {
        contentType: 'application/pdf',
        customMetadata: {
          token,
          projectId: invite.projectId,
          expenseId: invite.expenseId,
          providerId: invite.providerId || '',
          providerName: invite.providerName || '',
          originalFileName: file!.name,
          uploadedBy: 'provider_public_link',
        },
      });

      const url = await getDownloadURL(storageRef);
      const invoice = {
        fileName,
        originalFileName: file!.name,
        url,
        path,
        contentType: 'application/pdf',
        size: file!.size,
        uploadedAt: serverTimestamp(),
        uploadedBy: 'provider_public_link',
      };

      await updateDoc(doc(db, 'projects', invite.projectId, 'areaExpenses', invite.expenseId), {
        invoice,
        invoiceStatus: 'pendiente',
        publicInvoiceUpload: {
          token,
          uploadedAt: serverTimestamp(),
          providerId: invite.providerId || '',
          providerName: invite.providerName || '',
        },
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'invoiceUploadInvites', token), {
        used: true,
        status: 'used',
        usedAt: serverTimestamp(),
        invoiceFileName: fileName,
        invoicePath: path,
        invoiceUrl: url,
        originalFileName: file!.name,
      });

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
              <span className="text-sm font-black text-slate-900">{selectedFile ? selectedFile.name : 'Seleccionar factura PDF'}</span>
              <span className="mt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Maximo {MAX_UPLOAD_SIZE_LABEL}</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
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
