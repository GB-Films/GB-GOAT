export const DEFAULT_RESULT_INCIDENCES: Readonly<Record<string, number>> = Object.freeze({
  imprevistos: 1,
  impuestos: 4.5,
  financiacion: 2,
  administracion: 8,
  margen: 10,
});

export function resolveResultIncidences(stored: unknown): Record<string, number> {
  const result = { ...DEFAULT_RESULT_INCIDENCES };
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const [key, value] of Object.entries(stored)) {
      if (value !== null && value !== '' && Number.isFinite(Number(value))) result[key] = Number(value);
    }
  }
  return result;
}
