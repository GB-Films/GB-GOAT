export const normalizeSearch = (value: unknown) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();

// Tokens may appear in any order. Compact matching also accepts GGB0554,
// formatted CUITs and emails without requiring their punctuation/spaces.
export const matchesSmartSearch = (query: string, ...fields: unknown[]) => {
  const needle = normalizeSearch(query);
  if (!needle) return true;
  const haystack = fields.map(normalizeSearch).join(' ');
  const compact = haystack.replace(/ /g, '');
  return needle.split(/\s+/).every(token => haystack.includes(token) || compact.includes(token));
};
