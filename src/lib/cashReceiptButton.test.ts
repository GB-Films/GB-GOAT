import test from 'node:test';
import assert from 'node:assert/strict';
import { CashReceiptButton } from '../pages/project-detail/CashReceiptButton';
import type { CashMovement } from '../pages/project-detail/types';

test('the actual ledger action routes personal and General deliveries to reception, and returns to their own flow', () => {
  for (const type of ['entrega', 'transferencia', 'devolucion'] as const) {
    const movement: CashMovement = { id: 'm', type, status: 'pending', toUserEmail: 'recipient@example.test', amount: 40, date: '2026-11-11' };
    const calls: string[] = [];
    const props = { movement, currentUserEmail: 'RECIPIENT@example.test', canReceiveGeneralReturn: true, busy: false,
      onConfirmDelivery: (value: CashMovement) => { assert.equal(value, movement); calls.push('delivery'); },
      onConfirmReturn: (value: CashMovement) => { assert.equal(value, movement); calls.push('return'); } };
    const button = CashReceiptButton(props);
    assert(button); button.props.onClick();
    assert.deepEqual(calls, [type === 'devolucion' ? 'return' : 'delivery']);
    assert.equal(CashReceiptButton({ ...props, currentUserEmail: 'sender@example.test' }), null);
    assert.equal(CashReceiptButton({ ...props, currentUserEmail: '', movement: { ...movement, toUserEmail: '' } }), null);
    assert.equal(CashReceiptButton({ ...props, movement: { ...movement, status: 'confirmed' } }), null);
    assert.equal(CashReceiptButton({ ...props, busy: true })?.props.disabled, true);
    if (type === 'devolucion') assert.equal(CashReceiptButton({ ...props, canReceiveGeneralReturn: false }), null);
    else assert(CashReceiptButton({ ...props, canReceiveGeneralReturn: false }), 'personal receipt does not require General access');
  }
});
