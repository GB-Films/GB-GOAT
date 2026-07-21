export const normalizeEmail = (email?: string | null) => (email || '').trim().toLowerCase();

export const normalizeSearchText = (value: unknown) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

