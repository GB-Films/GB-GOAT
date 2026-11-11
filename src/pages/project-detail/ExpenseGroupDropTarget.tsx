import type { ReactNode } from 'react';
import { Droppable } from '@hello-pangea/dnd';

// A collapsed group's header remains a full-size drop target. Expanded groups
// keep their normal list target so there are never duplicate droppable IDs.
export function ExpenseGroupDropTarget({ collapsed, droppableId, disabled, children }: {
  collapsed: boolean; droppableId: string; disabled: boolean; children: ReactNode;
}) {
  if (!collapsed) return <>{children}</>;
  return <Droppable droppableId={droppableId} type="area-expense" isDropDisabled={disabled}>
    {(provided, snapshot) => <div ref={provided.innerRef} {...provided.droppableProps}
      className={snapshot.isDraggingOver ? 'ring-2 ring-inset ring-blue-500' : undefined}>
      {children}{provided.placeholder}
    </div>}
  </Droppable>;
}
