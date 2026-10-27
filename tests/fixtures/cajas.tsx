import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus } from 'lucide-react';
import { CashBoxPicker } from '../../src/pages/project-detail/CashBoxPicker';
import { CashLedger } from '../../src/pages/project-detail/CashLedger';
import { CashMovementDialog, type CashMovementKind } from '../../src/pages/project-detail/CashMovementDialog';
import { calculateCashBalances, calculateGeneralCashSummary, isGeneralCashMovement } from '../../src/lib/cashBoxes';
import type { CashMovement } from '../../src/pages/project-detail/types';
import '../../src/index.css';

const people = [{ email: 'sofia@example.com', displayName: 'Sofía López' }, { email: 'lucas@example.com', displayName: 'Lucas García' }];
const movements: CashMovement[] = [
  { id: 'pending', type: 'entrega', amount: 4135000, date: '2026-10-27', toUserEmail: people[0].email, toUserName: people[0].displayName, createdByName: 'Administración', status: 'pending', notes: 'Fondos para el próximo rodaje' },
  { id: 'return', type: 'devolucion', amount: 20000, date: '2026-10-26', fromUserEmail: people[0].email, toUserName: 'Administración', status: 'confirmed', notes: 'Devolución de efectivo no utilizado' },
  { id: 'incoming', type: 'transferencia', amount: 40000, date: '2026-10-25', fromUserEmail: people[1].email, fromUserName: people[1].displayName, toUserEmail: people[0].email, toUserName: people[0].displayName, notes: 'Sobrante de Arte' },
  { id: 'outgoing', type: 'transferencia', amount: 150000, date: '2026-10-24', fromUserEmail: people[0].email, fromUserName: people[0].displayName, toUserEmail: people[1].email, toUserName: people[1].displayName, notes: 'Fondos para Arte' },
  { id: 'payment', type: 'pago', amount: 85000, date: '2026-10-23', fromUserEmail: people[0].email, collectionName: 'areaExpenses', itemId: 'catering', description: 'Almuerzos del equipo', notes: 'Rodaje día 1' },
  { id: 'received', type: 'entrega', amount: 500000, date: '2026-10-22', toUserEmail: people[0].email, createdByName: 'Administración', status: 'confirmed', notes: 'Caja de rodaje' },
];

function Example() {
  const [account, setAccount] = useState(people[0].email);
  const [kind, setKind] = useState<CashMovementKind | null>(null);
  const [recipient, setRecipient] = useState(people[1].email);
  const [notice, setNotice] = useState('');
  const balances = calculateCashBalances(movements);
  const general = calculateGeneralCashSummary(movements);
  const rows = people.map(responsible => ({ email: responsible.email, responsible, balance: balances.get(responsible.email) || 0 }));
  const visible = account === 'general' ? general.movements : movements.filter(m => (m.toUserEmail === account && m.type !== 'devolucion') || (m.fromUserEmail === account && !((m.type === 'pago' || m.type === 'reintegro') && m.cashAccount === 'general')));
  return <main className="mx-auto max-w-[1440px] space-y-4 p-4 sm:p-8">
    <div className="text-xs text-slate-500">Vista de ejemplo · datos ficticios · no registra operaciones</div>
    <h1 className="text-2xl font-bold">Proyecto de ejemplo</h1>
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <h2 className="text-base font-bold">Cajas</h2>
      <button onClick={() => setKind('entrega')} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"><Plus className="h-4 w-4" />Registrar movimiento</button>
    </header>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <CashBoxPicker rows={rows} value={account} onChange={setAccount} showGeneral generalOut={general.totalOut} />
      <CashLedger movements={visible} account={account} budgetItems={[]} areaExpenses={[{ id: 'catering', providerName: 'Catering del Sur', description: 'Almuerzos del equipo' }]}
        renderActions={m => m.status === 'pending' ? <button onClick={() => setNotice('Esta es una muestra: no se confirmó ninguna recepción real.')} className="rounded-md bg-amber-950 px-3 py-2 text-xs font-semibold text-white">Confirmar recepción</button> : null} />
    </section>
    {notice && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">{notice}</p>}
    {kind && <CashMovementDialog kind={kind} onKindChange={setKind} onClose={() => setKind(null)} canDeliver canTransfer canReturn
      recipients={people} recipientEmail={recipient} onRecipientChange={setRecipient} availableBalance={balances.get(people[0].email) || 0}
      ownName={people[0].displayName} defaultDate="2026-10-27" busy={false}
      onSubmit={event => { event.preventDefault(); setKind(null); setNotice('Vista de ejemplo: no se registró ningún movimiento.'); }} />}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Example />);
