export type StructureDragLayout = { minHeight: number; paddingTop: number };

// Freeze height BEFORE collapsing so the browser cannot clamp the scroll position.
// Reserve preceding content with padding instead of scrolling the user's viewport.
export const collapseAroundDraggedRow = (draggableId: string, collapse: () => void): StructureDragLayout | null => {
  const source = Array.from(document.querySelectorAll<HTMLElement>('[data-structure-drag-id]'))
    .find((element) => element.dataset.structureDragId === draggableId);
  const list = source?.closest<HTMLElement>('[data-structure-drag-list]');
  if (!source || !list) { collapse(); return null; }

  const originalTop = source.getBoundingClientRect().top;
  const minHeight = list.getBoundingClientRect().height;
  list.style.minHeight = `${minHeight}px`;

  collapse();
  return { minHeight, paddingTop: source.isConnected ? Math.max(0, originalTop - source.getBoundingClientRect().top) : 0 };
};
