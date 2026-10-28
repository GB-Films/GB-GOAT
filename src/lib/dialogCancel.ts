// The file picker emits a bubbling cancel event too. Only a cancel targeted at
// this dialog (Escape) may close it; never let it close a parent dialog.
export function handleDialogCancel(event: { target: unknown; currentTarget: unknown; stopPropagation: () => void; preventDefault: () => void }, onClose: () => void) {
  event.stopPropagation();
  if (event.target !== event.currentTarget) return;
  event.preventDefault();
  onClose();
}
