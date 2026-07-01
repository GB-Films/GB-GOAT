import { type FormEvent, useEffect, useRef, useState } from 'react';
import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { Calendar, DollarSign, ExternalLink, History, Paperclip, Plus, Trash2, Wallet } from 'lucide-react';
import { motion } from 'motion/react';
import { db, storage } from '../../lib/firebase';
import { handleFirestoreError } from '../../lib/firestoreUtils';
import { cn } from '../../lib/utils';
import { validateMaxUploadSize } from '../../lib/uploadLimits';
import type { Payment, PaymentCollection } from './types';

const formatDate = (dateString: string | any) => {
  if (!dateString) return 'Sin fecha';
  const date = typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString.trim())
    ? new Date(`${dateString.trim()}T12:00:00`)
    : dateString.seconds ? new Date(dateString.seconds * 1000) : new Date(dateString);
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const parsePaymentDate = (dateValue: any): Date => {
  if (!dateValue) return new Date();
  if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue.trim())) return new Date(`${dateValue.trim()}T12:00:00`);
  if (dateValue.seconds) return new Date(dateValue.seconds * 1000);
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const toDateInputValue = (dateValue: any = new Date()) => {
  if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue.trim())) return dateValue.trim();
  const date = parsePaymentDate(dateValue);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const sanitizeFileName = (fileName: string) => {
  return fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
};

const buildReceiptFileName = (paymentId: string, file: File) => {
  const cleanBase = sanitizeFileName(file.name.replace(/\.[^.]+$/, '') || 'comprobante').slice(0, 70);
  const ext = sanitizeFileName(file.name.split('.').pop() || 'pdf').toLowerCase();
  return `comprobante-${paymentId}-${cleanBase}.${ext}`;
};

const allowedReceiptTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const validateReceiptFile = (file: File) => {
  if (!allowedReceiptTypes.includes(file.type)) {
    return 'El comprobante debe ser PDF, JPG, PNG o WEBP.';
  }

  return validateMaxUploadSize(file, 'comprobante');
};

const formatFileSize = (size: number) => {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
};

const toMoneyCents = (value: unknown) => Math.round((Number(value) || 0) * 100);

interface PaymentModalProps {
  projectId?: string;
  item: any | null;
  isOpen: boolean;
  canManagePayments: boolean;
  canUseCashBox: boolean;
  cashBoxBalance: number;
  cashOwnerEmail?: string;
  cashOwnerName?: string;
  paymentType: PaymentCollection;
  isDeletingPayment: number | null;
  canEditExistingPayments?: boolean;
  currentUserEmail?: string;
  currentUserId?: string;
  currentUserName?: string;
  currentUserRole?: string;
  canEditPaymentRecord?: (payment: Payment, paymentIndex: number) => boolean;
  onClose: () => void;
  onPaymentStateChange: (
    itemId: string,
    collectionName: PaymentCollection,
    updatedHistory: Payment[],
    isFullyPaid: boolean,
    audit?: { paymentLocked: boolean; paymentAuthorIds: string[] }
  ) => void;
  onDeletePayment: (paymentIndex: number) => Promise<void>;
  onCashMovementCreated?: (movement: any) => void;
  onCashMovementUpdated?: (movementId: string, updates: any) => void;
}

export function PaymentModal({
  projectId,
  item,
  isOpen,
  canManagePayments,
  canUseCashBox,
  cashBoxBalance,
  cashOwnerEmail,
  cashOwnerName,
  paymentType,
  isDeletingPayment,
  canEditExistingPayments = false,
  currentUserEmail = '',
  currentUserId = '',
  currentUserName = '',
  currentUserRole = '',
  canEditPaymentRecord,
  onClose,
  onPaymentStateChange,
  onDeletePayment,
  onCashMovementCreated,
  onCashMovementUpdated,
}: PaymentModalProps) {
  const amountRef = useRef<HTMLInputElement>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<File | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState('');
  const [isReceiptDragOver, setIsReceiptDragOver] = useState(false);
  const [paymentDateInput, setPaymentDateInput] = useState(() => toDateInputValue());
  const [editingPaymentIndex, setEditingPaymentIndex] = useState<number | null>(null);
  const [editPaymentDateInput, setEditPaymentDateInput] = useState(() => toDateInputValue());
  const [editReceipt, setEditReceipt] = useState<File | null>(null);

  useEffect(() => {
    setSelectedReceipt(null);
    setReceiptPreviewUrl('');
    setIsReceiptDragOver(false);
    setPaymentDateInput(toDateInputValue());
    setEditingPaymentIndex(null);
    setEditPaymentDateInput(toDateInputValue());
    setEditReceipt(null);
  }, [isOpen, item?.id]);

  useEffect(() => {
    if (!selectedReceipt || !selectedReceipt.type.startsWith('image/')) {
      setReceiptPreviewUrl('');
      return;
    }

    const url = URL.createObjectURL(selectedReceipt);
    setReceiptPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedReceipt]);

  const attachReceipt = (file?: File | null) => {
    if (!file) return;
    const error = validateReceiptFile(file);
    if (error) {
      alert(error);
      return;
    }

    setSelectedReceipt(file);
  };

  const attachEditReceipt = (file?: File | null) => {
    if (!file) return;
    const error = validateReceiptFile(file);
    if (error) {
      alert(error);
      return;
    }

    setEditReceipt(file);
  };

  if (!isOpen || !item) return null;

  const paymentHistory = item.paymentHistory || [];
  const totalPaidCents = paymentHistory.reduce((acc: number, p: any) => acc + toMoneyCents(p.amount), 0);
  const totalPaid = totalPaidCents / 100;
  const balance = (toMoneyCents(item.total) - totalPaidCents) / 100;
  const collectionName: PaymentCollection = item.__paymentCollection || paymentType;

  const updateExistingPayment = async (event: FormEvent<HTMLFormElement>, paymentIndex: number) => {
    event.preventDefault();
    const currentPayment = paymentHistory[paymentIndex] as Payment | undefined;
    if (!projectId || !currentPayment || !canEditExistingPayments || !canEditPaymentRecord?.(currentPayment, paymentIndex)) return;

    const formData = new FormData(event.currentTarget);
    const nextAmount = Number(formData.get('editAmount'));
    const nextDate = formData.get('editPaymentDate') as string;
    const nextDetail = String(formData.get('editDetail') || '');

    if (!nextAmount || nextAmount <= 0) {
      alert('Ingresá un monto válido.');
      return;
    }

    const maxEditableAmount = Math.max(0, (Number(item.total) || 0) - (totalPaid - (Number(currentPayment.amount) || 0)));
    if (toMoneyCents(nextAmount) > toMoneyCents(maxEditableAmount)) {
      alert(`El pago no puede superar el saldo disponible de $${maxEditableAmount.toLocaleString()}.`);
      return;
    }

    let nextReceipt = currentPayment.receipt || null;

    try {
      if (editReceipt) {
        const fileName = buildReceiptFileName(currentPayment.id || Math.random().toString(36).slice(2), editReceipt);
        const path = `projects/${projectId}/${collectionName}/${item.id}/comprobantes/${fileName}`;
        const storageRef = ref(storage, path);

        await uploadBytes(storageRef, editReceipt, {
          contentType: editReceipt.type,
          customMetadata: {
            projectId,
            collectionName,
            itemId: item.id,
            paymentId: currentPayment.id || '',
            originalFileName: editReceipt.name,
          },
        });

        const url = await getDownloadURL(storageRef);
        nextReceipt = {
          fileName,
          originalFileName: editReceipt.name,
          url,
          path,
          contentType: editReceipt.type,
          size: editReceipt.size,
          uploadedAt: new Date(),
          uploadedBy: currentUserEmail,
        };

      }

      const paymentChanges: Payment = {
        ...currentPayment,
        amount: nextAmount,
        detail: nextDetail,
        date: nextDate ? new Date(`${nextDate}T12:00:00`) : parsePaymentDate(currentPayment.date),
        type: nextAmount >= (Number(item.total) || 0) - 0.01 ? 'total' : 'partial',
        receipt: nextReceipt,
      };
      const itemRef = doc(db, 'projects', projectId, collectionName, item.id);

      const result = await runTransaction(db, async (transaction) => {
        const latestItemSnap = await transaction.get(itemRef);
        if (!latestItemSnap.exists()) throw new Error('ITEM_NOT_FOUND');

        const latestItem = latestItemSnap.data();
        const latestHistory = Array.isArray(latestItem.paymentHistory) ? latestItem.paymentHistory as Payment[] : [];
        const latestPaymentIndex = currentPayment.id
          ? latestHistory.findIndex((payment) => payment.id === currentPayment.id)
          : paymentIndex;
        if (latestPaymentIndex < 0 || !latestHistory[latestPaymentIndex]) throw new Error('PAYMENT_NOT_FOUND');

        const itemTotalCents = toMoneyCents(latestItem.total);
        const otherPaymentsTotalCents = latestHistory.reduce((acc, payment, index) => (
          index === latestPaymentIndex ? acc : acc + toMoneyCents(payment.amount)
        ), 0);
        const nextTotalPaidCents = otherPaymentsTotalCents + toMoneyCents(nextAmount);
        if (nextTotalPaidCents > itemTotalCents) throw new Error('PAYMENT_EXCEEDS_TOTAL');

        const isFullyPaid = nextTotalPaidCents >= itemTotalCents;
        const updatedPayment = {
          ...latestHistory[latestPaymentIndex],
          ...paymentChanges,
          type: isFullyPaid ? 'total' as const : 'partial' as const,
        };
        const updatedHistory = latestHistory.map((payment, index) => index === latestPaymentIndex ? updatedPayment : payment);
        transaction.update(itemRef, {
          paymentHistory: updatedHistory,
          paid: isFullyPaid,
          updatedAt: serverTimestamp(),
        });

        if (currentPayment.cashMovementId) {
          transaction.update(doc(db, 'projects', projectId, 'cashMovements', currentPayment.cashMovementId), {
            amount: nextAmount,
            date: paymentChanges.date,
            notes: nextDetail,
            updatedAt: serverTimestamp(),
          });
        }

        return { updatedHistory, isFullyPaid };
      });

      if (editReceipt && currentPayment.receipt?.path && currentPayment.receipt.path !== nextReceipt?.path) {
        deleteObject(ref(storage, currentPayment.receipt.path)).catch(() => {});
      }

      if (currentPayment.cashMovementId) {
        onCashMovementUpdated?.(currentPayment.cashMovementId, {
          amount: nextAmount,
          date: paymentChanges.date,
          notes: nextDetail,
          updatedAt: new Date(),
        });
      }

      onPaymentStateChange(item.id, collectionName, result.updatedHistory, result.isFullyPaid);
      setEditingPaymentIndex(null);
      setEditReceipt(null);
    } catch (error: any) {
      console.error('Error editing payment:', error);
      if (editReceipt && nextReceipt?.path && nextReceipt.path !== currentPayment.receipt?.path) {
        deleteObject(ref(storage, nextReceipt.path)).catch(() => {});
      }
      if (error?.message === 'PAYMENT_EXCEEDS_TOTAL') {
        alert('El pago no puede superar el valor total del gasto. Otro pago pudo haberse registrado mientras editabas.');
        return;
      }
      handleFirestoreError(error, 'update', `projects/${projectId}/${collectionName}/${item.id}`);
      alert('No se pudo actualizar el pago.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl w-full max-w-xl h-[92vh] max-h-[760px] shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="shrink-0 px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-900 flex items-center gap-2">
            <Wallet className="w-4 h-4 text-emerald-600" />
            Gestión de Pagos
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-black">
            <Plus className="w-5 h-5 rotate-45" />
          </button>
        </div>

        <div className="min-h-0 flex-1 p-5 space-y-4 overflow-y-auto custom-scrollbar">
          <div className="flex justify-between items-start gap-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">{item.description}</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                {item.providerName || 'Sin Proveedor asignado'}
              </p>
            </div>
            <div className="text-right">
              <div className="text-lg font-black text-slate-900">${item.total?.toLocaleString()}</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Partida</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Pagado</div>
              <div className="text-lg font-black text-emerald-600">
                ${totalPaid.toLocaleString()}
              </div>
            </div>
            <div className="bg-slate-900 p-3 rounded-xl">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Saldo</div>
              <div className="text-lg font-black text-white">
                ${balance.toLocaleString()}
              </div>
            </div>
          </div>

          {canManagePayments && (
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!projectId) return;
              
              const formData = new FormData(e.currentTarget);
              const customDate = formData.get('paymentDate') as string;
              const amount = Number(formData.get('amount'));
              const formReceiptFile = formData.get('receipt') as File | null;
              const receiptFile = selectedReceipt || (formReceiptFile && formReceiptFile.size > 0 ? formReceiptFile : null);
              const useCashBox = formData.get('useCashBox') === 'on';
              
              if (!amount || amount <= 0) {
                alert('Por favor ingrese un monto válido');
                return;
              }

              const remainingBalanceCents = Math.max(0, toMoneyCents(item.total) - totalPaidCents);
              const remainingBalance = remainingBalanceCents / 100;
              if (toMoneyCents(amount) > remainingBalanceCents) {
                alert(`El pago no puede superar el saldo pendiente de $${remainingBalance.toLocaleString()}.`);
                return;
              }

              if (useCashBox && amount > cashBoxBalance + 0.01) {
                alert('El monto supera el saldo disponible en caja.');
                return;
              }

              if (receiptFile && receiptFile.size > 0) {
                const receiptError = validateReceiptFile(receiptFile);
                if (receiptError) {
                  alert(receiptError);
                  return;
                }
              }

              const currentItemId = item.id;
              const isRemainingBalance = toMoneyCents(amount) === remainingBalanceCents;
              const paymentId = Math.random().toString(36).substr(2, 9);

              const newPayment: Payment = {
                id: paymentId,
                amount,
                detail: formData.get('detail') as string,
                date: customDate ? new Date(customDate + 'T12:00:00') : new Date(),
                type: isRemainingBalance ? 'total' : 'partial',
                method: useCashBox ? 'caja_efectivo' : 'otro',
                createdByEmail: currentUserEmail,
                createdBy: currentUserId,
                createdByName: currentUserName,
                createdByRole: currentUserRole,
              };

              const collectionName: PaymentCollection = item.__paymentCollection || paymentType;
              const docRef = doc(db, 'projects', projectId, collectionName, currentItemId);
              const cashMovementRef = useCashBox ? doc(collection(db, 'projects', projectId, 'cashMovements')) : null;
              
              try {
                if (useCashBox && cashMovementRef) {
                  newPayment.paidByEmail = cashOwnerEmail || '';
                  newPayment.paidByName = cashOwnerName || '';
                  newPayment.cashMovementId = cashMovementRef.id;
                }

                if (receiptFile && receiptFile.size > 0) {
                  const fileName = buildReceiptFileName(paymentId, receiptFile);
                  const path = `projects/${projectId}/${collectionName}/${currentItemId}/comprobantes/${fileName}`;
                  const storageRef = ref(storage, path);

                  await uploadBytes(storageRef, receiptFile, {
                    contentType: receiptFile.type,
                    customMetadata: {
                      projectId,
                      collectionName,
                      itemId: currentItemId,
                      paymentId,
                      originalFileName: receiptFile.name,
                    },
                  });

                  const url = await getDownloadURL(storageRef);
                  newPayment.receipt = {
                    fileName,
                    originalFileName: receiptFile.name,
                    url,
                    path,
                    contentType: receiptFile.type,
                    size: receiptFile.size,
                    uploadedAt: new Date(),
                    uploadedBy: currentUserEmail,
                  };
                }

                const paymentDate = customDate ? new Date(customDate + 'T12:00:00') : new Date();
                const movement = useCashBox && cashMovementRef ? {
                    type: 'pago',
                    amount,
                    date: paymentDate,
                    fromUserEmail: cashOwnerEmail || '',
                    fromUserName: cashOwnerName || '',
                    area: item.area || '',
                    subcategory: item.subcategory || '',
                    collectionName,
                    itemId: currentItemId,
                    paymentId,
                    description: item.description || '',
                    notes: formData.get('detail') as string || '',
                    createdByEmail: cashOwnerEmail || '',
                    createdByName: cashOwnerName || '',
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                  } : null;

                const result = await runTransaction(db, async (transaction) => {
                  const latestItemSnap = await transaction.get(docRef);
                  if (!latestItemSnap.exists()) throw new Error('ITEM_NOT_FOUND');

                  const latestItem = latestItemSnap.data();
                  const latestHistory = Array.isArray(latestItem.paymentHistory) ? latestItem.paymentHistory as Payment[] : [];
                  const latestItemTotalCents = toMoneyCents(latestItem.total);
                  const latestTotalPaidCents = latestHistory.reduce((acc, payment) => acc + toMoneyCents(payment.amount), 0);
                  if (latestTotalPaidCents + toMoneyCents(amount) > latestItemTotalCents) throw new Error('PAYMENT_EXCEEDS_TOTAL');

                  const updatedHistory = [...latestHistory, newPayment];
                  const existingPaymentAuthorIds = Array.isArray(latestItem.paymentAuthorIds)
                    ? latestItem.paymentAuthorIds.filter((authorId: unknown) => typeof authorId === 'string' && authorId)
                    : [];
                  const canInitializePaymentAudit = latestHistory.length === 0 || latestItem.paymentLocked === true;
                  const paymentAuthorIds = canInitializePaymentAudit && currentUserId
                    ? [...existingPaymentAuthorIds, currentUserId]
                    : existingPaymentAuthorIds;
                  const nextTotalPaidCents = latestTotalPaidCents + toMoneyCents(amount);
                  const isFullyPaid = nextTotalPaidCents >= latestItemTotalCents;

                  if (movement && cashMovementRef) transaction.set(cashMovementRef, movement);
                  transaction.update(docRef, {
                    paymentHistory: updatedHistory,
                    paid: isFullyPaid,
                    updatedAt: serverTimestamp(),
                    ...(canInitializePaymentAudit && currentUserId ? {
                      paymentLocked: true,
                      paymentAuthorIds,
                    } : {}),
                  });

                  return {
                    updatedHistory,
                    isFullyPaid,
                    audit: canInitializePaymentAudit && currentUserId
                      ? { paymentLocked: true, paymentAuthorIds }
                      : undefined,
                  };
                });

                if (movement && cashMovementRef) {
                  onCashMovementCreated?.({ id: cashMovementRef.id, ...movement, createdAt: new Date(), updatedAt: new Date() });
                }

                onPaymentStateChange(currentItemId, collectionName, result.updatedHistory, result.isFullyPaid, result.audit);
                
                (e.target as HTMLFormElement).reset();
                setSelectedReceipt(null);
                setPaymentDateInput(toDateInputValue());
              } catch (err: any) {
                console.error("Error updating payment:", err);
                if (newPayment.receipt?.path) deleteObject(ref(storage, newPayment.receipt.path)).catch(() => {});
                if (err?.message === 'PAYMENT_EXCEEDS_TOTAL') {
                  alert('No se registró el pago porque el gasto ya alcanzó su valor total. Actualizá y revisá el historial.');
                  return;
                }
                handleFirestoreError(err, 'update', `projects/${projectId}/${collectionName}/${currentItemId}`);
              }
            }} className="space-y-3 pt-3 border-t border-slate-100">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex-1">
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1.5 tracking-widest">Fecha del Pago</label>
                  <input
                    name="paymentDate"
                    type="date"
                    value={paymentDateInput}
                    onChange={(event) => setPaymentDateInput(event.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded text-xs font-bold text-slate-800 focus:outline-none focus:border-black"
                  />
                </div>
                <div className="flex-1">
                   <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1.5 tracking-widest text-emerald-600">Saldo Pendiente</label>
                   <button 
                     type="button"
                     onClick={() => {
                       const remaining = Math.max(0, (Number(item.total) || 0) - totalPaid);
                       if (amountRef.current) {
                         amountRef.current.value = remaining.toFixed(2);
                       }
                     }}
                     className="w-full px-3 py-2 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-100 transition-all flex items-center justify-center gap-2 shadow-sm"
                   >
                     Cargar Saldo Total
                   </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1.5 tracking-widest">Monto a Registrar</label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</div>
                  <input 
                    ref={amountRef}
                    name="amount" 
                    type="number" 
                    step="0.01" 
                    min="0.01"
                    max={Math.max(0, balance)}
                    required
                    placeholder="0.00" 
                    className="w-full pl-8 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-base font-black text-slate-900 focus:outline-none focus:border-black focus:ring-4 focus:ring-slate-100 transition-all" 
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1.5 tracking-widest">Detalle / Referencia</label>
                <input name="detail" placeholder="Ej: Transferencia Banco X, Pago en efectivo..." className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded text-xs focus:outline-none focus:border-black transition-all" />
              </div>
              {canUseCashBox && (
                <label className="flex items-center justify-between gap-4 p-3 bg-amber-50 border border-amber-100 rounded-xl cursor-pointer">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Usar caja en efectivo</div>
                    <div className="text-xs text-amber-700/70 mt-1">Saldo disponible: ${cashBoxBalance.toLocaleString()}</div>
                  </div>
                  <input name="useCashBox" type="checkbox" className="w-4 h-4 accent-amber-600" />
                </label>
              )}
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1.5 tracking-widest">Comprobante de Pago</label>
                <label
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setIsReceiptDragOver(true);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'copy';
                    setIsReceiptDragOver(true);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                      setIsReceiptDragOver(false);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsReceiptDragOver(false);
                    attachReceipt(event.dataTransfer.files.item(0));
                  }}
                  className={cn(
                    "w-full px-3 py-3 bg-slate-50 border border-dashed rounded text-[10px] font-bold uppercase tracking-widest transition-all flex flex-col items-center justify-center gap-2 cursor-pointer",
                    isReceiptDragOver
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 text-slate-400 hover:text-slate-900 hover:border-slate-900"
                  )}
                >
                  {receiptPreviewUrl ? (
                    <img src={receiptPreviewUrl} alt="Previsualizacion del comprobante" className="h-16 max-w-full rounded border border-slate-200 object-contain bg-white" />
                  ) : (
                    <Paperclip className="w-5 h-5" />
                  )}
                  <span>{selectedReceipt ? 'Comprobante adjunto' : 'Arrastrar o adjuntar PDF / Imagen'}</span>
                  {selectedReceipt && (
                    <span className="text-[10px] normal-case tracking-normal text-slate-500 font-medium">
                      {selectedReceipt.name} · {formatFileSize(selectedReceipt.size)}
                    </span>
                  )}
                  <input
                    name="receipt"
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
                    className="hidden"
                    onChange={(event) => attachReceipt(event.target.files?.[0])}
                  />
                </label>
                {selectedReceipt && (
                  <button
                    type="button"
                    onClick={() => setSelectedReceipt(null)}
                    className="mt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-red-500 transition-colors"
                  >
                    Quitar comprobante
                  </button>
                )}
              </div>
              <button type="submit" disabled={balance <= 0.01} className="w-full py-3 bg-emerald-600 text-white rounded-xl text-[10px] font-bold tracking-widest uppercase hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed">
                 <DollarSign className="w-4 h-4" /> Registrar Pago
              </button>
            </form>
          )}

          {canManagePayments && paymentHistory.length > 0 && (
            <div className="pt-4 border-t border-slate-100">
              <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-3 tracking-widest flex items-center gap-2">
                 <History className="w-3 h-3" /> Historial de Pagos
              </h3>
              <div className="space-y-2">
                {(paymentHistory as Payment[]).map((payment, idx) => {
                  const paymentAuthor = payment.createdByName || payment.paidByName || payment.createdByEmail || payment.paidByEmail || '';
                  const cashOwner = payment.paidByName || payment.paidByEmail || payment.createdByName || payment.createdByEmail || '';
                  const wasPaidWithCashBox = payment.method === 'caja_efectivo';
                  const editableMaxAmount = Math.max(0, (toMoneyCents(item.total) - (totalPaidCents - toMoneyCents(payment.amount))) / 100);
                  return (
                  <div key={payment.id || idx} className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    {editingPaymentIndex === idx ? (
                      <form onSubmit={(event) => updateExistingPayment(event, idx)} className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            name="editPaymentDate"
                            type="date"
                            value={editPaymentDateInput}
                            onChange={(event) => setEditPaymentDateInput(event.target.value)}
                            className="px-3 py-2 bg-white border border-slate-100 rounded text-xs font-bold text-slate-800 focus:outline-none focus:border-black"
                          />
                          <input
                            name="editAmount"
                            type="number"
                            step="0.01"
                            min="0.01"
                            max={editableMaxAmount}
                            defaultValue={payment.amount}
                            className="px-3 py-2 bg-white border border-slate-100 rounded text-xs font-bold focus:outline-none focus:border-black"
                          />
                        </div>
                        <input
                          name="editDetail"
                          defaultValue={payment.detail || ''}
                          placeholder="Detalle"
                          className="w-full px-3 py-2 bg-white border border-slate-100 rounded text-xs focus:outline-none focus:border-black"
                        />
                        <label className="flex items-center justify-between gap-2 px-3 py-2 bg-white border border-dashed border-slate-200 rounded text-[10px] font-bold uppercase tracking-widest text-slate-400 cursor-pointer hover:text-slate-900 hover:border-slate-900">
                          <span>{editReceipt ? editReceipt.name : payment.receipt?.url ? 'Reemplazar comprobante' : 'Agregar comprobante'}</span>
                          <Paperclip className="w-3.5 h-3.5" />
                          <input
                            type="file"
                            accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
                            className="hidden"
                            onChange={(event) => attachEditReceipt(event.target.files?.[0])}
                          />
                        </label>
                        <div className="flex gap-2">
                          <button type="submit" className="flex-1 px-3 py-2 bg-slate-900 text-white rounded text-[10px] font-black uppercase tracking-widest">Guardar</button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPaymentIndex(null);
                              setEditReceipt(null);
                            }}
                            className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded text-[10px] font-black uppercase tracking-widest text-slate-500"
                          >
                            Cancelar
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex justify-between items-center">
                        <div className="flex-1">
                          <div className="text-xs font-bold text-slate-900">${payment.amount.toLocaleString()}</div>
                          <div className="text-[9px] text-slate-400 uppercase font-medium">{payment.detail || 'Sin detalle'}</div>
                          <div className="mt-1 text-[8px] font-black uppercase tracking-widest text-slate-300">
                            {paymentAuthor ? `Cargado por ${paymentAuthor}` : 'Cargado por usuario no registrado'}
                          </div>
                          {wasPaidWithCashBox && (
                            <div className="mt-2 inline-flex max-w-full items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-amber-700">
                              <Wallet className="h-3 w-3 shrink-0" />
                              <span className="truncate">
                                Caja de {cashOwner || 'responsable sin identificar'}
                              </span>
                            </div>
                          )}
                          {payment.receipt?.url && (
                            <a
                              href={payment.receipt.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-blue-600 hover:underline"
                            >
                              <ExternalLink className="w-2.5 h-2.5" />
                              Ver comprobante
                            </a>
                          )}
                        </div>
                        <div className="text-right flex flex-col items-end gap-1">
                          <div className="text-[9px] text-slate-400 font-bold uppercase flex items-center gap-1 justify-end">
                            <Calendar className="w-2.5 h-2.5" />
                            {formatDate(payment.date)}
                          </div>
                          {canEditExistingPayments && canEditPaymentRecord?.(payment, idx) && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPaymentIndex(idx);
                                setEditPaymentDateInput(toDateInputValue(payment.date));
                                setEditReceipt(null);
                              }}
                              className="mt-2 text-[10px] font-bold uppercase px-3 py-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 hover:border-black hover:text-black"
                            >
                              Editar
                            </button>
                          )}
                          {canEditPaymentRecord?.(payment, idx) && (
                            <button
                              type="button"
                              disabled={isDeletingPayment === idx}
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                await onDeletePayment(idx);
                              }}
                              className={cn(
                                "mt-2 text-[10px] font-bold uppercase px-3 py-1.5 rounded-lg transition-all flex items-center justify-center border shadow-sm active:scale-95 w-full",
                                isDeletingPayment === idx
                                  ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                                  : "bg-white text-rose-600 border-rose-200 hover:bg-rose-600 hover:text-white"
                              )}
                            >
                              {isDeletingPayment === idx ? (
                                "Borrando..."
                              ) : (
                                <><Trash2 className="w-3 h-3 mr-1" /> Eliminar Pago</>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
