// onBeforeCapture contrae la lista antes de que DnD mida la fila. Conservamos
// su posición en pantalla con scroll y devolvemos el espacio que aún falta.
export const collapseAroundDraggedRow = (draggableId: string, collapse: () => void): number => {
  const source = Array.from(document.querySelectorAll<HTMLElement>('[data-structure-drag-id]'))
    .find((element) => element.dataset.structureDragId === draggableId);
  if (!source) { collapse(); return 0; }

  const originalTop = source.getBoundingClientRect().top;
  let scrollParent: HTMLElement | null = null;
  for (let parent = source.parentElement; parent; parent = parent.parentElement) {
    const overflow = window.getComputedStyle(parent).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && parent.scrollHeight > parent.clientHeight + 1) {
      scrollParent = parent;
      break;
    }
  }

  collapse();
  if (!source.isConnected) return 0;
  const shift = source.getBoundingClientRect().top - originalTop;
  if (Math.abs(shift) < 0.5) return 0;
  if (scrollParent) {
    scrollParent.scrollTop += shift;
    const remainder = source.getBoundingClientRect().top - originalTop;
    if (Math.abs(remainder) >= 0.5) window.scrollBy({ top: remainder, behavior: 'instant' });
  } else window.scrollBy({ top: shift, behavior: 'instant' });

  return Math.max(0, originalTop - source.getBoundingClientRect().top);
};
