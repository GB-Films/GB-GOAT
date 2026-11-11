import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CashBoxPicker } from '../pages/project-detail/CashBoxPicker';
import { CashMovementDialog } from '../pages/project-detail/CashMovementDialog';
import { calculateCashBoxSummaries } from './cashBoxes';

test('las cajas pendientes muestran saldo completo en amarillo, por confirmar y disponible, incluso en la vista propia', () => {
  const summaries = calculateCashBoxSummaries([
    { type: 'entrega', status: 'confirmed', amount: 100, toUserEmail: 'sender@example.test' },
    { type: 'transferencia', status: 'pending', amount: 100, fromUserEmail: 'sender@example.test', toUserEmail: 'recipient@example.test' },
  ]);
  const rows = [...summaries].map(([email, summary]) => ({ email, responsible: { displayName: email }, ...summary, availableBalance: summary.available }));
  const render = (value: string, showGeneral = true) => renderToStaticMarkup(createElement(CashBoxPicker, { rows, value, showGeneral, generalOut: 100, onChange() {} }));
  const all = render('all'); assert.match(all, /border-amber-300 bg-amber-50/); assert.match(all, /Por confirmar: \$100/); assert.match(all, /Disponible: \$0/); assert.match(all, /Por recibir: \$100/);
  const own = render('sender@example.test', false); assert.match(own, /text-amber-800/); assert.match(own, /\$100/); assert.match(own, /Por confirmar: \$100/); assert.match(own, /Disponible: \$0/); assert.doesNotMatch(own, /Caja General|Por recibir/);
});

test('al confirmarse la recepción desaparece el amarillo y se muestran los saldos ya descontados', () => {
  const html = renderToStaticMarkup(createElement(CashBoxPicker, {
    rows: [{ email: 'sender@example.test', responsible: { displayName: 'Emisor' }, balance: 0, availableBalance: 0, pendingOutgoing: 0, pendingIncoming: 0 }],
    value: 'sender@example.test', showGeneral: true, generalOut: 100, onChange() {},
  }));
  assert.match(html, /\$0/); assert.doesNotMatch(html, /Por confirmar|Por recibir|Disponible:|bg-amber-50/);
});

test('mostrar saldo pendiente no permite iniciar otra entrega con esos mismos fondos', () => {
  const html = renderToStaticMarkup(createElement(CashMovementDialog, {
    kind: 'transferencia', canDeliver: false, canTransfer: true, canReturn: true, hasAssignedCashBox: true,
    recipients: [{ email: 'recipient@example.test' }], recipientEmail: 'recipient@example.test',
    currentBalance: 100, availableBalance: 0, ownName: 'Emisor', defaultDate: '2026-01-01', busy: false,
    onKindChange() {}, onClose() {}, onRecipientChange() {}, onSubmit() {},
  }));
  assert.match(html, /saldo \$100/); assert.match(html, /Disponible: <strong>\$0/);
  assert.match(html.match(/<input[^>]*name="amount"[^>]*>/)![0], /max="0"/);
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled=""/);
});
