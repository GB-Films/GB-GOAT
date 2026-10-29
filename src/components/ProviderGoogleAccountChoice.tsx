import { CheckCircle2, Mail, ShieldCheck } from 'lucide-react';
import type { AccountVerification } from '../lib/providerGoogleAccount';

export type ProviderAccountSelection = { email: string; verificationId?: string };
const normalized = (value: string) => value.trim().toLowerCase();
export function ProviderGoogleAccountChoice({ accessEmail, registeredEmail, pendingEmail, selection, onChange, onVerify, verifying, onVerifying, error, onError, disabled }: {
  accessEmail: string; registeredEmail: string; pendingEmail?: string; selection: ProviderAccountSelection;
  onChange: (selection: ProviderAccountSelection) => void; onVerify?: (email: string) => Promise<AccountVerification>;
  verifying: boolean; onVerifying: (value: boolean) => void; error: string; onError: (message: string) => void; disabled: boolean;
}) {
  const differs = !!registeredEmail && normalized(registeredEmail) !== normalized(accessEmail);
  const current = normalized(selection.email) === normalized(accessEmail);
  const recorded = differs && normalized(selection.email) === normalized(registeredEmail);
  const other = !current && !recorded;
  const choose = (email: string) => { onError(''); onChange({ email }); };
  const option = (email: string, label: string, checked: boolean) => <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${checked ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'}`}>
    <input className="mt-1" type="radio" name="provider-google-account" checked={checked} onChange={() => choose(email)} />
    <span className="min-w-0 text-sm"><span className="block font-semibold">{label}</span><span className="break-all">{email}</span></span>
  </label>;
  return <fieldset disabled={disabled || verifying || !!pendingEmail} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
    <legend className="px-1 font-semibold">Tu correo en GOAT</legend>
    <div className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" /><span>Ingresaste con Google: <strong className="break-all">{accessEmail}</strong></span></div>
    {pendingEmail ? <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">Correo solicitado: <strong className="break-all">{pendingEmail}</strong>. Completá la aplicación de los datos firmados; mientras tanto, seguí ingresando con <strong className="break-all">{accessEmail}</strong>.</p> : <>
      {differs && <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>En tu ficha figura <strong className="break-all">{registeredEmail}</strong>. Es distinto de la cuenta con la que ingresaste. Elegí cuál usar.</span></p>}
      <div className={`grid gap-2 ${differs ? 'sm:grid-cols-2' : ''}`}>{option(accessEmail, 'Usar mi cuenta actual', current)}{differs && option(registeredEmail, 'Usar el correo de la ficha', recorded)}</div>
      <label className="flex items-center gap-2 text-sm"><input type="radio" name="provider-google-account" checked={other} onChange={() => choose('')} />Usar otra cuenta de Google</label>
      {other && <label className="block text-sm">Correo que querés usar<input type="email" autoComplete="email" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2" value={selection.email} onChange={event => choose(event.target.value)} /></label>}
      {!current && <div className="space-y-2">
        <button type="button" disabled={disabled || verifying || !onVerify || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(selection.email)} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 disabled:opacity-40" onClick={async () => {
          if (!onVerify) return;
          onError(''); onVerifying(true);
          try { const result = await onVerify(selection.email); if (normalized(result.email) !== normalized(selection.email)) throw Error('La cuenta verificada no coincide con la elegida.'); onChange({ email: result.email, verificationId: result.verificationId }); }
          catch (error: any) { onError(error.message || 'No pudimos verificar la cuenta.'); }
          finally { onVerifying(false); }
        }}>{verifying ? 'Verificando con Google…' : selection.verificationId ? 'Verificar otra vez con Google' : 'Verificar con Google'}</button>
        {selection.verificationId && <p role="status" className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Cuenta verificada con Google</p>}
        <p className="text-xs text-slate-600">Después de verificar esta cuenta con Google, tu firma desde la cuenta aprobada autoriza el cambio. Luego deberás ingresar con la cuenta elegida.</p>
      </div>}
    </>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </fieldset>;
}
