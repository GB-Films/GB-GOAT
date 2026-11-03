import { LogOut, UserRound } from 'lucide-react';

type Props = {
  name: string; email: string; role: string; photoURL?: string;
  compact?: boolean; onSignOut: () => void;
};

export function AccountMenu({name,email,role,photoURL,compact,onSignOut}: Props) {
  const identity = <div className="flex min-w-0 items-center gap-2.5 rounded-xl p-2.5">
    {photoURL ? <img src={photoURL} alt="" className="h-8 w-8 shrink-0 rounded-full" /> : <UserRound className="h-8 w-8 shrink-0 rounded-full bg-slate-500/10 p-1.5" />}
    <div className="min-w-0 flex-1">
      <p title={name} className="truncate text-xs font-semibold">{name}</p>
      <p title={email} className="truncate text-[11px] opacity-80">{email}</p>
      <p className="truncate text-[10px] opacity-60">{role}</p>
    </div>
  </div>;
  const logout = <button type="button" onClick={onSignOut}
    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors hover:bg-red-500/10 hover:text-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">
    <LogOut className="h-3.5 w-3.5" />Cerrar sesión
  </button>;
  if (compact) return <details className="relative shrink-0 border-l border-slate-200 pl-1">
    <summary className="flex min-w-[64px] cursor-pointer list-none flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
      <UserRound className="h-4 w-4" />Cuenta
    </summary>
    <div className="absolute bottom-full right-0 mb-3 w-64 max-w-[calc(100vw-16px)] rounded-xl border border-slate-200 bg-white p-2 text-slate-900 shadow-xl">
      {identity}{logout}
    </div>
  </details>;
  return <div className="relative shrink-0 border-t border-white/10 bg-[#020817] p-3 text-white">
    {identity}{logout}
  </div>;
}
