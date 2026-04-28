import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { providerDisplayName } from '../../lib/providerConstants';

interface BudgetRowCellProps {
  item: any;
  providers?: any[];
  onUpdate: (itemId: string, updates: any) => Promise<void>;
  onDelete?: (itemId: string) => Promise<void>;
  type: 'provider' | 'description' | 'price' | 'quantity' | 'paid';
  onManagePayment?: (item: any) => void;
  disabledPayment?: boolean;
  disabled?: boolean;
}

export function BudgetRowCell({ item, providers, onUpdate, type, onManagePayment, disabledPayment, disabled }: BudgetRowCellProps) {
  const [isEditingProvider, setIsEditingProvider] = useState(false);
  const [providerSearch, setProviderSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsEditingProvider(false);
      }
    }
    if (isEditingProvider) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isEditingProvider]);

  const isInvalidProvider = item.providerName && !item.providerId && providers?.length;

  const handleValueUpdate = (field: string, value: any) => {
    if (disabled) return;
    const updates: any = { [field]: value };
    if (field === 'quantity' || field === 'unitPrice') {
       const qty = field === 'quantity' ? Number(value) : item.quantity;
       const price = field === 'unitPrice' ? Number(value) : item.unitPrice;
       updates.total = qty * price;
    }
    onUpdate(item.id, updates);
  };

  if (type === 'provider') {
    return (
      <div className="relative group/provider">
        {item.providerId || item.providerName ? (
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black shrink-0",
              isInvalidProvider ? "bg-red-500 text-white animate-pulse" : "bg-slate-900 text-white"
            )}>
              {item.providerName?.[0] || '?'}
            </div>
            <span className={cn(
              "font-bold uppercase truncate text-[10px]",
              isInvalidProvider ? "text-red-500 underline decoration-dotted" : "text-slate-900"
            )}>
              {item.providerName || 'Sin Nombre'}
            </span>
            {!disabled && (
              <button 
                onClick={() => setIsEditingProvider(true)}
                className="opacity-0 group-hover/provider:opacity-100 p-1 text-slate-300 hover:text-black transition-all"
              >
                <Plus className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        ) : (
          disabled ? (
            <span className="text-slate-300 font-bold uppercase text-[9px] tracking-widest">Sin staff</span>
          ) : (
            <button 
              onClick={() => setIsEditingProvider(true)}
              className="text-slate-300 hover:text-black font-bold uppercase text-[9px] tracking-widest flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Asignar Staff
            </button>
          )
        )}
        
        {isEditingProvider && !disabled && (
           <div 
             ref={dropdownRef}
             className="absolute top-0 left-0 w-64 bg-white border border-slate-200 shadow-2xl rounded-lg z-[100] p-3 mt-8"
           >
              <div className="relative mb-3">
                <input 
                  autoFocus
                  placeholder="Buscar profesional..."
                  value={providerSearch}
                  onChange={(e) => setProviderSearch(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 rounded border border-slate-100 outline-none focus:border-black text-[10px] font-medium"
                />
              </div>
              <div className="max-h-52 overflow-y-auto custom-scrollbar">
                <button 
                  onClick={() => {
                    onUpdate(item.id, { providerId: '', providerName: '' });
                    setIsEditingProvider(false);
                    setProviderSearch('');
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-red-50 text-[10px] text-red-500 font-bold uppercase transition-colors rounded mb-1"
                >
                  X Desvincular actual
                </button>
                {providers?.filter(p => {
                  const text = providerDisplayName(p).toLowerCase();
                  return !providerSearch || text.includes(providerSearch.toLowerCase());
                }).map(p => (
                  <button
                    key={p.id}
                    onClick={() => {
                      onUpdate(item.id, { providerId: p.id, providerName: providerDisplayName(p) });
                      setIsEditingProvider(false);
                      setProviderSearch('');
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 text-[10px] border-t border-slate-50 first:border-0 transition-colors font-medium"
                  >
                    {providerDisplayName(p)}
                  </button>
                ))}
              </div>
              <button 
                onClick={() => setIsEditingProvider(false)}
                className="w-full mt-3 py-2 text-[9px] uppercase font-black text-slate-400 hover:text-black border-t border-slate-100"
              >
                Cerrar Panel
              </button>
           </div>
        )}
      </div>
    );
  }

  if (type === 'description') {
    return (
      <input 
        defaultValue={item.description}
        disabled={disabled}
        onBlur={(e) => handleValueUpdate('description', e.target.value)}
        placeholder="Ej: Alquiler de lentes, jornada de 12hs..."
        className={cn(
          "w-full bg-transparent border-b border-transparent outline-none transition-all py-1 text-slate-600 text-[11px]",
          disabled ? "cursor-default text-slate-500" : "hover:border-slate-100 focus:border-black"
        )}
      />
    );
  }

  if (type === 'price') {
    return (
      <div className="flex items-center gap-1 font-mono text-[11px]">
        <span className="text-slate-300 font-bold">$</span>
        <input 
          type="number"
          defaultValue={item.unitPrice}
          disabled={disabled}
          onBlur={(e) => handleValueUpdate('unitPrice', e.target.value)}
          className={cn(
            "w-full bg-transparent border-b border-transparent outline-none transition-all py-1 font-bold text-slate-800",
            disabled ? "cursor-default text-slate-500" : "hover:border-slate-100 focus:border-black"
          )}
        />
      </div>
    );
  }

  if (type === 'quantity') {
    return (
      <input 
        type="number"
        defaultValue={item.quantity}
        disabled={disabled}
        onBlur={(e) => handleValueUpdate('quantity', e.target.value)}
        className={cn(
          "w-16 bg-transparent border-b border-transparent outline-none transition-all py-1 text-center font-bold text-slate-800",
          disabled ? "cursor-default text-slate-500" : "hover:border-slate-100 focus:border-black"
        )}
      />
    );
  }

  if (type === 'paid') {
    const totalPaid = (item.paymentHistory || []).reduce((acc: number, p: any) => acc + p.amount, 0);
    const isPartial = totalPaid > 0 && totalPaid < item.total;
    const isFull = totalPaid >= item.total;

    return (
      <div className="flex items-center justify-center">
        <button 
          disabled={disabledPayment || disabled}
          onClick={() => onManagePayment?.(item)}
          className={cn(
            "w-4 h-4 rounded-full border-2 transition-all flex items-center justify-center group/dot",
            (disabledPayment || disabled) ? "bg-slate-100 border-slate-300 cursor-not-allowed" :
            isFull ? "bg-emerald-500 border-emerald-600" :
            isPartial ? "bg-yellow-400 border-yellow-500" :
            "bg-rose-500 border-rose-600"
          )}
          title={(disabledPayment || disabled) ? "No tenés permiso para gestionar pagos" : isFull ? "Pago Total" : isPartial ? "Pago Parcial" : "Sin Pago"}
        >
          <div className={cn(
            "w-1 h-1 rounded-full opacity-0 group-hover/dot:opacity-100 transition-all",
            (disabledPayment || disabled) ? "bg-slate-400" : "bg-white"
          )} />
        </button>
      </div>
    );
  }

  return null;
}
