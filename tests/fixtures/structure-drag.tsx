import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { collapseAroundDraggedRow, type StructureDragLayout } from '../../src/lib/dragPointerAnchor';

function Fixture() {
  const [dragging, setDragging] = useState(false);
  const [layout, setLayout] = useState<StructureDragLayout | null>(null);
  const [groups, setGroups] = useState(['Subcategoria', 'Honorarios', 'Produccion', 'Post']);
  const nested = new URLSearchParams(location.search).has('nested');
  return <main id="scroll-container" style={nested ? { height: '100vh', overflow: 'auto' } : {}}>
    <header style={{ height: 500 }}>Project header</header>
    <DragDropContext autoScrollerOptions={{ disabled: dragging }}
      onBeforeCapture={({ draggableId }) => {
        const next = collapseAroundDraggedRow(draggableId, () => flushSync(() => setDragging(true)));
        flushSync(() => setLayout(next));
      }}
      onDragEnd={({ source, destination }) => {
        setDragging(false); setLayout(null);
        if (destination) setGroups(current => {
          const next = [...current]; next.splice(destination.index, 0, next.splice(source.index, 1)[0]); return next;
        });
      }}>
      <Droppable droppableId="groups" type="structure">
        {provided => <div ref={provided.innerRef} {...provided.droppableProps} data-structure-drag-list
          style={{ ...layout, overflowAnchor: 'none', boxSizing: 'border-box' }}>
          {groups.map((name, index) => <Draggable key={name} draggableId={name} index={index}>
            {(row, snapshot) => <section ref={row.innerRef} {...row.draggableProps} data-structure-drag-id={name}
              data-dragging={snapshot.isDragging} style={{ ...row.draggableProps.style, background: '#e2e8f0' }}>
              <div style={{ height: 48, display: 'flex', alignItems: 'center', borderBottom: '1px solid #aaa', boxSizing: 'border-box' }}>
                <span {...row.dragHandleProps} aria-label={`Mover ${name}`} style={{ padding: 12 }}>⠿</span>{name}
              </div>
              {!dragging && Array.from({ length: name === 'Honorarios' ? 12 : 8 }, (_, n) => <div key={n}
                style={{ height: 56, boxSizing: 'border-box', borderBottom: '1px solid #ccc', background: 'white' }}>Expense {n}</div>)}
            </section>}
          </Draggable>)}
          {provided.placeholder}
        </div>}
      </Droppable>
    </DragDropContext>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
