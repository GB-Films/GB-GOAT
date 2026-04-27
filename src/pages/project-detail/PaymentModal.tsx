import { useRef } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Calendar, DollarSign, History, Plus, Trash2, Wallet } from 'lucide-react';
import { motion } from 'motion/react';
import { db } from '../../lib/firebase';
import { handleFirestoreError } from '../../lib/firestoreUtils';
import { cn } from '../../lib/utils';
import type { Payment, PaymentCollection } from './types';

const formatDate = (dateString: string | any) => {
  if (!dateString) return 'Sin fecha';
  const date = dateString.seconds ? new Date(dateString.seconds * 1000) : new Date(dateString);
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

interface PaymentModalProps {
  projectId?: string;
  item: any | null;
  isOpen: boolean;
  isProjectAdmin: boolean;
  paymentType: PaymentCollection;
  isDeletingPayment: number | null;
  onClose: () => void;
  onPaymentStateChange: (
    itemId: string,
    collectionName: PaymentCollection,
    updatedHistory: Payment[],
    isFullyPaid: boolean
  ) => void;
  onDeletePayment: (paymentIndex: number) => Promise<void>;
}

export function PaymentModal({
  projectId,
  item,
  isOpen,
  isProjectAdmin,
  paymentType,
  isDeletingPayment,
  onClose,
  onPaymentStateChange,
  onDeletePayment,
}: PaymentModalProps) {
  const amountRef = useRef<HTMLInputElement>(null);

  if (!isOpen || !item) return null;

  const paymentHistory = item.paymentHistory || [];
  const totalPaid = paymentHistory.reduce((acc: number, p: any) => acc + p.amount, 0);
  const balance = (Number(item.total) || 0) - totalPaid;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-900 flex items-center gap-2">
            <Wallet className="w-4 h-4 text-emerald-600" />
            Gestión de Pagos
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-black">
            <Plus className="w-5 h-5 rotate-45" />
          </button>
        </div>

        <div className="p-8 space-y-6">
          <div className="flex justify-between items-start">
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

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Pagado</div>
              <div className="text-xl font-black text-emerald-600">
                ${totalPaid.toLocaleString()}
              </div>
            </div>
            <div className="bg-slate-900 p-4 rounded-xl">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Saldo</div>
              <div className="text-xl font-black text-white">
                ${balance.toLocaleString()}
              </div>
            </div>
          </div>

          {isProjectAdmin && (
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!projectId) return;
              
              const formData = new FormData(e.currentTarget);
              const customDate = formData.get('paymentDate') as string;
              const amount = Number(formData.get('amount'));
              
              if (!amount || amount <= 0) {
                alert('Por favor ingrese un monto válido');
                return;
              }

              const currentItemId = item.id;
              const totalPaidBefore = paymentHistory.reduce((acc: number, p: any) => acc + p.amount, 0);
              const isRemainingBalance = Math.abs(amount - ((Number(item.total) || 0) - totalPaidBefore)) < 0.01;

              const newPayment: Payment = {
                id: Math.random().toString(36).substr(2, 9),
                amount,
                detail: formData.get('detail') as string,
                date: customDate ? new Date(customDate + 'T12:00:00') : new Date(),
                type: isRemainingBalance ? 'total' : 'partial'
              };

              const updatedHistory = [...paymentHistory, newPayment];
              const nextTotalPaid = updatedHistory.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
              const itemTotal = Number(item.total) || 0;
              const isFullyPaid = nextTotalPaid >= (itemTotal - 0.01);

              const collectionName: PaymentCollection = item.__paymentCollection || paymentType;
              const docRef = doc(db, 'projects', projectId, collectionName, currentItemId);
              
              try {
                await updateDoc(docRef, {
                  paymentHistory: updatedHistory,
                  paid: isFullyPaid,
                  updatedAt: serverTimestamp()
                });

                onPaymentStateChange(currentItemId, collectionName, updatedHistory, isFullyPaid);
                
                (e.target as HTMLFormElement).reset();
              } catch (err: any) {
                console.error("Error updating payment:", err);
                handleFirestoreError(err, 'update', `projects/${projectId}/${collectionName}/${currentItemId}`);
              }
            }} className="space-y-4 pt-4 border-t border-slate-100">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex-1">
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Fecha del Pago</label>
                  <input name="paymentDate" type="date" defaultValue={new Date().toISOString().split('T')[0]} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" />
                </div>
                <div className="flex-1">
                   <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest text-emerald-600">Saldo Pendiente</label>
                   <button 
                     type="button"
                     onClick={() => {
                       const remaining = Math.max(0, (Number(item.total) || 0) - totalPaid);
                       if (amountRef.current) {
                         amountRef.current.value = remaining.toFixed(2);
                       }
                     }}
                     className="w-full px-4 py-3 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-100 transition-all flex items-center justify-center gap-2 shadow-sm"
                   >
                     Cargar Saldo Total
                   </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Monto a Registrar</label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</div>
                  <input 
                    ref={amountRef}
                    name="amount" 
                    type="number" 
                    step="0.01" 
                    required
                    placeholder="0.00" 
                    className="w-full pl-8 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-xl text-lg font-black text-slate-900 focus:outline-none focus:border-black focus:ring-4 focus:ring-slate-100 transition-all" 
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">Detalle / Referencia</label>
                <input name="detail" placeholder="Ej: Transferencia Banco X, Pago en efectivo..." className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded text-sm focus:outline-none focus:border-black transition-all" />
              </div>
              <button type="submit" className="w-full py-4 bg-emerald-600 text-white rounded-xl text-[10px] font-bold tracking-widest uppercase hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2">
                 <DollarSign className="w-4 h-4" /> Registrar Pago
              </button>
            </form>
          )}

          {isProjectAdmin && paymentHistory.length > 0 && (
            <div className="pt-6 border-t border-slate-100">
              <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-4 tracking-widest flex items-center gap-2">
                 <History className="w-3 h-3" /> Historial de Pagos
              </h3>
              <div className="space-y-3 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                {(paymentHistory as Payment[]).map((payment, idx) => (
                  <div key={payment.id || idx} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="flex-1">
                      <div className="text-xs font-bold text-slate-900">${payment.amount.toLocaleString()}</div>
                      <div className="text-[9px] text-slate-400 uppercase font-medium">{payment.detail || 'Sin detalle'}</div>
                    </div>
                    <div className="text-right flex flex-col items-end gap-1">
                       <div className="text-[9px] text-slate-400 font-bold uppercase flex items-center gap-1 justify-end">
                         <Calendar className="w-2.5 h-2.5" />
                         {formatDate(payment.date)}
                       </div>
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
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
