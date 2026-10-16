import { parsePaymentAmount } from './paymentAmounts';

export function mobileExpenseAmountUpdate(totalText: string, quantityText: string) {
  if (!/^\s*\d[\d.,\s]*\s*$/.test(totalText) || !/^\s*\d+(?:[.,]\d+)?\s*$/.test(quantityText)) {
    throw new Error('Ingresá un total válido y una cantidad mayor que cero.');
  }
  const total = parsePaymentAmount(totalText);
  const quantity = Number(quantityText.replace(',', '.'));
  if (!Number.isFinite(total) || total < 0 || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Ingresá un total válido y una cantidad mayor que cero.');
  }
  return { total, quantity, unitPrice: total / quantity };
}
