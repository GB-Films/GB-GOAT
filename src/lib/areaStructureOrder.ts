export function reorderDisplayedCategories(
  categories: string[],
  displayed: string[],
  sourceIndex: number,
  destinationIndex: number,
): string[] | null {
  if (sourceIndex < 0 || sourceIndex >= displayed.length
    || destinationIndex < 0 || destinationIndex >= displayed.length) return null;
  const reordered = [...displayed];
  const [moved] = reordered.splice(sourceIndex, 1);
  reordered.splice(destinationIndex, 0, moved);
  const displayedSet = new Set(displayed);
  let nextIndex = 0;
  return categories.map((category) => displayedSet.has(category) ? reordered[nextIndex++] : category);
}

export function moveAreaSubcategory(
  sourceNames: string[],
  targetNames: string[],
  sourceIndex: number,
  destinationIndex: number,
  sameCategory: boolean,
) {
  const source = [...sourceNames];
  const target = sameCategory ? source : [...targetNames];
  if (sourceIndex < 0 || sourceIndex >= source.length
    || destinationIndex < 0 || destinationIndex > target.length) return null;
  const [subcategory] = source.splice(sourceIndex, 1);
  if (subcategory === undefined) return null;
  if (!sameCategory && target.some((item) => item.toLowerCase() === subcategory.toLowerCase())) return null;
  target.splice(destinationIndex, 0, subcategory);
  return { subcategory, source, target };
}
