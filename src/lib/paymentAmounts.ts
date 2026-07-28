export const parsePaymentAmount = (value: unknown) => {
  const raw = String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^\d,.-]/g, '');

  if (!raw) return 0;

  const separators = Array.from(raw.matchAll(/[,.]/g), (match) => match.index ?? -1);
  if (separators.length === 0) return Number(raw) || 0;

  const lastSeparator = separators[separators.length - 1];
  const decimals = raw.length - lastSeparator - 1;
  const normalized = decimals >= 1 && decimals <= 2
    ? `${raw.slice(0, lastSeparator).replace(/[,.]/g, '')}.${raw.slice(lastSeparator + 1)}`
    : raw.replace(/[,.]/g, '');

  return Number(normalized) || 0;
};
