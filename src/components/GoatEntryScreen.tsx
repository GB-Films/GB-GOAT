import type { ReactNode } from 'react';
import { LoaderCircle, LogIn, UserRoundPlus } from 'lucide-react';
import { Link } from 'react-router-dom';

type LoginAction = { href: string } | { onClick: () => void; busy: boolean };
type InvitationAction = { onStart: () => void; checking: boolean };

const button = 'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700 disabled:cursor-wait disabled:opacity-70';
const primary = 'bg-slate-950 text-white hover:bg-slate-800';
const secondary = 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50';
const infoLink = 'rounded-sm text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700';

export function GoatEntryScreen({ login, invitation, status, alert }: {
  login?: LoginAction;
  invitation?: InvitationAction;
  status?: string;
  alert?: ReactNode;
}) {
  const baseUrl = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL || '/';
  return (
    <main className="grid min-h-dvh place-items-center bg-[radial-gradient(ellipse_at_top,#e6edf9_0%,#f8fafc_64%)] px-4 py-5 [@media(max-height:450px)]:py-2">
      <section aria-labelledby="goat-entry-title" className="w-full max-w-[23rem] rounded-3xl border border-slate-200/90 bg-white px-5 py-6 text-center shadow-xl shadow-slate-900/5 sm:px-8 sm:py-8 [@media(max-height:450px)]:py-4">
        <header>
          <img src={`${baseUrl}gb-films-logo.png`} alt="GB Films" className="mx-auto size-16 rounded-xl bg-black object-contain [@media(max-height:450px)]:size-11" />
          <h1 id="goat-entry-title" className="mt-3 text-3xl font-bold tracking-tight text-slate-950 [@media(max-height:450px)]:mt-2 [@media(max-height:450px)]:text-2xl">GB GOAT</h1>
          <p className="mt-1.5 text-sm text-slate-600">
            {invitation ? 'Tenés una invitación para registrar tu ficha.' : 'Usá tu cuenta de Google para ingresar.'}
          </p>
        </header>

        <div className="mt-5 grid gap-2.5 [@media(max-height:450px)]:mt-3">
          {invitation && (
            <button type="button" onClick={invitation.onStart} disabled={invitation.checking} className={`${button} ${primary}`}>
              {invitation.checking
                ? <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin" />
                : <UserRoundPlus aria-hidden="true" className="size-4 shrink-0" />}
              {invitation.checking ? 'Comprobando invitación…' : 'Darme de alta como proveedor'}
            </button>
          )}
          {login && ('href' in login ? (
            <Link to={login.href} className={`${button} ${invitation ? secondary : primary}`}>
              <LogIn aria-hidden="true" className="size-4 shrink-0" />
              Ingresar al sistema
            </Link>
          ) : (
            <button type="button" onClick={login.onClick} disabled={login.busy} className={`${button} ${primary}`}>
              {login.busy ? <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin" /> : <LogIn aria-hidden="true" className="size-4 shrink-0" />}
              {login.busy ? 'Conectando con Google…' : 'Ingresar al sistema'}
            </button>
          ))}
          {status && <p role="status" className="inline-flex items-center justify-center gap-2 text-sm text-slate-600">
            {!login && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
            {status}
          </p>}
          {alert && <div role="alert" className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-800">{alert}</div>}
        </div>

        <nav aria-label="Información de GB GOAT" className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs [@media(max-height:450px)]:mt-3">
          <a href={`${baseUrl}about.html`} className={infoLink}>Sobre GB GOAT</a>
          <a href={`${baseUrl}privacy.html`} className={infoLink}>Privacidad</a>
        </nav>
      </section>
    </main>
  );
}
