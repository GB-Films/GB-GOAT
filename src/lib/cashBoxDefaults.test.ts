import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cashMovementOptions, prioritizeAssignedCashBox, resolvePaymentCashBoxChoice } from './cashBoxDefaults';
import { buildPaymentCashBoxOptions } from './cashBoxes';
import { PaymentModal } from '../pages/project-detail/PaymentModal';
import { CashMovementDialog } from '../pages/project-detail/CashMovementDialog';

const email = 'tomas@granberta.com';
const options = buildPaymentCashBoxOptions({ isProjectAdmin: true, hasPersonalCashBox: true, personalBalance: 0, currentUserEmail: email, currentUserName: 'Persona de prueba' });
test('payments prefer the actor’s assigned box, including zero balance, and retain an explicit General choice', () => {
  const generalFirst = [...options].reverse();
  assert.equal(prioritizeAssignedCashBox(generalFirst, email)[0].id, 'personal');
  assert.equal(generalFirst[0].id, 'general', 'ordering does not mutate the incoming options');
  assert.equal(resolvePaymentCashBoxChoice(generalFirst, email), 'personal');
  assert.equal(resolvePaymentCashBoxChoice(options, email, 'general'), 'general');
  assert.equal(resolvePaymentCashBoxChoice(options.map(box => ({ ...box, balance: 100 })), email, 'general'), 'general');
});
test('an automatic General default gives way to assigned cash when it loads; an explicit choice is preserved', () => {
  const initial = options.filter(box => box.id === 'general');
  assert.equal(resolvePaymentCashBoxChoice(initial, email), 'general');
  assert.equal(resolvePaymentCashBoxChoice(options, email), 'personal');
  assert.equal(resolvePaymentCashBoxChoice(options, email, 'general'), 'general');
  assert.equal(resolvePaymentCashBoxChoice([], email), '');
  assert.equal(resolvePaymentCashBoxChoice(initial, email, 'personal'), 'general', 'removed/unavailable options cannot remain selected');
});
test('General remains limited to authorized users; owning cash does not grant General or subdelivery privileges', () => {
  const ownOnly = buildPaymentCashBoxOptions({ isProjectAdmin: true, hasPersonalCashBox: true, personalBalance: 20, currentUserEmail: 'other@example.test', currentUserName: 'Otra persona' });
  assert.equal(resolvePaymentCashBoxChoice(ownOnly, 'other@example.test', 'general'), 'personal');
  assert.deepEqual(cashMovementOptions({ hasAssignedCashBox: true, canDeliver: false, canTransfer: false, canReturn: true }).map(row => row.kind), ['devolucion']);
  assert.deepEqual(cashMovementOptions({ hasAssignedCashBox: false, canDeliver: false, canTransfer: false, canReturn: false }), []);
});
test('movement creation and its selector share the assigned-cash-first order, with General still selectable', () => {
  const access = { hasAssignedCashBox: true, canDeliver: true, canTransfer: true, canReturn: true };
  const choices = cashMovementOptions(access);
  assert.deepEqual(choices.map(row => row.kind), ['transferencia', 'entrega', 'devolucion']);
  assert.equal(cashMovementOptions({ ...access, hasAssignedCashBox: false, canReturn: false })[0].kind, 'entrega');
  const html = renderToStaticMarkup(createElement(CashMovementDialog, { ...access, kind: choices[0].kind, onKindChange() {}, onClose() {}, recipients: [{ email: 'recipient@example.test' }], recipientEmail: 'recipient@example.test', onRecipientChange() {}, availableBalance: 20, currentBalance: 1750.5, ownName: 'Persona de prueba', defaultDate: '2026-11-11', busy: false, onSubmit() {} }));
  const select = html.match(/<select[^>]*id="cash-movement-kind"[\s\S]*?<\/select>/)![0];
  assert.match(select, /<option value="transferencia" selected="">/);
  assert(select.indexOf('value="transferencia"') < select.indexOf('value="entrega"'));
  assert.match(select, /Transferir desde mi caja asignada \(saldo \$1\.750,5\)/);
  assert.match(html, /max="20"/, 'displaying the ledger balance preserves the lower available transfer limit');
});
function paymentHtml(actorEmail = email) {
  return renderToStaticMarkup(createElement(PaymentModal, {
    projectId: 'project-example', item: { id: 'expense', description: 'Gasto ficticio', total: 10, paymentHistory: [] },
    isOpen: true, canManagePayments: true, cashBoxOptions: [...options].reverse().map(box => ({ ...box, ownerEmail: actorEmail })),
    paymentType: 'areaExpenses', isDeletingPayment: null, currentUserEmail: actorEmail,
    onClose() {}, onPaymentStateChange() {}, onDeletePayment: async () => {},
  }));
}
test('the payment form selects personal cash and lists it before General without enabling cash use automatically', () => {
  const html = paymentHtml();
  const select = html.match(/<select[^>]*name="cashBoxId"[\s\S]*?<\/select>/)![0];
  assert.match(select, /<option value="personal" selected="">/);
  assert(select.indexOf('value="personal"') < select.indexOf('value="general"'));
  assert.match(select, /Caja asignada a Persona de prueba \(disponible \$0\)/);
  assert.doesNotMatch(html.match(/<input[^>]*name="useCashBox"[^>]*>/)![0], /checked/);
  assert.doesNotMatch(paymentHtml('other@example.test').match(/<select[^>]*name="cashBoxId"[\s\S]*?<\/select>/)![0], /value="general"/);
});
