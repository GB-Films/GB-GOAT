const groupPrefix = 'area-expense-group', areaPrefix = 'area-expense-area';
const clean = (value: string) => value.trim() === 'Sin subcategoria' ? '' : value.trim();
export const areaExpenseGroupDroppableId = (area: string, subcategory: string, appendOnly = false) =>
  `${groupPrefix}|${encodeURIComponent(area.trim())}|${encodeURIComponent(clean(subcategory))}${appendOnly ? '|append' : ''}`;
export const areaExpenseAreaDroppableId = (area: string) => `${areaPrefix}|${encodeURIComponent(area.trim())}`;
export const parseAreaExpenseDroppableId = (value: string) => {
  const [prefix, encodedArea, encodedSubcategory, mode, extra] = String(value || '').split('|');
  try {
    if (!encodedArea || extra !== undefined) return null;
    const area = decodeURIComponent(encodedArea);
    if (prefix === areaPrefix && encodedSubcategory === undefined) return { area, subcategory: '', appendOnly: true };
    if (prefix === groupPrefix && encodedSubcategory !== undefined && (mode === undefined || mode === 'append'))
      return { area, subcategory: decodeURIComponent(encodedSubcategory), appendOnly: mode === 'append' };
  } catch { /* Ignore malformed drag IDs rather than leaving the interface stuck. */ }
  return null;
};
