import assert from 'node:assert/strict';
import test from 'node:test';
import {
  administrationAction, emptyProjectAdministration, invoiceBalance, normalizeProjectAdministration,
  resolvedInvoiceDueDate, unbilledAmount, validateAdministration,
  type CustomerInvoice, type ProjectAdministrationRecord,
} from './projectAdministration';

const invoice: CustomerInvoice = {
  id: 'factura-1', number: 'A 00001-00000353', issueDate: '2026-09-01',
  sentDate: '2026-09-02', portalDate: '', amount: 1000, netAmount: 1000, currency: 'ARS',
  dueDate: '', documentRef: 'Factura septiembre.pdf', ctRef: '',
};

const base = (): ProjectAdministrationRecord => ({
  ...emptyProjectAdministration('project-1'), clientLegalName: 'Cliente SA',
  issuerEntity: 'Gran Berta SRL', agreementStatus: 'confirmed' as const,
  agreementRef: 'Contrato aprobado', agreedAmount: 2000, agreedCurrency: 'ARS', orderStatus: 'confirmed' as const,
  orderNumber: 'OC 123', billingStatus: 'ready' as const,
});

test('the dashboard distinguishes ready-to-invoice, unverified terms, overdue and collected', () => {
  const record = base();
  assert.equal(administrationAction(record, '2026-10-01'), 'billing');
  record.invoices = [invoice];
  assert.equal(administrationAction(record, '2026-10-01'), 'terms');
  record.paymentTermDays = 30;
  record.paymentTermBasis = 'invoice';
  record.paymentTermSource = 'OC 123';
  assert.equal(resolvedInvoiceDueDate(record, invoice), '2026-10-01');
  assert.equal(administrationAction(record, '2026-10-02'), 'overdue');
  record.collections = [{ id: 'cobro-1', invoiceId: invoice.id, date: '2026-10-03', appliedAmount: 1000, netReceived: 900, withholding: 100, reference: 'BBVA', documentRef: '' }];
  assert.equal(invoiceBalance(record, invoice), 0);
  assert.equal(administrationAction(record, '2026-10-04'), 'billing');
  record.agreedAmount = 1000;
  assert.equal(administrationAction(record, '2026-10-04'), 'complete');
});

test('a customer collection must match net cash and withholding, and cannot exceed the invoice', () => {
  const record = { ...base(), invoices: [invoice] };
  record.collections = [{ id: 'cobro-1', invoiceId: invoice.id, date: '2026-10-03', appliedAmount: 1000, netReceived: 900, withholding: 50, reference: 'BBVA', documentRef: '' }];
  assert.match(validateAdministration(record) || '', /importe aplicado/);
  record.collections[0].withholding = 100;
  assert.equal(validateAdministration(record), null);
  record.collections[0].appliedAmount = 1100;
  record.collections[0].netReceived = 1000;
  assert.match(validateAdministration(record) || '', /superan/);
});

test('a client requiring portal and email stays pending until both submissions are recorded', () => {
  const record = { ...base(), agreedAmount: 1000, billingChannel: 'both' as const, paymentTermDays: 30, paymentTermBasis: 'submission' as const, paymentTermSource: 'Instructivo' };
  record.invoices = [{ ...invoice, portalDate: '' }];
  assert.equal(administrationAction(record, '2026-09-03'), 'send');
  record.invoices[0].portalDate = '2026-09-04';
  assert.equal(resolvedInvoiceDueDate(record, record.invoices[0]), '2026-10-04');
  assert.equal(administrationAction(record, '2026-09-03'), 'collection');
});

test('a historical tax-inclusive agreement is not presented as a net amount', () => {
  const record = { ...base(), agreedAmountTaxBasis: 'gross' as const, invoices: [invoice] };
  assert.equal(unbilledAmount(record), null);
});

test('agreement and purchase order flags do not block project billing review', () => {
  const record = { ...base(), agreementStatus: 'pending' as const, orderStatus: 'pending' as const };
  assert.equal(administrationAction(record, '2026-10-01'), 'billing');
});

test('existing Gran Berta issuer and tax-inclusive amount remain readable without reinterpretation', () => {
  const record = normalizeProjectAdministration('project-1', { issuerEntity: 'GRAN BERTA S.R.L.', agreedAmount: 1210, agreedCurrency: 'ARS' });
  assert.equal(record.issuerEntity, 'Gran Berta SRL');
  assert.equal(record.agreedAmountTaxBasis, 'gross');
  assert.equal(unbilledAmount(record), null);
});
