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

export function moveNamedSubcategory(
  sourceNames: string[],
  targetNames: string[],
  sourceIndex: number,
  destinationIndex: number,
  sourceHasDefault: boolean,
  targetHasDefault: boolean,
  sameCategory: boolean,
) {
  const source = [...sourceNames];
  const target = sameCategory ? source : [...targetNames];
  const namedSourceIndex = sourceIndex - Number(sourceHasDefault);
  const namedDestinationIndex = destinationIndex - Number(targetHasDefault);
  if (namedSourceIndex < 0 || namedSourceIndex >= source.length
    || namedDestinationIndex < 0 || namedDestinationIndex > target.length) return null;
  const [subcategory] = source.splice(namedSourceIndex, 1);
  if (!subcategory) return null;
  target.splice(namedDestinationIndex, 0, subcategory);
  return { subcategory, source, target };
}
