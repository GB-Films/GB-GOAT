export const normalizeEmail = (email?: string | null) => (email || '').trim().toLowerCase();

export const normalizeSearchText = (value: unknown) => String(value || '')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .trim()
  .toLowerCase();

