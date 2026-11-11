import type { FormEvent } from 'react';
import { ProjectDialog } from './ProjectDialog';
import { cashMovementOptions, type CashMovementKind } from '../../lib/cashBoxDefaults';

export type { CashMovementKind } from '../../lib/cashBoxDefaults';
type Person = { email: string; displayName?: string };

export function CashMovementDialog({ kind, onKindChange, onClose, canDeliver, canTransfer, canReturn, hasAssignedCashBox = canReturn,
  recipients, recipientEmail, onRecipientChange, availableBalance, currentBalance = availableBalance, ownName, defaultDate, busy, onSubmit }: {
  kind: CashMovementKind;
  onKindChange: (kind: CashMovementKind) => void;
  onClose: () => void;
  canDeliver: boolean; canTransfer: boolean; canReturn: boolean;
  hasAssignedCashBox?: boolean;
  recipients: Person[]; recipientEmail: string; onRecipientChange: (email: string) => void;
  availableBalance: number; currentBalance?: number; ownName: string; defaultDate: string; busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const delivery = kind === 'entrega';
  const transfer = kind === 'transferencia';
  const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-blue-500';
  const labelClass = 'mb-1.5 block text-xs font-semibold text-slate-700';
  return <ProjectDialog title="Registrar movimiento" onClose={() => { if (!busy) onClose(); }}>
    <label htmlFor="cash-movement-kind" className={labelClass}>Movimiento</label>
    <select id="cash-movement-kind" value={kind} disabled={busy}
      onChange={event => onKindChange(event.target.value as CashMovementKind)} className={`${inputClass} mb-4 bg-slate-50 font-semibold`}>
      {cashMovementOptions({ hasAssignedCashBox, canDeliver, canTransfer, canReturn }).map(option => <option key={option.kind} value={option.kind}>{option.label}{option.kind === 'transferencia' ? ` (saldo $${currentBalance.toLocaleString('es-AR')})` : ''}</option>)}
    </select>
    {!delivery && <p className="mb-4 text-sm text-slate-600">{ownName} · Disponible: <strong>${availableBalance.toLocaleString('es-AR')}</strong></p>}
    <form key={kind} onSubmit={onSubmit}>
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="cash-movement-recipient" className={labelClass}>{kind === 'devolucion' ? 'Administrador que recibe' : 'Persona que recibe'}</label>
          <select id="cash-movement-recipient" name="toUserEmail" value={recipientEmail} required
            onChange={event => onRecipientChange(event.target.value)} className={inputClass}>
            <option value="" disabled>{recipients.length ? 'Seleccioná una persona' : 'No hay destinatarios disponibles'}</option>
            {recipients.map(person => <option key={person.email} value={person.email}>{person.displayName || person.email}{person.displayName ? ` · ${person.email}` : ''}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="cash-movement-amount" className={labelClass}>Monto</label>
          <input id="cash-movement-amount" name="amount" type="number" min="0.01" max={delivery ? undefined : availableBalance}
            step="0.01" required placeholder="$ 0" className={inputClass} />
        </div>
        {!transfer && <div>
          <label htmlFor="cash-movement-date" className={labelClass}>Fecha</label>
          <input id="cash-movement-date" name="date" type="date" defaultValue={defaultDate} required className={inputClass} />
        </div>}
        <div className={transfer ? 'sm:col-span-2' : ''}>
          <label htmlFor="cash-movement-notes" className={labelClass}>Descripción (opcional)</label>
          <input id="cash-movement-notes" name="notes" className={inputClass} placeholder={delivery ? 'Ej.: efectivo para rodaje' : transfer ? 'Ej.: fondos para Arte' : 'Ej.: saldo no utilizado'} />
        </div>
        <p className="text-xs text-slate-500 sm:col-span-2">{transfer ? 'El importe queda reservado en tu caja. La persona debe confirmar la recepción para tenerlo disponible.' : delivery ? 'Se suma al saldo cuando la persona confirma la recepción.' : 'Se descuenta de tu saldo cuando el administrador confirma la recepción.'}</p>
        <div className="mt-1 flex justify-end gap-2 sm:col-span-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-600">Cancelar</button>
          <button type="submit" disabled={busy || recipients.length === 0 || (!delivery && availableBalance <= 0)}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
            {busy ? 'Registrando…' : delivery ? 'Registrar entrega' : transfer ? 'Registrar transferencia' : 'Registrar devolución'}
          </button>
        </div>
      </fieldset>
    </form>
  </ProjectDialog>;
}
