import type { ReactNode } from 'react';

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ eyebrow, title, actions, className = '' }: PageHeaderProps) {
  return (
    <header className={`flex flex-col gap-4 border-b border-slate-200 pb-6 lg:flex-row lg:items-end lg:justify-between ${className}`.trim()}>
      <div>
        <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{eyebrow}</div>
        <h1 className="text-xl font-bold leading-none text-black sm:text-2xl">{title}</h1>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
