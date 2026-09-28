import { GripVertical } from 'lucide-react';
import { cn } from '../../lib/utils';

type ExpenseDragHandleProps = {
  dragHandleProps?: any;
  disabled?: boolean;
  className?: string;
  title?: string;
};

// Estilo de la fila mientras se arrastra, compartido por Presu Ppal y Áreas.
export const DRAGGING_EXPENSE_ROW_CLASS = 'z-50 rounded-lg border-y border-slate-200 bg-slate-50 shadow-xl';

// Único punto de arrastre para las filas de gastos: Presu Ppal y Gestión por
// Áreas comparten el mismo grip, el mismo cursor y el mismo estado deshabilitado.
export function ExpenseDragHandle({ dragHandleProps, disabled, className, title = 'Arrastrar gasto' }: ExpenseDragHandleProps) {
  return (
    <div
      {...(disabled ? {} : dragHandleProps || {})}
      className={cn(
        'text-slate-300',
        disabled ? 'opacity-30' : 'cursor-grab hover:text-slate-500 active:cursor-grabbing',
        className,
      )}
      title={disabled ? undefined : title}
    >
      <GripVertical className="h-4 w-4" />
    </div>
  );
}
